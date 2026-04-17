import type { Server } from 'bun';

import type {
  ZipbulContainer,
} from '@zipbul/common';
import { Logger } from '@zipbul/logger';
import { StatusCodes } from 'http-status-codes';

import type {
  HttpServerBootOptions,
  HttpServerOptions,
} from './interfaces';
import type {
  ClassMetadata,
  MatchedRouteMetadata,
  MetadataRegistryKey,
  RequestIdOptions,
} from './types';

import type { HttpMethod } from '@zipbul/shared';
import { HttpContext } from './http-context';
import { HttpRequest } from './http-request';
import { HttpResponse } from './http-response';
import { HTTP_STANDARD_METHODS } from './http-method';
import { RouteHandler } from './route-handler';
import type { HttpAdapter } from './http-adapter';
import { parseRequestTarget } from './url-parts';

import { normalizeIp, evaluateTrustProxy, resolveProxyInfo } from './proxy';
import type { ResolvedProxyInfo } from './proxy';

// ── Module-internal interfaces ────────────────────────────────

interface CreateHttpRequestResult {
  readonly kind: 'ok';
  readonly request: HttpRequest;
}

interface CreateHttpRequestNotImplemented {
  readonly kind: 'not-implemented';
  readonly request: HttpRequest;
}

interface CreateHttpRequestBadRequest {
  readonly kind: 'bad-request';
  readonly reason: 'invalid-url' | 'invalid-content-length';
  readonly request?: HttpRequest;
}

interface CreateHttpRequestUriTooLong {
  readonly kind: 'uri-too-long';
}

type CreateHttpRequestOutput =
  | CreateHttpRequestResult
  | CreateHttpRequestNotImplemented
  | CreateHttpRequestBadRequest
  | CreateHttpRequestUriTooLong;

const DEFAULT_MAX_URI_LENGTH = 8192;

// ── Helper functions ──────────────────────────────────────────

function parseContentLength(headers: Headers): number | null | 'invalid' {
  const raw = headers.get('content-length');
  if (raw === null || raw.length === 0) return null;

  // Bun 실측: 중복 CL 헤더를 "5, 3"으로 합쳐서 통과시킨다.
  if (raw.includes(',')) {
    const values = raw.split(',').map(v => v.trim());
    const unique = new Set(values);
    if (unique.size !== 1) return 'invalid';
    const parsed = parseInt(values[0]!, 10);
    if (Number.isNaN(parsed)) return null;
    return parsed < 0 ? 'invalid' : parsed;
  }

  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed < 0 ? 'invalid' : parsed;
}

function validateHttpMethod(method: string, allowedMethods: ReadonlySet<string>): HttpMethod | null {
  // as 허용 사유: allowedMethods.has(method) 통과 = 런타임 검증 완료.
  // HttpMethod open union의 TS 타입 시스템 한계.
  return allowedMethods.has(method) ? method as HttpMethod : null;
}

function resolveRawBody(matchedRoute: MatchedRouteMetadata | undefined): boolean {
  return matchedRoute?.rawBody === true;
}

// ── createHttpRequest factory ─────────────────────────────────

