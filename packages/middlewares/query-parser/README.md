# @zipbul/query-parser

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/query-parser)](https://www.npmjs.com/package/@zipbul/query-parser)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/query-parser-coverage.json)

A high-performance, RFC 3986 compliant query string parser with strict security controls.

> Designed for Bun. Options are validated with [@zipbul/baker](https://www.npmjs.com/package/@zipbul/baker).

<br>

## 📦 Installation

```bash
bun add @zipbul/query-parser
```

`@zipbul/query-parser` is a zipbul-framework middleware; in a zipbul app its dependencies are already present. The **HTTP middleware** form (`queryParser()` + `request.getQuery(dto)`) requires these framework peer dependencies:

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

### Malformed queries → 400 (not 500)

In the middleware, a malformed query string is a **client** error. When `strict` is enabled, the supply step returns an `httpError(BadRequest)` — the framework short-circuits the pipeline into a **400** response and never runs the handler. It is never thrown, so a hostile `?q=%ZZ` can't be turned into a 500:

```typescript
middlewares: {
  [HttpAdapterPhase.BeforeValidate]: [queryParser({ strict: true, nesting: true })],
}
// GET /search?q=%ZZ        → 400 Bad Request  (malformed percent-escape)
// GET /search?a[b]c[d]=1   → 400 Bad Request  (malformed brackets, needs nesting)
// GET /search?q=hello      → handler runs normally
```

Under the default (`strict: false`) a malformed query is parsed leniently and never fails the request.

<br>

## ⚙️ Options

```typescript
interface QueryParserOptions {
  depth?: number;           // Default: 5
  maxParams?: number;       // Default: 1000
  nesting?: boolean;        // Default: false
  arrayLimit?: number;      // Default: 20
  duplicates?: 'first' | 'last' | 'array';  // Default: 'first'
  strict?: boolean;         // Default: false
  urlEncoded?: boolean;     // Default: false
}
```

### `depth`

Maximum depth of nested object parsing (requires `nesting: true`). When the limit is exceeded the over-depth value is dropped and an empty container is left in its place. Strict mode does **not** throw on depth overflow.

```typescript
const parser = QueryParser.create({ nesting: true, depth: 2 });

parser.parse('a[b][c]=1');    // { a: { b: { c: '1' } } }
parser.parse('a[b][c][d]=1'); // depth exceeded — '1' dropped: { a: { b: { c: {} } } }
```

### `maxParams`

Maximum number of key-value pairs to parse. Parameters beyond this limit are silently dropped.

```typescript
const parser = QueryParser.create({ maxParams: 2 });

parser.parse('a=1&b=2&c=3'); // { a: '1', b: '2' }
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

Maximum array index allowed when `nesting` is enabled. At **container creation** an index above this limit does not drop the value — the container falls back to a plain object keyed by the index string.

```typescript
const parser = QueryParser.create({ nesting: true, arrayLimit: 5 });

parser.parse('a[3]=ok');   // { a: [undefined, undefined, undefined, 'ok'] }  (sparse array)
parser.parse('a[100]=no'); // over limit → object: { a: { '100': 'no' } }
```

⚠️ The object fallback only applies when the container is first created. If the key already holds an **array**, a later over-limit index is silently dropped:

```typescript
parser.parse('a[0]=x&a[100]=no'); // { a: ['x'] } — '100' dropped
```

⚠️ `arrayLimit` is also a resource bound: an in-limit index allocates a sparse array up to that index, so raising it far above the default lets a tiny input allocate a huge array (`arrayLimit: 1_000_000` + `a[999999]=x`). Keep it small for untrusted input. (Indices are accepted up to 10 digits; a value above the max real JS array index, 2³²−2, is retained as a string-keyed property rather than a true array element.)

### `duplicates`

Strategy for handling duplicate keys (HTTP Parameter Pollution).

| Value | Behavior |
|:------|:---------|
| `'first'` _(default)_ | Keep the first value — safest against HPP attacks |
| `'last'` | Keep the last value |
| `'array'` | Collect all values into an array |

```typescript
// Input: 'role=admin&role=user'

QueryParser.create({ duplicates: 'first' }).parse(input);
// { role: 'admin' }

QueryParser.create({ duplicates: 'last' }).parse(input);
// { role: 'user' }

QueryParser.create({ duplicates: 'array' }).parse(input);
// { role: ['admin', 'user'] }
```

### `strict`

When enabled, `parse()` throws `QueryParserError` instead of silently ignoring errors:

- Malformed percent encoding (`%zz`, truncated `%E0%A4`)
- Unbalanced, nested, or unclosed brackets (`a]b[c]=1`, `a[[b]]=1`, `a[b=1`), and stray characters between bracket groups (`a[b]junk[c]=1`)
- Conflicting key structures (`a=1&a[b]=2`) — detecting structure conflicts requires `nesting: true`; with nesting off, bracket keys are literal and never conflict

```typescript
const parser = QueryParser.create({ strict: true, nesting: true });

parser.parse('valid=ok');           // { valid: 'ok' }
parser.parse('bad=%zz');            // throws QueryParserError
parser.parse('a=1&a[b]=2');        // throws QueryParserError (conflicting structure)
```

### `urlEncoded`

Decode `+` as a space, matching `application/x-www-form-urlencoded` — how browsers and `URLSearchParams` treat query strings. Off by default; see [RFC 3986 Compliance](#-rfc-3986-compliance).

```typescript
QueryParser.create({ urlEncoded: true }).parse('q=hello+world');
// { q: 'hello world' }

QueryParser.create().parse('q=hello+world'); // default — '+' is literal
// { q: 'hello+world' }
```

The `+`→space and percent-decoding are independent passes, so a malformed escape never discards the space: `parse('q=a+b%ZZ')` → `{ q: 'a b%ZZ' }`.

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
const result = parser.parseResult('q=%ZZ');

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
| `InvalidUrlEncoded` | `create()` | `urlEncoded` must be a boolean |
| `MalformedQueryString` | `parse()` | Malformed syntax (strict mode only) |
| `ConflictingStructure` | `parse()` | Key used as both scalar and nested (strict mode only) |

<br>

## 📐 RFC 3986 Compliance

This parser follows [RFC 3986](https://datatracker.ietf.org/doc/html/rfc3986) semantics:

- **`+` is literal by default** — not decoded to a space. ⚠️ This differs from browsers, `URLSearchParams`, and `qs`, which decode `+`→space. For form-urlencoded query strings set [`urlEncoded: true`](#urlencoded). Use `%20` for an unambiguous space.
- **Percent decoding** — `%HH` sequences are decoded via `decodeURIComponent`. Malformed sequences fall back to the raw string in non-strict mode.
- **`&` delimiter only** — `;` is not recognized as a separator.

<br>

## 🔒 Security

### Prototype pollution prevention

`__proto__` is the only blocked key — at every position (root, nested segment, leaf), so `?__proto__[x]=1` and `?a[__proto__][x]=1` are neutralized. A plain assignment to `__proto__` invokes the prototype setter, so it can never be an ordinary parameter.

Every other key — including `constructor`, `prototype`, `__defineGetter__`, etc. — is a **safe own-property value**: the parser only ever writes own properties (create-own-or-skip via `hasOwnProperty`), so it never reaches the prototype chain, and the classic `?constructor[prototype][x]=y` payload builds an ordinary own object without polluting `Object.prototype`. These names are therefore returned as normal parameters (`?constructor=1` → `{ constructor: '1' }`) rather than silently discarded.

> **Behavior change (since this release):** `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__` used to be dropped at all positions. They are now surfaced as ordinary own-property values (only `__proto__` remains blocked). If your app relied on these being absent from the parsed object, note that `parsed.constructor` is now whatever the client sent as a string rather than `Object`.

### HPP (HTTP Parameter Pollution) defense

Default `duplicates: 'first'` prevents attackers from injecting values by appending duplicate keys.

### Resource limits

- `depth` caps nested object recursion
- `maxParams` caps the number of parsed pairs
- `arrayLimit` caps array index allocation

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
