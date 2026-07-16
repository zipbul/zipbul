import type { AdapterContext, ClassToken, ContextKey, MiddlewareDefinition, MiddlewareHandlerFn } from '@zipbul/common';
import type { HttpRequest } from '@zipbul/http-adapter';
import { HttpContext, HttpResponse } from '@zipbul/http-adapter';

export interface MockHeaders {
  get(name: string): string | null;
}

export type MockResponse = HttpResponse;

/**
 * A real `HttpResponse`, seeded to the state under test.
 *
 * These tests exercise the middleware against the adapter's actual response
 * model — its store split, its header merge, its stream handling. A hand-rolled
 * stand-in would only assert that the middleware agrees with the stand-in, and
 * would keep passing while production broke.
 */
export function mockHttpResponse(opts: {
  body?: unknown;
  headers?: Record<string, string>;
  contentType?: string | null;
  status?: number;
  /** Handler-returned raw Response path. */
  nativeResponse?: Response;
} = {}): MockResponse {
  const res = new HttpResponse({ method: 'GET' } as unknown as HttpRequest);

  // Body/native-response first, explicit headers last: setBody/setNativeResponse
  // always clear Content-Length (it describes the *previous* body, adapter
  // redesign D7), so a caller-declared header/CL must be applied *after* the
  // body to survive — same order a real handler follows (body, then headers).
  if (opts.nativeResponse !== undefined) {
    res.setNativeResponse(opts.nativeResponse);
  } else if (opts.body !== undefined) {
    res.setBody(opts.body as never);
  }

  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      res.setHeader(k.toLowerCase(), v);
    }
  }
  if (typeof opts.contentType === 'string') {
    res.setHeader('content-type', opts.contentType);
  }
  if (opts.status !== undefined) {
    res.setStatus(opts.status);
  }

  return res;
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
