import type { AdapterContext, ClassToken, ContextKey, MiddlewareDefinition, MiddlewareHandlerFn } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';

export interface MockHeaders {
  get(name: string): string | null;
}

export interface MockResponse {
  getBody(): unknown;
  setBody(data: unknown): MockResponse;
  getHeader(name: string): string | null;
  setHeader(name: string, value: string): MockResponse;
  removeHeader(name: string): MockResponse;
  appendHeader(name: string, value: string): MockResponse;
  getContentType(): string | null;
  getStatus(): number;
  setStatus(status: number): MockResponse;
  /** real HttpResponse와 동일: stream/Blob body는 native Response로 저장되고 getBody()는 undefined */
  hasNativeResponse(): boolean;
  getNativeResponse(): Response;
  /** read-only 접근 — real peekNativeResponse와 동일하게 merge 부작용 없음 */
  peekNativeResponse(): Response | undefined;
}

export function mockHttpResponse(opts: {
  body?: unknown;
  headers?: Record<string, string>;
  contentType?: string | null;
  status?: number;
  /** 핸들러가 raw Response를 반환한 경로 재현 — real setNativeResponse와 동일하게 저장 */
  nativeResponse?: Response;
} = {}): MockResponse {
  let body: unknown;
  let native: Response | undefined;
  let status = opts.status ?? 200;
  const headers = new Map<string, string>();
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      headers.set(k.toLowerCase(), v);
    }
  }
  const contentType = opts.contentType !== undefined ? opts.contentType : (headers.get('content-type') ?? null);

  // real HttpResponse.setBody와 동일한 분기: stream → native passthrough,
  // Blob → stream() 변환 native, 그 외 → buffered (상호 배타, 마지막 setBody 승리)
  const applyBody = (data: unknown): void => {
    if (data instanceof ReadableStream) {
      body = undefined;
      native = new Response(data as ReadableStream<Uint8Array>);
      return;
    }
    if (data instanceof Blob) {
      body = undefined;
      headers.set('content-length', String(data.size));
      native = new Response(data.stream());
      return;
    }
    body = data;
    native = undefined;
  };
  if (opts.nativeResponse !== undefined) {
    body = undefined;
    native = opts.nativeResponse;
  } else {
    applyBody(opts.body);
  }

  const self: MockResponse = {
    getBody: () => body,
    setBody: (data) => { applyBody(data); return self; },
    getHeader: (name) => headers.get(name.toLowerCase()) ?? null,
    setHeader: (name, value) => { headers.set(name.toLowerCase(), value); return self; },
    removeHeader: (name) => { headers.delete(name.toLowerCase()); return self; },
    appendHeader: (name, value) => {
      const existing = headers.get(name.toLowerCase());
      headers.set(name.toLowerCase(), existing ? `${existing}, ${value}` : value);
      return self;
    },
    getContentType: () => contentType,
    getStatus: () => status,
    setStatus: (s) => { status = s; return self; },
    hasNativeResponse: () => native !== undefined,
    peekNativeResponse: () => native,
    getNativeResponse: () => {
      if (native === undefined) throw new Error('mock: no native response');
      return native;
    },
  };
  return self;
}

/** ReadableStream 전체를 읽어 하나의 Uint8Array로 합친다. */
export async function drainStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) { total.set(c, off); off += c.byteLength; }
  return total;
}

/** 주어진 청크들을 순서대로 내보내는 ReadableStream을 만든다. */
export function streamOf(...chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder2 = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder2.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

/** Minimal mock for `AdapterContext`. `to()` only accepts the `HttpContext`
 *  token (the only token the compression middleware uses) and throws otherwise
 *  — mirrors the production `HttpContext.to()` impl in http-adapter, which also
 *  ends in a single `as unknown as T` after the runtime token check. */
export function mockContext(
  request: { headers: MockHeaders; method?: string },
  response: MockResponse,
): AdapterContext {
  const req = { method: 'GET', ...request };
  const http = { request: req, response };
  const ctx: AdapterContext = {
    getType: () => 'http',
    get: <T>(_key: ContextKey<T>) => undefined,
    set: <T>(_key: ContextKey<T>, _value: T) => undefined,
    use: <T>(_key: ContextKey<T>): T => { throw new Error('not implemented in mock'); },
    to: <TContext>(ctor: ClassToken<TContext>): TContext => {
      if (ctor !== HttpContext) {
        throw new Error(`mockContext.to: unsupported token ${ctor.name}; only HttpContext is mocked`);
      }
      return http as unknown as TContext;
    },
  };
  return ctx;
}

export function makeRequestHeaders(acceptEncoding?: string): MockHeaders {
  const h = new Headers();
  if (acceptEncoding !== undefined) {
    h.set('accept-encoding', acceptEncoding);
  }
  return h;
}

export function largeBody(sizeBytes: number): string {
  return 'a'.repeat(sizeBytes);
}

/** Expose a middleware definition's handler. `compressionMiddleware` throws on
 *  invalid options, so a definition passed here is already valid. */
export function unwrap(def: MiddlewareDefinition): { handler: MiddlewareHandlerFn } {
  return { handler: def.factory() };
}

export const LARGE_BODY_OBJ = { data: largeBody(2048) };
export const LARGE_JSON = JSON.stringify(LARGE_BODY_OBJ);
