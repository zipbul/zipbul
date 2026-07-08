# @zipbul/compression

[![npm](https://img.shields.io/npm/v/@zipbul/compression)](https://www.npmjs.com/package/@zipbul/compression)

A Bun-native HTTP **response-compression** middleware — `gzip` / `brotli` / `deflate` / `zstd` with strict RFC 9110 conformance.

It negotiates `Accept-Encoding`, compresses the response body, and keeps the wire correct for you:
invalidates/regenerates `Content-Length`, weakens shared `ETag`s, sets `Vary`, honours `Cache-Control: no-transform`, and skips the responses that must not be compressed (1xx/204/205/304/HEAD/206).

> Designed for Bun. Options are validated with [@zipbul/baker](https://www.npmjs.com/package/@zipbul/baker).
> Codec conformance (gzip/deflate zlib-wrapped, zstd 8 MB window, etc.) is specified in [`STANDARDS.md`](./STANDARDS.md).

<br>

## 📦 Installation

```bash
bun add @zipbul/compression
```

The middleware needs the adapter peers:

```bash
bun add @zipbul/common @zipbul/http-adapter
```

<br>

## 🚀 Quick Start

`compressionMiddleware(options?)` validates its config eagerly and returns a `Result` — an `Err`
on invalid options, otherwise a middleware you register in the **`BeforeResponse`** phase (it runs
after the handler has produced the body).

Build it in its own module and narrow the `Result` there, then export the concrete middleware.
The AOT compiler serialises a module's middleware list by reference, so each entry must be an
**imported symbol** — and control-flow narrowing (`isErr`) does not cross a module boundary unless
you export the narrowed value as a fresh `const`:

```typescript
// compression.ts
import { compressionMiddleware, CompressionCodec } from '@zipbul/compression';
import { isErr } from '@zipbul/result';

const result = compressionMiddleware({
  encodings: [CompressionCodec.Br, CompressionCodec.Gzip], // server preference order
  threshold: 1024,                                         // bytes; smaller bodies are left alone
});

if (isErr(result)) {
  throw new Error(result.data.message); // invalid config — fail fast at boot
}

export const compression = result; // narrowed to MiddlewareDefinition
```

```typescript
// module.ts — declarative registration, keyed by adapter and pipeline phase.
import { defineModule } from '@zipbul/core';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';

import { compression } from './compression';

export const appModule = defineModule({
  name: 'App',
  adapters: [
    {
      adapter: HttpAdapter,
      middlewares: {
        [HttpAdapterPhase.BeforeResponse]: [compression],
      },
    },
  ],
});
```

A client sending `Accept-Encoding: br, gzip` now receives a `Content-Encoding: br` body (server
preference wins on equal quality), with `Vary: Accept-Encoding` set and `Content-Length` rewritten
to the compressed size.

<br>

## ⚙️ Options

```typescript
interface CompressionOptions {
  encodings?: CompressionCodec[];                       // Default: [Br, Gzip]
  threshold?: number;                                   // Default: 1024 (bytes)
  filter?: (contentType: string) => boolean;            // Default: compressible text/* + json/xml/svg
  level?: Partial<Record<CompressionCodec, number>>;    // Default: { br: 4, gzip: 6, deflate: 6, zstd: 3 }
  breach?: { maxPadding: number };                      // Off by default
}
```

### `encodings`

Server-supported content codings, in **preference order** (earlier = preferred on equal client
qvalue). Negotiated against the request `Accept-Encoding` per RFC 9110 §12.5.3 — the acceptable
coding with the highest non-zero qvalue wins, ties broken by this order.

```typescript
compressionMiddleware({ encodings: [CompressionCodec.Zstd, CompressionCodec.Br, CompressionCodec.Gzip] });
```

`CompressionCodec` is a string enum — import it; a bare `'gzip'` literal is not assignable.

| `CompressionCodec` | Wire value | Format | Level range |
|:---|:---|:---|:---|
| `.Gzip` | `gzip` | RFC 1952 | 1–9 |
| `.Br` | `br` | RFC 7932 (Brotli) | 0–11 |
| `.Deflate` | `deflate` | RFC 1950 zlib-wrapped | 1–9 |
| `.Zstd` | `zstd` | RFC 8878, ≤ 8 MB window (RFC 9659) | 1–19 |

### `threshold`

Minimum uncompressed body size in bytes. Bodies below it are sent untouched (compressing tiny
payloads costs more than it saves). Streaming responses have unknown length and are always
considered.

### `filter`

`(contentType: string) => boolean` — return `true` to allow compression for that `Content-Type`.
The default allows compressible types (`text/*` except `text/event-stream`, `application/json`,
`+json`/`+xml` suffixes, `image/svg+xml`, …). A throwing filter is treated as "skip". Content
types are the open-ended IANA media-type space, so this is a plain `string`, not an enum.

### `level`

Per-codec compression level. Each codec has its own valid integer range (see the table above);
an out-of-range level is rejected at construction with a detailed `InvalidLevel` message
(e.g. `"zstd level must be an integer between 1 and 19, got 20"`). `zstd` is capped at 19 so the
frame window never exceeds the RFC 9659 8 MB HTTP limit (larger windows are rejected by browsers).

```typescript
compressionMiddleware({ level: { [CompressionCodec.Br]: 6, [CompressionCodec.Gzip]: 9 } });
```

### `breach`

Opt-in **Heal-the-BREACH** length randomisation: injects random-length padding into the compressed
output (gzip FEXTRA subfield / zstd skippable frame — transparent to any RFC-compliant decoder) so
the response size varies between requests. `maxPadding` is an integer `1–4096` (bytes of maximum
padding). Enabling `breach` restricts encodings to the padding-safe set (`gzip`, `zstd`) and
requires at least one to be present; streams are left uncompressed while it is on.

```typescript
compressionMiddleware({ breach: { maxPadding: 64 } });
```

> **Security note.** Length padding is **defense-in-depth only** — it slows a BREACH oracle, it does
> not close it. The primary mitigations remain: don't compress responses that mix secrets with
> attacker-reflected input, separate secrets from reflected data, and use CSRF-token masking +
> `SameSite` cookies. Treat `breach` as a supplementary layer, never the main defense.

<br>

## 📐 Standards

This middleware is an origin-server response content-coding applier. Its rules are specified,
rule-by-rule with primary citations, in [`STANDARDS.md`](./STANDARDS.md). Highlights:

- **Negotiation** — RFC 9110 §12.5.3 `Accept-Encoding` q-values, `identity;q=0` / `*;q=0` handling,
  `x-gzip`/`x-compress` aliases, case-insensitive names.
- **Byte formats** — gzip (RFC 1952), deflate = zlib-wrapped (RFC 1950, **not** raw), brotli
  (RFC 7932), zstd (RFC 8878) with the **8 MB window cap** (RFC 9659).
- **Correctness** — `Content-Length` invalidated/regenerated after coding (RFC 9110 §8.6); `Vary:
  Accept-Encoding` on negotiated responses (§12.5.5), including the identity branch; strong `ETag`
  weakened to `W/` after transformation (§8.8.1/§8.8.3); `no-transform` honoured (RFC 9111 §5.2.2.6).
- **Exclusions** — 1xx/204/205/304/HEAD (no body) and 206/`Content-Range` (byte ranges computed on
  the encoded sequence, §14.1.2) are never compressed.

Out of scope (see [`FUTURE.md`](./FUTURE.md)): Compression Dictionary Transport (`dcb`/`dcz`,
RFC 9842) — its dictionary compression is not yet exposed by the Bun runtime.

<br>

## 📤 Error model — `Result`, not exceptions

`compressionMiddleware(options?)` returns a `Result<MiddlewareDefinition, CompressionErrorData>`
(from `@zipbul/result`). Invalid configuration is a value you narrow with `isErr` — the middleware
never throws for bad options; it surfaces the first offending field.

```typescript
import { isErr } from '@zipbul/result';

const compression = compressionMiddleware({ level: { gzip: 99 } });
if (isErr(compression)) {
  compression.data.reason;  // CompressionErrorReason.InvalidLevel
  compression.data.message; // "gzip level must be an integer between 1 and 9, got 99"
}
```

### `CompressionErrorReason`

| Reason | Meaning |
|:---|:---|
| `EmptyEncodings` | `encodings` is an empty array |
| `InvalidEncodings` | `encodings` contains an unknown codec |
| `InvalidThreshold` | `threshold` is not a finite, non-negative number |
| `InvalidLevel` | a per-codec `level` is out of its valid integer range |
| `InvalidFilter` | `filter` is not a function |
| `InvalidBreach` | `breach.maxPadding` out of `1–4096`, or no BREACH-safe encoding present |

`CompressionError` (an `Error` subclass carrying `.reason`) is exported for constructing/throwing at
call sites that prefer exceptions.

<br>

## 🔌 Public API

| Export | Description |
|:---|:---|
| `compressionMiddleware` | `(options?) => Result<MiddlewareDefinition, CompressionErrorData>` — register at `BeforeResponse`. |
| `CompressionCodec` | Codec enum for `encodings`/`level`: `.Gzip` / `.Br` / `.Deflate` / `.Zstd`. |
| `CompressionErrorReason` | snake_case reason enum for validation failures. |
| `CompressionError` | `Error` subclass carrying `.reason` (for throw-based call sites). |
| `parseAcceptEncoding` / `negotiateEncoding` | Standalone `Accept-Encoding` negotiation helpers. |
| `ContentEncoding` | Wire-value enum re-exported from `@zipbul/http-adapter`. |
| Types | `CompressionOptions`, `CompressionErrorData`, `BreachOptions`, `EncodingPreference`. |

> Narrow the returned `Result` with `isErr` from `@zipbul/result` (not re-exported here).

<br>

## 📄 License

MIT
