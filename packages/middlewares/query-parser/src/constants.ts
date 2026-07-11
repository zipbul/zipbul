import { DuplicateStrategy } from './enums';
import type { ResolvedQueryParserOptions } from './types';

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
