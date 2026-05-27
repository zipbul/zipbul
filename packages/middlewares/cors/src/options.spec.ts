import { HttpMethod } from '@zipbul/http-adapter';
import { describe, expect, it } from 'bun:test';

import type { ResolvedCorsOptions } from './types';

import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';
import { CorsErrorReason } from './enums';
import { resolveCorsOptions, validateCorsOptions } from './options';

describe('resolveCorsOptions', () => {
  it('should return all defaults when called without arguments', () => {
    // Arrange / Act
    const result = resolveCorsOptions();
    // Assert
    expect(result.origin).toBe('*');
    expect(result.methods).toEqual(CORS_DEFAULT_METHODS);
    expect(result.allowedHeaders).toBeNull();
    expect(result.exposedHeaders).toBeNull();
    expect(result.credentials).toBe(false);
    expect(result.maxAge).toBeNull();
    expect(result.preflightContinue).toBe(false);
    expect(result.optionsSuccessStatus).toBe(CORS_DEFAULT_OPTIONS_SUCCESS_STATUS);
    expect(result.allowPrivateNetwork).toBe(false);
  });

  it('should reflect all explicit values when every field is provided', () => {
    // Arrange
    const methods = [HttpMethod.Get, HttpMethod.Post];
    const allowedHeaders = ['X-Custom'];
    const exposedHeaders = ['X-Result'];
    const originFn = () => true as const;
    // Act
    const result = resolveCorsOptions({
      origin: originFn,
      methods,
      allowedHeaders,
      exposedHeaders,
      credentials: true,
      maxAge: 3600,
      preflightContinue: true,
      optionsSuccessStatus: 200,
    });
    // Assert
    expect(result.origin).toBe(originFn);
    expect(result.methods).toEqual(methods);
    expect(result.allowedHeaders).toEqual(allowedHeaders);
    expect(result.exposedHeaders).toEqual(exposedHeaders);
    expect(result.credentials).toBe(true);
    expect(result.maxAge).toBe(3600);
    expect(result.preflightContinue).toBe(true);
    expect(result.optionsSuccessStatus).toBe(200);
  });

  it('should reflect allowPrivateNetwork:true when explicitly provided', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ allowPrivateNetwork: true });
    // Assert
    expect(result.allowPrivateNetwork).toBe(true);
  });

  it('should mix explicit origin with default values for remaining fields', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ origin: 'https://example.com' });
    // Assert
    expect(result.origin).toBe('https://example.com');
    expect(result.methods).toEqual(CORS_DEFAULT_METHODS);
    expect(result.credentials).toBe(false);
  });

  it('should preserve falsy non-null values through nullish coalescing', () => {
    // Arrange / Act
    const result = resolveCorsOptions({
      origin: '',
      credentials: false,
      maxAge: 0,
      preflightContinue: false,
      optionsSuccessStatus: 0,
    });
    // Assert — these are falsy but NOT null/undefined, so ?? should not replace them
    expect(result.origin).toBe('');
    expect(result.credentials).toBe(false);
    expect(result.maxAge).toBe(0);
    expect(result.preflightContinue).toBe(false);
    expect(result.optionsSuccessStatus).toBe(0);
  });

  it('should preserve methods as-is without normalization', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: [HttpMethod.Get, HttpMethod.Post] });
    // Assert
    expect(result.methods).toEqual([HttpMethod.Get, HttpMethod.Post]);
  });

  it('should preserve wildcard * unchanged when methods contains wildcard', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: ['*'] });
    // Assert
    expect(result.methods).toEqual(['*']);
  });

  it('should return empty array when methods is empty array', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: [] });
    // Assert
    expect(result.methods).toEqual([]);
  });

  it('should collapse to wildcard-only array when methods contains * mixed with other methods', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: [HttpMethod.Get, '*', HttpMethod.Post] });
    // Assert
    expect(result.methods).toEqual(['*']);
  });
});

