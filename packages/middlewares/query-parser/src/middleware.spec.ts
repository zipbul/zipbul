/**
 * Unit spec for the `queryParserMiddleware` factory (colocated with the source).
 * Covers the adapter-integration contract — the `MiddlewareDefinition` shape,
 * fail-fast option validation, `ctx.to(HttpContext)`, reading
 * `request.queryString`, and assigning the parsed result to `request.query` —
 * exercised against a real `HttpContext` from `@zipbul/http-adapter/testing`.
 *
 * The framework-agnostic parsing engine is verified separately in
 * `query-parser.spec.ts`; this file focuses on the middleware glue.
 */
import { HttpAdapter } from '@zipbul/http-adapter';
import { mockContext } from '@zipbul/http-adapter/testing';
import { describe, expect, it } from 'bun:test';

import type { QueryParserOptions } from './interfaces';

import { QueryParserErrorReason } from './enums';
import { QueryParserError } from './interfaces';
import { queryParserMiddleware } from './middleware';

const run = (path: string, opts?: QueryParserOptions): unknown => {
  const ctx = mockContext({ url: `http://localhost${path}` });
  const handler = queryParserMiddleware(opts).factory();

  handler(ctx);

  return ctx.request.query;
};

describe('queryParserMiddleware — definition shape', () => {
  it('should return a MiddlewareDefinition keyed to [HttpAdapter]', () => {
    const def = queryParserMiddleware();

    expect(def).toBeDefined();
    expect(def.adapters).toEqual([HttpAdapter]);
    expect(typeof def.factory).toBe('function');
  });

  it('should throw QueryParserError synchronously when options are invalid', () => {
    expect(() => queryParserMiddleware({ depth: -1 })).toThrow(QueryParserError);
  });

  it('should throw QueryParserError with InvalidDuplicates reason for an invalid option', () => {
    try {
      queryParserMiddleware({ duplicates: 'nope' as unknown as 'first' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(QueryParserError);
      expect((e as QueryParserError).reason).toBe(QueryParserErrorReason.InvalidDuplicates);
    }
  });
});

describe('queryParserMiddleware — request.query assignment', () => {
  it('should parse the query string and assign it to request.query', () => {
    expect(run('/search?q=hello&city=seoul')).toEqual({ q: 'hello', city: 'seoul' });
  });

  it('should percent-decode values', () => {
    expect(run('/p?q=hello%20world')).toEqual({ q: 'hello world' });
  });

  it('should assign an empty object when the URL has no query string', () => {
    expect(run('/no-query')).toEqual({});
  });

  it('should assign an empty object for a bare "?"', () => {
    expect(run('/edge?')).toEqual({});
  });

  it('should apply nesting when configured', () => {
    expect(run('/n?user[name]=alice&user[age]=20', { nesting: true })).toEqual({
      user: { name: 'alice', age: '20' },
    });
  });

  it('should apply the urlEncoded option (+ as space)', () => {
    expect(run('/u?q=hello+world', { urlEncoded: true })).toEqual({ q: 'hello world' });
  });

  it('should keep + literal by default (urlEncoded off)', () => {
    expect(run('/d?q=hello+world')).toEqual({ q: 'hello+world' });
  });

  it('should apply the duplicates strategy (first by default)', () => {
    expect(run('/h?role=admin&role=user')).toEqual({ role: 'admin' });
  });
});

describe('queryParserMiddleware — strict mode', () => {
  it('should propagate QueryParserError on a malformed query in strict mode', () => {
    const ctx = mockContext({ url: 'http://localhost/s?bad=%zz' });
    const handler = queryParserMiddleware({ strict: true }).factory();

    expect(() => handler(ctx)).toThrow(QueryParserError);
  });
});
