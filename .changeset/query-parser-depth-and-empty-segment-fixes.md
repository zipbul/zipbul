---
"@zipbul/query-parser": patch
---

Query parser: fix depth-overflow data loss, empty-segment budget erosion, and `[]`-on-object empty-key emission.

- **Depth overflow no longer drops the value or leaves a phantom object.** With
  `nesting`, a key deeper than `depth` (e.g. `a[b][c][d][e][f][g]=1` at the
  default depth 5) previously returned `{a:{b:{c:{d:{e:{f:{}}}}}}}` — the value
  `"1"` was silently lost and `f` was left as an empty object (type confusion).
  The value is now preserved as a leaf at the deepest permitted level:
  `{a:{b:{c:{d:{e:{f:"1"}}}}}}`. Depth remains a resource limit (it truncates
  deeper structure silently in both strict and non-strict mode), it just no
  longer corrupts data. OBSERVABLE CHANGE: depth-exceeded inputs now yield a
  scalar leaf where they previously yielded an empty object.

- **Empty `&` separators no longer consume the `maxParams` budget.** A segment
  that emits no key-value pair (`&&`, `=&`) used to increment the parameter
  count, so leading/interleaved `&` padding could silently drop real trailing
  parameters (`&a=1&b=2` with `maxParams:2` returned `{a:'1'}`). Only real pairs
  now count, so that input returns `{a:'1',b:'2'}`.

- **`[]` array-append onto an object no longer emits an empty-string key.**
  `filter[status]=a&filter[]=b` used to produce `{filter:{status:'a','':'b'}}`.
  In lenient mode the value is now stored under the next free numeric index
  (`{filter:{status:'a','0':'b'}}`); in `strict` mode this array/object mix is a
  `ConflictingStructure` error.

- **Docs.** Rescoped the "RFC 3986 compliant" headline to WHATWG
  `x-www-form-urlencoded` alignment and replaced the performance section with an
  honest, capability-matched benchmark: @zipbul is many times faster than `qs`
  and fastest on encoded/`+`-heavy input, but `fast-querystring` (flat) and
  `picoquery` (nested/array) are faster — stated plainly rather than claiming
  category-leading speed. Also documented sparse-array `null` serialization and
  percent-encoded-bracket decoding.
- **Internal.** Extracted `QueryParserError` into `errors.ts`. Split the
  benchmark into `bench/self.bench.ts` (regression, `src`) and
  `bench/competitive.bench.ts` (vs rivals, built `dist`) with a shared
  `bench/fixtures.ts`; the competitive bench uses capability cohorts, hoisted
  rival options, an output-parity preview, and pinned comparison deps
  (`qs`, `fast-querystring`, `picoquery`). Not shipped (bench/ is
  `.npmignore`d).
