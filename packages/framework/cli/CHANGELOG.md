# @zipbul/cli

## 0.1.1

### Patch Changes

- 01938cb: Distribute the CLI as a bundled JS module instead of TypeScript source so npm publishes the `bin` entry correctly. The `--compile` Linux-only binary build was replaced with `bun build … --target bun --format esm --packages external --banner='#!/usr/bin/env bun'`, producing `dist/zb.js` with a Bun shebang. `bin.zb` now points at `./dist/zb.js`, `files` is `["dist"]`, and `@zipbul/common` moved from `devDependencies` into `dependencies` (the bundle imports from it at runtime). The CI/release workflows additionally build the CLI before publishing.
- 01938cb: Comprehensive CLI cleanup pass — agent-line output, unified diagnostic surface, command rename, and audit-driven defect fixes.

  **Surface changes**

  - `--lib` flag promoted to a proper subcommand: `zb build middleware` is now a sibling of `zb build adapter`. The `--lib` flag, `CommandOptions.lib`, and the conditional middleware branch inside `build.command.ts` are gone. The unsupported subcommand path (`zb build something`) now logs a clear error + usage instead of silently falling through to the user-app build.
  - TUI removed entirely. `cli-renderer.ts`, `json-renderer.ts`, `module-tree-renderer.ts`, the `--json` flag, and the `@clack/prompts` + `picocolors` dependencies are deleted. All output flows through `@zipbul/logger`'s plain format (`<level>: [<context>] <msg>`). trace/debug/info land on stdout, warn/error/fatal on stderr.
  - `dist/zb.js` is invoked directly; the `--version` resolution now uses a static `import pkgJson from '../../package.json'` so the bundled binary reports the right version (the previous `import.meta.url`-relative read silently misresolved post-bundle).
  - Removed the dead `src/index.ts` barrel and `package.json#module` field — nothing in the workspace imported `@zipbul/cli` as a library.

  **Diagnostic quality**

  - Bracketed category labels (`[CONTRACT]`, `[SYNTAX]`, `[IO]`, `[MISSING_EXPORT]`, `[DUPLICATE]`, `[TYPE]`, `[Zipbul AOT]`) are gone from every diagnostic. The `diag()` factory in `adapter-build/diag.ts` no longer takes a category argument; messages are detailed natural language and the Logger context (`[adapter]`, `[build]`, `[dev/rebuild]`) supplies the scope tag.
  - User-actionable diagnostics gained `how:` remediation across `lib/middleware build`, adapter resolution, package.json validation, AST parse failures, scope/cycle detection, decorator extraction, and `defineAdapter({ provides })` shape.
  - Silent failures surfaced: missing adapter manifest now warns with package name, `loadAdapterNamespaces` reports unresolved adapters, dev cycle-detection failures emit `dev/rebuild` warnings, `definition-resolver` now propagates user-app file-read errors instead of silently dropping them, and `extractors.readProvidesField` rejects non-identifier elements with a precise diagnostic.

  **Logging contract (paired with `@zipbul/logger` 0.2.x)**

  - All commands instantiate context-scoped loggers (`build`, `build/middleware`, `build/scan`, `dev`, `dev/rebuild`, `dev/app`, `dev/parse`, `adapter`, `compiler/handler-index`, `compiler/middleware-collector`, `compiler/module-validation`, `compiler/entry-gen`, `zb`, `zb/cancel`, `zb/gildash`, `zb/config`). Class-name contexts (`'AdapterDefinitionResolver'`, `'Entry'`, `'ModuleValidation'`, `'MiddlewareAugmentCollector'`) were renamed to the `<scope>/<phase>` shape.
  - Manual `console.time/timeEnd` and ad-hoc `performance.now()` blocks replaced with `log.time(label)` / `log.timeEnd(label)`. Format specifiers (`%s`, `%d`) used everywhere instead of template literals.
  - DevProcessManager pipes subprocess stdout/stderr verbatim (no Logger wrapping) so the running app's own structured output stays intact, and frees the ReadableStream reader lock on stream close.

  **Code quality**

  - `adapter-build.command.ts` (1605 lines, 39 functions) split by responsibility: `diag.ts`, `serialize.ts`, `source-tree.ts`, `parse-helpers.ts`, `package-validation.ts`, `codegen.ts`, `extractors.ts`, plus a slim `adapter-build.command.ts` (260 lines) that only orchestrates. Module dependency graph is a DAG; no circular imports.
  - `pathExists()` consolidated into `common/path-exists.ts` (was duplicated across `source-tree`, `manifest-reader`, `definition-resolver`, `codegen`).
  - `openGildashWithFallback()` extracted into `common/gildash-open.ts`; `build`/`dev` no longer duplicate the semantic-mode try/catch fallback.
  - Defensive cargo removed: `e instanceof Error ? e.message : 'unknown'` patterns (6 sites) and `?? undefined` on already-optional values (5 sites). Logger's `%s` format handles `unknown` natively via `util.format`.
  - Dead code removed: `cacheFilePath` (unused outside its spec), `tsconfig-patcher` (consumer-side concern misplaced into the CLI), `__testing__` re-export wrappers (tests now import `createBuildCommand` / `createDevCommand` directly).
  - Unsafe casts hardened: `package-validation.readPackageJson` shape-guards parsed JSON before cast; `codegen.tsconfigNeedsBuildMode` validates each nested field; `manifest-reader` validates `$schemaName` + `manifests` shape before assuming `AdapterManifest`.
  - `report-diagnostic.ts` collapsed into `reportDiagnostic` + `reportError` (was three near-duplicates) — `reportError` routes any thrown value through Logger's `%s` specifier.

  **Bug fixes**

  - `--version` post-bundle path resolution (was reading `packages/package.json` instead of `packages/cli/package.json`).
  - `zb dev` SIGINT cleanup now emits the `cancelled: SIGINT received` line through Logger so monitor tools can detect shutdown; previously the line was a raw `console.error` that bypassed the Logger pipeline.
  - `runMiddlewareBuild` (formerly `buildLib`) emits a warning + drops augments (instead of silent `null`) when the target adapter ships no `dist/context-namespaces.json`.
  - `prependReferenceToAllDts` is now idempotent across re-runs (regex check guards the prepend); guarded by an explicit regression test.
  - Multi-adapter middleware augments correctly merge into one `dist/context-augments.d.ts` with `declare module` blocks for each target adapter.
  - `method-metadata-extractor` diagnostics for `addErrorFilters` / `addMiddlewares` now include the source file path so users can locate the offending code.

  **Tests + infrastructure**

  - Logger gained 19 new unit tests covering format-specifier interpolation, `time/timeEnd`, primitive vs structured arg routing, and the plain `ConsoleTransport` (shape, stream split, `err.stack` emission, JSON-mode passthrough).
  - Integration suite gained: `cli-options.test.ts` (`--help` / `--version` / no-arg / unknown), middleware-build idempotency + multi-adapter + unresolved-manifest warn regression, dev rebuild trigger-line guard, SIGINT stderr line assertion.
  - `Logger.configure({ level: 'info' })` restored in afterEach for tests that install custom `TestTransport`s, preventing cross-test leakage.
  - Root `package.json` now has `"prepare": "husky && bun run build:logger"` and `typecheck` runs `build:logger` first, so a fresh clone's typecheck no longer fails because `dist/index.d.ts` is missing.

