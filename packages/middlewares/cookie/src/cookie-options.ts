import { Baker, Field, createRule, isBakerIssueSet } from '@zipbul/baker';
import {
  isBoolean,
  isInt,
  isPositive,
  isEnum,
  oneOf,
  equals,
  isString,
  isUint8Array,
  arrayNotEmpty,
  arrayEvery,
  matches,
} from '@zipbul/baker/rules';

import { CookieErrorReason, CookiePriority, SameSite, SigningAlgorithm } from './enums';
import { CookieError } from './interfaces';
import { PATH_AV_OCTET, RFC1123_DOMAIN, isValidExpires } from './cookie-validators';
import type { CookieParserOptions } from './interfaces';

// A baker owned privately by this middleware. baker 5.x scopes registration/seal/run to an instance, so
// keeping our own `Baker` means the host app's baker and other middlewares never collide with the
// schema below. Only CookieParserOptionsSchema registers here, so a single lazy seal on first validate
// suffices (mirrors cors/query-parser).
const cookieBaker = new Baker();

// The only rules baker's built-ins can't express, so they're the only custom ones:
// - `nonBlank`: baker's `isNotEmpty` accepts whitespace-only strings; the contract rejects them.
const nonBlank = createRule('nonBlank', (v) => typeof v === 'string' && v.trim().length > 0);
// - `validEncryptionSecret`: "non-blank string OR non-empty array of non-blank" — `oneOf` takes single
//   rules per branch and can't AND `arrayNotEmpty` with `arrayEvery`, so the array branch is inlined.
const validEncryptionSecret = createRule('validEncryptionSecret', (v) =>
  (typeof v === 'string' && v.trim().length > 0)
  || (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.trim().length > 0)),
);
// - `validExpires`: number(ms) | Date | string within the Date range — no built-in covers this union.
//   Reuses the same predicate the per-cookie runtime check and normalizeExpires use, so boot and runtime
//   agree on what a valid expires is.
const validExpires = createRule('validExpires', (v) =>
  (typeof v === 'number' || typeof v === 'string' || v instanceof Date) && isValidExpires(v),
);

// Boot-time schema over the RAW, flat CookieParserOptions — validated BEFORE resolveCookieParserOptions
// null-fills and nests its defaults (baker `optional` skips `undefined`, not `null`, so the pre-resolve
// shape is the one that maps cleanly to these per-field rules).
@cookieBaker.Recipe
class CookieParserOptionsSchema {
  // arrayNotEmpty -> EmptySecrets, arrayEvery(nonBlank) -> InvalidSecret (mapped by issue.code below).
  @Field(arrayNotEmpty, arrayEvery(nonBlank), { optional: true })
  secrets?: string[];

  @Field(validEncryptionSecret, { optional: true, context: { reason: CookieErrorReason.InvalidEncryptionSecret } })
  encryptionSecret?: string | string[];

  @Field(isEnum(SigningAlgorithm), { optional: true, context: { reason: CookieErrorReason.InvalidAlgorithm } })
  algorithm?: SigningAlgorithm;

  @Field(isBoolean, { optional: true, context: { reason: CookieErrorReason.InvalidPrefixValidation } })
  prefixValidation?: boolean;

  @Field(oneOf(isString, isUint8Array), { optional: true, context: { reason: CookieErrorReason.InvalidKdfSalt } })
  kdfSalt?: string | Uint8Array;

  @Field(isInt, isPositive, { optional: true, context: { reason: CookieErrorReason.InvalidMaxInboundCookieBytes } })
  maxInboundCookieBytes?: number;

  @Field(isBoolean, { optional: true, context: { reason: CookieErrorReason.InvalidHttpOnly } })
  httpOnly?: boolean;

  @Field(oneOf(isBoolean, equals('auto')), { optional: true, context: { reason: CookieErrorReason.InvalidSecure } })
  secure?: boolean | 'auto';

  @Field(isEnum(SameSite), { optional: true, context: { reason: CookieErrorReason.InvalidSameSite } })
  sameSite?: SameSite;

  @Field(matches(PATH_AV_OCTET), { optional: true, context: { reason: CookieErrorReason.InvalidPath } })
  path?: string;

  @Field(matches(RFC1123_DOMAIN), { optional: true, context: { reason: CookieErrorReason.InvalidDomain } })
  domain?: string;

  @Field(isInt, isPositive, { optional: true, context: { reason: CookieErrorReason.InvalidMaxAge } })
  maxAge?: number;

  @Field(validExpires, { optional: true, context: { reason: CookieErrorReason.InvalidExpires } })
  expires?: number | Date | string;

  @Field(isBoolean, { optional: true, context: { reason: CookieErrorReason.InvalidPartitioned } })
  partitioned?: boolean;

  @Field(isEnum(CookiePriority), { optional: true, context: { reason: CookieErrorReason.InvalidPriority } })
  priority?: CookiePriority;
}

// `secrets` is the only field whose two failure modes need two reasons (empty array vs. blank element),
// and it uses the generic built-ins arrayNotEmpty/arrayEvery — so the mapping is keyed by `path:code`
// (not code alone) to stay correct if another array field is added later. Every other field's reason
// rides on its single @Field context.
const PATH_CODE_REASON: Readonly<Record<string, CookieErrorReason>> = {
  'secrets:arrayNotEmpty': CookieErrorReason.EmptySecrets,
  'secrets:arrayEvery': CookieErrorReason.InvalidSecret,
};

let sealed = false;
function ensureSealed(): void {
  if (sealed) {return;}
  cookieBaker.seal();
  sealed = true;
}

/**
 * Validate raw cookie-parser options at construction (boot) and throw a {@link CookieError} on the
 * first malformed field. Misconfiguration is a programmer error — it fails identically on every request
 * — so it surfaces as a throw here rather than as a per-request Result.
 *
 * @throws {CookieError} when any option fails its schema rule.
 */
export function validateCookieOptionsAtBoot(options: CookieParserOptions): void {
  ensureSealed();
  const result = cookieBaker.validateSync(CookieParserOptionsSchema, options);
  if (!isBakerIssueSet(result)) {return;}

  const issue = result.errors[0]!;
  const contextReason = (issue.context as { reason?: CookieErrorReason } | undefined)?.reason;
  const reason = PATH_CODE_REASON[`${issue.path}:${issue.code}`] ?? contextReason;
  if (reason === undefined) {
    throw new Error(`internal: cookie option "${issue.path}" failed rule "${issue.code}" with no mapped reason`);
  }
  throw new CookieError({ reason, message: `${issue.path}: ${issue.code}` });
}
