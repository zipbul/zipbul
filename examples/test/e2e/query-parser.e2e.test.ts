/**
 * End-to-end test for the example application's query-parser pipeline.
 *
 * The canonical `queryParser` middleware is registered on `BeforeValidate`; it
 * parses the request query string and installs a typed `request.getQuery(dto)`
 * accessor. The `SearchController` (`GET /search`) reads it back via
 * `getQuery(SearchQueryDto)`, so this exercises the full
 * middleware → getQuery → handler flow over real HTTP, with the middleware's
 * default options (nesting off, urlEncoded off, first-duplicate).
 *
 * NOTE: currently blocked by a pre-existing AOT-compiler bug that serializes
 * baker `@Field(oneOf(...))` rule arguments as string literals, which breaks
 * every baker `@Recipe` (cors included) in a compiled app. See the cors e2e,
 * which fails for the same root cause.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';
import { createHttpClient, type HttpClient } from '@zipbul/http-adapter/testing';
import { queryParser } from '@zipbul/query-parser';
import { Test, type TestApplication } from '@zipbul/testing';

import { appModule } from '../../src/module';

describe('examples — query-parser e2e', () => {
  let app: TestApplication;
  let http: HttpClient;

  beforeAll(async () => {
    app = await Test.create(appModule, {
      projectRoot: import.meta.dir.replace(/\/test\/e2e$/, ''),
      attach: (recorder) => {
        const httpAdapter = recorder.attach(HttpAdapter, { port: 0 });
        httpAdapter.addMiddlewares(HttpAdapterPhase.BeforeValidate, [queryParser]);
      },
    });

    http = createHttpClient(app.adapter(HttpAdapter));
  });

  afterAll(async () => {
    await app.close();
  });

  it('parses a flat query string and exposes it via getQuery', async () => {
    const res = await http.get('/search?q=hello&city=seoul');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ q: 'hello', city: 'seoul' });
  });

  it('percent-decodes values', async () => {
    const res = await http.get('/search?q=hello%20world');
    expect(await res.json()).toEqual({ q: 'hello world' });
  });

  it('returns an empty object when there is no query string', async () => {
    const res = await http.get('/search');
    expect(await res.json()).toEqual({});
  });

  it('keeps the first value for duplicate keys (HPP-safe default)', async () => {
    const res = await http.get('/search?q=admin&q=user');
    expect(await res.json()).toEqual({ q: 'admin' });
  });

  it('drops a poisoned key and does not pollute Object.prototype', async () => {
    const res = await http.get('/search?__proto__=evil&q=ok');
    expect(await res.json()).toEqual({ q: 'ok' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