describe('validateCorsOptions', () => {
  function makeResolved(overrides: Partial<ResolvedCorsOptions> = {}): ResolvedCorsOptions {
    return {
      origin: '*',
      methods: CORS_DEFAULT_METHODS,
      allowedHeaders: null,
      exposedHeaders: null,
      credentials: false,
      maxAge: null,
      preflightContinue: false,
      optionsSuccessStatus: CORS_DEFAULT_OPTIONS_SUCCESS_STATUS,
      allowPrivateNetwork: false,
      ...overrides,
    };
  }

  it('should pass for default resolved options', () => {
    // Arrange
    const resolved = makeResolved();
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when credentials is true with non-wildcard origin', () => {
    // Arrange
    const resolved = makeResolved({ credentials: true, origin: 'https://a.com' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when credentials is true with wildcard origin', () => {
    // Arrange
    const resolved = makeResolved({ credentials: true, origin: '*' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
    expect(typeof result?.data.message).toBe('string');
  });

  it('should return CorsError when maxAge is negative', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: -1 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should return CorsError when optionsSuccessStatus is below 200', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 0 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should return CorsError when optionsSuccessStatus is above 299', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 300 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should return CorsError when maxAge is non-integer', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: 1.5 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should return CorsError when maxAge is Infinity', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: Infinity });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should return CorsError when maxAge is NaN', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: NaN });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  // ── D-NEW-1: maxAge >= 1e21 (ECMAScript §6.1.6.1.30 toString exp threshold) ──

  it('should return CorsError when maxAge is 1e21 (ECMAScript exp-notation threshold)', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: 1e21 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should return CorsError when maxAge is Number.MAX_VALUE (1.7e308)', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: Number.MAX_VALUE });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should return CorsError when maxAge is 2e21 (above exp threshold)', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: 2e21 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should pass when maxAge is 9.999e20 (just below the exp threshold)', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: 9.999e20 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when maxAge is Number.MAX_SAFE_INTEGER (wire still serializes as integer)', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: Number.MAX_SAFE_INTEGER });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when maxAge is 2**53 (above MAX_SAFE_INTEGER but wire serializes as integer)', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: 2 ** 53 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when optionsSuccessStatus is 100', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 100 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should return CorsError when optionsSuccessStatus is 599', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 599 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should pass when maxAge is zero (boundary)', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: 0 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when optionsSuccessStatus is 200 (lower boundary)', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 200 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when optionsSuccessStatus is 299 (upper boundary)', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 299 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when maxAge is negative zero', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: -0 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should report credentials-with-wildcard origin before maxAge and status code violations', () => {
    const resolved = makeResolved({
      credentials: true,
      origin: '*',
      maxAge: -1,
      optionsSuccessStatus: 0,
    });
    const result = validateCorsOptions(resolved);
    expect(result?.data.reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
  });

  it('should report maxAge violation before status code violation', () => {
    const resolved = makeResolved({
      maxAge: 1.5,
      optionsSuccessStatus: 0,
    });
    const result = validateCorsOptions(resolved);
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  // ── origin 신규 검증 ──

  it('should pass when origin is wildcard *', () => {
    // Arrange
    const resolved = makeResolved({ origin: '*' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a valid concrete string', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'https://a.com' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is true', () => {
    // Arrange
    const resolved = makeResolved({ origin: true });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is false', () => {
    // Arrange
    const resolved = makeResolved({ origin: false });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is an array of strings and RegExps', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['https://a.com', /^https:\/\/b\.com$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when origin is an empty string', () => {
    // Arrange
    const resolved = makeResolved({ origin: '' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin is a blank string with spaces', () => {
    // Arrange
    const resolved = makeResolved({ origin: '  ' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin is a single space', () => {
    // Arrange
    const resolved = makeResolved({ origin: ' ' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin is an empty array', () => {
    // Arrange
    const resolved = makeResolved({ origin: [] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin array contains an empty string', () => {
    // Arrange
    const resolved = makeResolved({ origin: [''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin array contains a blank string', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['  '] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin array contains a single space', () => {
    // Arrange
    const resolved = makeResolved({ origin: [' '] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin array mixes valid and empty string entries', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['https://a.com', ''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin has a trailing slash (DN-3)', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'https://a.com/' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin has an uppercase scheme/host (RFC 6454 §6.2 canonical form)', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'HTTPS://A.COM' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin explicitly carries the default port', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'https://a.com:443' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin carries a path / query / fragment', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'https://a.com/path' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin is not a parseable URL', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'not-a-url' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should pass when origin is the literal "null" (RFC 6454 opaque origin)', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'null' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a serialized IPv6 origin', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'https://[::1]' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when an array origin entry is the CORS wildcard "*" literal', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['https://a.com', '*'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should report the offending entry index when an array origin has a trailing slash', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['https://a.com', 'https://b.com/'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
    expect(result?.data.message).toContain('origin[1]');
    expect(result?.data.message).toContain('https://b.com/');
  });

  it('should fire InvalidOrigin before CredentialsWithWildcardOrigin when origin is empty string and credentials is true', () => {
    // Arrange
    const resolved = makeResolved({ origin: '', credentials: true });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert — InvalidOrigin fires before V1
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  // ── methods 신규 검증 ──

  it('should pass when methods contains default values', () => {
    // Arrange
    const resolved = makeResolved({ methods: CORS_DEFAULT_METHODS });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when methods is wildcard array', () => {
    // Arrange
    const resolved = makeResolved({ methods: ['*'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when methods is ["*"] with credentials:true (D7)', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'https://a.com', methods: ['*'], credentials: true });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.CredentialsWithWildcardMethods);
  });

  it('should pass when methods contains a custom enum method like PROPFIND', () => {
    // Arrange
    const resolved = makeResolved({ methods: [HttpMethod.Get, HttpMethod.Propfind] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when methods is an empty array', () => {
    // Arrange
    const resolved = makeResolved({ methods: [] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidMethods);
  });


  // ── allowedHeaders 신규 검증 ──

  it('should pass when allowedHeaders is null', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: null });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when allowedHeaders is an empty array', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: [] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when allowedHeaders contains valid header names', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: ['X-Custom', 'Authorization'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when allowedHeaders contains an empty string', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: [''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidAllowedHeaders);
  });

  it('should return CorsError when allowedHeaders contains a blank string', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: ['  '] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidAllowedHeaders);
  });

  it('should return CorsError when allowedHeaders mixes valid and empty string entries', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: ['X-Custom', ''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidAllowedHeaders);
  });

  it('should return CorsError when allowedHeaders contains non-tchar characters (parentheses)', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: ['X-Foo(bar)'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidAllowedHeaders);
  });

  it('should return CorsError when allowedHeaders contains internal whitespace', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: ['X Foo'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidAllowedHeaders);
  });

  // ── exposedHeaders 신규 검증 ──

  it('should pass when exposedHeaders is null', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: null });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when exposedHeaders is an empty array', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: [] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when exposedHeaders contains valid header names', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: ['X-Request-Id'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when exposedHeaders contains an empty string', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: [''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidExposedHeaders);
  });

  it('should return CorsError when exposedHeaders contains a blank string', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: ['  '] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidExposedHeaders);
  });

  it('should return CorsError when exposedHeaders mixes valid and empty string entries', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: ['X-Custom', ''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidExposedHeaders);
  });

  it('should return CorsError when exposedHeaders contains comma (list separator)', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: ['X-Foo,Bar'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidExposedHeaders);
  });

  // ── optionsSuccessStatus 강화 검증 ──

  it('should return CorsError when optionsSuccessStatus is NaN', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: NaN });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should return CorsError when optionsSuccessStatus is a decimal number', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 200.5 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result?.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  // ── V_regex — single RegExp origin ──

  it('should pass when origin is a safe RegExp with anchors', () => {
    // Arrange
    const resolved = makeResolved({ origin: /^https:\/\/example\.com$/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a safe RegExp with i flag', () => {
    // Arrange
    const resolved = makeResolved({ origin: /^https:\/\/example\.com$/i });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a trivially safe RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: /a/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a safe RegExp with star height 1', () => {
    // Arrange
    const resolved = makeResolved({ origin: /^[a-z]+$/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a safe greedy-any RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: /.*/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a safe empty-group RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: /(?:)/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a string (V_regex skipped)', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'https://a.com' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  // ── V_regex — array containing RegExp ──

  it('should pass when origin array contains only safe RegExps', () => {
    // Arrange
    const resolved = makeResolved({ origin: [/^https:\/\/a\.com$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin array mixes string and safe RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['https://a.com', /^https:\/\/b\.com$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass for a RegExp origin with credentials:true (RegExp is not the wildcard)', () => {
    const resolved = makeResolved({ origin: /^a$/, credentials: true });
    const result = validateCorsOptions(resolved);
    expect(result).toBeUndefined();
  });
});
