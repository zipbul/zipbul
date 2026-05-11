# @zipbul/logger

## 0.2.1

### Patch Changes

- 01938cb: Agent-line plain format + timer/format-specifier APIs, along with widened argument typing so callers can forward `unknown` values from `catch` blocks without manual narrowing.

  **Output format**

  - `ConsoleTransport`'s `'pretty'` mode (timestamps, `✦` icons, RGB true-color, dim fn separators) replaced with `'plain'`: a single line of `<level>: [<context>[/<fn>]] <msg> [<key>=<val> ...]`. No ANSI escapes, no timestamps, no decorative glyphs. The `'plain'` format is the new non-production default; production keeps `'json'` (NDJSON, one JSON object per line) unchanged.
  - Stream split is now an explicit contract: `trace` / `debug` / `info` write to `process.stdout`; `warn` / `error` / `fatal` write to `process.stderr`. Errors with a `stack` are emitted on a second stderr write so the header line stays single-line for greppers.
  - Metadata trailer renders primitives as bare `key=value`; strings containing whitespace or `=` are JSON-quoted; `Loggable` and object metadata pass through `util.inspect({ depth: 3, colors: false, compact: true })` so the line stays parseable.
  - `LoggerOptions.format` is now `'plain' | 'json'`; the `Color`, `LoggerPrettyOptions`, and `prettyOptions` types are removed.

  **Logger API additions**

  - `log.time(label)` / `log.timeEnd(label)` — per-instance timers that emit `<label>: <ms>ms` at info level. Re-calling `time()` with the same label resets the start (matches `console.time` semantics); calling `timeEnd()` for an unstarted label warns and returns. Timers are per-instance, so a child or sibling Logger does not see them.
  - `log.<level>(msg, ...args)` now interpolates `util.format` specifiers (`%s`, `%d`, `%i`, `%f`, `%o`, `%O`, `%j`) in `msg` against primitive arguments. Mixed calls work as expected: `log.info('handler %s', 'getUser', { route: '/users/:id' })` interpolates `'getUser'` into the message and stores `{ route }` as metadata.
  - `LogArgument` widened to `unknown`. `catch (e)` values now forward through `log.warn('failed: %s', e)` without manual `e instanceof Error ? e.message : String(e)` dance — the runtime classifier sorts Error / Loggable / object into metadata and primitives into format args.

  **Index re-exports**

  - `TestTransport` and `Trace` are now re-exported from the package root so consumers can `import { TestTransport } from '@zipbul/logger'` without reaching into the dist `src/transports/test` path.

## 0.2.0

### Minor Changes

- 55917f7: Adopted Bun workspace catalogs to centralize external dependency versions; every package now references shared deps via `catalog:`. Notable bumps applied through the catalog:

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

- 55917f7: Type-system and DI infrastructure cleanup across the workspace.

  - DI: `ZipbulContainer` gains an optional `hasRequestScope?()` capability; `Container.set()` tracks request-scope registration via flag, removing the `HttpServer.shouldCreateRequestScope()` downcast.
  - Build pipeline: dropped the file-analysis cache (stale-cache build failures).
  - Type SSOT: `HttpError` class replaced with `httpError()` factory (supports RFC 9110 phrase override); adapter hooks reach symmetry via `wrapValidationError` + `wrapUnhandledException` + `wrapInvalidFilterResult`; `ExceptionConstructorLike` parameter contravariance fixed; `AdapterOptions<AdapterClass>` fallback `Record<string, never>` → `unknown`; `HttpStatus` widened-enum sealed via template-literal type; `resolveProxyInfo` now uses the `HeaderField` enum SSOT; deprecated `XRealIp` enum removed (non-standard, NGINX-specific).
  - Test tier reorganization: 3-tier model + perf split — `src/**/*.spec.ts` (unit), `test/integration/`, `test/e2e/`, `test/smoke/`, `test/perf/` (excluded from default runner). Added `httpError` factory spec, `emergencyTeardown` spec, and write-error / method-option / wrap-hooks specs.
  - Tooling: pre-commit hook splits typecheck + `test:unit` from heavier tiers; `typescript@5.9.3` pinned at root for working `bunx tsc`; `dependency-cruiser` removed.

## 0.1.1

### Patch Changes

- 77f9a1b: Initial npm publish setup with CI pipeline and OIDC provenance
