import type { Context, AdapterEntryDecorators, Result, Err, ResolvedExceptionFilter } from '@zipbul/common';
import type { MiddlewareDefinition } from '@zipbul/common';
import { Adapter, isErr, err } from '@zipbul/common';
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
import type { ClassMetadata, ErrorResponseData, MetadataRegistryKey, ParamTypeReference, ResponseBodyValue } from './types';
import type { Class } from '@zipbul/common';

import { HttpContext } from './http-context';
import { HttpServer } from './http-server';
import { __internals as httpServerInternals } from './http-server';
import { HttpError } from './errors/http-error';
import { HttpResponse } from './http-response';
import { BakerValidationError } from '@zipbul/baker';
import { RestController } from './decorators/class.decorator';
import { Get, Post, Put, Delete, Patch, Options, Head } from './decorators/method.decorator';
import { RawBody } from './decorators/method-option.decorator';
import type { RouteHandler } from './route-handler';
import { HttpPhase, HeaderField } from './enums';
import { isAsyncIterable, formatSSEChunk } from './server-sent-event';

// ── readBodyWithLimit ─────────────────────────────────────────

async function readBodyWithLimit(
  rawReq: Request,
  contentLength: number | null,
  bodyLimit: number,
): Promise<Result<Uint8Array, ErrorResponseData>> {
  // CL 존재 — fast path.
  // INVARIANT: Bun.serve({ maxRequestBodySize: bodyLimit })가 CL > bodyLimit인 요청을 HTTP 파서 레벨에서 선차단.
  if (contentLength !== null) {
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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.byteLength;
      if (totalSize > bodyLimit) {
        return err({ status: StatusCodes.REQUEST_TOO_LONG, message: 'Request body exceeds size limit' });
      }

      chunks.push(value);
    }
  } finally {
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

  /**
   * AOT 컴파일러가 메서드명 → validation kind 매핑에 사용.
   * `getBody` → `'body'`, `getQuery` → `'query'`, `getParams` → `'params'`.
   *
   * @public
   */
  static readonly validatedAccessors: Readonly<Record<string, string>> = {
    getBody: 'body',
    getQuery: 'query',
    getParams: 'params',
  };

  readonly decorators: AdapterEntryDecorators = {
    controller: RestController,
    handlers: [Get, Post, Put, Delete, Patch, Options, Head],
    options: [RawBody],
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
   * HTTP-specific pipeline:
   * OnRequest → resolveRoute → BeforeParsing → readBody → BeforeValidation → runValidations → BeforeHandler → handler → [handleResult] → BeforeResponse → AfterResponse
   *
   * @param context - The HTTP context.
   * @returns Pipeline result.
   * @public
   */
  protected async executePipeline(context: Context): Promise<Result<unknown, unknown>> {
    const http = context.to(HttpContext);

    // 1. OnRequest — CORS, logging, method override, URL rewriting
    const onRequest = await this.runHttpMiddlewares(
      this.getPhaseMiddlewares(HttpPhase.OnRequest), http,
    );
    if (isErr(onRequest)) return onRequest;
    if (http.response.isSent()) return undefined;

    // 2. Route Match — match against final method/path. 404/405 early return
    const routeResult = this.resolveRoute(http);
    if (isErr(routeResult)) return routeResult;
    if (http.response.isSent()) return undefined;

    const route = http.matchedRoute;
    if (route === undefined) {
      return err({ status: StatusCodes.INTERNAL_SERVER_ERROR, message: 'Route metadata not available' });
    }

    // 3. BeforeParsing — raw body interception, decryption
    const beforeParsing = await this.runHttpMiddlewares(
      this.getPhaseMiddlewares(HttpPhase.BeforeParsing), http,
    );
    if (isErr(beforeParsing)) return beforeParsing;
    if (http.response.isSent()) return undefined;

    // 4. readBody — Content-Type 기반 body 역직렬화
    const parseResult = await this.parseBody(http);
    if (isErr(parseResult)) return parseResult;

    // 5. BeforeValidation — query parsing, multipart parsing, body transformation
    const beforeValidation = await this.runHttpMiddlewares(
      this.getPhaseMiddlewares(HttpPhase.BeforeValidation), http,
    );
    if (isErr(beforeValidation)) return beforeValidation;
    if (http.response.isSent()) return undefined;

    // 6. runValidations — baker DTO 검증
    if (route.validations.length > 0) {
      const validationResult = await this.runValidations(route.validations, http);
      if (isErr(validationResult)) return validationResult;
    }

    // 7. Guards — global access control
    const guards = await this.runGuards(context);
    if (isErr(guards)) return guards;
    if (http.response.isSent()) return undefined;

    // 8. BeforeHandler — global MW
    const beforeHandler = await this.runHttpMiddlewares(
      this.getPhaseMiddlewares(HttpPhase.BeforeHandler), http,
    );
    if (isErr(beforeHandler)) return beforeHandler;
    if (http.response.isSent()) return undefined;

    // 9. BeforeHandler — handler-scoped MW
    if (route.middlewares.length > 0) {
      const scopedResult = await this.runHttpMiddlewares(route.middlewares, http);
      if (isErr(scopedResult)) return scopedResult;
      if (http.response.isSent()) return undefined;
    }

    // 10. Route-level guards
    for (const guard of route.guards) {
      const guardResult = await guard(context);
      if (isErr(guardResult)) return guardResult;
    }
    if (http.response.isSent()) return undefined;

    this.logger.debug(`Pipeline: mw=${route.middlewares.length} guards=${route.guards.length} filters=${route.exceptionFilters.length}`);

    // 11. Handler
    return route.handler(http);
  }

  // ── Pipeline steps ──────────────────────────────────────────

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
      return err({ status: StatusCodes.NOT_FOUND, message: `Route not found: ${req.method} ${req.path}` });
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

    if (matchResult.route.exceptionFilters.length > 0) {
      http.setRouteExceptionFilters(matchResult.route.exceptionFilters);
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

    if (shouldBuffer && rawBodyEnabled) {
      // ── 버퍼링 + rawBody (CL 유무 불문 readBodyWithLimit) ──
      const bytesResult = await readBodyWithLimit(rawReq, req.contentLength, this.options.bodyLimit!);
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
        const bytesResult = await readBodyWithLimit(rawReq, null, this.options.bodyLimit!);
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

      // CL 존재 — Bun 네이티브 fast path (maxRequestBodySize가 이미 CL 검증)
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
        // rawReq.text()는 non-fatal 디코딩을 사용하므로 인코딩 에러를 throw하지 않는다 (Bun 1.3.9 실측 확인).
        req.body = await rawReq.text();
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
   * Maps a validation kind to the corresponding raw input from the HTTP request.
   *
   * @param kind - The validation kind ('body', 'query', 'params').
   * @param context - The current execution context.
   * @returns The raw input value for baker to validate.
   * @public
   */
  protected override resolveValidationInput(kind: string, context: Context): unknown {
    const http = context.to(HttpContext);
    switch (kind) {
      case 'body': return http.request.body;
      case 'query': return http.request.query;
      case 'params': return http.request.params;
      default: throw new Error(`Unknown validation kind: ${kind}`);
    }
  }

  /**
   * Wraps baker validation errors as HTTP 400 with field-level details.
   * Non-baker errors are re-thrown to enter the exception filter path.
   *
   * @param _kind - The validation kind that failed.
   * @param thrown - The error thrown by baker `deserialize()`.
   * @returns `Err` with structured 400 response for baker errors.
   * @public
   */
  protected override wrapValidationError(_kind: string, thrown: unknown): Err<unknown> {
    if (thrown instanceof BakerValidationError) {
      return err({
        status: StatusCodes.BAD_REQUEST,
        message: thrown.message,
        errors: thrown.errors.map(fieldError => ({
          path: fieldError.path,
          code: fieldError.code,
          ...(fieldError.message !== undefined ? { message: fieldError.message } : {}),
        })),
      });
    }
    throw thrown;
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
    } else {
      await this.writeSuccessResponse(res, result, http.request.signal);
    }

    // BeforeResponse — runs after serialization, before transmission.
    // Skipped for native Response passthrough (SSE, raw Response) since
    // the response is already finalized via setNativeResponse.
    if (res.getNativeResponse() === undefined) {
      const beforeResponse = this.getPhaseMiddlewares(HttpPhase.BeforeResponse);
      if (beforeResponse.length > 0) {
        await this.runHttpMiddlewares(beforeResponse, http);
      }
    }
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
      // 부분 설정된 헤더를 초기화한 후 500 응답 설정
      res.clearHeaders();
      res.setStatus(StatusCodes.INTERNAL_SERVER_ERROR);
      res.setBody('Internal Server Error');
    }
  }

  protected override getLocalExceptionFilters(context: Context): readonly ResolvedExceptionFilter[] | undefined {
    return context.to(HttpContext).routeExceptionFilters;
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
   * When the handler returns a raw `Response` object, this method extracts
   * its status, headers, and body into the `HttpResponse` builder. This is
   * an escape hatch that bypasses the normal `HttpResponse` build chain —
   * use it when direct control over the raw response is required (e.g.
   * streaming, SSE, or proxied responses).
   *
   * @param res - The HTTP response builder.
   * @param result - The handler's return value.
   * @param signal - The request's AbortSignal for client disconnect detection.
   */
  private async writeSuccessResponse(res: HttpResponse, result: unknown, signal: AbortSignal): Promise<void> {
    // AsyncIterable → SSE ReadableStream → native Response passthrough
    if (isAsyncIterable(result)) {
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
            controller.enqueue(formatSSEChunk(value));
          } catch (error) {
            if (!signal.aborted) {
              controller.error(error);
            } else {
              controller.close();
            }
          }
        },
        cancel() {
          try {
            iterator.return?.();
          } catch { /* swallow — cleanup best-effort */ }
        },
      });

      const sseResponse = new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });

      res.setNativeResponse(sseResponse);
      return;
    }

    // Native Response passthrough (handler-created Response)
    if (result instanceof Response) {
      res.setNativeResponse(result);
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
