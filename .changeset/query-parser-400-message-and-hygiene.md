---
"@zipbul/query-parser": patch
---

Fix a doubled error prefix in the middleware's 400 response, plus doc/type hygiene.

- **400 message fix.** The parser's error messages are already fully formed
  (`"Malformed query string: …"`, `"Conflict: …"`), but the middleware prepended
  a second `"Malformed query string: "`, so a strict-mode 400 body read
  `"Malformed query string: Malformed query string: …"` — and a structure
  conflict got the wrong prefix (`"Malformed query string: Conflict: …"`). The
  middleware now passes the parser message through verbatim.
- **Type surface.** `QueryParserErrorData` was tagged `@internal` despite being
  exported and being the public `E` of `parseResult()`; removed the tag so its
  JSDoc ships.
- **Docs.** Corrected the install note (the package is a framework middleware —
  it is not dependency-free standalone; the middleware form needs its framework
  peers). Documented `arrayLimit` as a resource bound (a high value lets a tiny
  input allocate a huge sparse array) and its 10-digit vs. 2³²−2 index caveat.
- **Tests.** Added regression guards: the 400 body is not double-prefixed,
  lone-surrogate percent escapes fall back to raw (non-strict) / 400 (strict),
  and the `"depth: min"` option-error message the README promises verbatim.
