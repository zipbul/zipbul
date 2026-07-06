import type {
  AdapterContext,
  ApplicationContext,
  AdapterEntryDecorators,
  AugmentAccessorRegistryEntry,
  CompiledHandlerEntry,
} from '@zipbul/common';
import { err, isErr } from '@zipbul/result';
import type { Result, Err } from '@zipbul/result';
import { Adapter, handlerResultKey, getBootstrapState, TEST_SURFACE } from '@zipbul/core';
import type { HttpTestSurface } from './test-surface';
import { createHttpInjectSurface } from './test-surface';
import { createStubBunServer } from './stub-bun-server';
import type { ResolvedMiddleware, ResolvedValidationEntry, PipelineStepFn } from '@zipbul/core';
import { Logger } from '@zipbul/logger';

import type {
  HttpServerBootOptions,
  HttpServerOptions,
  InternalRouteEntry,
  ErrorResponseData,
} from './interfaces';
import type { InternalRouteHandler, RouteHandlerFunction, RouteHandlerResult } from './types';

import { HttpContext } from './http-context';
import type { Server } from 'bun';

import { HttpServer } from './http-server';
import type { HttpServerMetrics } from './http-server';
import { HttpResponse } from './http-response';
import { isBakerIssueSet } from '@zipbul/baker';
import { RestController } from './decorators/class.decorator';
import { Get, Post, Put, Delete, Patch, Options, Head, Method } from './decorators/method.decorator';
import { RawBody, Sse, BodyLimit, Status, Redirect, ContentType as ContentTypeDecorator, Header } from './decorators/method-option.decorator';
import type { RouteHandler, ResolvedRoutePipeline } from './route-handler';
import { DEFAULT_BODY_LIMIT_BYTES, DEFAULT_HTTP_PORT, TEXT_ENCODER, CACHE_CONTROL_NO_CACHE, CONNECTION_KEEP_ALIVE, X_ACCEL_BUFFERING_OFF } from './constants';
import { HttpHeader, HttpStatus, HttpAdapterPhase, HttpAdapterStep, ContentType } from './enums';
import { parseBody } from './body';
import { isAsyncIterable, formatSSEChunk } from './server-sent-event';
import { writeErrorResponse, writeSuccessResponse } from './response-writer';
import { normalizeMetadataRegistry } from './metadata';
import { HTTP_NAMESPACE_PROTOTYPES } from './context-namespaces';

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
  static override readonly validPhases: ReadonlySet<string> = new Set(Object.values(HttpAdapterPhase));

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

  /**
   * DECLARATION: the HTTP context namespaces and the prototypes their augment
   * members install on (`request` → {@link HttpRequest}, `response` →
   * {@link HttpResponse}). Core owns the install mechanism; the adapter only
   * declares these targets.
   */
  protected override namespacePrototypes(): Readonly<Record<string, object>> {
    return HTTP_NAMESPACE_PROTOTYPES;
  }

  /**
   * Exposes the AOT-emitted accessor registry to {@link HttpServer} for
   * RouteHandler validation wiring.
   *
   * @internal
   */
  getAugmentAccessors(): readonly AugmentAccessorRegistryEntry[] {
    return this.getAugmentAccessorRegistry();
  }

  constructor(options: HttpServerOptions = {}) {
    super();

    const normalizedOptions: HttpServerOptions = {
      name: 'zipbul-http',
      logLevel: 'debug',
      port: DEFAULT_HTTP_PORT,
      bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
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

  // ── Finalize middlewares ─────────────────────────────────────

  /**
   * Returns `AfterResponse` phase middlewares for Phase 3 finalize.
   *
   * @returns Resolved AfterResponse middlewares.
   * @public
   */
  protected override getFinalizeMiddlewares(): readonly ResolvedMiddleware[] {
    return this.getPhaseMiddlewares(HttpAdapterPhase.AfterResponse);
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
    const onRequestMws = this.getPhaseMiddlewares(HttpAdapterPhase.OnRequest);

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
    const routeBoundary = compiledPre.indexOf(HttpAdapterStep.ResolveRoute);
    const postRouteSteps = routeBoundary >= 0 ? compiledPre.slice(routeBoundary + 1) : compiledPre;
    const preSteps = postRouteSteps.filter(step => step !== HttpAdapterPhase.OnRequest);

    // Skip AfterResponse (handled by finalize)
    const postSteps = (entry.compiledPost ?? []).filter(step => step !== HttpAdapterPhase.AfterResponse);

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
      [HttpAdapterPhase.BeforeParse, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        if (http.response.isSent()) return undefined;
        return this.runHttpMiddlewares(resolvePhaseMws(HttpAdapterPhase.BeforeParse), http);
      }],
      [HttpAdapterPhase.BeforeValidate, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        if (http.response.isSent()) return undefined;
        return this.runHttpMiddlewares(resolvePhaseMws(HttpAdapterPhase.BeforeValidate), http);
      }],
      [HttpAdapterPhase.BeforeHandle, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        if (http.response.isSent()) return undefined;
        return this.runHttpMiddlewares(resolvePhaseMws(HttpAdapterPhase.BeforeHandle), http);
      }],
      [HttpAdapterPhase.AfterHandle, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        if (http.response.hasNativeResponse() || http.response.isSent()) return undefined;
        return this.runHttpMiddlewares(resolvePhaseMws(HttpAdapterPhase.AfterHandle), http);
      }],
      [HttpAdapterPhase.BeforeResponse, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        return this.runHttpMiddlewares(resolvePhaseMws(HttpAdapterPhase.BeforeResponse), http);
      }],

      // ── Adapter steps ──
      [HttpAdapterStep.ParseBody, (context: AdapterContext) =>
        parseBody(context.to(HttpContext), this.options.bodyLimit!, this.textMediaTypes),
      ],
      [HttpAdapterStep.WriteResponse, (context: AdapterContext) => {
        const http = context.to(HttpContext);
        const result = context.get(handlerResultKey);

        if (http.response.isSent() || result === undefined) return;

        if (isErr(result)) {
          writeErrorResponse(http.response, result.data as ErrorResponseData);
        } else if (isAsyncIterable(result)) {
          // Streaming (SSE / raw): the adapter owns the live stream because a
          // throw during consumption must be logged via this.logger.
          this.writeStreamingResponse(http, result);
        } else {
          writeSuccessResponse(http.response, result as RouteHandlerResult);
        }
      }],
      [HttpAdapterStep.Serialize, (context: AdapterContext) => {
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
      return err({ status: HttpStatus.InternalServerError, message: 'Router not initialized' });
    }

    const matchResult = this.routeHandler.matchRoute(req.method, req.path);

    if (matchResult.kind === 'not-found') {
      return err({ status: HttpStatus.NotFound, message: 'Not Found' });
    }

    if (matchResult.kind === 'method-not-allowed') {
      if (req.method === 'OPTIONS') {
        http.response.setHeader(HttpHeader.Allow, matchResult.allowedMethods.join(', '));
        http.response.setStatus(HttpStatus.NoContent);
        http.response.send();
        return undefined;
      }

      // RFC 9110 §15.5.6: Allow 헤더 필수
      http.response.setHeader(HttpHeader.Allow, matchResult.allowedMethods.join(', '));
      return err({ status: HttpStatus.MethodNotAllowed, message: 'Method Not Allowed' });
    }

    req.params = matchResult.params;
    http.matchedRoute = matchResult.route;

    return undefined;
  }



  /**
   * Shared generic 500 error used by HTTP protocol-translation overrides
   * (`wrapUnhandledException`, `wrapInvalidFilterResult`). Returns the
   * minimal {@link ErrorResponseData} shape that the `WriteResponse` step
   * can render without any runtime inspection.
   */
  private genericServerError(): Err<unknown> {
    return err({
      status: HttpStatus.InternalServerError,
      message: 'Internal Server Error',
    } satisfies ErrorResponseData);
  }

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
    return this.genericServerError();
  }

  /**
   * HTTP protocol translation for filter-author contract violations
   * (matched filter returned a non-`Err` value). Same shape as
   * {@link wrapUnhandledException} — generic 500.
   */
  protected override wrapInvalidFilterResult(_error: unknown, _filterResult: unknown): Err<unknown> {
    return this.genericServerError();
  }

  /**
   * Wraps baker validation errors as HTTP 400 with field-level details.
   * Non-baker errors are re-thrown to enter the exception filter path.
   *
   * @param _entry - The validation entry that failed.
   * @param errors - The `BakerIssueSet` returned by baker `deserialize()`.
   * @returns `Err` with structured 400 response for baker errors.
   * @public
   */
  protected override wrapValidationError(_entry: ResolvedValidationEntry, errors: unknown): Err<unknown> {
    if (isBakerIssueSet(errors)) {
      return err({
        status: HttpStatus.BadRequest,
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
      res.setStatus(HttpStatus.InternalServerError);
      res.setContentType('text/plain');
      res.setBody('Internal Server Error');
    }
  }

  /**
   * Builds and attaches the streaming response for an `AsyncIterable` handler
   * result — Server-Sent Events when the route is `@Sse`, otherwise a raw byte
   * stream. The adapter owns this (rather than the pure `writeSuccessResponse`
   * util) because a throw during stream consumption can only be surfaced via the
   * adapter's own logger.
   *
   * A throw from the handler's iterator surfaces inside the response
   * `ReadableStream`'s `pull`, which the server drives AFTER the request
   * pipeline finished and its adapter/logger `AsyncLocalStorage` scope unwound.
   * The pipeline's {@link emergencyTeardown} therefore cannot run (status and
   * headers are already committed to the wire), and mutating the response would
   * cancel the in-flight stream. So the failure is surfaced the only way still
   * possible — the adapter's logger, captured directly (no context re-entry).
   * The stream is then terminated per transport semantics:
   * - SSE: `close()` — WHATWG lets the EventSource client keep already-received
   *   events and reconnect; `error()` would truncate the response.
   *   https://html.spec.whatwg.org/multipage/server-sent-events.html
   * - raw: `error()` — signals a truncated, incomplete response per HTTP
   *   chunked-transfer semantics (the bytes are not all there).
   *
   * @param http - The HTTP context for the request.
   * @param iterable - The async-iterable handler result to stream.
   * @internal
   */
  writeStreamingResponse(http: HttpContext, iterable: AsyncIterable<unknown>): void {
    const signal = http.request.signal;
    const isSse = http.matchedRoute?.sse === true;
    const iterator = iterable[Symbol.asyncIterator]();
    const logger = this.logger;

    const stream = new ReadableStream({
      async pull(controller) {
        if (signal.aborted) {
          controller.close();
          return;
        }

        try {
          const { done, value } = await iterator.next();
          if (done || signal.aborted) {
            controller.close();
            return;
          }

          if (isSse) {
            controller.enqueue(formatSSEChunk(value));
          } else if (typeof value === 'string') {
            controller.enqueue(TEXT_ENCODER.encode(value));
          } else if (value instanceof Uint8Array) {
            controller.enqueue(value);
          } else {
            controller.enqueue(TEXT_ENCODER.encode(String(value)));
          }
        } catch (error) {
          if (signal.aborted) {
            // Client went away — normal cancellation, not a handler failure.
            controller.close();
            return;
          }

          if (error instanceof Error) {
            logger.error(`stream handler threw: ${error.message}`, error);
          } else {
            logger.error(`stream handler threw: ${formatUnknownError(error)}`);
          }

          if (isSse) {
            controller.close();
          } else {
            controller.error(error);
          }
        }
      },
      async cancel() {
        try {
          await iterator.return?.();
        } catch { /* swallow — cleanup best-effort */ }
      },
    });

    if (isSse) {
      // Bun: disable idle timeout for SSE so gaps between events don't drop the
      // connection.
      http.setTimeout(0);
      http.response.setNativeResponse(new Response(stream, {
        headers: {
          [HttpHeader.ContentType]: ContentType.EventStream,
          [HttpHeader.CacheControl]: CACHE_CONTROL_NO_CACHE,
          [HttpHeader.Connection]: CONNECTION_KEEP_ALIVE,
          [HttpHeader.XAccelBuffering]: X_ACCEL_BUFFERING_OFF,
        },
      }));
    } else {
      // Raw streaming — Content-Type from @ContentType or imperative setContentType.
      http.response.setNativeResponse(new Response(stream));
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

  /**
   * In-process test lifecycle. Wires routes and adapter state exactly like
   * {@link start} but **skips the network listener** — no `Bun.serve` bind.
   * The adapter's `fetch()` path remains invocable via {@link getHttpServer}
   * for `@zipbul/testing`'s in-process inject.
   *
   * @public
   */
  override async startTest(context: ApplicationContext): Promise<void> {
    await Logger.runScoped(this.logger, () => this.startTestInternal(context));
  }

  /**
   * Returns the underlying `HttpServer` once `start()` or `startTest()` has
   * been called. Used by `@zipbul/testing` to drive the production `fetch()`
   * path with an injected `Request`.
   *
   * @public
   */
  getHttpServer(): HttpServer | undefined {
    return this.httpServer;
  }

  /**
   * Well-known `@zipbul/testing` surface accessor. Returns an
   * {@link HttpTestSurface} whose `inject()` calls the production
   * `httpServer.fetch()` directly with a stub `Bun.Server`.
   *
   * Only valid after {@link startTest} (or {@link start} when not bound to
   * a port). Throws if called before the test/start lifecycle ran.
   *
   * @public
   */
  [TEST_SURFACE](): HttpTestSurface {
    if (this.httpServer === undefined) {
      throw new Error(
        '[HttpAdapter] test surface requested before startTest()/start(). ' +
        'Compile the test application before calling app.adapter(HttpAdapter).',
      );
    }
    return createHttpInjectSurface(this.httpServer, createStubBunServer());
  }

  private async startInternal(context: ApplicationContext): Promise<void> {
    this.httpServer = new HttpServer();
    await this.httpServer.boot(context.container, this.buildBootOptions(), this);
  }

  private async startTestInternal(context: ApplicationContext): Promise<void> {
    this.httpServer = new HttpServer();
    await this.httpServer.prepareRoutes(context.container, this.buildBootOptions(), this);
  }

  private buildBootOptions(): HttpServerBootOptions {
    const bootstrapState = getBootstrapState();
    const metadata = normalizeMetadataRegistry(bootstrapState.metadataRegistry);
    const scopedKeys = bootstrapState.scopedKeys;

    return {
      ...this.options,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(scopedKeys !== undefined ? { scopedKeys } : {}),
      internalRoutes: this.internalRoutes,
      ...(bootstrapState.handlerIndex !== undefined ? { handlerIndex: bootstrapState.handlerIndex } : {}),
      ...(bootstrapState.controllerFactories !== undefined ? { controllerFactories: bootstrapState.controllerFactories } : {}),
    };
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
