---
"@zipbul/query-parser": minor
---

Query parser: make the nested-key resolution regime coherent and lossless, governed by one principle — **lossless resolutions never throw (strict or not); lossy resolutions are silent in non-strict and throw in strict**. Fixes five long-standing edge-case defects in bracket parsing (#1/#2/#3/#6 and the depth-truncation residue).

- **array↔object key-kind is never a strict error (BREAKING).** Mixing a
  non-numeric key into an array (`a[0]=y&a[foo]=x`) now materializes to a
  lossless object `{a:{"0":"y","foo":"x"}}` in every mode — previously strict
  threw in one order but silently merged in the other. Only a true
  scalar↔container collision under `first`/`last` (`a=1&a[b]=2`) still throws
  `ConflictingStructure` in strict.

- **`[]` push onto an object uses the next integer key, not `""` (BREAKING).**
  `a[b]=1&a[]=2&a[]=3` → `{a:{"0":"2","1":"3","b":"1"}}` (was: second push
  overwrote the `""` key, losing `"3"`). Both orders of a mixed
  push/named-key now converge to the same lossless shape.

- **scalar↔container collisions follow the `duplicates` strategy at every
  nesting level (BREAKING).** `a=2&a[b]=1` (and one level down,
  `x[a]=2&x[a][b]=1`) resolve as: `first` keeps the scalar, `last` keeps the
  structure, `array` wraps both losslessly into `["2",{b:"1"}]`. Previously the
  scalar was silently dropped. Under `array` this is lossless, so it no longer
  throws in strict either — while `a=1&a=2&a=3` (plain scalar duplicates) still
  collects to `["1","2","3"]` and never throws.

- **depth overflow is an atomic whole-pair drop, no empty-node residue
  (BREAKING).** A key nesting deeper than `depth` is dropped entirely rather
  than written partially: `a[b][c]=1` at `depth:1` → `{}` (was `{a:{b:{}}}` —
  value lost AND a garbage empty node emitted). A sibling within depth is
  unaffected: `a[b]=1&a[b][c]=2` at `depth:1` → `{a:{b:"1"}}`.

- **New `QueryParserErrorReason.LimitExceeded`.** In strict mode, exceeding
  `maxParams` or `depth` now throws `LimitExceeded` (observable) instead of
  silently truncating; non-strict keeps truncating silently (matching `qs`'s
  default vs opt-in model). `maxParams` over-limit detection scans only the
  bounded leftover tail for a real extra pair — trailing `&`/`&&&` are empty
  sequences and never trip it (a bug `qs` itself has); `arrayLimit` is NOT part
  of this — an over-limit index materializes losslessly and never throws.

Also corrects the `arrayLimit` section of the READMEs, which still documented
the pre-materialization sparse-array/silent-drop behavior.
