import type { AdapterContext, ApplicationContext, AdapterEntryDecorators, CompiledHandlerEntry } from '@zipbul/common';
import type { MiddlewareDefinition } from '@zipbul/common';
import { err, isErr } from '@zipbul/result';
import type { Result, Err } from '@zipbul/result';
import { Adapter, handlerResultKey } from '@zipbul/core';
import type { ResolvedMiddleware, ResolvedValidationEntry, PipelineStepFn } from '@zipbul/core';
import { StatusCodes } from 'http-status-codes';
import { Logger } from '@zipbul/logger';

import { getBootstrapState } from '@zipbul/core';
import type {
  HttpServerBootOptions,
  HttpServerOptions,
  InternalRouteHandler,
  InternalRouteEntry,
} from './interfaces';
import type { ErrorResponseData, RouteHandlerFunction, RouteHandlerResult } from './types';

import { HttpContext } from './http-context';
import type { Server } from 'bun';

import { HttpServer } from './http-server';
import type { HttpServerMetrics } from './http-server';
import { HttpResponse } from './http-response';
import { isBakerError } from '@zipbul/baker';
import { RestController } from './decorators/class.decorator';
import { Get, Post, Put, Delete, Patch, Options, Head, Method } from './decorators/method.decorator';
import { RawBody, Sse, BodyLimit, Status, Redirect, ContentType as ContentTypeDecorator, Header } from './decorators/method-option.decorator';
import type { RouteHandler } from './route-handler';
import type { ResolvedRoutePipeline } from './route-handler';
import { HttpPhase, HttpStep, HeaderField } from './enums';
import { parseBody } from './body';
import { writeErrorResponse, writeSuccessResponse } from './response-writer';
import { normalizeMetadataRegistry } from './metadata';

