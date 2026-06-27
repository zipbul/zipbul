import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootQueryParserApp, parsedQuery, silentLogger, type QpTestApp } from './helpers';

/**
 * End-to-end test for the `queryParser` middleware over real HTTP (tck).
 *
 * The middleware is the canonical `export const … = defineMiddleware(…)` shape,
 * so it runs with default options; `echoQuery` reads the parsed result back
 * through the typed `request.getQuery(dto)` accessor it installs and echoes it
 * into a response header. Configurable parsing (nesting, urlEncoded, strict,
 * duplicates, depth) is verified against `QueryParser.create(opts)` in
 * `query-parser.spec.ts` / `options.spec.ts`.
 */
describe('queryParser middleware e2e (default options)', () => {
  silentLogger();

  let app: QpTestApp;
  beforeAll(async () => { app = await bootQueryParserApp(); });
  afterAll(async () => { await app.close(); });

  it('should parse a flat query string', async () => {
    const res = await app.fetch('/x?q=hello&city=seoul');
    expect(parsedQuery(res)).toEqual({ q: 'hello', city: 'seoul' });
  });

  it('should percent-decode values', async () => {
    const res = await app.fetch('/x?q=hello%20world');
    expect(parsedQuery(res)).toEqual({ q: 'hello world' });
  });

  it('should return an empty object when there is no query string', async () => {
    const res = await app.fetch('/x');
    expect(parsedQuery(res)).toEqual({});
  });

  it('should keep the first value for duplicate keys (HPP-safe default)', async () => {
    const res = await app.fetch('/x?role=admin&role=user');
    expect(parsedQuery(res)).toEqual({ role: 'admin' });
  });

  it('should keep + literal by default (urlEncoded off)', async () => {
    const res = await app.fetch('/x?q=a+b');
    expect(parsedQuery(res)).toEqual({ q: 'a+b' });
  });

  it('should keep brackets literal by default (nesting off)', async () => {
    const res = await app.fetch('/x?user[name]=alice');
    expect(parsedQuery(res)).toEqual({ 'user[name]': 'alice' });
  });

  it('should drop a poisoned key and not pollute Object.prototype', async () => {
    const res = await app.fetch('/x?__proto__=evil&safe=ok');
    expect(parsedQuery(res)).toEqual({ safe: 'ok' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
