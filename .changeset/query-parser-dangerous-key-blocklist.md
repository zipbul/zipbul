---
"@zipbul/query-parser": minor
---

Query parser: block all `Object.prototype` own-property-named keys by default, closing a prototype-pollution gadget and a method-shadow crash vector left open by the `__proto__`-only blocklist; add an opt-in `allowPrototypes` escape hatch.

- **Prototype-pollution policy (SECURITY, BREAKING CHANGE).** By default
  (`allowPrototypes: false`), every key that names an own-property of
  `Object.prototype` — `constructor`, `toString`, `hasOwnProperty`,
  `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`,
  `__lookupSetter__`, … — is now dropped from the parsed output at every
  position (root, nested segment, leaf), the same way `__proto__` always was.
  `__proto__` remains blocked unconditionally, at every position, regardless
  of this option. `prototype` is **not** an own-property of `Object.prototype`
  (it is an own-property of function objects, not of `Object.prototype`) and is
  intentionally never blocked — matching `qs`'s behavior exactly.

  This closes two real vectors that existed when only `__proto__` was
  blocked:
  - **Pollution gadget:** `?constructor[prototype][x]=1` used to build an
    ordinary own object `{ constructor: { prototype: { x: '1' } } }`. Handed
    to a naive recursive merge elsewhere in an application
    (`merge({}, parsed)`), that shape reaches and pollutes
    `Object.prototype`.
  - **Method-shadow crash:** `?k[toString]=1` used to build
    `{ k: { toString: '1' } }` — an own-property string that shadows the
    inherited `Object.prototype.toString`, so a later `String(parsed.k)`
    throws. `?k[hasOwnProperty]=1` similarly breaks a later
    `parsed.k.hasOwnProperty(...)` call.

  Dropping a key at a nested segment/leaf position leaves the parent
  container shell in place rather than discarding the whole result:
  `?a[toString]=1` → `{ a: {} }`, not `{}` — identical in shape to the
  pre-existing `?a[__proto__][x]=1` → `{ a: {} }` behavior.

  BREAKING CHANGE: `?constructor=1` now parses to `{}` (was
  `{ constructor: '1' }` as of the previous minor), and the other names
  above are dropped again at all positions. If your app relies on these
  names being surfaced in the parsed object, pass `allowPrototypes: true`
  to restore that behavior — but note the SECURITY warning below before
  doing so.

- **New `allowPrototypes` option.** `boolean`, default `false`. Setting it to
  `true` reverts to blocking only `__proto__`, re-admitting every other
  `Object.prototype`-named key as an ordinary own-property value (the
  previous default). ⚠️ SECURITY: this re-arms both vectors above — only
  enable it if you fully control how the parsed object is consumed
  downstream (e.g. you already sanitize/reject dangerous key names, or never
  merge the result into anything). Invalid values throw
  `QueryParserErrorReason.InvalidAllowPrototypes` at `create()`. Matches
  `qs`'s `allowPrototypes` opt-in.

- **`DANGEROUS_KEYS`** is exported from `constants.ts` (internal) as
  `Object.getOwnPropertyNames(Object.prototype)` plus `__proto__`, computed
  once at module load — self-updating across engines/versions with an O(1)
  `Set` lookup, rather than a hand-maintained literal list.
