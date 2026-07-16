import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { augmentRawKey, defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpAdapterPhase, HttpContext } from '@zipbul/http-adapter';
import { Tck, type TestApplication } from '@zipbul/tck';

import { queryParser } from '../../index';
import { silentLogger } from './helpers';

const echoQuery = defineMiddleware([HttpAdapter], () => (ctx) => {
  const http = ctx.to(HttpContext);
  const query = ctx.get(augmentRawKey('request', 'getQuery'));
  http.response.setHeader('x-parsed-query', JSON.stringify(query));
  http.response.send();
});

async function bootApp(
  options: Parameters<typeof queryParser>[0],
): Promise<{ fetch: (p: string) => Promise<Response>; close: () => Promise<void> }> {
  let captured: HttpAdapter | undefined;
  const testApp: TestApplication = await Tck.createApplication({
    adapterConfig: {
      HttpAdapter: {
        middlewares: {
          [HttpAdapterPhase.OnRequest]: [queryParser(options), echoQuery],
        },
      },
    },
    register: (app) => { captured = app.attach(HttpAdapter, { port: 0 }); },
  });
  const server = captured!.getServer()!;
  const base = `http://127.0.0.1:${server.port as number}`;
  return { fetch: (p) => fetch(`${base}${p}`), close: () => testApp.close() };
}

async function bootStrictApp(): Promise<{ fetch: (p: string) => Promise<Response>; close: () => Promise<void> }> {
  return bootApp({ strict: true, nesting: true });
}

describe('queryParser strict-mode malformed query — HTTP status', () => {
  silentLogger();
  let app: Awaited<ReturnType<typeof bootStrictApp>>;
  beforeAll(async () => { app = await bootStrictApp(); });
  afterAll(async () => { await app.close(); });

  it('a malformed percent-escape under strict mode parses (2xx) — §2.6, not an error', async () => {
    // WHATWG §2.6 [MUST]: a malformed '%' is NOT an error. Strict validates
    // STRUCTURE (brackets/conflicts), never percent syntax, so `%ZZ` is preserved
    // as a literal and the request parses successfully instead of returning 400.
    const res = await app.fetch('/x?q=%ZZ');
    expect(res.status).toBe(204);
    expect(JSON.parse(res.headers.get('x-parsed-query')!)).toEqual({ q: '%ZZ' });
  });

  it('malformed brackets under strict+nesting → 400 (not 500)', async () => {
    const res = await app.fetch('/x?a[b]c[d]=1');
    expect(res.status).toBe(400);
  });

  it('the 400 body carries the parser message verbatim, not a doubled prefix', async () => {
    // Malformed BRACKET syntax is what strict mode rejects — an invalid
    // percent-escape like %ZZ is NOT a parser error under WHATWG decoding
    // (it parses successfully; see the §2.6 test above), so only a bracket
    // error can exercise this path. The parser already emits "Malformed
    // query string: ..."; the middleware must pass it through, not prepend
    // a second copy.
    const res = await app.fetch('/x?a[b]c[d]=1');
    const body = await res.text();
    expect(body).toContain('Malformed query string:');
    expect(body).not.toContain('Malformed query string: Malformed query string:');
  });

  it('a conflicting-structure error keeps its own "Conflict:" message (no wrong prefix)', async () => {
    const res = await app.fetch('/x?a=1&a[b]=2');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Conflict:');
    expect(body).not.toContain('Malformed query string: Conflict:');
  });

  it('a well-formed query under strict mode still parses (2xx, not 5xx)', async () => {
    const res = await app.fetch('/x?a[b]=1');
    // echoQuery commits a header-only response (204 No Content); the point is it
    // parses and does NOT error.
    expect(res.status).toBe(204);
    expect(JSON.parse(res.headers.get('x-parsed-query')!)).toEqual({ a: { b: '1' } });
  });
});

describe('queryParser strict-mode LimitExceeded (#1/N-3) — HTTP status', () => {
  silentLogger();

  describe('maxParams', () => {
    let app: Awaited<ReturnType<typeof bootApp>>;
    beforeAll(async () => { app = await bootApp({ strict: true, maxParams: 2 }); });
    afterAll(async () => { await app.close(); });

    it('a query within maxParams parses (2xx, not 400)', async () => {
      const res = await app.fetch('/x?a=1&b=2');
      expect(res.status).toBe(204);
      expect(JSON.parse(res.headers.get('x-parsed-query')!)).toEqual({ a: '1', b: '2' });
    });

    it('a query exceeding maxParams under strict mode → 400 (not 500)', async () => {
      const res = await app.fetch('/x?a=1&b=2&c=3');
      expect(res.status).toBe(400);
    });
  });

  describe('depth', () => {
    let app: Awaited<ReturnType<typeof bootApp>>;
    beforeAll(async () => { app = await bootApp({ strict: true, nesting: true, depth: 1 }); });
    afterAll(async () => { await app.close(); });

    it('a query within depth parses (2xx, not 400)', async () => {
      const res = await app.fetch('/x?a[b]=1');
      expect(res.status).toBe(204);
      expect(JSON.parse(res.headers.get('x-parsed-query')!)).toEqual({ a: { b: '1' } });
    });

    it('a query exceeding depth under strict mode → 400 (not 500)', async () => {
      const res = await app.fetch('/x?a[b][c]=1');
      expect(res.status).toBe(400);
    });
  });
});
