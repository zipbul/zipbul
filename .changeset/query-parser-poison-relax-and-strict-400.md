---
"@zipbul/query-parser": minor
---

Query parser: narrow the prototype-pollution blocklist to `__proto__` only, bring percent-decoding and pair-decomposition to WHATWG result-equivalence, map structurally malformed queries to a 400 in the middleware, and bound `arrayLimit`.

- **Prototype-pollution policy.** `__proto__` remains blocked at every position
  (its assignment invokes the prototype setter). Every other key —
  `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`,
  `__lookupGetter__`, `__lookupSetter__` — is now returned as an ordinary
  own-property value instead of being silently dropped. The parser only ever
  create-own-or-skips via `hasOwnProperty`, so these names never reach the
  prototype chain and the classic `?constructor[prototype][x]=y` payload builds
  an ordinary own object without polluting `Object.prototype` (verified with a
  global-pollution assertion across the vector matrix).

  BEHAVIOR CHANGE: `?constructor=1` now parses to `{ constructor: '1' }` (was
  `{}`), and the six names above are surfaced in the parsed object at all
  positions. If your app relied on them being absent, note that
  `parsed.constructor` is now the client-supplied string rather than `Object`.

- **WHATWG-compliant percent-decoding (§2.5/§2.6).** `safeDecode` never throws:
  a pure-ASCII fast path decodes valid and malformed `%HH` alike without
  `decodeURIComponent`'s throw cost; multi-byte input uses the native
  `decodeURIComponent` fast path when it's valid UTF-8, falling back to a
  byte-level WHATWG decode (`TextEncoder` → percent-decode bytes →
  `TextDecoder('utf-8', { fatal: false, ignoreBOM: true })`) otherwise. A
  malformed `%` (not followed by two hex digits) is preserved as a literal
  character and decoding continues — partial decode, e.g. `%ZZ%41` → `%ZZA`.
  Invalid UTF-8 becomes U+FFFD instead of throwing. A leading BOM is preserved.

  BREAKING BEHAVIOR CHANGE (strict mode): a malformed percent-escape is no
  longer a `strict` error. Previously `parse('bad=%zz')` / `parseResult(...)`
  under `strict: true` threw / returned `Err<MalformedQueryString>` (and the
  middleware mapped it to a 400); it now parses successfully to
  `{ bad: '%zz' }` in strict and non-strict alike. `strict` now validates
  **structure only** — unbalanced/nested/unclosed brackets, stray characters
  between bracket groups, and scalar/structure conflicts. If your app relied on
  `?q=%ZZ` (or similar) being rejected by `strict`, that traffic now reaches the
  handler with the malformed escape preserved as a literal string.

- **Empty-name pairs kept, empty sequences don't consume `maxParams` (§2.2/§2.3).**
  `parse('=v')` → `{ '': 'v' }` (previously dropped). A genuinely empty
  byte sequence — leading/trailing/consecutive `&` (e.g. `'&&'`) — still
  produces no pair, but no longer counts against the `maxParams` budget, so
  padding a query with empty `&&` runs no longer starves real parameters.

- **`DuplicateStrategy` enum.** A string enum (`DuplicateStrategy.First` /
  `.Last` / `.Array`) is exported from the package barrel. The `duplicates`
  option type is now `DuplicateStrategy | 'first' | 'last' | 'array'`, so
  existing bare-literal callers are unaffected.

- **`arrayLimit` upper bound.** `arrayLimit` must now be an integer in
  `[0, 10000]` (`MAX_ARRAY_LIMIT`); a value above 10000 throws
  `QueryParserErrorReason.InvalidArrayLimit` at `create()`. Previously
  unbounded, allowing a single `a[<huge>]=x` to inflate an array's `length`
  into DoS territory for downstream `JSON.stringify` / length-driven iteration.

- **Malformed query → 400 (middleware).** The `queryParser()` middleware's
  `getQuery` supply now returns `httpError(BadRequest)` on a *structurally*
  malformed query under `strict`, so the framework short-circuits into a 400
  response instead of letting a throw surface as a 500. A malformed
  percent-escape no longer triggers this path (see above). Default
  (`strict: false`) parsing is unchanged (lenient, never fails the request).

- **`parseResult()`** is documented and `isErr` / `Result` are re-exported from
  the package, so the non-throwing parse variant is usable without a second
  import from `@zipbul/result`.