function createHttpRequest(
  raw: Request,
  socketIp: string | null,
  isTrustedProxy: boolean,
  proxyInfo: ResolvedProxyInfo | null,
  allowedMethods: ReadonlySet<string>,
  requestIdOptions?: RequestIdOptions,
  maxUriLength: number = DEFAULT_MAX_URI_LENGTH,
): CreateHttpRequestOutput {
  if (raw.url.length > maxUriLength) {
    return { kind: 'uri-too-long' };
  }

  const validatedMethod = validateHttpMethod(raw.method, allowedMethods);

  const parsedTarget = parseRequestTarget(raw.url);
  if (parsedTarget === null) {
    return { kind: 'bad-request', reason: 'invalid-url' };
  }

  const contentLength = parseContentLength(raw.headers);
  const rawProtocol = parsedTarget.protocol;
  const urlProtocol = rawProtocol !== null && rawProtocol.length > 0 ? rawProtocol : null;
  const urlHost = parsedTarget.authority;

  // Method string for HttpRequest — use raw method even if not in allowedMethods
  const method = (validatedMethod ?? raw.method) as HttpMethod;

  const request = new HttpRequest({
    ...(requestIdOptions?.header !== undefined ? { requestIdHeaderName: requestIdOptions.header } : {}),
    ...(requestIdOptions?.generate !== undefined ? { requestIdGenerator: requestIdOptions.generate } : {}),
    originalMethod: method,
    originalUrl: raw.url,
    method,
    url: raw.url,
    path: parsedTarget.path,
    headers: raw.headers,
    origin: {
      urlProtocol,
      urlHost,
      ...(proxyInfo !== null
        ? {
          proxyProtocol: proxyInfo.proto,
          proxyHost: proxyInfo.host,
          proxyPort: proxyInfo.port,
        }
        : {}),
    },
    contentLength: contentLength === 'invalid' ? null : contentLength,
    ip: normalizeIp(proxyInfo !== null ? (proxyInfo.clientIp ?? socketIp) : socketIp),
    ips: proxyInfo !== null ? proxyInfo.ipChain : [],
    isTrustedProxy,
    signal: raw.signal,
  });

  if (validatedMethod === null) {
    return { kind: 'not-implemented', request };
  }

  if (contentLength === 'invalid') {
    return { kind: 'bad-request', reason: 'invalid-content-length', request };
  }

  return { kind: 'ok', request };
}

// ── HttpServer ────────────────────────────────────────────────

/**
 * Runtime metrics for HTTP server observability.
 * Read directly from Bun's `Server.pendingRequests` / `pendingWebSockets`.
 *
 * @public
 */
export interface HttpServerMetrics {
  readonly pendingRequests: number;
  readonly pendingWebSockets: number;
}

export class HttpServer {
  private adapter: HttpAdapter;
  private container: ZipbulContainer;
  private readonly logger = Logger.inherit();

  private options: HttpServerOptions;
  private server: Server<unknown>;
  private allowedMethods: ReadonlySet<string>;
  private requestScopeEnabled: boolean | undefined;

  /**
   * Returns the underlying Bun Server instance for drain operations.
   *
   * @returns The Bun Server, or undefined if not yet booted.
   * @public
   */
  getServer(): Server<unknown> | undefined {
    return this.server;
  }

  /**
   * Returns current server metrics for health checks and autoscaling.
   *
   * @returns Metrics snapshot, or `undefined` if the server is not booted.
   * @public
   */
  getMetrics(): HttpServerMetrics | undefined {
    if (this.server === undefined) return undefined;
    return {
      pendingRequests: this.server.pendingRequests,
      pendingWebSockets: this.server.pendingWebSockets,
    };
  }

  async boot(container: ZipbulContainer, options: HttpServerBootOptions, adapter: HttpAdapter): Promise<void> {
    this.adapter = adapter;
    this.container = container;
    this.options = options;
    this.requestScopeEnabled = undefined;

    this.allowedMethods = new Set([...HTTP_STANDARD_METHODS, ...(this.options.customMethods ?? [])]);

    this.logger.debug('Booting...');

    const metadataRegistry = options.metadata ?? new Map<MetadataRegistryKey, ClassMetadata>();

    const decoratorConfig = {
      adapterId: this.adapter.constructor.name,
      controllerDecoratorName: this.adapter.decorators.controller.name,
      handlerDecoratorNames: this.adapter.decorators.handlers.map(h => h.name),
    };

    const routeHandler = new RouteHandler(metadataRegistry, decoratorConfig);

    if (options.handlerIndex !== undefined && options.handlerIndex.length > 0) {
      routeHandler.registerFromHandlerIndex(
        options.handlerIndex,
        options.controllerInstances,
        this.adapter.buildRoutePipeline.bind(this.adapter),
      );
    }

    if (Array.isArray(options.internalRoutes) && options.internalRoutes.length > 0) {
      routeHandler.registerInternalRoutes(options.internalRoutes);
    }

    this.adapter.setRouteHandler(routeHandler);

    const isProduction = process.env['NODE_ENV'] === 'production';

    const serveOptions: Parameters<typeof Bun.serve>[0] = {
      fetch: this.fetch.bind(this),
      reusePort: this.options.reusePort ?? true,
      idleTimeout: this.options.idleTimeout ?? 30,
      development: !isProduction,
      // maxRequestBodySize 미설정 — 프레임워크 readBodyWithLimit()이 처리.
      // Bun 파서의 413은 CORS 등 미들웨어를 우회하므로 사용하지 않는다.
      error: (error: Error) => {
        this.logger.error('Unhandled server error', error);
        return new Response('Internal server error', { status: 500 });
      },
    };

    if (this.options.port !== undefined) {
      serveOptions.port = this.options.port;
    }

    if (this.options.hostname !== undefined) {
      serveOptions.hostname = this.options.hostname;
    }

    if (this.options.tls !== undefined) {
      serveOptions.tls = this.options.tls;
    }

    this.server = Bun.serve<unknown>(serveOptions);

    this.logger.info(`Listening on :${this.server.port}`);
  }

