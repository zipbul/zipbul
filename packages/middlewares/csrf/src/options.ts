import { Baker, Field, isBakerIssueSet } from '@zipbul/baker';
import { isBoolean } from '@zipbul/baker/rules';
import { err } from '@zipbul/result';

import type { Result } from '@zipbul/result';

// Package-private baker. baker 5.x scopes `@Recipe` registration to an instance,
// so owning one here keeps this middleware's schema from colliding with the app
// baker or any other middleware's.
const csrfBaker = new Baker();

/**
 * Options for the middleware. baker validates the shape of whatever the caller
 * passes to the factory. Grow the schema by adding `@Field`-decorated
 * properties — each `@Field` runs its rules on the matching input value.
 */
@csrfBaker.Recipe
export class CsrfOptions {
  /** Example flag. `optional` lets callers omit it, in which case the default applies. */
  @Field(isBoolean, { optional: true })
  enabled?: boolean;
}

/** Fully-resolved options: every field present after defaults are applied. */
export interface ResolvedCsrfOptions {
  enabled: boolean;
}

const CSRF_DEFAULTS: ResolvedCsrfOptions = {
  enabled: true,
};

// baker requires `seal()` once, after every `@Recipe` class has been imported.
// Deferring to first use (rather than sealing at module load) lets the class
// import settle first; the guard makes repeat calls skip the redundant seal.
let isSealed = false;
function ensureSealed(): void {
  if (isSealed) {
    return;
  }
  csrfBaker.seal();
  isSealed = true;
}

/**
 * Validates caller options and merges defaults. Returns a `Result` — the
 * framework's value-or-error idiom — so the caller decides how to surface a bad
 * config. On success it returns the resolved options directly; on failure it
 * returns `err(...)`. (`Result<T, E>` is just `T | Err<E>`, no wrapper class.)
 */
export function resolveCsrfOptions(
  options?: CsrfOptions,
): Result<ResolvedCsrfOptions, Error> {
  ensureSealed();

  const validation = csrfBaker.validateSync(CsrfOptions, options ?? {});
  if (isBakerIssueSet(validation)) {
    const [issue] = validation.errors;
    return err(new Error(`invalid csrf options: ${issue?.path ?? '?'} ${issue?.code ?? ''}`.trim()));
  }

  return { ...CSRF_DEFAULTS, ...options };
}
