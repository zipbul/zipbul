import { describe, expect, it } from 'bun:test';

import { isErr } from '@zipbul/result';

import { resolveHelmetOptions } from './options';
import { ReferrerPolicyToken } from './referrer-policy';

function unwrap(result: ReturnType<typeof resolveHelmetOptions>) {
  if (isErr(result)) {
    throw new Error('expected ok, got err');
  }
  return result;
}

describe('resolveHelmetOptions', () => {
  // STANDARDS §1.3: emission is a policy choice; secure-by-default → on.
  // The default comes from the class-field initializer via baker
  // allowClassDefaults + deserializeSync.
  it('defaults xContentTypeOptions to true when omitted', () => {
    expect(unwrap(resolveHelmetOptions()).xContentTypeOptions).toBe(true);
    expect(unwrap(resolveHelmetOptions({})).xContentTypeOptions).toBe(true);
  });

  it('keeps an explicit false', () => {
    expect(unwrap(resolveHelmetOptions({ xContentTypeOptions: false })).xContentTypeOptions).toBe(
      false,
    );
  });

  it('errs on a wrong-typed option (coarse shape via baker)', () => {
    // @ts-expect-error — intentionally invalid: boolean field given a string.
    expect(isErr(resolveHelmetOptions({ xContentTypeOptions: 'yes' }))).toBe(true);
  });
});

describe('resolveHelmetOptions — referrerPolicy', () => {
  // STANDARDS §2.8: secure-by-default → the strongest baseline-or-above token.
  it('defaults referrerPolicy to no-referrer when omitted', () => {
    expect(unwrap(resolveHelmetOptions()).referrerPolicy).toBe(ReferrerPolicyToken.NoReferrer);
    expect(unwrap(resolveHelmetOptions({})).referrerPolicy).toBe(ReferrerPolicyToken.NoReferrer);
  });

  it('accepts a valid token', () => {
    expect(
      unwrap(resolveHelmetOptions({ referrerPolicy: ReferrerPolicyToken.StrictOrigin }))
        .referrerPolicy,
    ).toBe(ReferrerPolicyToken.StrictOrigin);
  });

  it('accepts a non-empty array of valid tokens', () => {
    const tokens = [ReferrerPolicyToken.NoReferrer, ReferrerPolicyToken.StrictOrigin] as const;
    expect(unwrap(resolveHelmetOptions({ referrerPolicy: tokens })).referrerPolicy).toEqual(
      tokens,
    );
  });

  // §2.5: `false` disables emission — current UAs already apply the default.
  it('accepts false', () => {
    expect(unwrap(resolveHelmetOptions({ referrerPolicy: false })).referrerPolicy).toBe(false);
  });

  // Empty array is valid input; serialize treats it as equivalent to `false`.
  it('accepts an empty array', () => {
    expect(unwrap(resolveHelmetOptions({ referrerPolicy: [] })).referrerPolicy).toEqual([]);
  });

  // STANDARDS §2.2: recognized tokens are lowercase only — no case-insensitive match is defined.
  it('errs on an uppercase variant of a valid token', () => {
    // @ts-expect-error — intentionally invalid: not a recognized token.
    expect(isErr(resolveHelmetOptions({ referrerPolicy: 'NO-REFERRER' }))).toBe(true);
    // @ts-expect-error — intentionally invalid: not a recognized token.
    expect(isErr(resolveHelmetOptions({ referrerPolicy: 'No-Referrer' }))).toBe(true);
  });

  // Only `false` is valid among booleans — `true` is not a policy token.
  it('errs on true', () => {
    // @ts-expect-error — intentionally invalid: true is not a valid policy value.
    expect(isErr(resolveHelmetOptions({ referrerPolicy: true }))).toBe(true);
  });

  it('errs on an unrecognized string', () => {
    // @ts-expect-error — intentionally invalid: not a recognized token.
    expect(isErr(resolveHelmetOptions({ referrerPolicy: 'bogus' }))).toBe(true);
  });

  it('errs on an array containing an unrecognized token', () => {
    expect(
      isErr(
        resolveHelmetOptions({
          // @ts-expect-error — intentionally invalid: 'bogus' is not a recognized token.
          referrerPolicy: [ReferrerPolicyToken.NoReferrer, 'bogus'],
        }),
      ),
    ).toBe(true);
  });

  it('errs on a non-string, non-array, non-boolean value', () => {
    // @ts-expect-error — intentionally invalid: not a policy value.
    expect(isErr(resolveHelmetOptions({ referrerPolicy: 42 }))).toBe(true);
  });
});
