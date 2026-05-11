---
"@zipbul/http-adapter": patch
---

Build pipeline migrated to the framework's own adapter compiler so the package's published `dist/` matches the manifest contract every other adapter uses.

- `package.json#scripts.build` is now `bun ../../packages/cli/src/bin/zb.ts build adapter` (was a hand-written `bun build … && tsc -p tsconfig.build.json` pair). The CLI's adapter compiler emits the full manifest tree (`adapter.manifest.json`, `pipeline-schema.json`, `decorator-schema.json`, `peer-contract.json`, `context-namespaces.json`, `adapter-constructor-schema.json`) plus the JS bundle and `.d.ts`, then atomically promotes them into `dist/`.
- `package.json#zipbul.kind` set to `"adapter"` so `zb build adapter` accepts the package and so user-app builds resolve it via the manifest-only contract.

No source-level API changes — published runtime exports are unchanged.
