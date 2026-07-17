import { Baker, Field, isBakerIssueSet } from '@zipbul/baker';
import { isBoolean } from '@zipbul/baker/rules';
import { err } from '@zipbul/result';

import type { Result } from '@zipbul/result';

// Package-private baker. baker 5.x scopes `@Recipe` registration to an instance,
// so owning one here keeps this middleware's schema from colliding with the app
// baker or any other middleware's.
const conditionalRequestBaker = new Baker();

/**
 * Options for the middleware. baker validates the shape of whatever the caller
 * passes to the factory. Grow the schema by adding `@Field`-decorated
 * properties — each `@Field` runs its rules on the matching input value.
 */
@conditionalRequestBaker.Recipe
export class ConditionalRequestOptions {
  /** Example flag. `optional` lets callers omit it, in which case the default applies. */
  @Field(isBoolean, { optional: true })
  enabled?: boolean;
}

/** Fully-resolved options: every field present after defaults are applied. */
export interface ResolvedConditionalRequestOptions {
  enabled: boolean;
}

const CONDITIONAL_REQUEST_DEFAULTS: ResolvedConditionalRequestOptions = {
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
  conditionalRequestBaker.seal();
  isSealed = true;
}

/**
 * Validates caller options and merges defaults. Returns a `Result` — the
 * framework's value-or-error idiom — so the caller decides how to surface a bad
 * config. On success it returns the resolved options directly; on failure it
 * returns `err(...)`. (`Result<T, E>` is just `T | Err<E>`, no wrapper class.)
 */
export function resolveConditionalRequestOptions(
  options?: ConditionalRequestOptions,
): Result<ResolvedConditionalRequestOptions, Error> {
  ensureSealed();

  const validation = conditionalRequestBaker.validateSync(ConditionalRequestOptions, options ?? {});
  if (isBakerIssueSet(validation)) {
    const [issue] = validation.errors;
    return err(new Error(`invalid conditional-request options: ${issue?.path ?? '?'} ${issue?.code ?? ''}`.trim()));
  }

  return { ...CONDITIONAL_REQUEST_DEFAULTS, ...options };
}
