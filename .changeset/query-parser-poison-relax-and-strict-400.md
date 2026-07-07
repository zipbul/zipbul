---
"@zipbul/query-parser": minor
---

Query parser: narrow the prototype-pollution blocklist to `__proto__` only, and map malformed queries to a 400 in the middleware.

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

- **Malformed query → 400 (middleware).** The `queryParser()` middleware's
  `getQuery` supply now returns `httpError(BadRequest)` on a malformed query
  under `strict`, so the framework short-circuits into a 400 response instead of
  letting a throw surface as a 500. Default (`strict: false`) parsing is
  unchanged (lenient, never fails the request).

- **`parseResult()`** is documented and `isErr` / `Result` are re-exported from
  the package, so the non-throwing parse variant is usable without a second
  import from `@zipbul/result`.
