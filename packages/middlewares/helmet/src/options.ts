import { Baker, Field, isBakerIssueSet } from '@zipbul/baker';
import { isBoolean } from '@zipbul/baker/rules';
import { err } from '@zipbul/result';

import type { Result } from '@zipbul/result';

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
