import { describe, expect, it } from 'bun:test';

import { isErr } from '@zipbul/result';

import { resolveHelmetOptions } from './options';

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