function formatUnknownError(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

// ── HttpAdapter ──────────────────────────────────────────────

export class HttpAdapter extends Adapter {
  static override readonly validPhases: ReadonlySet<string> = new Set(Object.values(HttpPhase));

  readonly decorators: AdapterEntryDecorators = {
    controller: RestController,
    handlers: [Get, Post, Put, Delete, Patch, Options, Head, Method],
    options: [RawBody, Sse, BodyLimit, Status, Redirect, ContentTypeDecorator, Header],
  };

  private readonly options: HttpServerOptions;
  private readonly textMediaTypes: ReadonlySet<string>;
  private httpServer: HttpServer | undefined;
  private routeHandler: RouteHandler | undefined;
  private readonly logger = new Logger('HttpAdapter');

  private internalRoutes: InternalRouteEntry[] = [];

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
    this.textMediaTypes = new Set(normalizedOptions.textMediaTypes ?? []);
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
   * Typed programmatic middleware registration for HTTP phases.
   *
   * @param phase - The HTTP pipeline phase.
   * @param middlewares - Middleware definitions to append.
   * @returns `this` for chaining.
   * @public
   */
  addMiddlewares(phase: HttpPhase, middlewares: readonly MiddlewareDefinition[]): this {
    this.registerMiddleware(phase, middlewares);
    return this;
  }


  // ── Finalize middlewares ─────────────────────────────────────

  /**
   * Returns `AfterResponse` phase middlewares for Phase 3 finalize.
   *
   * @returns Resolved AfterResponse middlewares.
   * @public
   */
  protected override getFinalizeMiddlewares(): readonly ResolvedMiddleware[] {
    return this.getPhaseMiddlewares(HttpPhase.AfterResponse);
  }

  // ── Pipeline assembly ───────────────────────────────────────

  /**
   * HTTP-specific pipeline execution.
   *
   * Pre-route: OnRequest global MW → route resolution.
   * Post-route: `runPipeline(ctx, pre, handler, post, filters)` with per-handler compiled pipeline.
   *
   * @param context - The execution context.
   * @public
   */
  protected async executePipeline(context: AdapterContext): Promise<void> {
    const http = context.to(HttpContext);

    // ── Pre-route: global OnRequest phase middlewares ──
    const onRequestMws = this.getPhaseMiddlewares(HttpPhase.OnRequest);

    if (onRequestMws.length > 0) {
      const result = await this.runHttpMiddlewares(onRequestMws, http);

      if (result !== undefined && isErr(result)) {
        writeErrorResponse(http.response, result.data as ErrorResponseData);
        return;
      }

      if (http.response.isSent()) return;
    }

    // ── Pipeline error (malformed request from HttpServer) ──
    if (http.pipelineError !== undefined) {
      writeErrorResponse(http.response, http.pipelineError);
      return;
    }

    // ── Route resolution ──
    const routeResult = this.resolveRoute(http);

    if (isErr(routeResult)) {
      writeErrorResponse(http.response, routeResult.data);
      return;
    }

    if (http.response.isSent()) return;

    const route = http.matchedRoute!;

    // ── Handler step ──
    const handlerFn: PipelineStepFn = async () => {
      if (route.applyResponseDefaults !== undefined) {
        route.applyResponseDefaults(http.response);
      }

      return route.handler(http);
    };

    // ── Execute pre → handler → post via core ──
    await this.runPipeline(context, route.pre, handlerFn, route.post, route.filters);
  }

  // ── Pipeline building (boot-time) ──────────────────────────

  /**
   * Resolves a compiled handler entry into ready-to-call pipeline functions.
   * Called by RouteHandler during route registration via `PipelineBuildFn`.
   *
   * @param entry - The AOT-compiled handler entry.
   * @param validations - Resolved validation entries.
   * @param _handler - Resolved handler function (unused — handler is called via route metadata).
   * @param _applyResponseDefaults - Response defaults applier (unused — applied in executePipeline).
   * @returns Resolved pipeline with pre/post step functions and exception filters.
   * @public
   */
  buildRoutePipeline(
    entry: CompiledHandlerEntry,
    validations: readonly ResolvedValidationEntry[],
    _handler: RouteHandlerFunction,
    _applyResponseDefaults?: (response: HttpResponse) => void,
  ): ResolvedRoutePipeline {
    const phaseMws = entry.mergedPhaseMiddlewareKeys !== undefined
      ? this.resolvePhaseMiddlewareKeys(entry.mergedPhaseMiddlewareKeys)
      : {};
    const guards = entry.mergedGuardKeys !== undefined
      ? this.resolveGuardKeys(entry.mergedGuardKeys)
      : [...this.resolvedGuards];
    const filters = entry.mergedExceptionFilterKeys !== undefined
      ? this.resolveExceptionFilterKeys(entry.mergedExceptionFilterKeys)
      : [...this.resolvedExceptionFilters];

    const adapterSteps = this.buildAdapterStepFns(phaseMws);

    // Skip pre-route steps (handled by executePipeline)
    const compiledPre = entry.compiledPre ?? [];
    const routeBoundary = compiledPre.indexOf(HttpStep.ResolveRoute);
    const postRouteSteps = routeBoundary >= 0 ? compiledPre.slice(routeBoundary + 1) : compiledPre;
    const preSteps = postRouteSteps.filter(step => step !== HttpPhase.OnRequest);

    // Skip AfterResponse (handled by finalize)
    const postSteps = (entry.compiledPost ?? []).filter(step => step !== HttpPhase.AfterResponse);

    // Core resolves core steps + adapter steps in one pass
    const pre = this.resolveStepFns(preSteps, adapterSteps, guards, validations);
    const post = this.resolveStepFns(postSteps, adapterSteps, guards, validations);

    return { pre, post, filters };
  }

  /**
   * Builds a Map of adapter step names to `PipelineStepFn` closures.
   * Only adapter phases and adapter steps — no core steps.
   *
   * @param phaseMws - Resolved phase middlewares from merged keys.
   * @returns Map from step name to ready-to-call step function.
   */
  private buildAdapterStepFns(
    phaseMws: Readonly<Record<string, readonly ResolvedMiddleware[]>>,
  ): ReadonlyMap<string, PipelineStepFn> {
    const resolvePhaseMws = (phase: string): readonly ResolvedMiddleware[] =>
      phaseMws[phase] ?? this.getPhaseMiddlewares(phase);

    return new Map<string, PipelineStepFn>([
      // ── Adapter phases ──
      [HttpPhase.BeforeParse, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        if (http.response.isSent()) return undefined;
        return this.runHttpMiddlewares(resolvePhaseMws(HttpPhase.BeforeParse), http);
      }],
      [HttpPhase.BeforeValidate, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        if (http.response.isSent()) return undefined;
        return this.runHttpMiddlewares(resolvePhaseMws(HttpPhase.BeforeValidate), http);
      }],
      [HttpPhase.BeforeHandle, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        if (http.response.isSent()) return undefined;
        return this.runHttpMiddlewares(resolvePhaseMws(HttpPhase.BeforeHandle), http);
      }],
      [HttpPhase.AfterHandle, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        if (http.response.hasNativeResponse() || http.response.isSent()) return undefined;
        return this.runHttpMiddlewares(resolvePhaseMws(HttpPhase.AfterHandle), http);
      }],
      [HttpPhase.BeforeResponse, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        return this.runHttpMiddlewares(resolvePhaseMws(HttpPhase.BeforeResponse), http);
      }],

      // ── Adapter steps ──
      [HttpStep.ParseBody, (context: AdapterContext) =>
        parseBody(context.to(HttpContext), this.options.bodyLimit!, this.textMediaTypes),
      ],
      [HttpStep.WriteResponse, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        const result = context.get(handlerResultKey);

        if (http.response.isSent() || result === undefined) return;

        if (isErr(result)) {
          writeErrorResponse(http.response, result.data as ErrorResponseData);
        } else {
          await writeSuccessResponse(http.response, result as RouteHandlerResult, http);
        }
      }],
      [HttpStep.Serialize, (context: AdapterContext) => {
        context.to(HttpContext).response.serialize();
      }],
    ]);
  }


  /**
   * Matches the request to a route and stores metadata on the context.
   * Extracted from the former `resolveHandler` front-half.
   *
   * @param http - The HTTP context.
   * @returns `Ok` on match, `Err` for 404/500.
   */
  private resolveRoute(http: HttpContext): Result<void, ErrorResponseData> {
    const req = http.request;

    if (this.routeHandler === undefined) {
      return err({ status: StatusCodes.INTERNAL_SERVER_ERROR, message: 'Router not initialized' });
    }

    const matchResult = this.routeHandler.matchRoute(req.method, req.path);

    if (matchResult.kind === 'not-found') {
      return err({ status: StatusCodes.NOT_FOUND, message: 'Not Found' });
    }

    if (matchResult.kind === 'method-not-allowed') {
      if (req.method === 'OPTIONS') {
        http.response.setHeader(HeaderField.Allow, matchResult.allowedMethods.join(', '));
        http.response.setStatus(StatusCodes.NO_CONTENT);
        http.response.send();
        return undefined;
      }

      // RFC 9110 §15.5.6: Allow 헤더 필수
      http.response.setHeader(HeaderField.Allow, matchResult.allowedMethods.join(', '));
      return err({ status: StatusCodes.METHOD_NOT_ALLOWED, message: 'Method Not Allowed' });
    }

    req.params = matchResult.params;
    http.matchedRoute = matchResult.route;

    return undefined;
  }



  /**
   * Wraps baker validation errors as HTTP 400 with field-level details.
   * Non-baker errors are re-thrown to enter the exception filter path.
   *
   * @param _entry - The validation entry that failed.
   * @param errors - The `BakerErrors` returned by baker `deserialize()`.
   * @returns `Err` with structured 400 response for baker errors.
   * @public
   */
  /**
   * HTTP protocol translation for unhandled throws.
   *
   * Symmetric to {@link wrapValidationError}: the base class emits a
   * protocol-agnostic `{ message, cause }` shape which cannot be rendered
   * as an HTTP response. This override returns an {@link ErrorResponseData}
   * (generic 500) so the `WriteResponse` step can render a conforming wire
   * response without any runtime shape inspection.
   */
  protected override wrapUnhandledException(_error: unknown): Err<unknown> {
    return err({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: 'Internal Server Error',
    } satisfies ErrorResponseData);
  }

  /**
   * HTTP protocol translation for filter-author contract violations
   * (matched filter returned a non-`Err` value). Same shape as
   * {@link wrapUnhandledException} — generic 500.
   */
  protected override wrapInvalidFilterResult(_error: unknown, _filterResult: unknown): Err<unknown> {
    return err({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: 'Internal Server Error',
    } satisfies ErrorResponseData);
  }

  protected override wrapValidationError(_entry: ResolvedValidationEntry, errors: unknown): Err<unknown> {
    if (isBakerError(errors)) {
      return err({
        status: StatusCodes.BAD_REQUEST,
        message: 'Validation failed',
        errors: errors.errors.map(fieldError => ({
          path: fieldError.path,
          code: fieldError.code,
          ...(fieldError.message !== undefined ? { message: fieldError.message } : {}),
        })),
      });
    }
    throw errors;
  }

  /**
   * HTTP-specific middleware runner with `isSent()` check after each middleware.
   * HttpContext는 Context 인터페이스를 구조적으로 만족한다.
   *
   * @param list - Resolved middlewares to execute.
   * @param http - The HTTP context.
   * @returns Middleware result.
   */
  private async runHttpMiddlewares(
    list: readonly ResolvedMiddleware[],
    http: HttpContext,
  ): Promise<Result<void, unknown>> {
    for (const mw of list) {
      const result = await mw.handler(http);
      if (isErr(result)) return result;
      if (http.response.isSent()) return undefined;
    }
    return undefined;
  }

  /**
   * Emergency teardown. Sets a 500 status on the response.
   *
   * @param context - The HTTP context.
   * @param error - The error that triggered teardown.
   * @public
   */
  protected emergencyTeardown(context: AdapterContext, error?: unknown): void {
    if (error instanceof Error) {
      this.logger.error(`emergencyTeardown: ${error.message}`, error);
    } else if (error !== undefined) {
      this.logger.error(`emergencyTeardown: ${formatUnknownError(error)}`);
    }

    const http = context.to(HttpContext);
    const res = http.response;

    if (!res.isSent()) {
      // Philosophy: `throw` reaching this point means an invariant was
      // violated (bug, misconfiguration, or unexpected failure). Request
      // errors flow as `Err<ErrorResponseData>`, not exceptions. Respond
      // with a generic 500; headers set earlier (CORS, security) survive.
      res.setStatus(StatusCodes.INTERNAL_SERVER_ERROR);
      res.setContentType('text/plain');
      res.setBody('Internal Server Error');
    }
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

  async start(context: ApplicationContext): Promise<void> {
    await Logger.runScoped(this.logger, () => this.startInternal(context));
  }

  private async startInternal(context: ApplicationContext): Promise<void> {
    const bootstrapState = getBootstrapState();

    this.httpServer = new HttpServer();

    const metadata = normalizeMetadataRegistry(bootstrapState.metadataRegistry);
    const scopedKeys = bootstrapState.scopedKeys;
    const bootOptions: HttpServerBootOptions = {
      ...this.options,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(scopedKeys !== undefined ? { scopedKeys } : {}),
      internalRoutes: this.internalRoutes,
      ...(bootstrapState.handlerIndex !== undefined ? { handlerIndex: bootstrapState.handlerIndex } : {}),
      ...(bootstrapState.controllerInstances !== undefined ? { controllerInstances: bootstrapState.controllerInstances } : {}),
    };

    await this.httpServer.boot(context.container, bootOptions, this);
  }

  async stop(): Promise<void> {
    if (this.httpServer !== undefined) {
      await this.httpServer.stop();
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
      await server.stop(true);
    }
  }

  /**
   * Returns current HTTP server metrics for observability.
   *
   * @returns Metrics snapshot, or `undefined` if the server is not running.
   * @public
   */
  getMetrics(): HttpServerMetrics | undefined {
    return this.httpServer?.getMetrics();
  }

  /**
   * Returns the underlying Bun Server instance.
   *
   * Primarily for observability (e.g. reading `server.port` after a dynamic
   * `port: 0` bind) and integration testing.
   *
   * @returns The Bun Server, or `undefined` if not yet booted.
   * @public
   */
  getServer(): Server<unknown> | undefined {
    return this.httpServer?.getServer();
  }

}
