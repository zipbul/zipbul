---
"@zipbul/result": major
---

Fix `isErr()` narrowing when the success type has a `data` property (zipbul/toolkit#53), and make every type match runtime behavior.

**Breaking changes**

- **`Err` is branded.** `Err<E>` is now `{ readonly data: E }` plus an internal brand that only `err()` sets. A plain `{ data }` object is no longer assignable to `Err`, so a success value with a `data` property narrows to the success branch.
- **Marker is an internal `Symbol.for('@zipbul/result')`.** `isErr()` detects an `Err` from any 2.x copy or realm at runtime. An `Err` that went through `JSON.stringify` or `structuredClone` is no longer detected, so untrusted JSON can't forge an `Err`. `Err` values from 1.x or earlier are not detected, and the types of two different installed versions don't mix.
- **`setMarkerKey`, `getMarkerKey` and `DEFAULT_MARKER_KEY` are removed.** The global mutable marker could make existing `Err` values undetectable.
- **`isErr` takes no type argument:** `isErr(value: unknown): value is Err<unknown>`. The error type is inferred from the `Result` passed in, including multi-error unions and generic `Result<T, E>`. `isErr<E>(x)` was an unchecked assertion.
- **The default `E` is `undefined` instead of `never`** for `Err`, `Result` and `ResultAsync`. `err()` returns `Err<undefined>`, matching its runtime `data`. `Result<T>` still accepts `return err()`.

**Fixes**

- `safe()` never throws synchronously on the promise path. A cross-realm promise, a promise whose `then` or `constructor` throws, or a revoked Proxy now resolves to `Err`.
- `safe()` tells the two forms apart with `typeof input === 'function'`, so a revoked Proxy function becomes `Err` instead of throwing.
