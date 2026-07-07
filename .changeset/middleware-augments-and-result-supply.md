---
"@zipbul/common": minor
"@zipbul/core": minor
"@zipbul/http-adapter": minor
---

Declarative middleware augments: typed context accessors with value-or-error supply.

- **`@zipbul/common`** — `defineMiddleware({ augments })` lets a middleware
  declare typed context accessors (e.g. `request.getQuery(dto)`) from a bare
  `(ctx) => raw` supply function. The framework wires baker DTO validation from
  the handler's `accessor(SomeDto)` call site (exactly like `getBody`/
  `getParams`); the author never touches the baker. A supply may return a
  `Result<Raw>` — returning an `Err` short-circuits the pipeline into that error
  response (e.g. a malformed input → 4xx), so a bad request can never surface as
  a thrown 500. Supplies must be plain synchronous functions (async/generator/
  class are rejected at definition time).

- **`@zipbul/core`** — owns the augment MECHANICS: prototype-accessor install
  (`installAugmentAccessorOnPrototype`), the per-request supply step (Err-aware,
  short-circuits without writing the raw slot), the baker validation step, and
  ALS-scoped reads. Global collision validation runs at install.

- **`@zipbul/http-adapter`** — declares the HTTP namespace prototypes
  (`request`/`response`) that augments install onto; the generic install
  mechanism now lives in core, so the adapter only DECLARES. The
  `withAugments` test helper mirrors the runtime: an erroring supply leaves the
  raw slot unset.
