---
"@zipbul/http-adapter": patch
"@zipbul/cli": patch
"@zipbul/common": patch
"@zipbul/core": patch
"@zipbul/logger": patch
"@zipbul/request-context": patch
"@zipbul/testing": patch
"@zipbul/result": patch
"@zipbul/compression": patch
"@zipbul/cookie": patch
"@zipbul/cors": patch
"@zipbul/helmet": patch
"@zipbul/multipart": patch
"@zipbul/query-parser": patch
"@zipbul/rate-limiter": patch
"@zipbul/mikro-orm": patch
---

Build toolchain unified on tsgo (`@typescript/native-preview`).

Every library now compiles with tsgo, which emits **unbundled per-file** JS +
`.d.ts` in one type-checked pass. This replaces the previous mix of
`bun build --production`, `tsc`, and `tsdown`, and fixes runtime crashes from
Bun's bundler corrupting `export *` / re-export barrels under `sideEffects:false`
(the "needs to refer to a top-level declared variable" error; Bun 1.3.10
tree-shaking regression, oven-sh/bun#27709).

Consumer-visible changes:

- **dist shape:** packages now ship `dist/index.js` re-exporting `dist/src/*.js`
  (per-file) instead of a single bundled file. The `exports`/`module`/`types`
  entry points are unchanged, so imports resolve identically; per-file output
  also tree-shakes more reliably for consumers that bundle.
- **`@zipbul/http-adapter`:** the `.` and `./testing` exports now point at the
  compiled `dist/` output instead of TypeScript source (`index.ts`/`testing.ts`,
  which were excluded by `files: ["dist"]` and broke resolution from a published
  tarball).
- **`sideEffects`:** `@zipbul/cors` and `@zipbul/query-parser` list their
  baker-`@Recipe` options module explicitly (`["**/options.js"]`) so consumers
  can tree-shake the rest without dropping the import-time schema registration;
  other packages keep `false`.
- Removed the dead `ZIPBUL_PACKAGE` self-import (`name`/`version` from
  `package.json`) from every entry point.

No public API changes.
