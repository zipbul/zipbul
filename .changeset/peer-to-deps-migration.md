---
"@zipbul/common": minor
"@zipbul/core": minor
"@zipbul/http-adapter": minor
---

Moved sibling and `@zipbul/result` dependencies out of `peerDependencies` into `dependencies`. Consumers no longer need to install `@zipbul/common`, `@zipbul/core`, `@zipbul/logger`, or `@zipbul/result` explicitly when adding `@zipbul/http-adapter` — `bun add @zipbul/http-adapter` is sufficient. `@zipbul/baker` remains a `peerDependency` (external integration), and `typescript` stays a `peerDependency` of `@zipbul/logger` (compiler version owned by the host project).
