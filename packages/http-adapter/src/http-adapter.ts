import type { ZipbulRecord, Class, Context, AdapterEntryDecorators, Result, Err } from '@zipbul/common';
import { Adapter, isErr, err, safe } from '@zipbul/common';
import { StatusCodes } from 'http-status-codes';
import { Logger } from '@zipbul/logger';

import {
  ClusterManager,
  getRuntimeContext,
  type ClusterBaseWorker,
  type ClassMetadata as CoreClassMetadata,
  type ConstructorParamMetadata as CoreConstructorParamMetadata,
  type DecoratorMetadata as CoreDecoratorMetadata,
} from '@zipbul/core';
import type {
  HttpServerBootOptions,
  HttpServerOptions,
  HttpAdapterStartContext,
  InternalRouteHandler,
  InternalRouteEntry,
} from './interfaces';
import type { ClassMetadata, HttpWorkerRpc, JsonValue, MetadataRegistryKey, ParamTypeReference, RequestBodyValue, ResponseBodyValue } from './types';

import { HttpContext } from './http-context';
import { HttpServer } from './http-server';
import { HttpError } from './errors/http-error';
import { HttpResponse } from './http-response';
import { BadRequestError } from './errors/errors';
import { BakerValidationError } from '@zipbul/baker';
import { RestController } from './decorators/class.decorator';
import { Get, Post, Put, Delete, Patch, Options, Head } from './decorators/method.decorator';
import type { RouteHandler } from './route-handler';

import type { ZipbulValue } from '@zipbul/common';

interface ErrorResponseData {
  readonly status: number;
  readonly message?: string;
  readonly errors?: readonly JsonValue[];
}

export class HttpAdapter extends Adapter {
  readonly decorators: AdapterEntryDecorators = {
    controller: RestController,
    handlers: [Get, Post, Put, Delete, Patch, Options, Head],
  };

  private readonly options: HttpServerOptions;
  private clusterManager: ClusterManager<ClusterBaseWorker & HttpWorkerRpc> | undefined;
  private httpServer: HttpServer | undefined;
  private routeHandler: RouteHandler | undefined;
  private readonly logger = new Logger('HttpAdapter');

  private internalRoutes: InternalRouteEntry[] = [];

  constructor(options: HttpServerOptions = {}) {
    super();

    const normalizedOptions: HttpServerOptions = {
      port: 5000,
      bodyLimit: 10 * 1024 * 1024,
      trustProxy: false,
      ...options,
      name: 'zipbul-http',
      logLevel: 'debug',
    };

    this.options = normalizedOptions;
  }

  /**
   * Registers an internal route (e.g. for Scalar API docs).
   *
   * @param method - HTTP method (currently only 'GET' supported).
   * @param path - Route path.
   * @param handler - Route handler function.
   * @public
   */
  registerInternalRoute(method: InternalRouteEntry['method'], path: string, handler: InternalRouteHandler): void {
    this.internalRoutes.push({ method, path, handler });
  }

  // ── Abstract hook implementations ─────────────────────────────

  /**
   * Parses the HTTP request body from the raw Bun `Request`.
   * Runs after `OnReceive` middlewares, before `PostParseData`.
   *
   * @param context - The HTTP context.
   * @public
   */
  async parseInput(context: Context): Promise<void> {
    const http = context.to(HttpContext);
    const req = http.request;
    const rawReq = http.rawRequest;

    if (!rawReq) {
      return;
    }

    const httpMethod = req.httpMethod;

    if (
      httpMethod === 'GET' ||
      httpMethod === 'DELETE' ||
      httpMethod === 'HEAD' ||
      httpMethod === 'OPTIONS'
    ) {
      return;
    }

    const contentType = req.contentType ?? '';

    if (contentType.includes('application/json')) {
      try {
        const parsed = await rawReq.json();

        req.body = parsed as RequestBodyValue;
      } catch {
        throw new BadRequestError('Invalid JSON in request body');
      }
    } else {
      req.body = await rawReq.text();
    }
  }

