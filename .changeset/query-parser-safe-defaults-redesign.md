---
"@zipbul/query-parser": minor
---

Query parser: safe-by-default HTTP boundary, decoupled conflict rule, keep-all duplicates, and correctness/perf fixes.

- **`queryParser()` middleware now rejects, never silently truncates.** The
  middleware defaults to `strict: true` at the HTTP boundary (the standalone
  `QueryParser` primitive stays lenient, `strict: false`) — an over-limit
  (`maxParams`/`depth`) or malformed nested query is now a 400, not a silent
  200 with truncated/dropped data. Callers restore the old lenient behavior
  with `queryParser({ strict: false })`.

  BREAKING BEHAVIOR CHANGE: an over-`maxParams` or over-`depth` request that
  previously returned 200 with truncated data now returns 400 by default.

- **Bracket structure is validated only where it exists.** With `nesting: false`
  (the default), `[`/`]` are literal key characters and are never validated as
  structure — fixes a false 400 where `strict` previously rejected a literal
  bracket-bearing key (e.g. `a[b`, or the percent-encoded `x%5By`) even though
  nesting was off. Structural validation (unbalanced/unclosed/nested brackets,
  scalar/container conflicts) now applies only under `nesting: true`.

- **`allowPrototypes` option removed.** The dangerous-key blocklist (every
  `Object.prototype` own-name plus `__proto__`) is now unconditional, with no
  opt-out. The toggle only ever re-armed a real prototype-pollution gadget and
  a method-shadow crash for no legitimate benefit.

  BREAKING: passing `allowPrototypes` is a type error; the option no longer
  exists. The blocked-key set and its always-blocked defaults are unchanged.

- **Machine-readable `reason` surfaced in the 400 body.** The middleware's
  `httpError` call now includes `errors: [{ reason }]` alongside the existing
  human message, so a caller can distinguish `LimitExceeded` from
  `MalformedQueryString`/`ConflictingStructure` without parsing prose.

- **Scalar↔container conflict decoupled from `duplicates`.** A key used once
  as a scalar and once as a nested structure/array (`a=1&a[b]=2`, at any
  position — root, nested record, explicit array index — and any bracket
  shape) is a **shape conflict**, resolved independently of the duplicate-key
  strategy: `strict` now rejects it under **every** strategy, including
  `'array'` (previously `duplicates: 'array'` silently combined the conflict
  instead of raising `ConflictingStructure`, which would have let the new
  keep-all default below silently disable the middleware's 400). Non-strict
  resolution still follows `duplicates` (`first` keeps the scalar, `last`
  overwrites, `array` wraps losslessly) and stays lossless at every position.

- **`duplicates` now defaults to `'array'` (keep-all).** The previous default,
  `'first'`, destroyed every duplicate value before the DTO/validation layer
  — the layer this design assigns per-field cardinality to — could act on it.
  `'array'` keeps all values; a scalar DTO field then rejects unexpected
  multiplicity loudly (a 400) instead of the parser silently choosing one, and
  a genuinely multi-valued field keeps its data. (A DTO field expecting a
  lone value can normalize the single/multi form-encoding ambiguity with a
  one-line `transform`, e.g. `{ deserialize: ({value}) => Array.isArray(value) ? value : [value] }`.)

  BREAKING BEHAVIOR CHANGE: `?a=1&a=2` now parses to `{ a: ['1', '2'] }` by
  default (was `{ a: '1' }`). Pass `duplicates: DuplicateStrategy.First` or
  `.Last` explicitly to keep the old collapsing behavior.

- **`duplicates` is now typed as the `DuplicateStrategy` enum only.** The
  option type was `DuplicateStrategy | 'first' | 'last' | 'array'` — a union
  of the enum and the very string literals it already is. Standardized on the
  enum, matching how `strict`/`nesting` are already typed as first-class options.

  BREAKING: a bare string literal (`{ duplicates: 'array' }`) no longer
  typechecks; use `{ duplicates: DuplicateStrategy.Array }`. Runtime
  validation is unchanged (the enum's values are still the accepted strings).

- **`arrayLimit` now enforced on `[]` pushes, not just explicit indices.** An
  empty-bracket push (`a[]=x`) previously ignored `arrayLimit` entirely (only
  `a[<index>]=x` respected it), so `a[]` could grow a dense array past the
  configured bound. `arrayLimit` is inclusive (`index <= arrayLimit`, matching
  the existing explicit-index contract, not qs's exclusive boundary); an
  over-limit push now materializes the array to an index-keyed object,
  losslessly, exactly like an over-limit explicit index does.

- **Perf: removed an O(n²) push and a redundant per-pair decode scan.**
  `nextRecordIntegerKey` (resolving `a[]=x` onto a record) rescanned every
  existing key on each push; a per-record cache now makes N sequential pushes
  linear (measured: 1000 pushes 32.5ms → 0.17ms). `processPair` also re-scanned
  each key/value slice with `includes('%')`/`includes('+')` that the main scan
  loop had already visited; the scan now tracks `%`/`+` presence inline
  (measured: ~27% faster on plain flat input, output byte-identical).

- **Docs.** README and README.ko synced to the above (defaults, the decoupled
  conflict rule, the removed `allowPrototypes` section, enum-only examples).
