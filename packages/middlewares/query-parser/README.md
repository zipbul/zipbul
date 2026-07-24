# @zipbul/query-parser

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/query-parser)](https://www.npmjs.com/package/@zipbul/query-parser)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/query-parser-coverage.json)

A high-performance query string parser — RFC 3986 percent-decoding with WHATWG application/x-www-form-urlencoded value semantics and strict security controls.

> Designed for Bun. Options are validated with [@zipbul/baker](https://www.npmjs.com/package/@zipbul/baker).

<br>

## 📦 Installation

```bash
bun add @zipbul/query-parser
```

The standalone `QueryParser` has no runtime dependencies. To use the **HTTP middleware** form (`queryParser()` + `request.getQuery(dto)`), also install its peer dependencies:

```bash
bun add @zipbul/common @zipbul/http-adapter
```

<br>

## 🚀 Quick Start

```typescript
import { QueryParser } from '@zipbul/query-parser';

const parser = QueryParser.create();

parser.parse('name=hello&city=seoul');
// { name: 'hello', city: 'seoul' }

parser.parse('q=hello%20world&lang=ko');
// { q: 'hello world', lang: 'ko' }

parser.parse('q=hello+world');
// { q: 'hello world' } — '+' decodes to a space (WHATWG application/x-www-form-urlencoded)
```

<br>

## 🧩 HTTP Middleware

The package also ships a zipbul HTTP middleware factory, `queryParser(options?)`. Each call creates an independent middleware instance, so different registration points may use different options. Options are validated at boot — `queryParser()` throws `QueryParserError` immediately on invalid options, before the app starts serving.

Register it on any phase **before** validation (typically `HttpAdapterPhase.BeforeValidate`):

```typescript
import { queryParser } from '@zipbul/query-parser';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';

// In your adapter config:
middlewares: {
  [HttpAdapterPhase.BeforeValidate]: [queryParser({ nesting: true })],
}
```

The middleware declares a typed `request.getQuery(dto)` context accessor via its `augments` slot. The middleware only **supplies** the raw parsed query; the framework wires [@zipbul/baker](https://www.npmjs.com/package/@zipbul/baker) DTO validation from the handler's `getQuery(SomeDto)` call site, and the installed accessor returns the validated instance — exactly like `getBody`/`getParams`:

```typescript
@Get()
search(ctx: HttpContext) {
  const query = ctx.request.getQuery(SearchQueryDto); // typed + validated
}
```

`zb build middleware` extracts the accessor declaration into `dist/context-augments.d.ts` (consumer types) and `dist/context-augments.json` (app AOT manifest).

### Resource limits & malformed queries → 400 (not 500)

The `queryParser()` middleware defaults to **strict mode at the HTTP boundary** (the standalone `QueryParser` stays lenient — `strict: false`). An over-limit or malformed query is a **client** error: the supply step returns an `httpError(BadRequest)`, the framework short-circuits the pipeline into a **400**, and the handler never runs. It is never thrown, so a hostile query can't be turned into a 500 — and an over-limit query is **rejected**, not silently truncated (the industry norm).

What strict rejects depends on `nesting`:

- **Always** — resource-limit overflow: `maxParams` (and `depth`, when nesting is on) → `LimitExceeded`.
- **Only under `nesting: true`** — malformed bracket structure (unbalanced/unclosed/nested) and scalar/structure conflicts. With nesting off, `[` and `]` are **literal** key characters and are never treated as malformed.
- **Never** — a malformed percent-escape is data, not an error (see [`strict`](#strict)).

```typescript
middlewares: {
  [HttpAdapterPhase.BeforeValidate]: [queryParser({ nesting: true })], // strict is the middleware default
}
// GET /search?a[b]c[d]=1        → 400 Bad Request  (malformed brackets — needs nesting)
// GET /search?a=1&…(>maxParams) → 400 Bad Request  (over the limit — rejected, not truncated)
// GET /search?filter[status]=x  → handler runs (flat: key is the literal 'filter[status]')
// GET /search?q=%ZZ             → handler runs; q === '%ZZ' (malformed escape preserved, not an error)
// GET /search?q=hello           → handler runs normally
```

To restore lenient parsing (truncate over-limit, recover malformed), opt out explicitly with `queryParser({ strict: false })`. The standalone `QueryParser.create()` is lenient by default.

<br>

## ⚙️ Options

```typescript
interface QueryParserOptions {
  depth?: number;           // Default: 5
  maxParams?: number;       // Default: 1000
  nesting?: boolean;        // Default: false
  arrayLimit?: number;      // Default: 20
  duplicates?: 'first' | 'last' | 'array';  // Default: 'array'
  strict?: boolean;         // Default: false
}
```

### `depth`

Maximum bracket-nesting depth of a single key (requires `nesting: true`) — the number of bracket groups (`a[b][c]` has depth 2). When a key requests more nesting than `depth` allows, the **whole pair is dropped** — no partial write, no empty-container residue left behind. In `strict` mode, exceeding `depth` throws `QueryParserErrorReason.LimitExceeded` instead of dropping.

```typescript
const parser = QueryParser.create({ nesting: true, depth: 2 });

parser.parse('a[b][c]=1');    // { a: { b: { c: '1' } } }
parser.parse('a[b][c][d]=1'); // depth exceeded — the whole pair is dropped: {}

const strictParser = QueryParser.create({ nesting: true, depth: 2, strict: true });

strictParser.parse('a[b][c][d]=1'); // throws QueryParserError (LimitExceeded)
```

⚠️ Dropping is per-pair, not per-key: a sibling pair on the same key that IS within depth is unaffected — `a[b]=1&a[b][c][d]=2` (depth 2) → `{ a: { b: '1' } }`, not `{}`.

### `maxParams`

Maximum number of key-value pairs to parse. Parameters beyond this limit are silently dropped.

```typescript
const parser = QueryParser.create({ maxParams: 2 });

parser.parse('a=1&b=2&c=3'); // { a: '1', b: '2' }
```

In `strict` mode, exceeding `maxParams` throws `QueryParserErrorReason.LimitExceeded` instead of silently truncating. A query string with *exactly* `maxParams` pairs — even with trailing `&` characters, which are empty sequences, not pairs — never throws:

```typescript
const strictParser = QueryParser.create({ maxParams: 2, strict: true });

strictParser.parse('a=1&b=2');   // { a: '1', b: '2' } — exactly at the limit, no throw
strictParser.parse('a=1&b=2&');  // { a: '1', b: '2' } — trailing '&' is empty, not a pair, no throw
strictParser.parse('a=1&b=2&c'); // throws QueryParserError (LimitExceeded)
```

### `nesting`

Enables bracket-based array and nested object syntax.

```typescript
const parser = QueryParser.create({ nesting: true });

parser.parse('tags[]=a&tags[]=b');
// { tags: ['a', 'b'] }

parser.parse('items[0][name]=x&items[1][name]=y');
// { items: [{ name: 'x' }, { name: 'y' }] }

parser.parse('filter[status]=active&filter[role]=admin');
// { filter: { status: 'active', role: 'admin' } }
```

When `false` (default), brackets are treated as literal characters in the key name.

> **Decode-then-parse:** keys are fully percent-decoded **before** bracket detection, so encoded brackets (`%5B`/`%5D`) act structurally under `nesting: true` — `a%5Bb%5D=c` parses the same as `a[b]=c` (matching `qs`). There is no way to smuggle a literal `[` or `]` into a key name when nesting is enabled.

### `arrayLimit`

Maximum array index allowed when `nesting` is enabled. Must be an integer in `[0, 10000]`; a value above 10000 throws `QueryParserErrorReason.InvalidArrayLimit` at `create()`.

A key builds a real array only while its indices stay dense from `0` (`0`, `1`, `2`, … or `[]` pushes). The moment an index would leave a gap (greater than the current length) or exceed `arrayLimit`, the whole container materializes to a plain object keyed by the index strings — losslessly, with no `undefined` holes and no dropped values:

```typescript
const parser = QueryParser.create({ nesting: true, arrayLimit: 5 });

parser.parse('a[0]=x&a[1]=y');    // { a: ['x', 'y'] } — dense, stays an array
parser.parse('a[3]=ok');          // { a: { '3': 'ok' } } — gap → object (no holes)
parser.parse('a[6]=x');           // { a: { '6': 'x' } } — over limit → object
parser.parse('a[0]=x&a[100]=no'); // { a: { '0': 'x', '100': 'no' } } — over limit, nothing dropped
```

### `duplicates`

Strategy for handling duplicate keys (HTTP Parameter Pollution). Accepts either the bare string literal or the exported `DuplicateStrategy` string enum — both are equivalent.

Governs SAME-KIND duplicates only; a scalar↔container shape conflict is resolved independently (`strict` rejects it under every strategy — see [`strict`](#strict)).

| Value | `DuplicateStrategy` member | Behavior |
|:------|:---------------------------|:---------|
| `'array'` _(default)_ | `DuplicateStrategy.Array` | Keep every value in an array — lossless; defer the first/last/reject choice to the DTO layer |
| `'first'` | `DuplicateStrategy.First` | Keep the first value (drops the rest) |
| `'last'` | `DuplicateStrategy.Last` | Keep the last value (drops the rest) |

```typescript
import { DuplicateStrategy, QueryParser } from '@zipbul/query-parser';

// Input: 'role=admin&role=user'

QueryParser.create({ duplicates: DuplicateStrategy.First }).parse(input);
// { role: 'admin' }

QueryParser.create({ duplicates: DuplicateStrategy.Last }).parse(input);
// { role: 'user' }

QueryParser.create({ duplicates: DuplicateStrategy.Array }).parse(input);
// { role: ['admin', 'user'] }
```

**Scalar↔container collisions** — a key used once as a plain scalar and once as a nested structure (`a=1` then `a[b]=2`, in either order, at any depth; requires `nesting: true`) — are a **shape conflict**, resolved INDEPENDENTLY of `duplicates`. `strict` **rejects** the conflict under every strategy (`ConflictingStructure`); NON-strict resolves it per `duplicates`:

```typescript
// Input: 'a=2&a[b]=1' (nesting: true)  — non-strict

QueryParser.create({ nesting: true, duplicates: DuplicateStrategy.First }).parse(input);
// { a: '2' } — the first-seen value (the scalar) wins; the structure is dropped

QueryParser.create({ nesting: true, duplicates: DuplicateStrategy.Last }).parse(input);
// { a: { b: '1' } } — the last-seen value (the structure) wins; the scalar is dropped

QueryParser.create({ nesting: true, duplicates: DuplicateStrategy.Array }).parse(input);       // the default
// { a: ['2', { b: '1' }] } — both combined losslessly, in arrival order

// strict + ANY strategy (including 'array'):
QueryParser.create({ nesting: true, strict: true, duplicates: DuplicateStrategy.Array }).parse(input);
// throws QueryParserError (ConflictingStructure)
```

The conflict rule being decoupled from `duplicates` is what keeps the default `'array'` from silently disabling the strict/middleware conflict-400.

An empty-bracket push (`a[]=x`) that lands on a key currently holding a **scalar** is itself a scalar↔container conflict: `a=2&a[]=1` → `{ a: ['2', '1'] }` under non-strict `'array'`, `{ a: ['1'] }` under `'last'`, `{ a: '2' }` under `'first'` — and it throws `ConflictingStructure` under `strict` for every strategy. (One inherent exception: a scalar following an EXISTING `[]`-array under `'array'` — `a[]=1&a=2` — is absorbed as another element (`{ a: ['1', '2'] }`) rather than a conflict, since an accumulation array and a nesting array are indistinguishable. When `[]` lands on a key that is **already a plain object**, there is no conflict — the push appends at the next integer key; see the note below.)

> **`[]` on an existing plain object (no collision):** when `[]` push-syntax targets a key that is *already* an object (not created by a collision — e.g. `a[b]=1&a[]=2`, where `a[b]` makes an object and the `[]` push appends onto it), the pushed value lands at the next integer key (`max(existing numeric keys) + 1`, or `"0"` if none) rather than the literal `""` key:
>
> ```typescript
> QueryParser.create({ nesting: true }).parse('a[b]=1&a[]=2');
> // { a: { '0': '2', b: '1' } } — not { a: { '': '2', b: '1' } }
>
> QueryParser.create({ nesting: true }).parse('a[b]=1&a[]=2&a[]=3');
> // { a: { '0': '2', '1': '3', b: '1' } }
> ```

### `strict`

When enabled, `parse()` throws `QueryParserError` on **structural** problems instead of silently ignoring them. Percent-encoding syntax is never one of them — a malformed escape is never an error, even in strict mode (WHATWG §2.6; see [RFC 3986 Compliance](#-rfc-3986-compliance)). Malformed escapes are preserved as literals and invalid UTF-8 becomes U+FFFD, in strict and non-strict alike:

- Unbalanced, nested, or unclosed brackets (`a]b[c]=1`, `a[[b]]=1`, `a[b=1`), and stray characters between bracket groups (`a[b]junk[c]=1`)
- A **scalar↔container** conflict (`a=1&a[b]=2`) — under EVERY `duplicates` strategy (the conflict rule is decoupled from `duplicates`); detecting it requires `nesting: true` (with nesting off, bracket keys are literal and never conflict). An array↔object **key-kind** mismatch alone (`a[]=1&a[foo]=2`, or `a[0]=1&a[foo]=2`) is not a scalar↔container conflict — it always materializes losslessly and never throws.
- `depth` or `maxParams` exceeded — throws `LimitExceeded` instead of silently dropping/truncating; see [`depth`](#depth) and [`maxParams`](#maxparams) above.

```typescript
const parser = QueryParser.create({ strict: true, nesting: true });

parser.parse('valid=ok');           // { valid: 'ok' }
parser.parse('bad=%zz');            // { bad: '%zz' } — malformed escape is data, not an error
parser.parse('a=1&a[b]=2');        // throws QueryParserError (conflicting structure)
```

### Dangerous keys (always blocked)

Every key that names an own-property of `Object.prototype` (`constructor`, `toString`, `hasOwnProperty`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, …), plus `__proto__`, is dropped from the parsed output **unconditionally**, at any position — root, nested segment, or leaf. There is no opt-out (an earlier `allowPrototypes` option was removed: turning it on re-armed both the recursive-merge pollution gadget and the method-shadow crash at an HTTP boundary, for no legitimate benefit). `prototype` is **not** in this set (it is an own-property of function objects, not of `Object.prototype`) and is never blocked. See [Security → Prototype pollution prevention](#prototype-pollution-prevention) for why.

```typescript
QueryParser.create().parse('constructor=1');
// {} — dropped

QueryParser.create({ nesting: true }).parse('a[toString]=1');
// { a: {} } — dropped at the leaf; the "a" shell remains

QueryParser.create().parse('prototype=1');
// { prototype: '1' } — not an Object.prototype own-name, never blocked
```

<br>

## 🚨 Error Handling

`QueryParser.create()` throws on invalid options. `parse()` throws in strict mode.

```typescript
import { QueryParser, QueryParserError, QueryParserErrorReason } from '@zipbul/query-parser';

try {
  const parser = QueryParser.create({ depth: -1 });
} catch (e) {
  if (e instanceof QueryParserError) {
    e.reason;  // QueryParserErrorReason.InvalidDepth
    e.message; // "depth: min"
  }
}
```

### `parseResult()` — the non-throwing variant

`parse()` throws in strict mode; `parseResult()` returns a `Result` instead, so you can branch on a malformed query without a `try`/`catch`. (This is what the HTTP middleware uses to map a bad query to a 400.)

```typescript
import { QueryParser, isErr } from '@zipbul/query-parser';

const parser = QueryParser.create({ strict: true });

parser.parseResult('q=%ZZ');
// Ok — a malformed percent-escape is data, not a structural error: { q: '%ZZ' }

const nested = QueryParser.create({ strict: true, nesting: true });
const result = nested.parseResult('a[b]c[d]=1'); // structural error: stray chars between bracket groups

if (isErr(result)) {
  result.data.reason;   // QueryParserErrorReason.MalformedQueryString
  result.data.message;  // human-readable detail
} else {
  result;               // the parsed query record
}
```

### `QueryParserErrorReason`

| Reason | Thrown by | Description |
|:-------|:---------|:------------|
| `InvalidDepth` | `create()` | `depth` must be a non-negative integer |
| `InvalidMaxParams` | `create()` | `maxParams` must be a positive integer |
| `InvalidArrayLimit` | `create()` | `arrayLimit` must be a non-negative integer |
| `InvalidDuplicates` | `create()` | `duplicates` must be `'first'`, `'last'`, or `'array'` |
| `InvalidNesting` | `create()` | `nesting` must be a boolean |
| `InvalidStrict` | `create()` | `strict` must be a boolean |
| `MalformedQueryString` | `parse()` | Malformed bracket/structure syntax (strict mode only) — never percent-encoding |
| `ConflictingStructure` | `parse()` | Key used as both a scalar and a nested structure (strict mode only) — rejected under every `duplicates` strategy, since the conflict rule is decoupled from `duplicates` |
| `LimitExceeded` | `parse()` | `depth` or `maxParams` exceeded (strict mode only) — `arrayLimit` never throws |

<br>

## 📐 RFC 3986 Compliance

This parser follows [RFC 3986](https://datatracker.ietf.org/doc/html/rfc3986) semantics:

- **`+` always decodes to a space** — matching WHATWG `application/x-www-form-urlencoded` (browsers, `URLSearchParams`, `qs`, and every mainstream query-string parser). This applies unconditionally to both keys and values, before percent-decoding, so `%2B` still round-trips to a literal `+`. Send a literal `+` as `%2B`.
- **Percent decoding is WHATWG-compliant, not just `decodeURIComponent`** — a pure-ASCII fast path decodes valid and malformed `%HH` alike without `decodeURIComponent`'s throw cost; multi-byte input uses native `decodeURIComponent` when it's valid UTF-8, falling back to a byte-level decoder otherwise. Hex digits are case-insensitive (`%3A` ≡ `%3a`). A malformed `%` (not followed by two hex digits) is never an error — it is preserved as a literal character and decoding continues (`%ZZ%41` → `%ZZA`). Invalid UTF-8 byte sequences decode to U+FFFD (replacement character) instead of throwing. A leading BOM is preserved, not stripped. This holds in strict mode too — strict validates structure, not percent syntax. See [STANDARDS.md](./STANDARDS.md) §2.5–§2.7 for the full WHATWG citations.
- **`&` delimiter only** — `;` is not recognized as a separator.

<br>

## 🔒 Security

### Prototype pollution prevention

Every key that names an own-property of `Object.prototype` — `constructor`, `toString`, `hasOwnProperty`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, … — is dropped from the parsed output at every position (root, nested segment, leaf), so `?constructor=1`, `?a[toString]=1`, and the classic `?constructor[prototype][x]=1` chain are all neutralized. Dropping a key at a nested segment/leaf leaves the parent container shell in place rather than discarding the whole result: `?a[toString]=1` → `{ a: {} }`, not `{}`.

`__proto__` is **always** blocked, at every position and regardless of any option — a plain assignment to it invokes the prototype setter, so it can never be an ordinary parameter, and there is no opt-out.

`prototype` is **not** an own-property name of `Object.prototype` (it is an own-property of function objects, not of `Object.prototype`), so it is intentionally never blocked and is returned as an ordinary parameter (`?prototype=1` → `{ prototype: '1' }`) — this matches `qs`'s behavior exactly, it is not an oversight.

This closes two real vectors that existed when only `__proto__` was blocked:

- **Pollution gadget:** `?constructor[prototype][x]=1` used to build an ordinary own object `{ constructor: { prototype: { x: '1' } } }`. Handed to a naive recursive merge elsewhere in an application (`merge({}, parsed)`), that shape reaches and pollutes `Object.prototype`. The parser itself never merges into a shared prototype, but it can't control what a downstream consumer does with the object it returns — so the gadget shape is dropped at the source instead.
- **Method-shadow crash:** `?k[toString]=1` used to build `{ k: { toString: '1' } }` — an own-property string that *shadows* the inherited `Object.prototype.toString`. Any later `String(parsed.k)` throws (`toString` is not a function). `?k[hasOwnProperty]=1` similarly breaks a later `parsed.k.hasOwnProperty(...)` call.

> **BREAKING CHANGE:** previously `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__` were all surfaced as ordinary own-property values (only `__proto__` was blocked). By default they are now dropped again (`prototype` excepted — see above). This blocking is unconditional (the `allowPrototypes` opt-out was removed).

### HPP (HTTP Parameter Pollution) defense

The default `duplicates: DuplicateStrategy.Array` keeps every duplicate value (never silently choosing one); a scalar DTO field then rejects unexpected multiplicity with a loud 400. Set `duplicates: DuplicateStrategy.First` if you want the parser itself to keep only the first value.

### Resource limits

- `depth` caps nested object recursion — over-depth pairs are dropped (or throw `LimitExceeded` in `strict` mode)
- `maxParams` caps the number of parsed pairs — excess pairs are dropped (or throw `LimitExceeded` in `strict` mode)
- `arrayLimit` caps array index allocation — an over-limit index materializes into a plain object instead of allocating a huge sparse array; never throws

<br>

## ⚡ Performance

Benchmarked with [mitata](https://github.com/evanwashere/mitata) on Bun.

### vs competitors (flat key-value)

| Input | @zipbul/query-parser | node:querystring | URLSearchParams | qs |
|:------|---------------------:|-----------------:|----------------:|---:|
| flat 10 params | 423 ns | 368 ns | 2.62 us | 4.65 us |
| flat 50 params | 4.81 us | 4.36 us | 12.58 us | 19.40 us |
| encoded 5 params | **955 ns** | 1.24 us | 1.60 us | 2.24 us |

### vs qs (nested/array)

| Input | @zipbul/query-parser | qs | Speedup |
|:------|---------------------:|---:|--------:|
| nested depth 3 | 162 ns | 1.01 us | **6.3x** |
| array x10 | 1.39 us | 7.16 us | **5.2x** |
| e-commerce payload | 1.12 us | 4.50 us | **4.0x** |

Run benchmarks locally:

```bash
bun run bench
```

<br>

## 📄 License

MIT
