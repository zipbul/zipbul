# @zipbul/result

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/result)](https://www.npmjs.com/package/@zipbul/result)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/result-coverage.json)

A lightweight Result type for error handling without exceptions.
Returns plain union values (`T | Err<E>`) instead of wrapping in classes — zero runtime overhead, full type safety.

> No throw, no try/catch, no wrapper class. Just values.

<br>

## 📦 Installation

```bash
bun add @zipbul/result
```

<br>

## 💡 Core Concept

Traditional error handling with `throw` breaks control flow, loses type information, and forces callers into a `try/catch` guessing game.

```typescript
// ❌ Throw — caller has no idea what to expect
function parseConfig(raw: string): Config {
  if (!raw) throw new Error('empty input');      // What type? Unknown.
  if (!valid(raw)) throw new ValidationError();  // Silently propagates up.
  return JSON.parse(raw);
}

try {
  const config = parseConfig(input);
} catch (e) {
  // What is `e`? Error? ValidationError? SyntaxError from JSON.parse?
  // TypeScript cannot help you here — `e` is `unknown`.
}
```

```typescript
// ✅ Result — type-safe, explicit, no surprises
import { err, isErr, type Result } from '@zipbul/result';

function parseConfig(raw: string): Result<Config, string> {
  if (!raw) return err('empty input');
  if (!valid(raw)) return err('validation failed');
  return JSON.parse(raw);
}

const result = parseConfig(input);

if (isErr(result)) {
  console.error(result.data); // string — TypeScript knows the type
} else {
  console.log(result.host);   // Config — fully narrowed
}
```

<br>

## 🚀 Quick Start

```typescript
import { err, isErr, type Result } from '@zipbul/result';

interface User {
  id: number;
  name: string;
}

function findUser(id: number): Result<User, string> {
  if (id <= 0) return err('Invalid ID');

  const user = db.get(id);
  if (!user) return err('User not found');

  return user;
}

const result = findUser(42);

if (isErr(result)) {
  // result is Err<string>
  console.error(`Failed: ${result.data}`);
} else {
  // result is User
  console.log(`Hello, ${result.name}`);
}
```

<br>

## 📚 API Reference

### `err()`

Creates an immutable `Err` value. Never throws.

```typescript
import { err } from '@zipbul/result';
```

| Overload | Return | Description |
|:---------|:-------|:------------|
| `err()` | `Err<undefined>` | Error with no data |
| `err<E>(data: E)` | `Err<E>` | Error with attached data |

```typescript
// No data — simple signal
const e1 = err();
// e1.data → undefined

// With data — carry error details
const e2 = err('not found');
// e2.data → 'not found'

// Rich error objects
const e3 = err({ code: 'TIMEOUT', retryAfter: 3000 });
// e3.data.code → 'TIMEOUT'
```

Properties of the returned `Err`:

| Property | Type | Description |
|:---------|:-----|:------------|
| `data` | `E` | The attached error data |

> **Immutability** — every `Err` is `Object.freeze()`d. Attempting to modify properties in strict mode throws a `TypeError`.

<br>

### `isErr()`

Type guard that narrows a value to `Err<E>`.

```typescript
import { isErr } from '@zipbul/result';
```

```typescript
function isErr(value: unknown): value is Err<unknown>
```

- Returns `true` for values created by `err()`. It checks a marker, not the shape of `data`.
- **Never throws** — handles `null`, `undefined`, primitives, and hostile Proxies internally.
- No type argument needed. The error type is inferred from the `Result` you pass in. If the success type is too wide to tell apart (`unknown`, `object`), `data` is `unknown`.

```typescript
const result: Result<number, string> = doSomething();

if (isErr(result)) {
  // result: Err<string>
  console.error(result.data);
} else {
  // result: number
  console.log(result + 1);
}
```

<br>

### `Result<T, E>`

A plain union type — not a wrapper class.

```typescript
type Result<T, E = undefined> = T | Err<E>;
```

| Parameter | Default | Description |
|:----------|:--------|:------------|
| `T` | — | Success value type |
| `E` | `undefined` | Error data type |

```typescript
// Simple — no error data
type MayFail = Result<Config>;

// With error data
type ParseResult = Result<Config, string>;

// Rich error types
type ApiResult = Result<User, { code: string; message: string }>;
```

<br>

### `Err<E>`

The error type returned by `err()`.

```typescript
type Err<E = undefined> = {
  readonly data: E;
  // + an internal brand that only err() can set
};
```

> **Branded** — `Err` carries an internal marker that is not exported, so a plain object can't be typed as `Err`. A success value that happens to have a `data` property is never mistaken for an `Err`.
>
> **One version** — `isErr()` detects an `Err` from any copy of 2.x, but the types of two different installed versions don't mix, and `Err` values from 1.x or earlier are not detected. Keep a single version installed.
>
> **Serialization** — the marker does not survive `JSON.stringify` or `structuredClone`. Rebuild with `err()` after crossing such a boundary.

<br>

### `safe()`

Wraps a sync function or Promise into a `Result` / `ResultAsync`. Catches throws and rejections, converting them to `Err`.

```typescript
import { safe } from '@zipbul/result';
```

| Overload | Return | Description |
|:---------|:-------|:------------|
| `safe(fn)` | `Result<T, unknown>` | Sync — calls `fn()`, catches throws |
| `safe(fn, mapErr)` | `Result<T, E>` | Sync — catches throws, maps via `mapErr` |
| `safe(promise)` | `ResultAsync<T, unknown>` | Async — wraps rejection |
| `safe(promise, mapErr)` | `ResultAsync<T, E>` | Async — wraps rejection, maps via `mapErr` |

```typescript
// Sync — wrap a function that might throw
const result = safe(() => JSON.parse(rawJson));
if (isErr(result)) {
  console.error('Parse failed:', result.data);
} else {
  console.log(result); // parsed object
}

// Sync with mapErr — convert unknown throw to typed error
const typed = safe(
  () => JSON.parse(rawJson),
  (e) => ({ code: 'PARSE_ERROR', message: String(e) }),
);

// Async — wrap a Promise that might reject
const asyncResult = await safe(fetch('/api/data'));

// Async with mapErr
const apiResult = await safe(
  fetch('/api/users/1'),
  (e) => ({ code: 'NETWORK', message: String(e) }),
);
```

> **Sync path** — any function is called synchronously. A function that _returns_ a Promise is treated as sync — the Promise object becomes the success value `T`. Pass the Promise itself to take the async path.
>
> **Never throws** — the async path never throws synchronously, even for hostile or cross-realm promises; every failure becomes an `Err`.
>
> **mapErr panic** — if `mapErr` itself throws, the throw propagates (sync) or the returned promise rejects (async). This is by design — `mapErr` is user code, and its failure is a panic, not an `Err`.

<br>

### `ResultAsync<T, E>`

A type alias for async results — not a wrapper class.

```typescript
type ResultAsync<T, E = undefined> = Promise<Result<T, E>>;
```

| Parameter | Default | Description |
|:----------|:--------|:------------|
| `T` | — | Success value type |
| `E` | `undefined` | Error data type |

```typescript
// Use as return type for async Result-returning functions
async function fetchUser(id: number): ResultAsync<User, string> {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) return err(res.statusText);
  return await res.json();
}

// Or wrap an existing Promise with safe()
const result: ResultAsync<Response, string> = safe(
  fetch('/api/data'),
  (e) => String(e),
);
```

<br>

## 🔬 Advanced Usage

### Result-returning functions

Define function signatures with `Result` to make error paths explicit in the type system.

```typescript
import { err, isErr, type Result } from '@zipbul/result';

interface ValidationError {
  field: string;
  message: string;
}

function validate(input: unknown): Result<ValidData, ValidationError> {
  if (!input || typeof input !== 'object') {
    return err({ field: 'root', message: 'Expected an object' });
  }
  // ... validation logic
  return input as ValidData;
}

const result = validate(body);
if (isErr(result)) {
  return Response.json({ error: result.data }, { status: 400 });
}
// result is ValidData here
```

### Chaining results

Since `Result` is a plain union, there's no `.map()` or `.flatMap()`. Use standard control flow:

```typescript
function processOrder(orderId: string): Result<Receipt, string> {
  const order = findOrder(orderId);
  if (isErr(order)) return order; // propagate

  const payment = chargePayment(order);
  if (isErr(payment)) return payment; // propagate

  return generateReceipt(order, payment);
}
```

> This is intentional. Classes with `.map()` / `.flatMap()` add runtime cost and force a specific composition style. Plain values + `isErr()` let you use standard `if`, `switch`, early return, and any other pattern you prefer.

### Async results

Works naturally with `Promise`:

```typescript
async function fetchUser(id: number): Promise<Result<User, ApiError>> {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) return err({ code: res.status, message: res.statusText });
    return await res.json();
  } catch {
    return err({ code: 0, message: 'Network error' });
  }
}
```

## 🔌 Framework Integration Examples

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { err, isErr, type Result } from '@zipbul/result';

interface AppError {
  code: string;
  message: string;
}

function parseBody(request: Request): Promise<Result<Payload, AppError>> {
  // ... returns Result
}

Bun.serve({
  async fetch(request) {
    const body = await parseBody(request);

    if (isErr(body)) {
      return Response.json(
        { error: body.data.code, message: body.data.message },
        { status: 400 },
      );
    }

    // body is Payload
    return Response.json({ ok: true, data: process(body) });
  },
  port: 3000,
});
```

</details>

<br>

## 📄 License

MIT
