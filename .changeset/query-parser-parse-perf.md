---
"@zipbul/query-parser": patch
---

Query parser: hot-path performance optimizations (no behavior change).

Guided by a Bun CPU profile (`--cpu-prof-md`) of the nested/array paths:

- **Numeric-index array writes.** Array elements are written via `arr[idx]` (JSC's
  fast contiguous-array put) instead of `arr['idx']` (the generic string-keyed
  put), which the profile showed as a ~14% self-time hotspot.
- **Fused index parsing.** `isValidArrayIndex` + a redundant `parseInt` are merged
  into a single `parseArrayIndex` digit walk (returns the index or -1), computed
  once per segment and only on the array path.
- **Decode-flag tracking during the scan.** `%` / `+` are detected in the main
  scan loop, so `processPair` no longer re-scans each sliced key/value with
  `.includes('%')` / `.includes('+')`.

Same-machine A/B (Bun 1.3.14, i7-13700K): array ×10 ~1.36 µs → ~0.85 µs (~38%),
`+`-heavy form ~9% faster, nested/flat a few % faster, encoded neutral. All 185
tests plus the adversarial pollution/phantom fuzz still pass. README perf tables
refreshed against the optimized build.
