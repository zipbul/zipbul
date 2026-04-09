import type { AdapterContext, ApplicationContext, AdapterEntryDecorators, CompiledHandlerEntry, ContextKey } from '@zipbul/common';
import type { MiddlewareDefinition } from '@zipbul/common';
import { err, isErr } from '@zipbul/result';
import type { Result, Err } from '@zipbul/result';
import { Adapter, handlerResultKey } from '@zipbul/core';
import type { ResolvedMiddleware, ResolvedValidationEntry, PipelineStepFn } from '@zipbul/core';
import { StatusCodes } from 'http-status-codes';
import { Logger } from '@zipbul/logger';

import {
  getBootstrapState,
  type ClassMetadata as CoreClassMetadata,
  type ConstructorParamMetadata as CoreConstructorParamMetadata,
  type DecoratorMetadata as CoreDecoratorMetadata,
} from '@zipbul/core';
import type {
  HttpServerBootOptions,
  HttpServerOptions,
  InternalRouteHandler,
  InternalRouteEntry,
} from './interfaces';
import type { ClassMetadata, ErrorResponseData, MetadataRegistryKey, ParamTypeReference, ResponseBodyValue, RouteHandlerFunction } from './types';
import type { Class } from '@zipbul/common';

import { HttpContext } from './http-context';
import { HttpServer } from './http-server';
import { __internals as httpServerInternals } from './http-server';
import { HttpError } from './errors/http-error';
import { HttpResponse } from './http-response';
import { isBakerError } from '@zipbul/baker';
import { RestController } from './decorators/class.decorator';
import { Get, Post, Put, Delete, Patch, Options, Head, Method } from './decorators/method.decorator';
import { RawBody, Sse, BodyLimit, Status, Redirect, ContentType as ContentTypeDecorator, Header } from './decorators/method-option.decorator';
import type { RouteHandler } from './route-handler';
import type { ResolvedRoutePipeline } from './route-handler';
import { HttpPhase, HttpStep, HeaderField } from './enums';
import { isAsyncIterable, formatSSEChunk } from './server-sent-event';

const TEXT_ENCODER = new TextEncoder();

// ── readBodyWithLimit ─────────────────────────────────────────

