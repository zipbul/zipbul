# @zipbul/cors

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/cors)](https://www.npmjs.com/package/@zipbul/cors)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/cors-coverage.json)

CORS middleware for the **zipbul** framework.
Register it on the HTTP adapter's `OnRequest` phase and it evaluates the Fetch CORS protocol for every request — preflight answering, credentialed grants, `Vary` cache correctness, and Private Network Access.

> Internally a standalone engine (`Cors`) evaluates policy and returns a **discriminated union** result; `corsMiddleware` wires it into the zipbul pipeline. The engine is exported for advanced use (custom adapters, tests).

<br>

## 📦 Installation

```bash
bun add @zipbul/cors
```

<br>

## 🚀 Quick Start

Register `corsMiddleware` declaratively on the HTTP adapter's `OnRequest` phase in your module. Options are validated at registration (`Cors.create`), so a bad config throws `CorsError` **at boot**, not per request.

```typescript
import { defineModule } from '@zipbul/core';
import { corsMiddleware } from '@zipbul/cors';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';

export const appModule = defineModule({
  name: 'App',
  adapters: [
    {
      adapter: HttpAdapter,
      middlewares: {
        [HttpAdapterPhase.OnRequest]: [
          corsMiddleware({
            origin: 'https://my-app.example.com',
            credentials: true,
          }),
        ],
      },
    },
  ],
});
```

What the middleware does per request:

- **Preflight** (`OPTIONS` + `Access-Control-Request-Method`) — an accepted preflight is answered directly with the negotiated `Access-Control-*` headers and the configured success status (default `204`); with `preflightContinue: true` it is delegated to the next handler instead.
- **Actual request** — attaches the applicable CORS headers to the response and lets the route run: `Access-Control-Allow-Origin` always on a grant, `-Allow-Credentials` only with `credentials: true`, `-Expose-Headers` only when configured, `Vary: Origin` only when the allow-origin answer varies by request origin.
- **Rejected request** — withholds the grant (the browser then blocks cross-origin access) and lets the request proceed without producing a 403 itself; when the policy varies by origin (anything other than static `'*'` / `false`), `Vary: Origin` is still written per STANDARDS §7.1.

> ⚠️ Register on `OnRequest` only. It is the sole phase that runs before route resolution (a preflight must be answered even for unrouted paths), and phases after `ParseBody` cannot see the raw request at all — the body parser consumes it.

<br>

## 💡 Core Concept

The middleware wraps a standalone engine: `Cors.handle()` does not create a response — it returns **what to do next** as a discriminated union, and `corsMiddleware` maps that onto the zipbul pipeline.

```
CorsResult
├── Continue          → Attach CORS headers to the response and continue
├── RespondPreflight  → Return a preflight-only response immediately
└── Reject            → Withhold the grant (with reason + cache-correctness headers)
```

The engine is exported for advanced use — custom adapters and tests. See [Engine usage](#-engine-usage-advanced).

<br>

## ⚙️ Options

```typescript
interface CorsOptions {
  origin?: OriginOptions;              // Default: '*'
  methods?: Array<HttpMethod | '*'>;   // Default: GET, HEAD, PUT, PATCH, POST, DELETE
  allowedHeaders?: string[] | null;    // Default: null (reflects request's ACRH)
  exposedHeaders?: string[] | null;    // Default: null (header not included)
  credentials?: boolean;               // Default: false
  maxAge?: number | null;              // Default: null (header not included)
  preflightContinue?: boolean;         // Default: false
  optionsSuccessStatus?: HttpStatus;   // Default: 204 (must be a real 2xx HttpStatus)
  allowPrivateNetwork?: boolean;       // Default: false
}
```

### `origin`

| Value | Behavior |
|:------|:---------|
| `'*'` _(default)_ | Allow all origins |
| `false` | Reject all origins |
| `true` | Reflect the request origin |
| `'https://example.com'` | Allow only the exact match |
| `/^https:\/\/(.+\.)?example\.com$/` | Regex matching |
| `['https://a.com', /^https:\/\/b\./]` | Array (mix of strings and regexes) |
| `(origin, request) => boolean \| string \| Promise<boolean \| string>` | Function (sync or async) |

> When `credentials: true`, `origin: '*'` causes a **validation error**. Use `origin: true` to reflect the request origin.
>
> A RegExp carrying the `g` or `y` flag is **rejected at boot** (`InvalidOrigin`) — those flags mutate `lastIndex` between tests, so a shared matcher would alternate results across requests. Use stateless flags (`i`, `m`, `s`, `u`, `d`).
>
> RegExp origins are **not** screened for catastrophic backtracking (ReDoS). Because a RegExp is matched against the request `Origin` synchronously, supply only anchored, linear-time patterns (e.g. `/^https:\/\/([a-z0-9-]+\.)?example\.com$/`) — or prefer a string/array/function origin when the pattern would be complex.

### `methods`

HTTP methods to allow in preflight. Accepts `Array<HttpMethod | '*'>` — the `HttpMethod` enum (from `@zipbul/http-adapter`) covers all 36 methods accepted by Bun's HTTP parser.

```typescript
import { HttpMethod } from '@zipbul/http-adapter';

Cors.create({ methods: [HttpMethod.Get, HttpMethod.Post, HttpMethod.Delete] });
Cors.create({ methods: [HttpMethod.Get, HttpMethod.Propfind] }); // WebDAV
```

A wildcard `'*'` allows all methods (non-credentialed requests only). With `credentials: true`, `methods: ['*']` is **rejected at boot** (`CredentialsWithWildcardMethods`) — enumerate the allowed methods explicitly.

> The CORS-safelisted methods `GET`/`HEAD`/`POST` **always pass** the preflight method check, even when omitted from `methods` — the browser lets them cross regardless, so rejecting their preflight would only contradict the UA (STANDARDS §3.3).

### `allowedHeaders`

Request headers to allow in preflight. When not set, the client's requested header names are echoed back — re-serialized as a clean comma-separated list (whitespace and empty list elements stripped, per RFC 9110 §5.6.1.1's sender rule), never the raw client string.

```typescript
Cors.create({ allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'] });
```

> **⚠️ Authorization caveat** — Per the Fetch Standard, a wildcard `'*'` alone does not cover the `Authorization` header. You must list it explicitly.
>
> ```typescript
> Cors.create({ allowedHeaders: ['*', 'Authorization'] });
> ```

### `exposedHeaders`

Response headers to expose to browser JavaScript.

```typescript
Cors.create({ exposedHeaders: ['X-Request-Id', 'X-Rate-Limit-Remaining'] });
```

> With `credentials: true`, the `'*'` entry is dropped (browsers treat it as a literal name under credentials): a bare `['*']` emits no header at all, while explicit names listed alongside it (e.g. `['*', 'X-Foo']`) are still emitted.

### `credentials`

Whether to include the `Access-Control-Allow-Credentials: true` header.

```typescript
Cors.create({ origin: 'https://app.example.com', credentials: true });
```

### `maxAge`

How long (in seconds) the browser may cache the preflight result. Must be a non-negative integer below 10²¹ (RFC 9111 `delta-seconds`).

```typescript
Cors.create({ maxAge: 86400 }); // 24 hours
```

### `preflightContinue`

When set to `true`, an **accepted** preflight is not answered automatically — `CorsAction.Continue` is returned with the negotiated headers, delegating the response to the next handler. A preflight that fails validation still returns `Reject`.

### `optionsSuccessStatus`

HTTP status code for the preflight response. Defaults to `204`. Set to `200` if legacy browser compatibility is needed.

### `allowPrivateNetwork`

When `true`, a preflight carrying `Access-Control-Request-Private-Network: true` receives `Access-Control-Allow-Private-Network: true` in response, permitting the private-network access. Defaults to `false`. Based on the WICG [Private Network Access](https://wicg.github.io/private-network-access/) draft (non-standard, not yet merged into the Fetch Standard).

<br>

## 📤 Return Types

`handle()` returns `Promise<CorsResult>`. `CorsResult` is a discriminated union of three interfaces.

#### `CorsContinueResult`

```typescript
{ action: CorsAction.Continue; headers: Headers }
```

Returned for every non-preflight request — including an `OPTIONS` request **without** `Access-Control-Request-Method` (OPTIONS used as a real verb) and a no-Origin request under the static wildcard — and for an accepted preflight when `preflightContinue: true`. Merge `headers` into your response directly.

#### `CorsPreflightResult`

```typescript
{ action: CorsAction.RespondPreflight; headers: Headers; statusCode: HttpStatus }
```

Returned for `OPTIONS` requests that include `Access-Control-Request-Method`. Use `headers` and `statusCode` to build a response.

#### `CorsRejectResult`

```typescript
{ action: CorsAction.Reject; reason: CorsRejectionReason; headers: Headers }
```

Returned when CORS validation fails. Use `reason` to build a detailed error response, and **merge `headers` into whatever you send back** — it carries the cache-correctness headers (chiefly `Vary: Origin` when the allow-origin answer depends on the request origin, per Fetch's CORS-and-HTTP-caches guidance). Without it a shared cache may store the header-less response and replay it to an allowed origin.

| `CorsRejectionReason` | Meaning |
|:-----------------------|:--------|
| `NoOrigin` | `Origin` header missing or empty |
| `OriginNotAllowed` | Origin not in the allowed list |
| `MethodNotAllowed` | Preflight's `Access-Control-Request-Method` not allowed by the policy (the CORS-safelisted `GET`/`HEAD`/`POST` always pass) |
| `HeaderNotAllowed` | A preflight `Access-Control-Request-Headers` entry not allowed by the policy |

> Exception: with the static wildcard (`origin: '*'`), a request **without** an `Origin` header is not rejected — it returns `Continue` carrying `Access-Control-Allow-Origin: *`. Fetch's cache guidance requires a static wildcard to be sent on every response for the resource, non-CORS ones included (STANDARDS §7.2).

`Cors.create()` throws `CorsError` when options fail boot validation. Two reasons fire from `handle()` at runtime instead: `OriginFunctionError`, and `CredentialsWithWildcardOrigin` when an origin **function** returns `'*'` under `credentials: true`.

| `CorsErrorReason` | Meaning |
|:------------------|:--------|
| `CredentialsWithWildcardOrigin` | `credentials:true` with `origin:'*'` at boot, or an origin function returning `'*'` at runtime (Fetch Standard §3.3.5) |
| `CredentialsWithWildcardMethods` | `credentials:true` with `methods:['*']` (Fetch Standard §3.2.6) |
| `InvalidMaxAge` | `maxAge` is not a non-negative integer below 10²¹ (RFC 9111 `delta-seconds`) |
| `InvalidStatusCode` | `optionsSuccessStatus` is not a real 2xx `HttpStatus` member (e.g. `299` throws) |
| `InvalidOrigin` | `origin` is not a boolean, serialized-origin string (`'*'`/`'null'` allowed), stateless RegExp (no `g`/`y` flags), array thereof, or function |
| `InvalidMethods` | `methods` is empty, or contains an entry that is not a known `HttpMethod` or `'*'` |
| `InvalidAllowedHeaders` | `allowedHeaders` contains an entry that is not a valid HTTP token (RFC 9110 §5.6.2) |
| `InvalidExposedHeaders` | `exposedHeaders` contains an entry that is not a valid HTTP token (RFC 9110 §5.6.2) |
| `InvalidCredentials` | `credentials` is not a boolean |
| `InvalidPreflightContinue` | `preflightContinue` is not a boolean |
| `InvalidAllowPrivateNetwork` | `allowPrivateNetwork` is not a boolean |
| `OriginFunctionError` | Origin function threw at runtime (`handle()`) |

<br>

## 🔬 Advanced Usage

### Origin option patterns

```typescript
// Single origin
Cors.create({ origin: 'https://app.example.com' });

// Multiple origins (mix of strings and regexes)
Cors.create({
  origin: [
    'https://app.example.com',
    'https://admin.example.com',
    /^https:\/\/preview-\d+\.example\.com$/,
  ],
});

// Regex to allow all subdomains
Cors.create({ origin: /^https:\/\/(.+\.)?example\.com$/ });
```

### Async origin function

Dynamically validate origins via a database or external service.

```typescript
Cors.create({
  origin: async (origin, request) => {
    const tenant = request.headers.get('X-Tenant-Id');
    const allowed = await db.isOriginAllowed(tenant, origin);

    return allowed ? true : false;
    // true   → reflect the request origin
    // string → use the specified string (must be a serialized origin, 'null', or '*')
    // false  → reject
  },
});
```

> A returned string is held to the same standard as a config origin: it must be its own URL origin serialization (no trailing slash/path, no explicit default port), or the literal `'null'`/`'*'`. Anything else is treated as **not allowed** rather than emitted — a malformed value would fail the browser's byte comparison anyway.
>
> Exception: returning `'*'` while `credentials: true` is enabled makes `handle()` **throw** `CorsError` (`CredentialsWithWildcardOrigin`) — the same combination that is rejected at boot for the static config.

> If the origin function throws, `handle()` throws `CorsError` with `reason: CorsErrorReason.OriginFunctionError`.

### Wildcards and credentials

Per the Fetch Standard, wildcards (`*`) cannot be used with credentialed requests (cookies, `Authorization`).
When `credentials: true`, the library automatically handles the following:

| Option | Behavior with wildcard |
|:-------|:-----------------------|
| `origin: '*'` | **Validation error** — use `origin: true` to reflect the request origin |
| `methods: ['*']` | **Validation error** — enumerate the allowed methods explicitly |
| `allowedHeaders: ['*']` | Echoes the requested header names when present (never a literal `*`; `Authorization` still requires explicit listing) |
| `exposedHeaders: ['*']` | Bare `['*']` emits no header; explicit names alongside `'*'` are still emitted |

```typescript
// ✅ origin: true + credentials: true → request origin is reflected
Cors.create({ origin: true, credentials: true });

// ✅ Specific domain + credentials
Cors.create({ origin: 'https://app.example.com', credentials: true });

// ❌ origin: '*' + credentials: true → Cors.create() throws CorsError
Cors.create({ origin: '*', credentials: true }); // CorsErrorReason.CredentialsWithWildcardOrigin
```

> [!WARNING]
> **`origin: true` + `credentials: true` reflects _any_ requesting origin with credentials.**
> This is spec-valid (the browser CORS check accepts a reflected concrete origin) and is the only
> way to support credentialed CORS across multiple origins — but it means **every** website can make
> credentialed requests and read the responses. Use it **only** behind a first-party allowlist or an
> auth gateway. For a fixed set of trusted origins, pass an array or a function instead of `true`:
>
> ```typescript
> // ✅ credentialed CORS scoped to a vetted allowlist
> Cors.create({ origin: ['https://app.example.com', 'https://admin.example.com'], credentials: true });
> Cors.create({ origin: (o) => allowlist.has(o), credentials: true });
> ```
>
> Note: `origin: '*'` + `credentials` is *rejected at boot* because the browser blocks it (an inert,
> broken config); `origin: true` + `credentials` is *allowed* because it actually works — which is
> exactly why it is the dangerous one to leave unscoped.
>
> The same caution applies to **`origin: 'null'` + `credentials: true`**: it is spec-valid and permitted,
> but `null` is the origin of sandboxed iframes, `data:`/`file:` documents, and other opaque origins — so
> this shares credentialed responses with any such context. Only allow it when you specifically intend to.

### Per-origin / per-route policy (multiple instances)

Only `origin` is dynamic per request. `methods`, `allowedHeaders`, `credentials`, `maxAge`, etc. are
**fixed policy**, validated once at `Cors.create()` time. To vary the _whole_ policy by route, tenant,
or surface, construct one boot-validated `Cors` instance per policy and select it upstream — this keeps
every instance fully validated and keeps option re-validation/re-construction off the request path:

```typescript
const corsBySurface = new Map<string, Cors>([
  ['public', Cors.create({ origin: '*', methods: [HttpMethod.Get] })],
  ['app', Cors.create({ origin: 'https://app.example.com', credentials: true })],
]);

// pick the policy for this request's surface, then handle as usual
const cors = corsBySurface.get(surfaceOf(request)) ?? corsBySurface.get('public')!;
const result = await cors.handle(request);
```

This is preferred over a per-request options delegate: it preserves fail-fast boot validation instead
of moving it onto the hot request path.

### Preflight delegation

When another middleware needs to handle OPTIONS requests directly:

```typescript
const cors = Cors.create({ origin: 'https://app.example.com', preflightContinue: true });

async function handle(request: Request): Promise<Response> {
  const result = await cors.handle(request);

  if (result.action === CorsAction.Reject) {
    // result.headers carries Vary: Origin (the origin above varies by request) —
    // merge it so caches stay correct even on the 403
    return new Response('Forbidden', { status: 403, headers: result.headers });
  }

  // Continue — both normal and preflight requests arrive here
  const response = await nextHandler(request);

  for (const [key, value] of result.headers) {
    response.headers.set(key, value);
  }

  return response;
}
```

<br>

## 🔬 Engine usage (advanced)

`corsMiddleware` covers zipbul apps. The underlying `Cors` engine is exported for the cases the middleware cannot reach — custom adapters and direct tests. It takes a standard `Request` and returns a `CorsResult`; you translate that onto your transport:

```typescript
import { Cors, CorsAction } from '@zipbul/cors';

const cors = Cors.create({ origin: 'https://my-app.example.com', credentials: true });

async function handleRequest(request: Request): Promise<Response> {
  const result = await cors.handle(request); // throws CorsError if the origin fn fails

  if (result.action === CorsAction.Reject) {
    // result.headers carries Vary: Origin — keep caches correct even on the 403
    return new Response('Forbidden', { status: 403, headers: result.headers });
  }

  if (result.action === CorsAction.RespondPreflight) {
    return new Response(null, { status: result.statusCode, headers: result.headers });
  }

  // CorsAction.Continue — merge result.headers into your response
  const response = await next(request);
  for (const [key, value] of result.headers) {
    response.headers.set(key, value);
  }
  return response;
}
```

<br>

## 📄 License

MIT