  /**
   * Gracefully stops the Bun HTTP server.
   *
   * @public
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.stop();
      this.logger.info('Server stopped');
    }
  }

  async fetch(req: Request, server: Server<unknown>): Promise<Response> {
    const rawSocketIp = server.requestIP(req)?.address ?? null;
    // Bun은 듀얼 스택 소켓에서 ::ffff:10.0.0.1 형태로 반환한다. IPv4로 정규화.
    const socketIp = rawSocketIp !== null && rawSocketIp.startsWith('::ffff:')
      ? rawSocketIp.slice(7)
      : rawSocketIp;
    const trustProxy = this.options.trustProxy ?? false;
    const isTrusted = evaluateTrustProxy(socketIp, trustProxy);
    const proxyInfo = isTrusted ? resolveProxyInfo(req.headers, trustProxy, socketIp) : null;

    const createResult = createHttpRequest(
      req,
      socketIp,
      isTrusted,
      proxyInfo,
      this.allowedMethods,
      this.options.requestId,
      this.options.maxUriLength,
    );

    // URI 길이 초과 — RFC 9110 §15.5.15
    if (createResult.kind === 'uri-too-long') {
      return new Response(null, { status: StatusCodes.REQUEST_URI_TOO_LONG });
    }

    // URL 파싱 실패 또는 HttpRequest 생성 불가 → 고정 응답 (컨텍스트 없음)
    if (createResult.kind === 'bad-request' && createResult.reason === 'invalid-url') {
      return new Response(null, { status: 400 });
    }
    if (createResult.request === undefined) {
      return new Response(null, { status: 400 });
    }

    const zipbulReq = createResult.request;
    const zipbulRes = new HttpResponse(zipbulReq);

    const requestContainer = this.shouldCreateRequestScope()
      ? this.container.createRequestScope?.(zipbulReq.requestId)
      : undefined;
    const context = new HttpContext(zipbulReq, zipbulRes, req, requestContainer, server);

    // not-implemented, 기타 bad-request: pipelineError로 설정.
    // executePipeline이 OnRequest MW 실행 후 이 에러를 반환하여
    // CORS 등 미들웨어 헤더가 응답에 포함된다.
    if (createResult.kind === 'not-implemented') {
      context.pipelineError = { status: StatusCodes.NOT_IMPLEMENTED, message: 'Not Implemented' };
    } else if (createResult.kind === 'bad-request') {
      context.pipelineError = { status: StatusCodes.BAD_REQUEST, message: 'Bad Request' };
    }

    try {
      await this.adapter.dispatchRequest(context);
      return zipbulRes.getNativeResponse() ?? zipbulRes.end();
    } catch (error) {
      zipbulRes.cancelNativeStream();
      this.logger.error('Fetch Error', error instanceof Error ? error : undefined);
      return new Response('Internal server error', { status: 500 });
    } finally {
      try {
        await requestContainer?.dispose?.();
      } catch (disposeError) {
        this.logger.error('Request scope dispose failed', disposeError instanceof Error ? disposeError : undefined);
      }
    }
  }

  private shouldCreateRequestScope(): boolean {
    if (this.requestScopeEnabled !== undefined) {
      return this.requestScopeEnabled;
    }

    if (typeof this.container.createRequestScope !== 'function') {
      this.requestScopeEnabled = false;
      return false;
    }

    this.requestScopeEnabled = this.container.hasRequestScope?.() ?? true;
    return this.requestScopeEnabled;
  }
}

export const __internals = {
  parseContentLength,
  validateHttpMethod,
  resolveRawBody,
  createHttpRequest,
};
