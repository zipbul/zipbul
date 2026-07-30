---
"@zipbul/query-parser": patch
---

Query parser: reclaim the nested-parsing performance the correctness regime cost, with no behavior change. Two optimizations: (1) the blocked-key set is resolved once at construction (`DANGEROUS_KEYS`, or `POISONED_KEYS` under `allowPrototypes`) so each key check is a single monomorphic `Set.has` with no per-call option branch; (2) a single-bracket-group fast path handles the overwhelmingly common `root[seg]` key shape (`a[b]`, `a[0]`, `filter[status]`) with a reusable scratch buffer, skipping the general path's segment-array allocation and traversal loop. Array-index parsing goes from ~26% slower than the pre-regime baseline to ~21% faster; every other workload is at or below baseline. Verified behavior-identical to the regime implementation across 200,000 differential fuzz cases (random keys × all option combinations) plus the full 267-test suite.
