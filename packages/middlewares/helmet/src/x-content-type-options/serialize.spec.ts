import { describe, expect, it } from 'bun:test';

import { HttpHeader } from '@zipbul/http-adapter';

import { serializeXContentTypeOptions } from './serialize';

describe('serializeXContentTypeOptions', () => {
  // STANDARDS §1.2 [MUST]: emitted value is exactly the `nosniff` token.
  it('emits [x-content-type-options, nosniff] when enabled', () => {
    expect(serializeXContentTypeOptions(true)).toEqual([
      HttpHeader.XContentTypeOptions,
      'nosniff',
    ]);
  });

  // STANDARDS §1.2: the sole valid token — never anything else.
  it('emits the nosniff token, not a variant', () => {
    const entry = serializeXContentTypeOptions(true);
    expect(entry?.[1]).toBe('nosniff');
  });

  // Emission is gated by the boolean; disabled → no header.
  it('emits nothing when disabled', () => {
    expect(serializeXContentTypeOptions(false)).toBeUndefined();
  });
});
