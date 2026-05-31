/**
 * Unit spec for the `queryParser` middleware (canonical `export const … =
 * defineMiddleware(…)` + context augment). Covers the adapter-integration
 * contract — the `MiddlewareDefinition` shape and the typed
 * `request.getQuery(dto)` accessor it installs — exercised against a real
 * `HttpContext` from `@zipbul/http-adapter/testing`.
 *
 * Configurable parsing behavior (nesting, depth, duplicates, strict,
 * urlEncoded, option validation) is verified in `query-parser.spec.ts` and
 * `options.spec.ts` against `QueryParser.create(opts)`. The middleware uses
 * default options, so this file focuses on the middleware glue + the augment.
 */
import type { Class } from '@zipbul/common';

import { HttpAdapter } from '@zipbul/http-adapter';
import { mockContext } from '@zipbul/http-adapter/testing';
import { describe, expect, it } from 'bun:test';

import { queryParser } from './middleware';

class QueryDto {}

/** Runs the middleware against `path` and reads back the installed accessor. */
const getQuery = (path: string): unknown => {
  const ctx = mockContext({ url: `http://localhost${path}` });

  queryParser.factory()(ctx);

  return (ctx.request as unknown as { getQuery<T>(dto: Class<T>): T }).getQuery(QueryDto);
};

describe('queryParser — definition shape', () => {
  it('should be a MiddlewareDefinition keyed to [HttpAdapter]', () => {
    expect(queryParser).toBeDefined();
    expect(queryParser.adapters).toEqual([HttpAdapter]);
    expect(typeof queryParser.factory).toBe('function');
  });

  it('should install a getQuery accessor on the request', () => {
    const ctx = mockContext({ url: 'http://localhost/p?q=1' });

    queryParser.factory()(ctx);

    expect(typeof (ctx.request as unknown as { getQuery: unknown }).getQuery).toBe('function');
  });
});

describe('queryParser — getQuery accessor (default options)', () => {
  it('should parse a flat query string', () => {
    expect(getQuery('/search?q=hello&city=seoul')).toEqual({ q: 'hello', city: 'seoul' });
  });

  it('should percent-decode values', () => {
    expect(getQuery('/p?q=hello%20world')).toEqual({ q: 'hello world' });
  });

  it('should return an empty object when the URL has no query string', () => {
    expect(getQuery('/no-query')).toEqual({});
  });

  it('should return an empty object for a bare "?"', () => {
    expect(getQuery('/edge?')).toEqual({});
  });

  it('should keep brackets literal under the default (nesting off)', () => {
    expect(getQuery('/n?user[name]=alice')).toEqual({ 'user[name]': 'alice' });
  });

  it('should keep + literal under the default (urlEncoded off)', () => {
    expect(getQuery('/d?q=hello+world')).toEqual({ q: 'hello+world' });
  });

  it('should keep the first value for duplicate keys (HPP-safe default)', () => {
    expect(getQuery('/h?role=admin&role=user')).toEqual({ role: 'admin' });
  });
});
