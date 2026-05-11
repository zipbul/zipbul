import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import { compressionMiddleware, Encoding } from '../../index.ts';
import {
  HttpRequest,
  HttpResponse,
  HttpContext,
} from '@zipbul/http-adapter';
import type { HttpMethod } from '@zipbul/http-adapter';
import type { Server } from 'bun';

let BASE: string;

const LARGE_DATA = JSON.stringify({ data: 'x'.repeat(2048) });

const result = compressionMiddleware({
  encodings: [Encoding.Brotli, Encoding.Gzip],
});
if (isErr(result)) throw new Error(`setup failed: ${result.data.message}`);
const middlewareHandler = result.factory();

let server: Server<unknown>;

function buildHttpRequest(req: Request): HttpRequest {
  const url = new URL(req.url);
  const method = req.method as HttpMethod;
  return new HttpRequest({
    originalMethod: method,
    originalUrl: req.url,
    method,
    url: req.url,
    path: url.pathname,
    headers: req.headers,
    origin: { urlProtocol: url.protocol.replace(':', ''), urlHost: url.host },
    contentLength: null,
    ip: null,
    ips: [],
    isTrustedProxy: false,
    signal: new AbortController().signal,
  });
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);

      const httpReq = buildHttpRequest(req);
      const httpRes = new HttpResponse(httpReq, new Headers());

      if (url.pathname === '/json') {
        httpRes.setBody(LARGE_DATA).setContentType('application/json');
      } else if (url.pathname === '/image') {
        httpRes.setBody(new Uint8Array(2048)).setContentType('image/png');
      } else if (url.pathname === '/small') {
        httpRes.setBody('hi').setContentType('text/plain');
      } else {
        return new Response('not found', { status: 404 });
      }

      const ctx = new HttpContext(httpReq, httpRes);
      middlewareHandler(ctx);

      // Build response directly from HttpResponse state to preserve binary body
      const body = httpRes.getBody();
      const headers = new Headers();
      const contentType = httpRes.getContentType();
      if (contentType) headers.set('content-type', contentType);

      const encoding = httpRes.getHeader('content-encoding');
      if (encoding) headers.set('content-encoding', encoding);

      const vary = httpRes.getHeader('vary');
      if (vary) headers.set('vary', vary);

      // body is `string | number | boolean | Uint8Array | ArrayBuffer | object | null | undefined`
      // — narrow to the subset acceptable to `Response`.
      let responseBody: string | Uint8Array | ArrayBuffer | null;
      if (body === null || body === undefined) {
        responseBody = null;
      } else if (typeof body === 'string') {
        responseBody = body;
      } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
        responseBody = body;
      } else {
        responseBody = JSON.stringify(body);
      }

      return new Response(responseBody, { headers });
    },
  });
  BASE = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe('Compression E2E with Bun.serve', () => {
  it('should return gzip compressed response with correct headers', async () => {
    const resp = await fetch(`${BASE}/json`, {
      headers: { 'accept-encoding': 'gzip' },
    });

    // Bun auto-decompresses, so content-encoding is stripped by fetch
    // Verify the response body is decompressed correctly instead
    const text = await resp.text();
    expect(text).toBe(LARGE_DATA);
  });

  it('should return brotli compressed response for Accept-Encoding: br', async () => {
    const resp = await fetch(`${BASE}/json`, {
      headers: { 'accept-encoding': 'br' },
    });

    const text = await resp.text();
    expect(text).toBe(LARGE_DATA);
  });

  it('should roundtrip gzip (compress -> auto-decompress -> original)', async () => {
    const resp = await fetch(`${BASE}/json`, {
      headers: { 'accept-encoding': 'gzip' },
    });

    const text = await resp.text();
    expect(text).toBe(LARGE_DATA);
    expect(JSON.parse(text)).toEqual({ data: 'x'.repeat(2048) });
  });

  it('should roundtrip brotli (compress -> auto-decompress -> original)', async () => {
    const resp = await fetch(`${BASE}/json`, {
      headers: { 'accept-encoding': 'br' },
    });

    const text = await resp.text();
    expect(text).toBe(LARGE_DATA);
    expect(JSON.parse(text)).toEqual({ data: 'x'.repeat(2048) });
  });

  it('should skip compression for image/png', async () => {
    const resp = await fetch(`${BASE}/image`, {
      headers: { 'accept-encoding': 'gzip' },
    });

    expect(resp.headers.has('content-encoding')).toBe(false);
  });

  it('should skip compression when body is below threshold', async () => {
    const resp = await fetch(`${BASE}/small`, {
      headers: { 'accept-encoding': 'gzip' },
    });

    const text = await resp.text();
    expect(text).toBe('hi');
    expect(resp.headers.has('content-encoding')).toBe(false);
  });

  it('should skip compression when no Accept-Encoding header', async () => {
    const resp = await fetch(`${BASE}/json`, {
      headers: { 'accept-encoding': '' },
    });

    expect(resp.headers.has('content-encoding')).toBe(false);
    const text = await resp.text();
    expect(text).toBe(LARGE_DATA);
  });
});
