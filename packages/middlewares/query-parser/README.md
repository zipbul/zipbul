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

## 🔌 As a `@zipbul` middleware

Register `queryParser` on `HttpAdapterPhase.BeforeValidate`. It parses the request
query once and installs a typed `getQuery<T>(dto)` accessor on the HTTP request:

```typescript
import { queryParser } from '@zipbul/query-parser';
import { defineModule } from '@zipbul/core';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';

export const appModule = defineModule({
  name: 'App',
  adapters: [
    {
      adapter: HttpAdapter,
      middlewares: {
        [HttpAdapterPhase.BeforeValidate]: [queryParser],
      },
    },
  ],
});
```

Then read the parsed query in a handler or downstream middleware:

```typescript
const query = ctx.request.getQuery(SearchQueryDto); // typed
```

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

### `arrayLimit`

Maximum array index allowed when `nesting` is enabled. An index above this limit does **not** drop the value — the container falls back to a plain object keyed by the index string.

```typescript
const parser = QueryParser.create({ nesting: true, arrayLimit: 5 });

parser.parse('a[3]=ok');   // { a: [undefined, undefined, undefined, 'ok'] }  (sparse array)
parser.parse('a[100]=no'); // over limit → object: { a: { '100': 'no' } }
```

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
- Unbalanced or nested brackets (`a[[b]=1`, `a[b=1`)
- Conflicting key structures (`a=1&a[b]=2`)

```typescript
const parser = QueryParser.create({ strict: true });

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

The following keys are blocked from all parsed output — at any position, including as a plain top-level key (a literal `?constructor=1` yields `{}`, so these names cannot be used as ordinary parameters):

`__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`

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
