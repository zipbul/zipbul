# @zipbul/result

## 2.0.0

### Major Changes

- Fix `isErr()` narrowing when the success type has a `data` property (zipbul/toolkit#53), and make every type match runtime behavior.

  **Breaking changes**

  - **`Err` is branded.** `Err<E>` is now `{ readonly data: E }` plus an internal brand that only `err()` sets. A plain `{ data }` object is no longer assignable to `Err`, so a success value with a `data` property narrows to the success branch.
  - **Marker is an internal `Symbol.for('@zipbul/result')`.** `isErr()` detects an `Err` from any 2.x copy or realm at runtime. An `Err` that went through `JSON.stringify` or `structuredClone` is no longer detected, so untrusted JSON can't forge an `Err`. `Err` values from 1.x or earlier are not detected, and the types of two different installed versions don't mix.
  - **`setMarkerKey`, `getMarkerKey` and `DEFAULT_MARKER_KEY` are removed.** The global mutable marker could make existing `Err` values undetectable.
  - **`isErr` takes no type argument:** `isErr(value: unknown): value is Err<unknown>`. The error type is inferred from the `Result` passed in, including multi-error unions and generic `Result<T, E>`. `isErr<E>(x)` was an unchecked assertion.
  - **The default `E` is `undefined` instead of `never`** for `Err`, `Result` and `ResultAsync`. `err()` returns `Err<undefined>`, matching its runtime `data`. `Result<T>` still accepts `return err()`.

  **Fixes**

  - `safe()` never throws synchronously on the promise path. A cross-realm promise, a promise whose `then` or `constructor` throws, or a revoked Proxy now resolves to `Err`.
  - `safe()` tells the two forms apart with `typeof input === 'function'`, so a revoked Proxy function becomes `Err` instead of throwing.

## 1.0.0

### Major Changes

- 5744dc2: Remove `stack` property from `Err` type. Result pattern represents expected failures where stack traces are unnecessary — error data alone should describe the cause and origin. This aligns with how Rust's `Result` and Go's `error` handle expected failures.

  BREAKING CHANGE: `Err` no longer has a `stack` property. Access `err().stack` will be `undefined`.

## 0.1.7

### Patch Changes

- 2ebbfa4: chore: remove sourcemap generation from build scripts

## 0.1.6

### Patch Changes

- b6c0f72: docs: remove redundant Exports sections from READMEs

## 0.1.5

### Patch Changes

- 665e37c: chore: quality audit across all public packages

  - Add `sideEffects: false` and `publishConfig.provenance` to all packages
  - Add `.npmignore` to all packages
  - Expand npm keywords for better discoverability
  - Use explicit named exports in barrel files (shared, cors)
  - Improve README descriptions, add Exports sections, fix inaccuracies
  - Add root `.editorconfig`
  - Add router to CI/CD pipeline

## 0.1.4

### Patch Changes

- 55cf7d7: Include LICENSE file in published packages

## 0.1.3

### Patch Changes

- f3f036f: fix(release): resolve workspace:\* protocol and restore GitHub release creation

## 0.1.2

### Patch Changes

- afb893b: fix(release): use bun publish to correctly resolve workspace:\* protocol

  Previously `npx changeset publish` (npm publish) shipped `"workspace:*"` to npm
  as-is, making the package uninstallable for consumers. Switched to `bun publish`
  which natively resolves `workspace:*` to real version numbers at publish time.

## 0.1.1

### Patch Changes

- fec6633: refactor(shared): move HttpMethod type from enums/ to types/

  `HttpMethod` is a string literal union type, not an enum. Moved to `src/types/` to correctly reflect its nature. Public API is unchanged — still accessible via the main entry point.

  build: enable minification with --production flag across all packages

## 0.1.0

### Minor Changes

- 08bfee5: Add `safe()` function and `ResultAsync` type

  - `safe(fn)` / `safe(fn, mapErr)`: wraps sync functions, catches throws into `Err`
  - `safe(promise)` / `safe(promise, mapErr)`: wraps Promises, catches rejections into `Err`
  - `ResultAsync<T, E>`: type alias for `Promise<Result<T, E>>`

## 0.0.3

### Patch Changes

- 19bd0bc: fix: resolve release pipeline (private WIP packages, Node 24 OIDC)

## 0.0.2

### Patch Changes

- f2eb2de: fix: republish with resolved workspace dependencies
