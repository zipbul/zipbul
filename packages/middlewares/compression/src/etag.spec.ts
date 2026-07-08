import { describe, expect, it } from 'bun:test';

import { weakenETag } from './etag';

describe('weakenETag', () => {
  it('weakens a strong ASCII tag by prefixing W/', () => {
    expect(weakenETag('"abc"')).toBe('W/"abc"');
    expect(weakenETag('"33a64df5"')).toBe('W/"33a64df5"');
  });

  it('weakens an empty opaque tag', () => {
    expect(weakenETag('""')).toBe('W/""');
  });

  it('weakens tags containing obs-text octets 0x80-0xFF (RFC 9110 §8.8.3 etagc)', () => {
    expect(weakenETag('"caf\xe9"')).toBe('W/"caf\xe9"'); // é = 0xE9
    expect(weakenETag('"a\x80b"')).toBe('W/"a\x80b"');
    expect(weakenETag('"a\xffb"')).toBe('W/"a\xffb"');
  });

  it('leaves already-weak tags unchanged (no double W/)', () => {
    expect(weakenETag('W/"abc"')).toBe('W/"abc"');
    expect(weakenETag('W/"caf\xe9"')).toBe('W/"caf\xe9"');
  });

  it('leaves malformed tags unchanged (fabricates no invalid weak tag)', () => {
    expect(weakenETag('abc')).toBe('abc'); // unquoted
    expect(weakenETag('w/"abc"')).toBe('w/"abc"'); // lowercase weak indicator
    expect(weakenETag('"a"b"')).toBe('"a"b"'); // inner DQUOTE (0x22) not allowed in etagc
    expect(weakenETag('"a\x7fb"')).toBe('"a\x7fb"'); // DEL (0x7F) excluded from etagc
    expect(weakenETag('"a\x1fb"')).toBe('"a\x1fb"'); // control char below 0x21 excluded
  });
});
