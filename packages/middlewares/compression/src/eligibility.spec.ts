import { describe, expect, it } from 'bun:test';

import { hasNoTransform, varyCoversAcceptEncoding, varyTokensToAppend } from './eligibility';

describe('varyCoversAcceptEncoding', () => {
  it('is true when Vary lists accept-encoding (case-insensitive)', () => {
    expect(varyCoversAcceptEncoding('Accept-Encoding')).toBe(true);
    expect(varyCoversAcceptEncoding('accept-encoding')).toBe(true);
    expect(varyCoversAcceptEncoding('Cookie, Accept-Encoding')).toBe(true);
    expect(varyCoversAcceptEncoding('accept-encoding , user-agent')).toBe(true);
  });

  it('is true when Vary is the wildcard *', () => {
    expect(varyCoversAcceptEncoding('*')).toBe(true);
    expect(varyCoversAcceptEncoding('User-Agent, *')).toBe(true);
  });

  it('is false when Vary does not cover Accept-Encoding', () => {
    expect(varyCoversAcceptEncoding('User-Agent')).toBe(false);
    expect(varyCoversAcceptEncoding('')).toBe(false);
    expect(varyCoversAcceptEncoding('Accept-Encoding-Foo')).toBe(false); // not a substring false-match
  });
});

describe('varyTokensToAppend', () => {
  it('returns incoming tokens not already present (case-insensitive dedupe)', () => {
    expect(varyTokensToAppend('Accept-Encoding', 'Accept-Language')).toEqual(['Accept-Language']);
    expect(varyTokensToAppend('accept-encoding', 'Accept-Encoding')).toEqual([]);
    expect(varyTokensToAppend('Accept-Encoding', 'accept-language, Accept-Encoding')).toEqual(['accept-language']);
  });

  it('treats a null/empty existing header as no coverage', () => {
    expect(varyTokensToAppend(null, 'Accept-Language')).toEqual(['Accept-Language']);
    expect(varyTokensToAppend('', 'Accept-Language, Cookie')).toEqual(['Accept-Language', 'Cookie']);
  });

  it('returns nothing when existing already varies on everything (*)', () => {
    expect(varyTokensToAppend('*', 'Accept-Language')).toEqual([]);
    expect(varyTokensToAppend('User-Agent, *', 'Accept-Encoding')).toEqual([]);
  });

  it('de-dupes repeated tokens within the incoming value', () => {
    expect(varyTokensToAppend(null, 'Accept-Language, accept-language')).toEqual(['Accept-Language']);
  });
});

describe('hasNoTransform', () => {
  it('is true when Cache-Control carries no-transform (case-insensitive, multi-directive)', () => {
    expect(hasNoTransform('no-transform')).toBe(true);
    expect(hasNoTransform('No-Transform')).toBe(true);
    expect(hasNoTransform('public, max-age=0, no-transform')).toBe(true);
    expect(hasNoTransform('no-transform , private')).toBe(true);
  });

  it('is false otherwise', () => {
    expect(hasNoTransform('no-cache')).toBe(false);
    expect(hasNoTransform('no-transform-x')).toBe(false); // not a substring false-match
    expect(hasNoTransform('')).toBe(false);
  });
});
