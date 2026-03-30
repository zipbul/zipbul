import type { Server } from 'bun';

import type {
  ZipbulContainer,
} from '@zipbul/common';
import { Logger } from '@zipbul/logger';
import { StatusCodes } from 'http-status-codes';

import type {
  HttpServerBootOptions,
  HttpServerOptions,
  HttpWorkerResponse,
} from './interfaces';
import type {
  ClassMetadata,
  ContentTypeInfo,
  JsonValue,
  MatchedRouteMetadata,
  MetadataRegistryKey,
  RequestIdOptions,
  TrustProxyConfig,
} from './types';

import type { HttpMethod } from '@zipbul/shared';
import { HttpContext } from './http-context';
import { HttpRequest } from './http-request';
import { HttpResponse } from './http-response';
import { HTTP_STANDARD_METHODS } from './http-method';
import { RouteHandler } from './route-handler';
import type { HttpAdapter } from './http-adapter';

// ── Module-internal interfaces ────────────────────────────────

interface CreateHttpRequestResult {
  readonly kind: 'ok';
  readonly request: HttpRequest;
}

interface CreateHttpRequestNotImplemented {
  readonly kind: 'not-implemented';
}

interface CreateHttpRequestBadRequest {
  readonly kind: 'bad-request';
}

type CreateHttpRequestOutput = CreateHttpRequestResult | CreateHttpRequestNotImplemented | CreateHttpRequestBadRequest;

interface ResolvedProxyInfo {
  readonly proto: string | null;
  readonly host: string | null;
  readonly port: number | null;
  readonly clientIp: string | null;
  readonly ipChain: readonly string[];
}

interface ForwardedDirectives {
  readonly proto: string | null;
  readonly host: string | null;
}

// ── Helper functions ──────────────────────────────────────────

function parseContentTypeInfo(raw: string | null): ContentTypeInfo | null {
  if (raw === null || raw.length === 0) return null;

  const semicolonIndex = raw.indexOf(';');
  const mediaType = (semicolonIndex === -1 ? raw.trim() : raw.slice(0, semicolonIndex).trim()).toLowerCase();

  if (mediaType.length === 0) return null;

  const params = new Map<string, string>();
  if (semicolonIndex !== -1) {
    const paramString = raw.slice(semicolonIndex + 1);
    for (const pair of parseParameters(paramString)) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;

      const key = pair.slice(0, eqIndex).trim().toLowerCase();
      let value = pair.slice(eqIndex + 1).trim();

      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\(.)/g, '$1');
      }
      params.set(key, value);
    }
  }

  return {
    mediaType,
    charset: params.get('charset')?.toLowerCase() ?? null,
    boundary: params.get('boundary') ?? null,
    params,
  };
}

/**
 * RFC 9110 §5.6.4/§5.6.6 준수. quoted-string 내부 세미콜론을 존중한다.
 */
function parseParameters(input: string): string[] {
  const pairs: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && inQuotes) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      current += char;
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ';' && !inQuotes) {
      pairs.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current.length > 0) pairs.push(current);
  return pairs;
}

