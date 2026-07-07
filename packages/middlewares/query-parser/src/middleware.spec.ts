/**
 * Unit spec for the `queryParser` middleware factory (form-2 shape:
 * `export function queryParser(opts?) => defineMiddleware({ augments })`).
 *
 * Covers the factory contract — boot-time option validation, the augments
 * declaration, and the raw supply behavior under `withAugments` (which
 * populates the RAW slot only; DTO validation is wired by the AOT compiler
 * and exercised end-to-end, not here).
 *
 * Configurable parsing behavior (nesting, depth, duplicates, strict,
 * urlEncoded) is verified in `query-parser.spec.ts` / `options.spec.ts`
 * against `QueryParser.create(opts)`.
 */
import { augmentRawKey } from '@zipbul/common';
import { HttpAdapter } from '@zipbul/http-adapter';
import { mockContext, withAugments } from '@zipbul/http-adapter/testing';
import { describe, expect, it } from 'bun:test';

import { QueryParserError } from './interfaces';
import { queryParser } from './middleware';

/** Runs the middleware's raw supply against `path` and reads back the raw slot. */
const suppliedQuery = async (path: string, options?: Parameters<typeof queryParser>[0]): Promise<unknown> => {
  const definition = queryParser(options);
  const ctx = mockContext({ url: `http://localhost${path}` });

  return withAugments(definition, ctx, () => ctx.get(augmentRawKey('request', 'getQuery')));
};

describe('queryParser — factory contract', () => {
  it('should return a MiddlewareDefinition keyed to [HttpAdapter]', () => {
    const definition = queryParser();

    expect(definition.adapters).toEqual([HttpAdapter]);
    expect(typeof definition.factory).toBe('function');
  });

  it('should declare a validated-accessor augment for request.getQuery', () => {
    const definition = queryParser();

    expect(definition.augments?.request?.getQuery?.kind).toBe('validated-accessor');
  });

  it('should create independent instances per call', () => {
    expect(queryParser()).not.toBe(queryParser());
  });

  it('should throw QueryParserError at boot on invalid options', () => {
    expect(() => queryParser({ depth: -1 })).toThrow(QueryParserError);
  });
});

describe('queryParser — raw supply (default options)', () => {
  it('should parse a flat query string', async () => {
    expect(await suppliedQuery('/search?q=hello&city=seoul')).toEqual({ q: 'hello', city: 'seoul' });
  });

  it('should percent-decode values', async () => {
    expect(await suppliedQuery('/p?q=hello%20world')).toEqual({ q: 'hello world' });
  });

  it('should supply an empty object when the URL has no query string', async () => {
    expect(await suppliedQuery('/no-query')).toEqual({});
  });

  it('should supply an empty object for a bare "?"', async () => {
    expect(await suppliedQuery('/edge?')).toEqual({});
  });

  it('should keep brackets literal under the default (nesting off)', async () => {
    expect(await suppliedQuery('/n?user[name]=alice')).toEqual({ 'user[name]': 'alice' });
  });

  it('should keep + literal under the default (urlEncoded off)', async () => {
    expect(await suppliedQuery('/d?q=hello+world')).toEqual({ q: 'hello+world' });
  });

  it('should keep the first value for duplicate keys (HPP-safe default)', async () => {
    expect(await suppliedQuery('/h?role=admin&role=user')).toEqual({ role: 'admin' });
  });
});

describe('queryParser — raw supply (instance options)', () => {
  it('should honor nesting when the instance enables it', async () => {
    expect(await suppliedQuery('/n?user[name]=alice', { nesting: true })).toEqual({ user: { name: 'alice' } });
  });

  it('should honor urlEncoded when the instance enables it', async () => {
    expect(await suppliedQuery('/d?q=hello+world', { urlEncoded: true })).toEqual({ q: 'hello world' });
  });
});