async function readBodyWithLimit(
  rawReq: Request,
  contentLength: number | null,
  bodyLimit: number,
): Promise<Result<Uint8Array, ErrorResponseData>> {
  // CL 존재 — fast path. bodyLimit 초과 시 즉시 거부.
  if (contentLength !== null) {
    if (contentLength > bodyLimit) {
      return err({ status: StatusCodes.REQUEST_TOO_LONG, message: 'Request body exceeds size limit' });
    }
    return new Uint8Array(await rawReq.arrayBuffer());
  }

  // CL 없음 (chunked TE) — 점진적 size 체크
  const body = rawReq.body;
  if (body === null) {
    return new Uint8Array(0);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  let limitExceeded = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.byteLength;
      if (totalSize > bodyLimit) {
        limitExceeded = true;
        return err({ status: StatusCodes.REQUEST_TOO_LONG, message: 'Request body exceeds size limit' });
      }

      chunks.push(value);
    }
  } finally {
    if (limitExceeded) {
      await reader.cancel();
    }
    reader.releaseLock();
  }

  if (chunks.length === 1) {
    return chunks[0]!;
  }

  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
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
        this.writeErrorResponse(http.response, result.data);
        return;
      }

      if (http.response.isSent()) return;
    }

    // ── Pipeline error (malformed request from HttpServer) ──
    if (http.pipelineError !== undefined) {
      this.writeErrorResponse(http.response, http.pipelineError);
      return;
    }

    // ── Route resolution ──
    const routeResult = this.resolveRoute(http);

    if (isErr(routeResult)) {
      this.writeErrorResponse(http.response, routeResult.data);
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
        this.parseBody(context.to(HttpContext)),
      ],
      [HttpStep.WriteResponse, async (context: AdapterContext) => {
        const http = context.to(HttpContext);
        const result = context.get(handlerResultKey);

        if (http.response.isSent() || result === undefined) return;

        if (isErr(result)) {
          this.writeErrorResponse(http.response, result.data);
        } else {
          await this.writeSuccessResponse(http.response, result, http);
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
   * Parses the HTTP request body from the raw Bun `Request`.
   * Runs after `resolveRoute` so `@RawBody()` flag is accessible.
   *
   * @param http - The HTTP context.
   * @returns `void` on success, `Err` with 400 status on invalid JSON.
   */
  private async parseBody(http: HttpContext): Promise<Result<void, ErrorResponseData>> {
    const req = http.request;
    const rawReq = http.consumeRawRequest();

    if (rawReq === undefined) return undefined;
    if (req.method === 'GET' || req.method === 'HEAD') return undefined;
    if ((req.method === 'DELETE' || req.method === 'OPTIONS') && req.contentType === null) return undefined;

    // Content-Length: 0 — body 없음. Content-Encoding보다 먼저 체크.
    if (req.contentLength === 0) return undefined;

    // Content-Encoding 감지
    const contentEncoding = req.headers.get('content-encoding');
    if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
      // RFC 9110 §15.5.16
      http.response.setHeader(HeaderField.AcceptEncoding, 'identity');
      return err({
        status: StatusCodes.UNSUPPORTED_MEDIA_TYPE,
        message: `Content-Encoding '${contentEncoding}' is not supported. Send uncompressed request body.`,
      });
    }

    const mediaType = req.contentType?.mediaType ?? '';
    const isJson = mediaType === 'application/json' || mediaType.endsWith('+json');
    const isTextLike = mediaType.startsWith('text/')
      || mediaType === 'application/x-www-form-urlencoded'
      || this.textMediaTypes.has(mediaType);
    const shouldBuffer = isJson || isTextLike;
    const rawBodyEnabled = httpServerInternals.resolveRawBody(http.matchedRoute);
    const charset = req.contentType?.charset ?? 'utf-8';

    // JSON charset 제한: RFC 8259 §8.1 — UTF-8만 허용
    if (isJson) {
      try {
        if (new TextDecoder(charset as Bun.Encoding).encoding !== 'utf-8') {
          return err({
            status: StatusCodes.BAD_REQUEST,
            message: `JSON requires UTF-8 encoding (RFC 8259 §8.1), received: ${charset}`,
          });
        }
      } catch {
        return err({
          status: StatusCodes.BAD_REQUEST,
          message: `JSON requires UTF-8 encoding (RFC 8259 §8.1), received: ${charset}`,
        });
      }
    }

    const effectiveBodyLimit = http.matchedRoute?.bodyLimit ?? this.options.bodyLimit!;

    if (shouldBuffer && rawBodyEnabled) {
      // ── 버퍼링 + rawBody (CL 유무 불문 readBodyWithLimit) ──
      const bytesResult = await readBodyWithLimit(rawReq, req.contentLength, effectiveBodyLimit);
      if (isErr(bytesResult)) return bytesResult;

      req.rawBody = bytesResult;

      let text: string;
      try {
        text = new TextDecoder(charset as Bun.Encoding, { fatal: true }).decode(bytesResult);
      } catch {
        return err({ status: StatusCodes.BAD_REQUEST, message: `Unsupported or malformed charset: ${charset}` });
      }

      if (isJson) {
        try {
          req.body = httpServerInternals.parseJsonBody(JSON.parse(text));
        } catch {
          return err({ status: StatusCodes.BAD_REQUEST, message: 'Invalid JSON in request body' });
        }
      } else {
        req.body = text;
      }
      return undefined;
    }

    if (shouldBuffer) {
      // ── 버퍼링, rawBody 비활성 ──
      if (req.contentLength === null) {
        // CL 없음 (chunked TE) — readBodyWithLimit으로 점진적 size 체크
        const bytesResult = await readBodyWithLimit(rawReq, null, effectiveBodyLimit);
        if (isErr(bytesResult)) return bytesResult;

        let text: string;
        try {
          text = new TextDecoder(charset as Bun.Encoding, { fatal: true }).decode(bytesResult);
        } catch {
          return err({ status: StatusCodes.BAD_REQUEST, message: `Unsupported or malformed charset: ${charset}` });
        }

        if (isJson) {
          try {
            req.body = httpServerInternals.parseJsonBody(JSON.parse(text));
          } catch {
            return err({ status: StatusCodes.BAD_REQUEST, message: 'Invalid JSON in request body' });
          }
        } else {
          req.body = text;
        }
        return undefined;
      }

      // CL 존재 — fast path. bodyLimit 초과 시 즉시 거부.
      if (req.contentLength! > effectiveBodyLimit) {
        return err({ status: StatusCodes.REQUEST_TOO_LONG, message: 'Request body exceeds size limit' });
      }
      if (isJson) {
        try {
          req.body = httpServerInternals.parseJsonBody(await rawReq.json());
        } catch (error) {
          // SyntaxError = 클라이언트가 잘못된 JSON 전송 → err(400)
          // TypeError/기타 = body 이중 소비, 네트워크 끊김 등 인프라 에러 → throw 전파
          if (error instanceof SyntaxError) {
            return err({ status: StatusCodes.BAD_REQUEST, message: 'Invalid JSON in request body' });
          }
          throw error;
        }
      } else {
        try {
          const raw = new Uint8Array(await rawReq.arrayBuffer());
          req.body = new TextDecoder(charset as Bun.Encoding, { fatal: true }).decode(raw);
        } catch {
          return err({ status: StatusCodes.BAD_REQUEST, message: `Unsupported or malformed charset: ${charset}` });
        }
      }
      return undefined;
    }

    // ── 스트리밍 — 버퍼링 없음 ──
    if (rawReq.body !== null) {
      // Bun Request.body는 ReadableStream<Uint8Array>이지만 TS 타입이 ReadableStream<any>로 선언됨
      req.body = rawReq.body as ReadableStream<Uint8Array>;
    }
    return undefined;
  }


  /**
   * Wraps baker validation errors as HTTP 400 with field-level details.
   * Non-baker errors are re-thrown to enter the exception filter path.
   *
   * @param _key - The context key whose validation failed.
   * @param errors - The `BakerErrors` returned by baker `deserialize()`.
   * @returns `Err` with structured 400 response for baker errors.
   * @public
   */
  protected override wrapValidationError(_key: ContextKey<unknown>, errors: unknown): Err<unknown> {
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
      this.logger.error(`emergencyTeardown: ${String(error)}`);
    }

    const http = context.to(HttpContext);
    const res = http.response;

    if (!res.isSent()) {
      // Headers preserved — OnRequest에서 설정된 CORS/보안 헤더 유지.
      // status + body만 덮어쓴다.
      res.setStatus(StatusCodes.INTERNAL_SERVER_ERROR);
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

    const metadata = this.normalizeMetadataRegistry(bootstrapState.metadataRegistry);
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
        message: errorData.message,
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
   * AsyncIterable routing:
   * - `@Sse()` decorated → SSE format (text/event-stream + data: framing)
   * - No `@Sse()` → raw streaming (chunks sent as-is, Content-Type from @ContentType or imperative)
   *
   * @param res - The HTTP response builder.
   * @param result - The handler's return value.
   * @param http - The HTTP context (for route metadata and signal).
   */
  private async writeSuccessResponse(res: HttpResponse, result: unknown, http: HttpContext): Promise<void> {
    const signal = http.request.signal;

    // AsyncIterable → SSE or raw streaming based on @Sse flag
    if (isAsyncIterable(result)) {
      const isSse = http.matchedRoute?.sse === true;
      const iterator = result[Symbol.asyncIterator]();
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
            } else {
              // Raw streaming — encode string chunks, pass Uint8Array through
              if (typeof value === 'string') {
                controller.enqueue(TEXT_ENCODER.encode(value));
              } else if (value instanceof Uint8Array) {
                controller.enqueue(value);
              } else {
                controller.enqueue(TEXT_ENCODER.encode(String(value)));
              }
            }
          } catch (error) {
            if (!signal.aborted) {
              controller.error(error);
            } else {
              controller.close();
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
        const sseResponse = new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
        res.setNativeResponse(sseResponse);
      } else {
        // Raw streaming — Content-Type from @ContentType or imperative setContentType
        res.setNativeResponse(new Response(stream));
      }
      return;
    }

    // Native Response passthrough (handler-created Response)
    if (result instanceof Response) {
      res.setNativeResponse(result);
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