  /**
   * Matches the request to a route, runs scoped middlewares, and invokes the handler.
   * Returns the handler's result as a `Result<unknown, unknown>`.
   *
   * @param context - The HTTP context.
   * @returns The handler result (success value or `Err`).
   * @public
   */
  async resolveHandler(context: Context): Promise<Result<unknown, unknown>> {
    const http = context.to(HttpContext);
    const req = http.request;
    const res = http.response;
    const method = req.httpMethod;
    const path = req.path;

    if (!this.routeHandler) {
      return err({ status: StatusCodes.INTERNAL_SERVER_ERROR, message: 'Router not initialized' });
    }

    const matchResult = this.routeHandler.match(method, path);

    if (!matchResult) {
      return err({ status: StatusCodes.NOT_FOUND, message: `Route not found: ${method} ${path}` });
    }

    req.params = matchResult.params;

    if (matchResult.value.errorFilters.length > 0) {
      http.setRouteErrorFilters(matchResult.value.errorFilters);
    }

    const scopedResult = await this.runMiddlewares(matchResult.value.middlewares, context);

    if (isErr(scopedResult)) {
      return scopedResult;
    }

    this.logger.debug(`Matched Route: ${method}:${path}`);

    const routeEntry = matchResult.value;
    const handlerArgs = await safe(
      routeEntry.paramFactory(req, res),
      (thrown) => {
        if (thrown instanceof BakerValidationError) {
          return {
            status: StatusCodes.BAD_REQUEST,
            message: thrown.message,
            errors: thrown.errors.map(fieldError => ({
              path: fieldError.path,
              code: fieldError.code,
              ...(fieldError.message !== undefined ? { message: fieldError.message } : {}),
            })),
          };
        }

        throw thrown;
      },
    );

    if (isErr(handlerArgs)) {
      return handlerArgs;
    }

    const result = await routeEntry.handler(...handlerArgs);

    return result;
  }

  /**
   * Converts a `Result` into an HTTP response.
   * On success, writes the handler's return value as the response body.
   * On error, writes an error response with appropriate status code.
   *
   * @param result - The pipeline result.
   * @param context - The HTTP context.
   * @public
   */
  async handleResult(result: Result<unknown, unknown>, context: Context): Promise<void> {
    const http = context.to(HttpContext);
    const res = http.response;

    if (res.isSent()) {
      return;
    }

    if (isErr(result)) {
      this.writeErrorResponse(res, result.data);

      return;
    }

    await this.writeSuccessResponse(res, result);
  }

  /**
   * Emergency connection teardown. Sets a 500 status on the response.
   *
   * @param context - The HTTP context.
   * @public
   */
  forceCloseConnection(context: Context): void {
    const http = context.to(HttpContext);
    const res = http.response;

    if (!res.isSent()) {
      res.setStatus(StatusCodes.INTERNAL_SERVER_ERROR);
      res.setBody('Internal Server Error');
    }
  }

  /**
   * Runs exception filters, checking route-level filters first, then global.
   *
   * @param error - The thrown error.
   * @param context - The current execution context.
   * @returns `Err<unknown>` to feed into `handleResult`.
   * @public
   */
  override async runExceptionFilters(error: unknown, context: Context): Promise<Err<unknown>> {
    const http = context.to(HttpContext);
    const routeFilters = http.routeErrorFilters;

    if (routeFilters !== undefined) {
      for (const entry of routeFilters) {
        if (!this.matchesExceptionFilter(error, entry)) {
          continue;
        }

        return await entry.filter.catch(error, context);
      }
    }

    return super.runExceptionFilters(error, context);
  }

