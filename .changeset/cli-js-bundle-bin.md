---
"@zipbul/cli": patch
---

Distribute the CLI as a bundled JS module instead of TypeScript source so npm publishes the `bin` entry correctly. The `--compile` Linux-only binary build was replaced with `bun build … --target bun --format esm --packages external --banner='#!/usr/bin/env bun'`, producing `dist/zb.js` with a Bun shebang. `bin.zb` now points at `./dist/zb.js`, `files` is `["dist"]`, and `@zipbul/common` moved from `devDependencies` into `dependencies` (the bundle imports from it at runtime). The CI/release workflows additionally build the CLI before publishing.