- Updated dependencies [01938cb]
  - @zipbul/logger@0.2.1
  - @zipbul/common@0.3.0

## 0.1.0

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

- 55917f7: Initial public release of the Zipbul CLI (`zb dev`, `zb build`). Notable additions since the workspace introduction:

  - AOT producer-consumer dependency validation. The compiler walks `ctx.use(KEY)` consumers (handler bodies AND middleware) against `ctx.set(KEY, ...)` producers declared via `defineMiddleware({ provides: [KEY] })`. Violations fail the build with a hard error pointing at the offending consumer. Same-phase ordering, phase-rank ordering, and middleware-as-consumer cases are all covered via topological walk.
  - IR `contextOps` round-trip. Producer/consumer ops survive serialization to the boot index and are re-validated on load.
  - SRP/layer separation of the validator (parsing → analysis → emission) and high-level ctx-ops extraction API replacing duplicated helpers.
  - DI interface cleanup integration (consumes `ZipbulContainer.hasRequestScope?()`); file-analysis cache removed to avoid stale-cache build failures.
  - Distribution: package made public (`private` removed), bin `zb` ships as TypeScript with a `#!/usr/bin/env bun` shebang — Zipbul is Bun-only by design, so users invoke `zb` after `bun add @zipbul/cli`.

### Patch Changes

- Updated dependencies [55917f7]
- Updated dependencies [55917f7]
  - @zipbul/logger@0.2.0