  /**
   * Stores the RouteHandler reference for use by `resolveHandler`.
   * Called by HttpServer during boot.
   *
   * @param routeHandler - The route handler instance.
   * @public
   */
  setRouteHandler(routeHandler: RouteHandler): void {
    this.routeHandler = routeHandler;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async start(context: Context): Promise<void> {
    await Logger.runScoped(this.logger, () => this.startInternal(context));
  }

  private async startInternal(context: Context): Promise<void> {
    const startContext = this.toStartContext(context);
    const workers = this.options.workers;
    const isSingleProcess = workers === undefined || workers === 1;

    const runtimeCtx = getRuntimeContext();

    if (isSingleProcess) {
      this.httpServer = new HttpServer();

      const runtimeContext = runtimeCtx;
      const metadata = this.normalizeMetadataRegistry(runtimeContext.metadataRegistry);
      const scopedKeys = runtimeContext.scopedKeys;
      const bootOptions: HttpServerBootOptions = {
        ...this.options,
        ...(metadata !== undefined ? { metadata } : {}),
        ...(scopedKeys !== undefined ? { scopedKeys } : {}),
        errorFilters: this.errorFilterTokens,
        internalRoutes: this.internalRoutes,
      };

      await this.httpServer.boot(startContext.container, bootOptions, this);

      return;
    }

    // === Multi Process Mode (Cluster) ===
    const entryModule = startContext.entryModule;

    if (!entryModule) {
      throw new Error('Entry Module not found in context. Cannot start Cluster Mode.');
    }

    const script = this.resolveWorkerScript();

    this.clusterManager = new ClusterManager<ClusterBaseWorker & HttpWorkerRpc>({
      script,
      size: workers,
    });

    const sanitizedEntryModule = {
      path: 'unknown',
      className: entryModule.name,
    };
    const initParams: ZipbulRecord = {
      entryModule: {
        path: sanitizedEntryModule.path,
        className: sanitizedEntryModule.className,
      },
      options: {
        ...this.options,
        errorFilters: this.errorFilterTokens,
      },
    };

    await this.clusterManager.init(initParams);
    await this.clusterManager.bootstrap();
  }

  async stop(): Promise<void> {
    if (this.clusterManager !== undefined) {
      await this.clusterManager.destroy();
    }
  }

  protected resolveWorkerScript(): URL {
    const isAotRuntime = getRuntimeContext().isAotRuntime === true;

    if (isAotRuntime) {
      return new URL('./http-worker.ts', import.meta.url);
    }

    return new URL(Bun.argv[1] ?? '', 'file://');
  }

  // ── Response writing ──────────────────────────────────────

  private writeErrorResponse(res: HttpResponse, errorData: unknown): void {
    if (errorData instanceof HttpError) {
      const body: ResponseBodyValue = { statusCode: errorData.statusCode, message: errorData.message };
      res.setStatus(errorData.statusCode);
      res.setBody(body);

      return;
    }

    if (this.isErrorResponseData(errorData)) {
      const body: ResponseBodyValue = {
        status: errorData.status,
        message: String(errorData.message ?? 'Error'),
        ...(errorData.errors !== undefined ? { errors: [...errorData.errors] } : {}),
      };
      res.setStatus(errorData.status);
      res.setBody(body);

      return;
    }

    const body: ResponseBodyValue = { statusCode: StatusCodes.INTERNAL_SERVER_ERROR, message: 'Internal Server Error' };
    res.setStatus(StatusCodes.INTERNAL_SERVER_ERROR);
    res.setBody(body);
  }

  private async writeSuccessResponse(res: HttpResponse, result: unknown): Promise<void> {
    if (result instanceof Response) {
      res.setStatus(result.status);

      for (const [key, value] of result.headers.entries()) {
        res.setHeader(key, value);
      }

      const arrayBuffer = await result.arrayBuffer();

      if (arrayBuffer.byteLength > 0) {
        res.setBody(new Uint8Array(arrayBuffer));
      }

      return;
    }

    if (result instanceof HttpResponse) {
      return;
    }

    if (result === undefined || result === null) {
      return;
    }

    if (typeof result === 'bigint') {
      res.setBody(result.toString());

      return;
    }

    res.setBody(result as ResponseBodyValue);
  }

  private isErrorResponseData(value: unknown): value is ErrorResponseData {
    return (
      typeof value === 'object' &&
      value !== null &&
      'status' in value &&
      typeof value.status === 'number'
    );
  }

  // ── Internals ─────────────────────────────────────────────

  private toStartContext(context: Context): HttpAdapterStartContext {
    if (!this.isStartContext(context)) {
      throw new Error('Adapter context missing container.');
    }

    return context;
  }

  private isStartContext(value: Context): value is HttpAdapterStartContext {
    return typeof value === 'object' && value !== null && 'container' in value;
  }

  private normalizeMetadataRegistry(
    registry:
      | Map<MetadataRegistryKey, ClassMetadata | CoreClassMetadata>
      | Map<Class, ClassMetadata | CoreClassMetadata>
      | undefined,
  ): Map<MetadataRegistryKey, ClassMetadata> | undefined {
    if (!registry) {
      return undefined;
    }

    const normalized = new Map<MetadataRegistryKey, ClassMetadata>();

    for (const [key, value] of registry.entries()) {
      if (this.isClassToken(key)) {
        normalized.set(key, this.toHttpClassMetadata(value));
      }
    }

    return normalized;
  }

  private toHttpClassMetadata(value: ClassMetadata | CoreClassMetadata): ClassMetadata {
    if (this.isHttpClassMetadata(value)) {
      return value;
    }

    const decorators = value.decorators ? this.normalizeCoreDecorators(value.decorators) : undefined;
    const constructorParams = value.constructorParams ? this.normalizeCoreConstructorParams(value.constructorParams) : undefined;

    return {
      ...(decorators !== undefined ? { decorators } : {}),
      ...(constructorParams !== undefined ? { constructorParams } : {}),
    };
  }

  private isHttpClassMetadata(value: ClassMetadata | CoreClassMetadata): value is ClassMetadata {
    return 'methods' in value || 'className' in value;
  }

  private normalizeCoreDecorators(decorators: readonly CoreDecoratorMetadata[]): ClassMetadata['decorators'] {
    return decorators.map(decorator => ({ name: decorator.name }));
  }

  private normalizeCoreConstructorParams(params: readonly CoreConstructorParamMetadata[]): ClassMetadata['constructorParams'] {
    return params.map(param => {
      const type = this.isProviderToken(param.type) ? param.type : undefined;
      const decorators = param.decorators ? this.normalizeCoreDecorators(param.decorators) : undefined;

      return {
        ...(type !== undefined ? { type } : {}),
        ...(decorators !== undefined ? { decorators } : {}),
      };
    });
  }

  private isProviderToken(value: CoreConstructorParamMetadata['type']): value is ParamTypeReference {
    return typeof value === 'string' || typeof value === 'symbol' || typeof value === 'function';
  }

  private isClassToken(value: MetadataRegistryKey | Class): value is MetadataRegistryKey {
    return typeof value === 'function';
  }
}
