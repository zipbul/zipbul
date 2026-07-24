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
};

/**
 * Every own-property name on `Object.prototype` (`constructor`, `toString`,
 * `hasOwnProperty`, `__defineGetter__`, …), plus `__proto__`. Derived from the
 * runtime at module-load time — self-updating across engines/versions and an
 * O(1) `Set` lookup, rather than a hand-maintained literal list that can drift.
 *
 * Every key in this set is dropped from the parsed output unconditionally, at
 * any position (there is no opt-out). This closes two real vectors that a
 * `__proto__`-only block leaves open:
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
 * intentionally NOT in this set and is never blocked.
 */
export const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  '__proto__',
]);
