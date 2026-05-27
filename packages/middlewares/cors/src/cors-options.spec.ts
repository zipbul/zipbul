import { HttpMethod } from '@zipbul/http-adapter';
import { describe, expect, it } from 'bun:test';

import type { CorsOptionsInput } from './cors-options';

import { Cors } from './cors';
import { CORS_DEFAULT_METHODS } from './constants';
import { CorsAction, CorsErrorReason } from './enums';
import { CorsError } from './interfaces';

function expectInvalid(input: CorsOptionsInput, reason: CorsErrorReason) {
  let caught: unknown;
  try {
    Cors.create(input);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(CorsError);
  expect((caught as CorsError).reason).toBe(reason);
}

function expectValid(input: CorsOptionsInput) {
  expect(() => Cors.create(input)).not.toThrow();
}

describe('CorsOptions schema — origin', () => {
  it('passes when origin is "*"', () => expectValid({ origin: '*' }));
  it('passes when origin is a serialized RFC 6454 origin', () => expectValid({ origin: 'https://a.com' }));
  it('passes when origin is true', () => expectValid({ origin: true }));
  it('passes when origin is false', () => expectValid({ origin: false }));
  it('passes when origin is a stateless RegExp', () => expectValid({ origin: /^https:\/\/a\.com$/ }));
  it('passes when origin is the literal "null"', () => expectValid({ origin: 'null' }));
  it('passes when origin is an IPv6 serialized origin', () => expectValid({ origin: 'https://[::1]' }));
  it('passes when origin is an array of strings', () => expectValid({ origin: ['https://a.com', 'https://b.com'] }));
  it('passes when origin is a mixed array (string + RegExp)', () =>
    expectValid({ origin: ['https://a.com', /^https:\/\/b\.com$/] }));
  it('passes when an array origin entry is the CORS wildcard "*" literal', () =>
    expectValid({ origin: ['https://a.com', '*'] }));
  it('passes when origin is an async function', () => expectValid({ origin: async () => true }));

  it('rejects empty-string origin', () => expectInvalid({ origin: '' }, CorsErrorReason.InvalidOrigin));
  it('rejects blank-string origin', () => expectInvalid({ origin: '  ' }, CorsErrorReason.InvalidOrigin));
  it('rejects single-space origin', () => expectInvalid({ origin: ' ' }, CorsErrorReason.InvalidOrigin));
  it('rejects trailing-slash origin', () => expectInvalid({ origin: 'https://a.com/' }, CorsErrorReason.InvalidOrigin));
  it('rejects uppercase scheme/host', () => expectInvalid({ origin: 'HTTPS://A.COM' }, CorsErrorReason.InvalidOrigin));
  it('rejects explicit default port', () => expectInvalid({ origin: 'https://a.com:443' }, CorsErrorReason.InvalidOrigin));
  it('rejects path-bearing origin', () => expectInvalid({ origin: 'https://a.com/path' }, CorsErrorReason.InvalidOrigin));
  it('rejects unparseable origin', () => expectInvalid({ origin: 'not-a-url' }, CorsErrorReason.InvalidOrigin));
  it('rejects RegExp with /g flag', () => expectInvalid({ origin: /^x/g }, CorsErrorReason.InvalidOrigin));
  it('rejects RegExp with /y flag', () => expectInvalid({ origin: /^x/y }, CorsErrorReason.InvalidOrigin));
  it('rejects array with empty-string entry', () => expectInvalid({ origin: [''] }, CorsErrorReason.InvalidOrigin));
  it('rejects array mixing valid and trailing-slash entries', () =>
    expectInvalid({ origin: ['https://a.com', 'https://b.com/'] }, CorsErrorReason.InvalidOrigin));
  it('rejects array containing /g flag RegExp', () =>
    expectInvalid({ origin: [/^x/g, 'https://a.com'] }, CorsErrorReason.InvalidOrigin));
});

describe('CorsOptions schema — methods', () => {
  it('passes when methods is CORS_DEFAULT_METHODS', () => expectValid({ methods: [...CORS_DEFAULT_METHODS] }));
  it('passes when methods contains only "*"', () => expectValid({ methods: ['*'] }));
  it('passes when methods mixes known method and "*"', () =>
    expectValid({ methods: [HttpMethod.Get, '*', HttpMethod.Post] }));
  it('passes when methods contains custom HttpMethod (e.g., PROPFIND)', () =>
    expectValid({ methods: [HttpMethod.Get, HttpMethod.Propfind] }));

  it('rejects methods with empty-string entry', () =>
    expectInvalid({ methods: [HttpMethod.Get, '' as unknown as HttpMethod] }, CorsErrorReason.InvalidMethods));
  it('rejects methods with unknown string entry', () =>
    expectInvalid({ methods: ['NOT-A-METHOD' as unknown as HttpMethod] }, CorsErrorReason.InvalidMethods));
});

describe('CorsOptions schema — allowedHeaders', () => {
  it('passes when allowedHeaders is null', () => expectValid({ allowedHeaders: null }));
  it('passes when allowedHeaders is empty array', () => expectValid({ allowedHeaders: [] }));
  it('passes when allowedHeaders contains valid tokens', () =>
    expectValid({ allowedHeaders: ['X-Custom', 'Authorization'] }));

  it('rejects empty-string entry', () =>
    expectInvalid({ allowedHeaders: [''] }, CorsErrorReason.InvalidAllowedHeaders));
  it('rejects blank-string entry', () =>
    expectInvalid({ allowedHeaders: ['  '] }, CorsErrorReason.InvalidAllowedHeaders));
  it('rejects mixed-valid-and-empty entries', () =>
    expectInvalid({ allowedHeaders: ['X-Custom', ''] }, CorsErrorReason.InvalidAllowedHeaders));
  it('rejects entry containing non-tchar characters (parentheses)', () =>
    expectInvalid({ allowedHeaders: ['X-Foo(bar)'] }, CorsErrorReason.InvalidAllowedHeaders));
  it('rejects entry containing internal whitespace', () =>
    expectInvalid({ allowedHeaders: ['X Foo'] }, CorsErrorReason.InvalidAllowedHeaders));
});

describe('CorsOptions schema — exposedHeaders', () => {
  it('passes when exposedHeaders is null', () => expectValid({ exposedHeaders: null }));
  it('passes when exposedHeaders is empty array', () => expectValid({ exposedHeaders: [] }));
  it('passes when exposedHeaders contains valid tokens', () =>
    expectValid({ exposedHeaders: ['X-Request-Id'] }));

  it('rejects empty-string entry', () =>
    expectInvalid({ exposedHeaders: [''] }, CorsErrorReason.InvalidExposedHeaders));
  it('rejects mixed-valid-and-empty entries', () =>
    expectInvalid({ exposedHeaders: ['X-Custom', ''] }, CorsErrorReason.InvalidExposedHeaders));
  it('rejects entry containing non-tchar characters (comma)', () =>
    expectInvalid({ exposedHeaders: ['X-Foo,Bar'] }, CorsErrorReason.InvalidExposedHeaders));
});

describe('CorsOptions schema — maxAge (RFC 9111 §1.2.2 delta-seconds)', () => {
  it('passes when maxAge is zero (boundary)', () => expectValid({ maxAge: 0 }));
  it('passes when maxAge is null', () => expectValid({ maxAge: null }));
  it('passes when maxAge is just below the exp threshold (9.999e20)', () => expectValid({ maxAge: 9.999e20 }));
  it('passes when maxAge is Number.MAX_SAFE_INTEGER', () => expectValid({ maxAge: Number.MAX_SAFE_INTEGER }));
  it('passes when maxAge is 2**53 (above MAX_SAFE_INTEGER but wire-safe)', () => expectValid({ maxAge: 2 ** 53 }));

  it('rejects negative maxAge', () => expectInvalid({ maxAge: -1 }, CorsErrorReason.InvalidMaxAge));
  it('rejects non-integer maxAge', () => expectInvalid({ maxAge: 1.5 }, CorsErrorReason.InvalidMaxAge));
  it('rejects Infinity', () => expectInvalid({ maxAge: Infinity }, CorsErrorReason.InvalidMaxAge));
  it('rejects NaN', () => expectInvalid({ maxAge: NaN }, CorsErrorReason.InvalidMaxAge));
  it('rejects maxAge at the exp threshold (1e21)', () =>
    expectInvalid({ maxAge: 1e21 }, CorsErrorReason.InvalidMaxAge));
  it('rejects Number.MAX_VALUE', () => expectInvalid({ maxAge: Number.MAX_VALUE }, CorsErrorReason.InvalidMaxAge));
  it('rejects 2e21 (above exp threshold)', () => expectInvalid({ maxAge: 2e21 }, CorsErrorReason.InvalidMaxAge));
});

describe('CorsOptions schema — optionsSuccessStatus', () => {
  it('passes at lower boundary 200', () => expectValid({ optionsSuccessStatus: 200 }));
  it('passes at upper boundary 299', () => expectValid({ optionsSuccessStatus: 299 }));

  it('rejects below 200', () => expectInvalid({ optionsSuccessStatus: 100 }, CorsErrorReason.InvalidStatusCode));
  it('rejects above 299', () => expectInvalid({ optionsSuccessStatus: 599 }, CorsErrorReason.InvalidStatusCode));
  it('rejects non-integer', () => expectInvalid({ optionsSuccessStatus: 200.5 }, CorsErrorReason.InvalidStatusCode));
  it('rejects NaN', () => expectInvalid({ optionsSuccessStatus: NaN }, CorsErrorReason.InvalidStatusCode));
});

describe('CorsOptions cross-field — credentials + wildcard', () => {
  it('rejects credentials:true + origin:"*"', () =>
    expectInvalid({ origin: '*', credentials: true }, CorsErrorReason.CredentialsWithWildcardOrigin));
  it('rejects credentials:true + methods:["*"]', () =>
    expectInvalid({ origin: 'https://a.com', methods: ['*'], credentials: true }, CorsErrorReason.CredentialsWithWildcardMethods));
});

describe('Cors.create — resolved options isolation (D-NEW-3 closure)', () => {
  it('clones the origin array — post-create caller mutation does not leak into the handler', async () => {
    const origins = ['https://a.com'];
    const cors = Cors.create({ origin: origins });
    origins.push('https://attacker.com');

    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { Origin: 'https://attacker.com' },
    });
    const result = await cors.handle(req);
    expect(result.action).toBe(CorsAction.Reject);
  });

  it('clones the allowedHeaders array — caller mutation does not relax the policy', async () => {
    const headers = ['X-Custom'];
    const cors = Cors.create({ allowedHeaders: headers });
    headers.length = 0;
    headers.push('Authorization');

    const preflight = new Request('http://localhost', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://a.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    const result = await cors.handle(preflight);
    expect(result.action).toBe(CorsAction.Reject);
  });

  it('clones the exposedHeaders array — caller mutation does not inject extra exposed headers', async () => {
    const headers = ['X-Safe'];
    const cors = Cors.create({ exposedHeaders: headers });
    headers.push('X-Injected');

    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { Origin: 'https://a.com' },
    });
    const result = await cors.handle(req);
    if (result.action !== CorsAction.Continue) throw new Error('expected continue');
    expect(result.headers.get('Access-Control-Expose-Headers')).toBe('X-Safe');
  });
});
