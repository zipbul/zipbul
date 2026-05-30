# @zipbul/cookie

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/cookie)](https://www.npmjs.com/package/@zipbul/cookie)

An RFC 6265bis cookie **parser, signer, and jar** with strict security defaults for Bun.

It owns the whole server-side cookie lifecycle: parsing the inbound `Cookie` header,
HMAC signing, AES-256-GCM encryption, and RFC-conformant `Set-Cookie` serialization —
with key rotation, secret-strength gating, and the cookie-prefix / `SameSite` / size
invariants enforced for you.

> Built on Bun's native `Cookie` / `CookieMap` primitives. Zero `node:crypto` dependency
> (signing and encryption go through Web Crypto + `Bun.CryptoHasher`).

<br>

## 📦 Installation

```bash
bun add @zipbul/cookie
```

The framework middleware (`cookieMiddleware`) additionally needs the adapter peers:

```bash
bun add @zipbul/common @zipbul/http-adapter
```

<br>

## 💡 Core Concept

Two layers, use whichever you need:

```
@zipbul/cookie
├── CookieParser   → framework-agnostic engine: createCookie / serialize / sign / unsign / encrypt / decrypt
├── CookieJar      → per-request container: parse inbound, queue outbound, emit Set-Cookie headers
└── cookieMiddleware → zipbul HTTP middleware that wires a CookieJar onto the request context
```

The parser is pure (standard `Request`-less): it transforms `Cookie` objects and strings.
The jar adds request-scoped state. The middleware connects the jar to the `@zipbul`
HTTP pipeline. Each layer is independently usable.

<br>

## 🚀 Quick Start

### As a `@zipbul` middleware

```typescript
import { cookieMiddleware, cookieJarKey } from '@zipbul/cookie';
import { HttpAdapter, HttpAdapterPhase, HttpContext } from '@zipbul/http-adapter';
import { defineMiddleware } from '@zipbul/common';

// One parser, validated at registration (throws CookieError on a weak secret, etc.)
const cookies = cookieMiddleware({
  secrets: [process.env.COOKIE_SECRET!], // >= 32 bytes, >= 128 bits entropy
  httpOnly: true,
  secure: 'auto', // resolves to the request scheme
  sameSite: 'lax',
});

httpAdapter.addMiddlewares(HttpAdapterPhase.OnRequest, [cookies.onRequest]);
httpAdapter.addMiddlewares(HttpAdapterPhase.BeforeResponse, [cookies.beforeResponse]);

// Downstream handler / middleware: read and write via the jar
const handler = defineMiddleware([HttpAdapter], () => async (ctx) => {
  const jar = ctx.to(HttpContext).use(cookieJarKey);

  const session = await jar.get('session'); // string | null | Err
  if (session === null) {
    jar.set('session', 'new-user', { maxAge: 3600 });
  }
});
```

`onRequest` parses the inbound `Cookie` header into a `CookieJar` and publishes it under
`cookieJarKey`. `beforeResponse` serializes everything queued via `jar.set()` / `jar.delete()`
into one `Set-Cookie` header per cookie. Because the writer runs in the **post-route** phase,
it flushes only on matched routes (a 404 short-circuits before it).

### Standalone (no framework)

```typescript
import { CookieParser, CookieJar } from '@zipbul/cookie';

const parser = CookieParser.create({ secrets: [process.env.COOKIE_SECRET!] });

// Inbound: parse + auto-decrypt + auto-unsign
const jar = new CookieJar(parser, request.headers.get('cookie') ?? '');
const value = await jar.get('session'); // string | null | Err<CookieErrorData>

// Outbound: queue, then serialize
jar.set('session', 'user:42', { httpOnly: true, maxAge: 3600 });
const setCookies = await jar.getSetCookieHeaders({ isSecure: true });
for (const header of setCookies) {
  response.headers.append('Set-Cookie', header);
}
```

<br>

## ⚙️ Options

`CookieParser.create(options?)` and `cookieMiddleware(options?)` take the same
`CookieParserOptions`. All fields are optional; secrets are validated eagerly.

### Signing — `secrets`, `algorithm`

```typescript
CookieParser.create({
  secrets: [currentKey, previousKey], // rotation: sign with [0], verify against all
  algorithm: 'sha256',                // 'sha256' | 'sha384' | 'sha512' (default 'sha256')
});
```

HMAC over `name + 0x00 + value` (the cookie name is bound into the signature, closing
cross-name replay). Each key is derived via HKDF and tagged with a 4-byte KID; verification
is **KID-strict** — a signature whose KID matches no configured key is rejected outright.
Rotate by **prepending** the new key.

Each secret must be **≥ 32 UTF-8 bytes** and carry **≥ 128 bits of Shannon entropy**
(OWASP / NIST SP 800-131A); weak secrets throw `CookieError(WeakSecret)` at `create()`.

### Encryption — `encryptionSecret`

```typescript
CookieParser.create({
  encryptionSecret: [currentKey, previousKey], // string | string[]; encrypt with [0]
});
```

AES-256-GCM via Web Crypto: a 12-byte random IV, a 128-bit tag, and the cookie name bound
as AAD. The key is HKDF-derived (distinct `info` from the signing key) and KID-tagged;
`decrypt()` is KID-strict like `unsign()`. Same entropy gate as `secrets`.

### `kdfSalt`

```typescript
CookieParser.create({ kdfSalt: process.env.COOKIE_KDF_SALT }); // string | Uint8Array, >= 16 bytes
```

Per-deployment HKDF salt (RFC 5869 §3.1). Two installations that share a secret but use
different salts derive independent keys. Defaults to a fixed library value.

### `prefixValidation`

`true` by default. When on, `serialize()` enforces the `__Host-` / `__Secure-` invariants
(RFC 6265bis §4.1.3): `__Secure-` ⇒ `Secure`; `__Host-` ⇒ `Secure` + `Path=/` + no `Domain`.

### Cookie defaults

`httpOnly`, `secure` (`boolean | 'auto'`), `sameSite` (`'strict' | 'lax' | 'none'`), `path`,
`domain`, `maxAge`, `expires` (`number | Date | string`), `partitioned`, `priority`
(`'low' | 'medium' | 'high'`). Applied to every cookie the parser produces; overridable
per cookie. `secure: 'auto'` requires a `SerializeContext.isSecure` at serialize time (the
middleware supplies it from the request scheme) — it never silently downgrades to insecure.

### `onEncrypt`

```typescript
CookieParser.create({
  encryptionSecret: key,
  onEncrypt: ({ keyIndex, counter }) => metrics.gauge('gcm.invocations', counter),
});
```

Per-encryption hook for AES-GCM IV-usage telemetry (NIST SP 800-38D §8.3). The invocation
cap is a **per-process best-effort backstop**, not a fleet-wide guarantee — rotate the
encryption secret on a schedule.

<br>

## 📤 Reading cookies — `CookieJar.get()`

`get()` returns a Result-typed value so a tampered or undecryptable cookie is a value, not a throw:

```typescript
import { isErr } from '@zipbul/result';

const result = await jar.get('session');
if (result === null) {
  // cookie absent
} else if (isErr(result)) {
  // present but failed to decrypt / unsign — result.data.reason tells you which
} else {
  // result is the plaintext string
}
```

Inbound order is the inverse of outbound: **decrypt → unsign**. `getRaw(name)` returns the
undecoded wire value, and `has(name)` checks presence without processing.

<br>

## 🔬 Advanced Usage

### Key rotation

```typescript
// Step 1 — add the new key in front; old cookies still verify
CookieParser.create({ secrets: [newKey, oldKey] });
// Step 2 — once old cookies have expired, drop the old key
CookieParser.create({ secrets: [newKey] });
```

Signing/encryption always use index `0`; verification/decryption try every configured key
whose KID matches. The same pattern applies to `encryptionSecret`.

### Deleting prefixed cookies

```typescript
jar.delete('__Host-session'); // emits Secure + Path=/ automatically, so the UA accepts the expiry
```

Under default options, `delete()` sets `secure:true` for `__Host-`/`__Secure-` names (and
`Path=/` for `__Host-`) so the deletion `Set-Cookie` survives the prefix check. Plain cookies
default insecure so they can be expired over plain HTTP. Explicit attributes are honored verbatim.

### Inbound corruption handling

`Bun.CookieMap` substitutes U+FFFD for malformed percent-encoding. The jar drops such entries
(silent corruption is unacceptable for crypto/auth values) **unless** the raw segment is a
legitimately-encoded U+FFFD — those are kept.

<br>

## 🔌 Public API

| Export | Description |
| --- | --- |
| `CookieParser` | Engine. `create(options?)`, `createCookie`, `serialize`, `sign`, `unsign`, `encrypt`, `decrypt`, `validatePrefix`, `isSigningConfigured`, `isEncryptionConfigured`. |
| `CookieJar` | `new CookieJar(parser, cookieHeader)`; `get`, `getRaw`, `has`, `set`, `delete`, `getSetCookieHeaders`. |
| `cookieMiddleware` | `(options?) => { onRequest, beforeResponse }` — register at `OnRequest` + `BeforeResponse`. |
| `cookieJarKey` | `contextKey<CookieJar>` — read the jar via `ctx.use(cookieJarKey)`. |
| `CookieError` / `CookieErrorReason` | Error class + kebab-case reason enum. |
| Types | `CookieParserOptions`, `CookieAttributes`, `SerializeContext`, `SigningAlgorithm`, `CookieMiddleware`. |

<br>

## 📄 License

MIT
