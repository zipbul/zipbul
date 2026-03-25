import type { Context, AdapterEntryDecorators, Result, ResultAsync, Err, ZipbulContainer } from '@zipbul/common';
import type { MiddlewareDefinition } from '@zipbul/common';
import { Adapter, isErr, err, safe } from '@zipbul/common';
import type { ResolvedMiddleware } from '@zipbul/common';
import { StatusCodes } from 'http-status-codes';
import { Logger } from '@zipbul/logger';

import {
  getRuntimeContext,
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
import type { ClassMetadata, JsonValue, MetadataRegistryKey, ParamTypeReference, RequestBodyValue, ResponseBodyValue } from './types';
import type { Class } from '@zipbul/common';

import { HttpContext } from './http-context';
import { HttpServer } from './http-server';
import { HttpError } from './errors/http-error';
import { HttpResponse } from './http-response';
import { BakerValidationError } from '@zipbul/baker';
import { RestController } from './decorators/class.decorator';
import { Get, Post, Put, Delete, Patch, Options, Head } from './decorators/method.decorator';
import type { RouteHandler } from './route-handler';
import { HttpPhase, isHttpPhase } from './enums';


interface ErrorResponseData {
  readonly status: number;
  readonly message?: string;
  readonly errors?: readonly JsonValue[];
}

export class HttpAdapter extends Adapter {
  static override readonly validPhases: ReadonlySet<string> = new Set(Object.values(HttpPhase));

  readonly decorators: AdapterEntryDecorators = {
    controller: RestController,
    handlers: [Get, Post, Put, Delete, Patch, Options, Head],
  };

  private readonly options: HttpServerOptions;
  private httpServer: HttpServer | undefined;
  private routeHandler: RouteHandler | undefined;
  private readonly logger = new Logger('HttpAdapter');

  private internalRoutes: InternalRouteEntry[] = [];

  private middlewareRegistry = new Map<HttpPhase, MiddlewareDefinition[]>();
  private resolvedMiddlewareRegistry = new Map<HttpPhase, ResolvedMiddleware[]>();

  constructor(options: HttpServerOptions = {}) {
    super();

    const normalizedOptions: HttpServerOptions = {
      name: 'zipbul-http',
      logLevel: 'debug',
      port: 5000,
      bodyLimit: 10 * 1024 * 1024,
      trustProxy: false,
      ...options,
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

  // ── Middleware configuration ─────────────────────────────────

  /**
   * Receives AOT-generated middleware configuration.
   * Validates phase keys against `HttpPhase` and stores definitions.
   *
   * @param config - Phase-keyed middleware definitions from AOT.
   * @public
   */
  applyMiddlewareConfig(
    config: Readonly<Record<string, readonly MiddlewareDefinition[]>>,
  ): void {
    for (const [key, definitions] of Object.entries(config)) {
      if (!isHttpPhase(key)) {
        throw new Error(
          `Invalid middleware phase '${key}' for HttpAdapter. Valid phases: ${Object.values(HttpPhase).join(', ')}.`,
        );
      }

      const existing = this.middlewareRegistry.get(key) ?? [];
      this.middlewareRegistry.set(key, [...existing, ...definitions]);
    }
  }

  /**
   * Convenience method for programmatic middleware registration.
   *
   * @param phase - The HTTP pipeline phase.
   * @param middlewares - Middleware definitions to append.
   * @returns `this` for chaining.
   * @public
   */
  addMiddlewares(phase: HttpPhase, middlewares: readonly MiddlewareDefinition[]): this {
    this.validateAdapterCompatibility(middlewares, 'Middleware');

    const existing = this.middlewareRegistry.get(phase) ?? [];
    this.middlewareRegistry.set(phase, [...existing, ...middlewares]);
    return this;
  }

  // ── Pipeline initialization ─────────────────────────────────

  /**
   * Resolves guards, exception filters (Common), and middleware factories (HttpAdapter).
   *
   * @param container - The application DI container.
   * @public
   */
  override initializePipeline(container: ZipbulContainer): void {
    super.initializePipeline(container);

    for (const [phase, definitions] of this.middlewareRegistry) {
      this.resolvedMiddlewareRegistry.set(
        phase,
        this.resolveMiddlewareDefs(definitions, container),
      );
    }
  }

  // ── Finalize middlewares ─────────────────────────────────────

  /**
   * Returns `OnComplete` phase middlewares for Phase 3 finalize.
   *
   * @returns Resolved OnComplete middlewares.
   * @public
   */
  protected override getFinalizeMiddlewares(): readonly ResolvedMiddleware[] {
    return this.resolvedMiddlewareRegistry.get(HttpPhase.OnComplete) ?? [];
  }

  // ── Pipeline assembly ───────────────────────────────────────

  /**
   * HTTP-specific pipeline:
   * OnReceive → resolveRoute → parseBody → PostParse → Guards → PreHandle → executeHandler
   *
   * @param context - The HTTP context.
   * @returns Pipeline result.
   * @public
   */
  protected async executePipeline(context: Context): Promise<Result<unknown, unknown>> {
    const http = context.to(HttpContext);

    // 1. OnReceive — CORS, logging, method override, URL rewriting
    const onReceive = await this.runMiddlewares(
      this.resolvedMiddlewareRegistry.get(HttpPhase.OnReceive) ?? [], context,
    );

    if (isErr(onReceive)) {
      return onReceive;
    }

    // 2. Route Match — match against final method/path. 404/405 early return
    const routeResult = this.resolveRoute(http);

    if (isErr(routeResult)) {
      return routeResult;
    }

    // 3. Parse Body — @RawBody flag accessible via matchedRoute
    const parseResult = await this.parseBody(http);

    if (isErr(parseResult)) {
      return parseResult;
    }

    // 4. PostParse — query parsing, cookie parsing, body transformation
    const postParse = await this.runMiddlewares(
      this.resolvedMiddlewareRegistry.get(HttpPhase.PostParse) ?? [], context,
    );

    if (isErr(postParse)) {
      return postParse;
    }

    // 5. Guards — global access control
    const guards = await this.runGuards(context);

    if (isErr(guards)) {
      return guards;
    }

    // 6. PreHandle — final processing before handler
    const preHandle = await this.runMiddlewares(
      this.resolvedMiddlewareRegistry.get(HttpPhase.PreHandle) ?? [], context,
    );

    if (isErr(preHandle)) {
      return preHandle;
    }

    // 7. Execute Handler — route MW → route guards → param resolve → handler
    return this.executeHandler(http, context);
  }

  // ── Pipeline steps ──────────────────────────────────────────

  /**
   * Matches the request to a route and stores metadata on the context.
   * Extracted from the former `resolveHandler` front-half.
   *
   * @param http - The HTTP context.
   * @returns `Ok` on match, `Err` for 404/500.
   */
  private resolveRoute(http: HttpContext): Result<unknown, unknown> {
    const req = http.request;
    const method = req.httpMethod;
    const path = req.path;

    if (this.routeHandler === undefined) {
      return err({ status: StatusCodes.INTERNAL_SERVER_ERROR, message: 'Router not initialized' });
    }

    const matchResult = this.routeHandler.match(method, path);

    if (matchResult === undefined) {
      return err({ status: StatusCodes.NOT_FOUND, message: `Route not found: ${method} ${path}` });
    }

    req.params = matchResult.params;
    http.matchedRoute = matchResult.value;

    if (matchResult.value.exceptionFilters.length > 0) {
      http.setRouteExceptionFilters(matchResult.value.exceptionFilters);
    }

    return undefined;
  }

  /**
   * Parses the HTTP request body from the raw Bun `Request`.
   * Runs after `resolveRoute` so `@RawBody()` flag is accessible.
   *
   * @param http - The HTTP context.
   * @returns `void` on success, `Err` with 400 status on invalid JSON.
   */
  private async parseBody(http: HttpContext): ResultAsync<void, unknown> {
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
        return err({ status: StatusCodes.BAD_REQUEST, message: 'Invalid JSON in request body' });
      }
    } else {
      req.body = await rawReq.text();
    }
  }

  /**
   * Runs route-scoped middleware, guards, param resolution, and handler invocation.
   * Extracted from the former `resolveHandler` back-half.
   *
   * @param http - The HTTP context.
   * @param context - The base context for middleware/guard execution.
   * @returns Handler result.
   */
  private async executeHandler(http: HttpContext, context: Context): Promise<Result<unknown, unknown>> {
    const route = http.matchedRoute!;

    this.logger.debug(`Pipeline: mw=${route.middlewares.length} guards=${route.guards.length} filters=${route.exceptionFilters.length}`);

    // Route-scoped middlewares
    const scopedResult = await this.runMiddlewares(route.middlewares, context);

    if (isErr(scopedResult)) {
      return scopedResult;
    }

    // Route-level guards: after route middlewares, before param resolution
    for (const guard of route.guards) {
      const guardResult = await guard(context);

      if (isErr(guardResult)) {
        return guardResult;
      }
    }

    this.logger.debug(`Matched Route: ${http.request.httpMethod}:${http.request.path}`);

    const handlerArgs = await safe(
      route.paramFactory(http.request, http.response),
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

    return route.handler(...handlerArgs);
  }

  // ── Result handling ─────────────────────────────────────────

  /**
   * Converts a `Result` into an HTTP response.
   * On success, writes the handler's return value as the response body.
   * On error, writes an error response with appropriate status code.
   *
   * @param result - The pipeline result.
   * @param context - The HTTP context.
   * @public
   */
  protected override async handleResult(result: Result<unknown, unknown>, context: Context): Promise<void> {
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
   * Emergency teardown. Sets a 500 status on the response.
   *
   * @param context - The HTTP context.
   * @param error - The error that triggered teardown.
   * @public
   */
  protected emergencyTeardown(context: Context, error?: unknown): void {
    if (error instanceof Error) {
      this.logger.error(`emergencyTeardown: ${error.message}`, error);
    } else if (error !== undefined) {
      this.logger.error(`emergencyTeardown: ${String(error)}`);
    }

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
    const routeFilters = http.routeExceptionFilters;

    if (routeFilters !== undefined) {
      for (const entry of routeFilters) {
        if (!this.matchesExceptionFilter(error, entry)) {
          continue;
        }

        const filterResult = await entry.handler(error, context);

        if (!isErr(filterResult)) {
          return err({ message: 'Exception filter must return Err', cause: error });
        }

        return filterResult;
      }
    }

    return super.runExceptionFilters(error, context);
  }

  /**
   * Stores the RouteHandler reference for use by `resolveRoute`.
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
    const runtimeCtx = getRuntimeContext();

    this.httpServer = new HttpServer();

    const metadata = this.normalizeMetadataRegistry(runtimeCtx.metadataRegistry);
    const scopedKeys = runtimeCtx.scopedKeys;
    const bootOptions: HttpServerBootOptions = {
      ...this.options,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(scopedKeys !== undefined ? { scopedKeys } : {}),
      internalRoutes: this.internalRoutes,
      ...(runtimeCtx.handlerIndex !== undefined ? { handlerIndex: runtimeCtx.handlerIndex } : {}),
      ...(runtimeCtx.controllerInstances !== undefined ? { controllerInstances: runtimeCtx.controllerInstances } : {}),
    };

    await this.httpServer.boot(startContext.container, bootOptions, this);
  }

  async stop(): Promise<void> {
    if (this.httpServer !== undefined) {
      this.httpServer.stop();
    }
  }

  /**
   * Stops accepting new connections and waits for in-flight requests to complete.
   * Uses Bun's built-in server.stop() drain mechanism with a timeout fallback.
   *
   * @param timeoutMs - Maximum time to wait before force-closing connections.
   * @public
   */
  override async drain(timeoutMs: number): Promise<void> {
    if (!this.httpServer) return;

    const server = this.httpServer.getServer();

    if (!server) return;

    // server.stop() = graceful drain (waits for in-flight requests indefinitely)
    // Promise.race with timeout to prevent infinite wait
    await Promise.race([
      server.stop(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);

    // If requests remain after timeout, force close
    if (server.pendingRequests > 0 || server.pendingWebSockets > 0) {
      server.stop(true);
    }
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

  /**
   * Converts a successful handler result into an HTTP response.
   *
   * When the handler returns a raw `Response` object, this method extracts
   * its status, headers, and body into the `HttpResponse` builder. This is
   * an escape hatch that bypasses the normal `HttpResponse` build chain —
   * use it when direct control over the raw response is required (e.g.
   * streaming, SSE, or proxied responses).
   *
   * @param res - The HTTP response builder.
   * @param result - The handler's return value.
   */
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

    if (this.isResponseBodyValue(result)) {
      res.setBody(result);
    }
  }

  private isResponseBodyValue(value: unknown): value is ResponseBodyValue {
    if (value === null) {
      return true;
    }

    const valueType = typeof value;

    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
      return true;
    }

    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return true;
    }

    if (valueType === 'object') {
      return true;
    }

    return false;
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
