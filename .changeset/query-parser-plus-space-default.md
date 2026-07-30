---
"@zipbul/query-parser": major
---

BREAKING: `+` in query keys and values now always decodes to a space, matching WHATWG `application/x-www-form-urlencoded` semantics (the same behavior as `URLSearchParams`, `qs`, browsers, and every mainstream query-string parser). The `urlEncoded` option — which previously gated this behavior — has been removed entirely.

- **`+` → space is now unconditional.** `parse('q=hello+world')` now returns `{ q: 'hello world' }` (previously `{ q: 'hello+world' }` by default). This applies to both keys and values, and to nested bracket segments. The substitution happens on the raw string **before** percent-decoding, so `%2B` is unaffected and still decodes to a literal `+` (`parse('a=%2B')` → `{ a: '+' }`). The `+`→space and percent-decode passes remain independent, so a malformed percent escape never discards an already-applied space substitution (`parse('a=a+b%ZZ')` → `{ a: 'a b%ZZ' }`).
- **`urlEncoded` option removed.** `QueryParserOptions.urlEncoded` no longer exists — passing it is now a no-op (not a type error only if you bypass TypeScript). `QueryParserErrorReason.InvalidUrlEncoded` has also been removed.
- **Migration:** if your application relied on `+` being treated as a literal character, escape it as `%2B` before sending it in a query string. There is no option to restore the old literal-`+` behavior — no standard or mainstream parser supports it, and RFC 3986 does not define `+` handling for query pairs in the first place (pair decomposition and value semantics are WHATWG's domain, not RFC 3986's — see `STANDARDS.md` §1.7/§2.4).
