---
"@zipbul/cli": minor
"@zipbul/common": minor
"@zipbul/core": minor
"@zipbul/http-adapter": minor
"@zipbul/logger": minor
---

Adopted Bun workspace catalogs to centralize external dependency versions; every package now references shared deps via `catalog:`. Notable bumps applied through the catalog:

- `@zipbul/baker` ^2.1.0 → ^2.2.0
- `@zipbul/router` ^0.2.2 → ^0.2.3
- `@zipbul/gildash` 0.24.4 → 0.24.5 (carries `oxc-parser` 0.127.0)
- `oxc-parser` 0.121.0 → 0.127.0
- `@clack/prompts` ^0.11.0 → ^1.2.0 (CLI usages verified compatible — `intro`/`outro`/`cancel`/`log` only, no removed APIs touched)
- `mitata` ^0.1.13 → ^1.0.34 (benchmark migrated to `summary()` wrappers + nameless `group` model)
- `dotenv` removed from `@zipbul/core` (unused — Bun loads `.env` natively)
- `@types/node` ^22 → ^25.6.0
- `@types/bun` → ^1.3.13
- `@types/express` → ^5.0.6
- `picocolors`, `exponential-backoff`, `reflect-metadata`, NestJS 11.x, `elysia` 1.4.x, `express` 5.2.x, `fastify` 5.8.x, `hono` 4.12.x — all bumped to current latest
- `typescript` pinned at 5.9.3 (workspace-wide)

The publish script now resolves both `workspace:` and `catalog:` protocols; npm registry receives concrete ranges.
