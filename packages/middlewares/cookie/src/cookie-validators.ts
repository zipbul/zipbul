// Shared validation predicates for cookie names/attributes. This is a near-LEAF module: it depends only
// on the pure-literal `constants` module, so cookie-parser, cookie-jar, and the baker options schema can
// all depend on a single source of truth without forming an import cycle (cookie-jar already imports
// CookieParser for its type). The parser's per-cookie checkValidX guards and the boot-time baker rules
// in cookie-options both delegate here, so wire ingest, runtime validation, and option validation can
// never disagree about what a valid name/domain/path/expires is.

import { MAX_TIME_MS } from './constants';

function toExpiresMs(expires: number | Date | string): number {
  if (typeof expires === 'number') {return expires;}
  if (expires instanceof Date) {return expires.getTime();}
  return Date.parse(expires);
}

// Cookie name token per RFC 9110 §5.6.2 minus '%' (Bun.CookieMap percent-decodes inbound names;
// excluding '%' guarantees round-trip — an emitted name never carries a '%' that would re-decode).
// Module-private: callers go through isValidCookieName, the single token predicate.
const INVALID_TOKEN_CHARS = /[^\x21\x23\x24\x26\x27\x2A\x2B\x2D\x2E\x30-\x39\x41-\x5A\x5E-\x7A\x7C\x7E]/;

// RFC 1034/1123 subdomain LDH rule. Allows optional leading dot (RFC 6265 §4.1.2.3 — UA strips).
// Lowercase only (NO /i flag): Bun.Cookie rejects an uppercase Domain, so accepting one here would let
// a bad value pass validation and then throw at construction — the validator must agree with the
// executor. A caller with an uppercase domain must lowercase it (domains are case-insensitive).
export const RFC1123_DOMAIN = /^\.?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

// RFC 6265bis §4.1.1 path-value = *av-octet, av-octet = %x20-3A / %x3C-7E: printable ASCII except ';'.
// Anchored (matches the whole string) so it rejects CTLs, DEL, every byte >= 0x80, and ';' — exactly
// what Bun.Cookie accepts for a Path. There is NO leading-'/' requirement in the grammar. Exported so
// the boot schema's baker `matches(...)` rule and the runtime check below share one regex.
export const PATH_AV_OCTET = /^[\x20-\x3A\x3C-\x7E]*$/;

/** RFC 9110 token: non-empty and free of non-tchar/`%`. Identical rule on every code path. */
export function isValidCookieName(name: string): boolean {
  return name.length > 0 && !INVALID_TOKEN_CHARS.test(name);
}

/** A valid (lowercase) RFC 1123 LDH subdomain — the same regex the boot schema's `matches` rule uses. */
export function isValidDomain(domain: string): boolean {
  return RFC1123_DOMAIN.test(domain);
}

/** RFC 6265bis path av-octet — the same regex the boot schema's `matches` rule uses. */
export function isValidPath(path: string): boolean {
  return PATH_AV_OCTET.test(path);
}

// RFC 6265bis §4.1.1: max-age-av = non-zero-digit *DIGIT — a positive integer only. 0/negative are not
// derivable by the grammar; deletion uses a past Expires, never Max-Age=0.
export function isValidMaxAge(maxAge: number): boolean {
  return Number.isInteger(maxAge) && maxAge > 0;
}

/**
 * A representable instant. A `number` is JS milliseconds since the epoch (matching `Date.now()`); a
 * `Date` uses its time value; a `string` is parsed via `Date.parse`. The resulting ms must be finite
 * AND within the ECMAScript Date range (±8.64e15) — beyond that `new Date(ms)` is Invalid and Bun
 * rejects it, so a plain finiteness check would wrongly accept it.
 */
export function isValidExpires(expires: number | Date | string): boolean {
  const ms = toExpiresMs(expires);
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME_MS;
}

/**
 * Coerce a user-supplied expires to a `Date`, the only form Bun.Cookie accepts unambiguously. Bun reads
 * a bare `number` as Unix SECONDS (not ms), and its string parser rejects perfectly valid forms like
 * ISO-8601 (`2021-06-09`) that `Date.parse` accepts — so a `number` or `string` is converted to a
 * `Date` here and Bun never sees either. Assumes the input already passed {@link isValidExpires}, so
 * the produced Date is always valid. A `Date` passes through unchanged (e.g. `delete()`'s `new Date(0)`).
 */
export function normalizeExpires(expires: number | Date | string): Date {
  return expires instanceof Date ? expires : new Date(toExpiresMs(expires));
}
