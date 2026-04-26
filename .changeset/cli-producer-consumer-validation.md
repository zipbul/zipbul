---
"@zipbul/cli": minor
---

Initial public release of the Zipbul CLI (`zb dev`, `zb build`). Notable additions since the workspace introduction:

- AOT producer-consumer dependency validation. The compiler walks `ctx.use(KEY)` consumers (handler bodies AND middleware) against `ctx.set(KEY, ...)` producers declared via `defineMiddleware({ provides: [KEY] })`. Violations fail the build with a hard error pointing at the offending consumer. Same-phase ordering, phase-rank ordering, and middleware-as-consumer cases are all covered via topological walk.
- IR `contextOps` round-trip. Producer/consumer ops survive serialization to the boot index and are re-validated on load.
- SRP/layer separation of the validator (parsing → analysis → emission) and high-level ctx-ops extraction API replacing duplicated helpers.
- DI interface cleanup integration (consumes `ZipbulContainer.hasRequestScope?()`); file-analysis cache removed to avoid stale-cache build failures.
- Distribution: package made public (`private` removed), bin `zb` ships as TypeScript with a `#!/usr/bin/env bun` shebang — Zipbul is Bun-only by design, so users invoke `zb` after `bun add @zipbul/cli`.