function parseContentLength(headers: Headers): number | null | 'invalid' {
  const raw = headers.get('content-length');
  if (raw === null || raw.length === 0) return null;

  // Bun 실측: 중복 CL 헤더를 "5, 3"으로 합쳐서 통과시킨다.
  if (raw.includes(',')) {
    const values = raw.split(',').map(v => v.trim());
    const unique = new Set(values);
    if (unique.size !== 1) return 'invalid';
    const parsed = parseInt(values[0]!, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveRequestId(headers: Headers, options?: RequestIdOptions): string {
  if (options?.header !== undefined) {
    const headerValue = headers.get(options.header);
    if (headerValue !== null && validateRequestId(headerValue)) {
      return headerValue;
    }
  }
  if (options?.generate !== undefined) {
    return options.generate();
  }
  return crypto.randomUUID();
}

/**
 * log injection 방어: 인쇄 가능 ASCII(0x20-0x7E)만 허용.
 */
function validateRequestId(value: string): boolean {
  if (value.length === 0 || value.length > 256) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function extractHostname(host: string): string {
  if (host.startsWith('[')) {
    const closeBracket = host.indexOf(']');
    return closeBracket !== -1 ? host.slice(1, closeBracket) : host;
  }
  const colonIndex = host.indexOf(':');
  return colonIndex !== -1 ? host.slice(0, colonIndex) : host;
}

function extractPort(host: string): string | null {
  if (host.startsWith('[')) {
    const portSeparator = host.indexOf(']:');
    return portSeparator !== -1 ? host.slice(portSeparator + 2) : null;
  }
  const colonIndex = host.indexOf(':');
  return colonIndex !== -1 ? host.slice(colonIndex + 1) : null;
}

function defaultPortByProtocol(protocol: string | null): number {
  if (protocol === 'https') return 443;
  return 80;
}

function validateHttpMethod(method: string, allowedMethods: ReadonlySet<string>): HttpMethod | null {
  // as 허용 사유: allowedMethods.has(method) 통과 = 런타임 검증 완료.
  // HttpMethod open union의 TS 타입 시스템 한계.
  return allowedMethods.has(method) ? method as HttpMethod : null;
}

function normalizeIp(ip: string | null): string | null {
  if (ip === null) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function parseJsonBody(parsed: unknown): JsonValue {
  // as 허용 사유: JSON.parse 반환값은 ECMAScript 스펙상 JsonValue.
  // TS의 `any` 반환 타입 한계를 보완. 런타임 보장은 JSON.parse 자체가 수행.
  return parsed as JsonValue;
}

function resolveRawBody(matchedRoute: MatchedRouteMetadata | undefined): boolean {
  return matchedRoute?.rawBody === true;
}

function validateForwardedHost(value: string): boolean {
  if (value.length === 0 || value.length > 255) return false;
  // IPv6 bracket 쌍 검증
  if (value.startsWith('[') && !value.includes(']')) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

/**
 * RFC 7239 §4: 마지막 element에서 proto/host만 읽는다.
 * IP 결정은 XFF 역방향 탐색만 사용. Forwarded:for는 사용하지 않는다.
 */
function parseForwardedLast(value: string): ForwardedDirectives {
  const elements = value.split(',');
  const last = elements[elements.length - 1]!;
  let proto: string | null = null;
  let host: string | null = null;

  for (const pair of parseParameters(last)) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;

    const key = pair.slice(0, eqIndex).trim().toLowerCase();
    let val = pair.slice(eqIndex + 1).trim();

    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\(.)/g, '$1');
    }

    if (key === 'proto') proto = val.toLowerCase();
    else if (key === 'host') host = val;
  }

  return { proto, host };
}

/**
 * @param ip - IPv4 정규화 완료된 소켓 IP. fetch()에서 ::ffff: 접두사를 제거한 후 전달한다.
 */
function evaluateTrustProxy(ip: string | null, config: TrustProxyConfig): boolean {
  if (config === false) return false;
  if (config === true) return true;
  if (ip === null) return false;

  if (typeof config === 'number') return true;
  if (typeof config === 'string') return isInCidrRange(ip, [config]);
  if (Array.isArray(config)) return isInCidrRange(ip, config);
  if (typeof config === 'function') return config(ip, 0);
  return false;
}

function resolveProxyInfo(
  headers: Headers,
  trustProxy: TrustProxyConfig,
  socketIp: string | null,
): ResolvedProxyInfo {
  const xffRaw = headers.get('x-forwarded-for');
  const ipChain = xffRaw !== null
    ? xffRaw.split(',').map(ip => ip.trim()).filter(ip => ip.length > 0)
    : [];

  const clientIp = resolveClientIp(ipChain, trustProxy, socketIp);

  // Forwarded (RFC 7239) 우선 — 마지막 element에서 proto/host만 읽는다.
  const forwarded = headers.get('forwarded');
  if (forwarded !== null) {
    const info = parseForwardedLast(forwarded);
    if (info.proto !== null || info.host !== null) {
      const validatedHost = info.host !== null && validateForwardedHost(info.host) ? info.host : null;
      return {
        proto: info.proto,
        host: validatedHost,
        port: null,
        clientIp,
        ipChain,
      };
    }
  }

  // X-Forwarded-* fallback
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()?.toLowerCase() ?? null;
  const rawHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? null;
  const host = rawHost !== null && validateForwardedHost(rawHost) ? rawHost : null;
  const rawPort = headers.get('x-forwarded-port')?.split(',')[0]?.trim() ?? null;
  const port = rawPort !== null ? parseInt(rawPort, 10) : null;

  return {
    proto,
    host,
    port: port !== null && Number.isNaN(port) ? null : port,
    clientIp,
    ipChain,
  };
}

function resolveClientIp(
  ipChain: readonly string[],
  trustProxy: TrustProxyConfig,
  socketIp: string | null,
): string | null {
  if (ipChain.length === 0) return socketIp;
  if (trustProxy === true) return ipChain[0] ?? socketIp;
  if (trustProxy === false) return socketIp;

  let currentIp = socketIp;
  let hopIndex = 0;

  for (let i = ipChain.length - 1; i >= 0; i--) {
    if (currentIp === null || !isTrustedIp(currentIp, trustProxy, hopIndex)) {
      return currentIp;
    }
    currentIp = ipChain[i] ?? null;
    hopIndex++;
  }
  return currentIp;
}

/**
 * XFF 체인의 IP를 평가한다. XFF 값은 클라이언트/프록시가 설정한 원본 값이므로
 * ::ffff: 접두사가 포함될 수 있다. 이 함수 내부에서 정규화한다.
 */
function isTrustedIp(ip: string, config: TrustProxyConfig, hopIndex: number): boolean {
  if (config === true) return true;
  if (config === false) return false;

  const normalized = normalizeIp(ip) ?? ip;

  if (typeof config === 'number') return hopIndex < config;
  if (typeof config === 'string') return isInCidrRange(normalized, [config]);
  if (Array.isArray(config)) return isInCidrRange(normalized, config);
  if (typeof config === 'function') return config(normalized, hopIndex);
  return false;
}

function isInCidrRange(ip: string, cidrs: readonly string[]): boolean {
  for (const cidr of cidrs) {
    if (cidr.includes('/')) {
      if (matchesCidr(ip, cidr)) return true;
    } else {
      if (normalizeIp(ip) === normalizeIp(cidr)) return true;
    }
  }
  return false;
}

function matchesCidr(ip: string, cidr: string): boolean {
  const slashIndex = cidr.indexOf('/');
  const range = cidr.slice(0, slashIndex);
  const prefixStr = cidr.slice(slashIndex + 1);
  const prefix = parseInt(prefixStr, 10);

  if (Number.isNaN(prefix)) return false;

  const ipNum = ipv4ToNumber(ip);
  const rangeNum = ipv4ToNumber(range);

  if (ipNum !== null && rangeNum !== null) {
    if (prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  }

  // IPv6 CIDR prefix matching
  const ipBytes = ipv6ToBytes(ip);
  const rangeBytes = ipv6ToBytes(range);

  if (ipBytes === null || rangeBytes === null) return false;
  if (prefix < 0 || prefix > 128) return false;

  return matchesPrefix(ipBytes, rangeBytes, prefix);
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (Number.isNaN(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

/**
 * Parses an IPv6 address string into a 16-byte Uint8Array.
 * Handles `::` zero-group expansion and embedded IPv4 (e.g. `::ffff:10.0.0.1`).
 *
 * @returns 16-byte array or null if the input is not a valid IPv6 address.
 */
function ipv6ToBytes(ip: string): Uint8Array | null {
  // Handle embedded IPv4 suffix (e.g. ::ffff:10.0.0.1)
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  let ipv4Suffix: number | null = null;

  if (tail.includes('.')) {
    ipv4Suffix = ipv4ToNumber(tail);
    if (ipv4Suffix === null) return null;
    // Replace the IPv4 part with two 16-bit groups
    ip = ip.slice(0, lastColon + 1) +
      ((ipv4Suffix >>> 16) & 0xffff).toString(16) + ':' +
      (ipv4Suffix & 0xffff).toString(16);
  }

  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const left = halves[0].length > 0 ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1].length > 0 ? halves[1].split(':') : [];

  const totalGroups = left.length + right.length;
  if (halves.length === 1 && totalGroups !== 8) return null;
  if (halves.length === 2 && totalGroups > 7) return null;

  const zeroFill = 8 - totalGroups;
  const groups: string[] = [...left];
  for (let i = 0; i < zeroFill; i++) groups.push('0');
  groups.push(...right);

  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const val = parseInt(groups[i], 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
    bytes[i * 2] = (val >>> 8) & 0xff;
    bytes[i * 2 + 1] = val & 0xff;
  }

  return bytes;
}

/**
 * Compares two 16-byte IPv6 addresses under a given prefix length.
 */
function matchesPrefix(addr: Uint8Array, range: Uint8Array, prefix: number): boolean {
  const fullBytes = prefix >>> 3;

  for (let i = 0; i < fullBytes; i++) {
    if (addr[i] !== range[i]) return false;
  }

  const remainingBits = prefix & 7;
  if (remainingBits > 0) {
    const mask = (0xff << (8 - remainingBits)) & 0xff;
    if ((addr[fullBytes] & mask) !== (range[fullBytes] & mask)) return false;
  }

  return true;
}

// ── createHttpRequest factory ─────────────────────────────────

function createHttpRequest(
  raw: Request,
  socketIp: string | null,
  isTrustedProxy: boolean,
  proxyInfo: ResolvedProxyInfo | null,
  allowedMethods: ReadonlySet<string>,
  requestIdOptions?: RequestIdOptions,
): CreateHttpRequestOutput {
  const method = validateHttpMethod(raw.method, allowedMethods);
  if (method === null) return { kind: 'not-implemented' };

  let urlObj: URL;
  try {
    urlObj = new URL(raw.url);
  } catch {
    return { kind: 'bad-request' };
  }

  const contentLength = parseContentLength(raw.headers);
  if (contentLength === 'invalid') return { kind: 'bad-request' };

  const rawProtocol = urlObj.protocol.slice(0, -1);
  const urlProtocol = rawProtocol.length > 0 ? rawProtocol : null;
  const urlHost = urlObj.host.length > 0 ? urlObj.host : null;
  const urlHostname = urlObj.hostname.length > 0 ? urlObj.hostname : null;
  const urlPort = urlObj.port.length > 0 ? parseInt(urlObj.port, 10) : defaultPortByProtocol(rawProtocol);

  let protocol: string | null;
  let host: string | null;
  let hostname: string | null;
  let port: number;

  if (proxyInfo !== null) {
    protocol = (proxyInfo.proto === 'http' || proxyInfo.proto === 'https')
      ? proxyInfo.proto
      : urlProtocol;

    host = proxyInfo.host ?? urlHost;
    hostname = host !== null ? extractHostname(host) : urlHostname;

    const forwardedPort = host !== null ? extractPort(host) : null;
    const parsedForwardedPort = forwardedPort !== null ? parseInt(forwardedPort, 10) : NaN;
    port = !Number.isNaN(parsedForwardedPort)
      ? parsedForwardedPort
      : (proxyInfo.port ?? defaultPortByProtocol(protocol ?? rawProtocol));
  } else {
    protocol = urlProtocol;
    host = urlHost;
    hostname = urlHostname;
    port = urlPort;
  }

  return {
    kind: 'ok',
    request: new HttpRequest({
      requestId: resolveRequestId(raw.headers, requestIdOptions),
      originalMethod: method,
      originalUrl: raw.url,
      method,
      url: raw.url,
      path: urlObj.pathname,
      headers: raw.headers,
      protocol,
      host,
      hostname,
      port,
      queryString: urlObj.search.length > 0 ? urlObj.search : null,
      contentType: parseContentTypeInfo(raw.headers.get('content-type')),
      contentLength,
      ip: normalizeIp(proxyInfo !== null ? (proxyInfo.clientIp ?? socketIp) : socketIp),
      ips: proxyInfo !== null ? proxyInfo.ipChain : [],
      isTrustedProxy,
      signal: raw.signal,
    }),
  };
}

// ── HttpServer ────────────────────────────────────────────────

export class HttpServer {
  private adapter: HttpAdapter;
  private container: ZipbulContainer;
  private readonly logger = Logger.inherit();

  private options: HttpServerOptions;
  private server: Server<unknown>;
  private allowedMethods: ReadonlySet<string>;

  /**
   * Returns the underlying Bun Server instance for drain operations.
   *
   * @returns The Bun Server, or undefined if not yet booted.
   * @public
   */
  getServer(): Server<unknown> | undefined {
    return this.server;
  }

  async boot(container: ZipbulContainer, options: HttpServerBootOptions, adapter: HttpAdapter): Promise<void> {
    this.adapter = adapter;
    this.container = container;
    this.options = options;

    this.allowedMethods = new Set([...HTTP_STANDARD_METHODS, ...(this.options.customMethods ?? [])]);

    this.logger.debug('Booting...');

    const metadataRegistry = options.metadata ?? new Map<MetadataRegistryKey, ClassMetadata>();

    const decoratorConfig = {
      adapterId: this.adapter.constructor.name,
      controllerDecoratorName: this.adapter.decorators.controller.name,
      handlerDecoratorNames: this.adapter.decorators.handlers.map(h => h.name),
    };

    const routeHandler = new RouteHandler(metadataRegistry, decoratorConfig, undefined, this.container);

    if (options.handlerIndex !== undefined && options.handlerIndex.length > 0) {
      routeHandler.registerFromHandlerIndex(options.handlerIndex, options.controllerInstances);
    }

    if (Array.isArray(options.internalRoutes) && options.internalRoutes.length > 0) {
      routeHandler.registerInternalRoutes(options.internalRoutes);
    }

    this.adapter.setRouteHandler(routeHandler);

    const serveOptions: Parameters<typeof Bun.serve>[0] = {
      fetch: this.fetch.bind(this),
      reusePort: this.options.reusePort ?? true,
    };

    if (this.options.port !== undefined) {
      serveOptions.port = this.options.port;
    }

    if (this.options.bodyLimit !== undefined) {
      serveOptions.maxRequestBodySize = this.options.bodyLimit;
    }

    this.server = Bun.serve<unknown>(serveOptions);

    this.logger.info(`Listening on :${this.options.port}`);
  }

  /**
   * Gracefully stops the Bun HTTP server.
   *
   * @public
   */
  stop(): void {
    if (this.server) {
      this.server.stop();
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
    );

    // 파이프라인 진입 전 에러: 프로토콜 에러 형식 (상태 코드 + 빈 body)
    if (createResult.kind === 'not-implemented') {
      return new Response(null, { status: 501 });
    }
    if (createResult.kind === 'bad-request') {
      return new Response(null, { status: 400 });
    }

    const zipbulReq = createResult.request;
    const zipbulRes = new HttpResponse(zipbulReq, new Headers());

    const requestContainer = this.container.createRequestScope?.(zipbulReq.requestId);
    const context = new HttpContext(zipbulReq, zipbulRes, req, requestContainer);

    try {
      await this.adapter.dispatchRequest(context);

      const nativeResponse = zipbulRes.getNativeResponse();
      if (nativeResponse !== undefined) {
        return nativeResponse;
      }

      return this.toResponse(zipbulRes.end());
    } catch (error) {
      this.logger.error('Fetch Error', error instanceof Error ? error : undefined);
      return new Response('Internal server error', { status: StatusCodes.INTERNAL_SERVER_ERROR });
    } finally {
      try {
        await requestContainer?.dispose?.();
      } catch (disposeError) {
        this.logger.error('Request scope dispose failed', disposeError instanceof Error ? disposeError : undefined);
      }
    }
  }

  private toResponse(workerRes: HttpWorkerResponse): Response {
    const init: ResponseInit = workerRes.init ?? {};
    const status = init.status;

    if (status === 0 || status === undefined) {
      const { status: _status, statusText: _statusText, ...rest } = init;

      return new Response(workerRes.body, rest);
    }

    if (typeof status === 'number' && status !== StatusCodes.SWITCHING_PROTOCOLS && (status < 200 || status > 599)) {
      this.logger.warn(`Invalid HTTP status ${status} corrected to 500`);

      return new Response(workerRes.body, {
        ...init,
        status: StatusCodes.INTERNAL_SERVER_ERROR,
      });
    }

    return new Response(workerRes.body, init);
  }
}

export const __internals = {
  parseContentTypeInfo,
  parseParameters,
  parseContentLength,
  resolveRequestId,
  validateRequestId,
  extractHostname,
  extractPort,
  defaultPortByProtocol,
  validateHttpMethod,
  normalizeIp,
  parseJsonBody,
  resolveRawBody,
  validateForwardedHost,
  parseForwardedLast,
  evaluateTrustProxy,
  resolveProxyInfo,
  resolveClientIp,
  isTrustedIp,
  isInCidrRange,
  matchesCidr,
  ipv4ToNumber,
  ipv6ToBytes,
  matchesPrefix,
  createHttpRequest,
};
