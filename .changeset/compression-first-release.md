---
"@zipbul/compression": major
---

First release of `@zipbul/compression`. A Bun-native HTTP response-compression middleware for `gzip` / `brotli` / `deflate` / `zstd` with strict RFC 9110 conformance.

- **Negotiation** — RFC 9110 §12.5.3 `Accept-Encoding` q-values, `identity;q=0` / `*;q=0` handling, `x-gzip`/`x-compress` aliases, case-insensitive names, server-preference tie-breaking.
- **Wire correctness** — `Content-Length` invalidated/regenerated after coding, strong `ETag` weakened to `W/`, `Vary: Accept-Encoding` (including the identity branch), `Cache-Control: no-transform` honoured, and the never-compress exclusions (1xx/204/205/304/HEAD, 206/`Content-Range`).
- **Byte formats** — gzip (RFC 1952), deflate = zlib-wrapped (RFC 1950, not raw), brotli (RFC 7932), zstd (RFC 8878) with the 8 MB window cap (RFC 9659). Specified rule-by-rule in `STANDARDS.md`.
- **Options** validated eagerly with `@zipbul/baker`, returning a `Result` (never throws for bad config); per-codec `level`, `threshold`, `filter`, `encodings`.
- **Heal-the-BREACH** opt-in length padding (gzip FEXTRA / zstd skippable frame) as documented defense-in-depth.

Deferred (see `FUTURE.md`): Compression Dictionary Transport (`dcb`/`dcz`, RFC 9842/9841) — blocked on Bun runtime dictionary support.
