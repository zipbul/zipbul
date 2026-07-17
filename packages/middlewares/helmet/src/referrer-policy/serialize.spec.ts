import { describe, expect, it } from 'bun:test';

import { HttpHeader } from '@zipbul/http-adapter';

import { ReferrerPolicyToken } from './enums';
import { serializeReferrerPolicy } from './serialize';

describe('serializeReferrerPolicy', () => {
  // STANDARDS §2.5: no explicit policy → current UAs already apply the
  // default, so `false` means "emit nothing".
  it('emits nothing when disabled', () => {
    expect(serializeReferrerPolicy(false)).toBeUndefined();
  });

  // STANDARDS §2.2: a single recognized token serializes as-is.
  it('emits [referrer-policy, token] for a single token', () => {
    expect(serializeReferrerPolicy(ReferrerPolicyToken.NoReferrer)).toEqual([
      HttpHeader.ReferrerPolicy,
      'no-referrer',
    ]);
  });

  // A single-element array is equivalent to the bare token.
  it('emits the same entry for a single-element array', () => {
    expect(serializeReferrerPolicy([ReferrerPolicyToken.NoReferrer])).toEqual([
      HttpHeader.ReferrerPolicy,
      'no-referrer',
    ]);
  });

  // §2.6~2.8 are SHOULD NOT, not MUST NOT — serialize does not police safety.
  it('serializes a below-baseline token unchanged', () => {
    expect(serializeReferrerPolicy(ReferrerPolicyToken.UnsafeUrl)).toEqual([
      HttpHeader.ReferrerPolicy,
      'unsafe-url',
    ]);
  });

  // STANDARDS §2.4 fallback list, §2.11 single emission: joined into one header value.
  it('joins a multi-token array with ", "', () => {
    expect(
      serializeReferrerPolicy([
        ReferrerPolicyToken.NoReferrer,
        ReferrerPolicyToken.StrictOriginWhenCrossOrigin,
      ]),
    ).toEqual([HttpHeader.ReferrerPolicy, 'no-referrer, strict-origin-when-cross-origin']);
  });

  // §2.4 last-wins: the fallback order must survive into the joined value.
  it('preserves array order in the joined value', () => {
    const entry = serializeReferrerPolicy([
      ReferrerPolicyToken.StrictOriginWhenCrossOrigin,
      ReferrerPolicyToken.NoReferrer,
    ]);
    expect(entry?.[1]).toBe('strict-origin-when-cross-origin, no-referrer');
  });

  // §2.5 equivalence: an empty array has nothing to emit, same as `false`.
  it('emits nothing for an empty array', () => {
    expect(serializeReferrerPolicy([])).toBeUndefined();
  });

  // Regression guard for defect 1: a `readonly` array literal (`as const`) must
  // typecheck, not just a mutable array.
  it('accepts a readonly array literal', () => {
    const tokens = [ReferrerPolicyToken.NoReferrer] as const;
    expect(serializeReferrerPolicy(tokens)).toEqual([HttpHeader.ReferrerPolicy, 'no-referrer']);
  });

  // STANDARDS §2.2: every recognized token is emitted verbatim as a lowercase
  // value (no case-insensitive matching is defined).
  it('emits every token verbatim as a lowercase value', () => {
    for (const token of Object.values(ReferrerPolicyToken)) {
      expect(serializeReferrerPolicy(token)?.[1]).toBe(token);
      expect(token.toLowerCase()).toBe(token);
    }
  });
});
