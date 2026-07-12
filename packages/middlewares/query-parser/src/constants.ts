import { DuplicateStrategy } from './enums';
import type { ResolvedQueryParserOptions } from './types';

/**
 * Upper bound for the `arrayLimit` option. A materialized array can reach length
 * `arrayLimit + 1`, so an unbounded `arrayLimit` lets a single `a[<huge>]=x`
 * inflate an array's `length` to billions — cheap to allocate but a DoS for any
 * downstream `JSON.stringify` / length-driven iteration. 10000 is far beyond any
 * real query need while keeping the worst-case array small.
 */
export const MAX_ARRAY_LIMIT = 10_000;

export const DEFAULT_QUERY_PARSER_OPTIONS: ResolvedQueryParserOptions = {
  depth: 5,
  maxParams: 1000,
  nesting: false,
  arrayLimit: 20,
  duplicates: DuplicateStrategy.First,
  strict: false,
  urlEncoded: false,
};

/**
 * The sole key ever blocked from a parsed object. `__proto__` is special: a
 * plain assignment (`obj.__proto__ = x`) invokes the prototype setter, so it is
 * neutralized at every position (root, nested segment, leaf).
 *
 * Every other key — including `constructor`, `prototype`, `__defineGetter__`,
 * etc. — is stored as an ordinary OWN-property shadow and is harmless: the
 * parser only ever create-own-or-skips via `hasOwnProperty`, so it never reads
 * or writes a property off the prototype chain. Blocking those names would
 * silently discard legitimate query fields (e.g. `?filter[constructor]=x`)
 * without adding any pollution defense.
 */
export const POISONED_KEYS: ReadonlySet<string> = new Set(['__proto__']);
