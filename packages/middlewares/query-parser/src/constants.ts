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
  allowPrototypes: false,
};

/**
 * The key that is ALWAYS blocked, even when {@link QueryParserOptions.allowPrototypes}
 * opts back into the rest of {@link DANGEROUS_KEYS}. `__proto__` is special: a plain
 * assignment (`obj.__proto__ = x`) invokes the prototype setter, so it is neutralized
 * at every position (root, nested segment, leaf) unconditionally.
 */
export const POISONED_KEYS: ReadonlySet<string> = new Set(['__proto__']);

/**
 * Every own-property name on `Object.prototype` (`constructor`, `toString`,
 * `hasOwnProperty`, `__defineGetter__`, …), plus `__proto__`. Derived from the
 * runtime at module-load time — self-updating across engines/versions and an
 * O(1) `Set` lookup, rather than a hand-maintained literal list that can drift.
 *
 * By default (`allowPrototypes: false`) every key in this set is dropped from
 * the parsed output, at any position. This closes two real vectors previously
 * possible with only `__proto__` blocked:
 *  - Pollution gadget: `constructor[prototype][x]=1` builds an own
 *    `{ constructor: { prototype: { x: '1' } } }` shadow; fed to a naive
 *    recursive merge (`merge({}, parsed)`) elsewhere in an application, this
 *    reaches `Object.prototype` and pollutes it.
 *  - Method-shadow crash: `k[toString]=1` produces `{ k: { toString: '1' } }`,
 *    and `String(out.k)` throws because the own-property string shadows the
 *    inherited `Object.prototype.toString`. `k[hasOwnProperty]=1` similarly
 *    breaks a later `out.k.hasOwnProperty(...)` call.
 *
 * `prototype` is NOT an own-property name of `Object.prototype` (it is an
 * own-property of function objects, not of `Object.prototype`), so it is
 * intentionally NOT in this set and is never blocked — matching `qs`'s
 * `allowPrototypes` semantics exactly.
 *
 * Setting {@link QueryParserOptions.allowPrototypes} to `true` reverts to the
 * prior, narrower policy: only `__proto__` (see {@link POISONED_KEYS}) is
 * blocked, and every other key in this set — including `constructor` and the
 * `__define*__`/`__lookup*__` accessors — is returned as an ordinary
 * own-property value again.
 */
export const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  '__proto__',
]);
