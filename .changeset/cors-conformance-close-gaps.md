---
"@zipbul/cors": minor
---

Close the remaining Fetch/RFC conformance gaps found by a 14-implementation industry audit (see `INDUSTRY-COMPARISON.md`), making `@zipbul/cors` the only surveyed implementation passing §1.5+§7.1+§7.2+§3.5+§3.7 of `STANDARDS.md` simultaneously.

**Behavior changes**

- **§7.1 — `Vary: Origin` on rejected/no-Origin responses.** `CorsRejectResult` gains a `headers: Headers` field carrying cache-correctness headers; `corsMiddleware` writes them on rejected requests. Prevents a shared cache from replaying an ACAO-less response to an allowed origin.
- **§7.2 — static wildcard on non-CORS responses.** With `origin: '*'`, a request without an `Origin` header now returns `Continue` with `Access-Control-Allow-Origin: *` (previously `Reject(NoOrigin)`), per Fetch's CORS-and-HTTP-caches guidance.
- **§1.5 — no empty list elements in the reflected `Access-Control-Allow-Headers`.** Reflect mode re-serializes the parsed header names instead of echoing the raw client string (`"X-Foo ,, x-bar"` → `X-Foo,x-bar`), per RFC 9110 §5.6.1.1's sender rule.
- **Origin-function returns are now validated** to the same standard as config origins: `'*'`, `'null'`, or a value that is its own URL origin serialization. Malformed returns (trailing slash, explicit default port, blank, control characters) are treated as not-allowed instead of emitted.
- **Success-path `Vary` is keyed on the config, not the granted value** — an origin function returning `'*'` for one request no longer produces a cacheable wildcard grant without `Vary: Origin`.

**Docs**

- `STANDARDS.md` rewritten as 27 mechanically derived rules (header ABNF + cors-conditioned failure-step negations + server-addressed directives), each with a verbatim source citation.
- `INDUSTRY-COMPARISON.md` added: 27-rule audit of 13 major CORS implementations across 6 ecosystems (JS runtime-probed, others source-audited).
- READMEs (en/ko) rewritten zipbul-first and corrected against source after a 4-reviewer adversarial pass (31 defects fixed, including a nonexistent `addMiddlewares` API in examples).
