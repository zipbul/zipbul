import { Baker, Field, isBakerIssueSet } from '@zipbul/baker';
import { arrayEvery, equals, isBoolean, isEnum, oneOf } from '@zipbul/baker/rules';
import { err } from '@zipbul/result';

import type { Result } from '@zipbul/result';

import { ReferrerPolicyToken } from './referrer-policy';

import type { ReferrerPolicyOption } from './referrer-policy';

// Package-private baker. `allowClassDefaults` lets `deserializeSync` fill
// missing keys from each field's initializer, so the class is the single
// source of both schema and defaults — no separate defaults constant.
const helmetBaker = new Baker({ allowClassDefaults: true });

/**
 * Options for the helmet middleware. Each `@Field` declares the shape baker
 * validates; the initializer is the default applied when the key is omitted.
 */
@helmetBaker.Recipe
export class HelmetOptions {
  /**
   * Emit `X-Content-Type-Options: nosniff`. Defaults to `true`
   * (secure-by-default; STANDARDS §1.3). Set `false` to omit the header.
   * The value is fixed to `nosniff` (§1.2) — only emission is configurable.
   */
  @Field(isBoolean, { optional: true })
  xContentTypeOptions: boolean = true;

  /**
   * Referrer-Policy value to emit. Defaults to `no-referrer` (secure-by-default;
   * STANDARDS §2.8 — the strongest of the author-recommended tokens).
   * `false` → no emission (§2.5 — modern UAs already apply
   * `strict-origin-when-cross-origin`). Only the 8 recognized tokens are valid
   * (§2.2). Below-baseline tokens (`unsafe-url`, `origin`, etc.) are still
   * accepted — they lower protection (§2.6~2.8) but are not forbidden. If
   * `no-referrer` breaks referrer-based analytics or CSRF checks, pick a
   * weaker policy.
   *
   * **Arrays are §2.4 last-wins**: the last **recognized** token is the
   * effective policy; earlier tokens are fallbacks for UAs that don't
   * recognize it. E.g. `[NoReferrer, StrictOriginWhenCrossOrigin]` →
   * effective `strict-origin-when-cross-origin`, `no-referrer` is the fallback.
   * Put the preferred policy **last**. An empty array `[]` is treated as
   * `false` (no emission).
   */
  @Field(
    oneOf(
      equals(false), // no emission
      isEnum(ReferrerPolicyToken), // single token
      arrayEvery(isEnum(ReferrerPolicyToken)), // fallback list (empty array passes → no emission in serialize)
    ),
    { optional: true },
  )
  referrerPolicy: ReferrerPolicyOption = ReferrerPolicyToken.NoReferrer;
}

let isSealed = false;
function ensureSealed(): void {
  if (isSealed) {
    return;
  }
  helmetBaker.seal();
  isSealed = true;
}

/**
 * Validates caller options and applies defaults. Returns a `Result` — on
 * success the fully-resolved `HelmetOptions` (every field present), on failure
 * an `err(...)`. Defaults come from the class-field initializers, so callers
 * that omit a field get the secure default.
 */
export function resolveHelmetOptions(
  options?: Partial<HelmetOptions>,
): Result<HelmetOptions, Error> {
  ensureSealed();

  const resolved = helmetBaker.deserializeSync(HelmetOptions, options ?? {});
  if (isBakerIssueSet(resolved)) {
    const [issue] = resolved.errors;
    return err(
      new Error(`invalid helmet options: ${issue?.path ?? '?'} ${issue?.code ?? ''}`.trim()),
    );
  }

  return resolved;
}
