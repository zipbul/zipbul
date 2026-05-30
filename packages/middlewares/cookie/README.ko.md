# @zipbul/cookie

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/cookie)](https://www.npmjs.com/package/@zipbul/cookie)

Bun을 위한, 엄격한 보안 기본값을 갖춘 RFC 6265bis 쿠키 **파서·서명기·jar**입니다.

서버 측 쿠키 수명주기 전체를 담당합니다: 인바운드 `Cookie` 헤더 파싱, HMAC 서명,
AES-256-GCM 암호화, RFC 부합 `Set-Cookie` 직렬화 — 키 로테이션, 시크릿 강도 검증,
쿠키 prefix / `SameSite` / 크기 불변식까지 자동으로 적용합니다.

> Bun 네이티브 `Cookie` / `CookieMap` 위에 구축. `node:crypto` 의존성 없음
> (서명·암호화는 Web Crypto + `Bun.CryptoHasher` 사용).

<br>

## 📦 설치

```bash
bun add @zipbul/cookie
```

프레임워크 미들웨어(`cookieMiddleware`)는 어댑터 peer가 추가로 필요합니다:

```bash
bun add @zipbul/common @zipbul/http-adapter
```

<br>

## 💡 핵심 개념

두 계층으로 나뉘며, 필요한 것만 골라 쓰면 됩니다:

```
@zipbul/cookie
├── CookieParser   → 프레임워크 비종속 엔진: createCookie / serialize / sign / unsign / encrypt / decrypt
├── CookieJar      → 요청 단위 컨테이너: 인바운드 파싱, 아웃바운드 큐잉, Set-Cookie 헤더 생성
└── cookieMiddleware → CookieJar를 요청 컨텍스트에 연결하는 zipbul HTTP 미들웨어
```

파서는 순수합니다(`Request` 불필요): `Cookie` 객체와 문자열을 변환할 뿐입니다.
jar는 요청 단위 상태를 더하고, 미들웨어는 jar를 `@zipbul` HTTP 파이프라인에 연결합니다.
각 계층은 독립적으로 사용할 수 있습니다.

<br>

## 🚀 빠른 시작

### `@zipbul` 미들웨어로 사용

```typescript
import { cookieMiddleware, cookieJarKey } from '@zipbul/cookie';
import { HttpAdapter, HttpAdapterPhase, HttpContext } from '@zipbul/http-adapter';
import { defineMiddleware } from '@zipbul/common';

// 파서 하나, 등록 시점에 검증 (약한 시크릿 등은 CookieError를 던짐)
const cookies = cookieMiddleware({
  secrets: [process.env.COOKIE_SECRET!], // 32바이트 이상, 엔트로피 128비트 이상
  httpOnly: true,
  secure: 'auto', // 요청 스킴에 따라 결정됨
  sameSite: 'lax',
});

httpAdapter.addMiddlewares(HttpAdapterPhase.OnRequest, [cookies.onRequest]);
httpAdapter.addMiddlewares(HttpAdapterPhase.BeforeResponse, [cookies.beforeResponse]);

// 다운스트림 핸들러/미들웨어: jar로 읽고 씀
const handler = defineMiddleware([HttpAdapter], () => async (ctx) => {
  const jar = ctx.to(HttpContext).use(cookieJarKey);

  const session = await jar.get('session'); // string | null | Err
  if (session === null) {
    jar.set('session', 'new-user', { maxAge: 3600 });
  }
});
```

`onRequest`는 인바운드 `Cookie` 헤더를 `CookieJar`로 파싱해 `cookieJarKey`에 게시하고,
`beforeResponse`는 `jar.set()` / `jar.delete()`로 큐잉된 항목을 쿠키마다 하나의 `Set-Cookie`
헤더로 직렬화합니다. writer는 **post-route** 단계에서 실행되므로, 매칭된 라우트에서만
플러시됩니다(404는 그 전에 단락됩니다).

### 독립 사용 (프레임워크 없이)

```typescript
import { CookieParser, CookieJar } from '@zipbul/cookie';

const parser = CookieParser.create({ secrets: [process.env.COOKIE_SECRET!] });

// 인바운드: 파싱 + 자동 복호화 + 자동 서명검증
const jar = new CookieJar(parser, request.headers.get('cookie') ?? '');
const value = await jar.get('session'); // string | null | Err<CookieErrorData>

// 아웃바운드: 큐잉 후 직렬화
jar.set('session', 'user:42', { httpOnly: true, maxAge: 3600 });
const setCookies = await jar.getSetCookieHeaders({ isSecure: true });
for (const header of setCookies) {
  response.headers.append('Set-Cookie', header);
}
```

<br>

## ⚙️ 옵션

`CookieParser.create(options?)`와 `cookieMiddleware(options?)`는 동일한
`CookieParserOptions`를 받습니다. 모든 필드는 선택이며, 시크릿은 즉시 검증됩니다.

### 서명 — `secrets`, `algorithm`

```typescript
CookieParser.create({
  secrets: [currentKey, previousKey], // 로테이션: [0]으로 서명, 전체로 검증
  algorithm: 'sha256',                // 'sha256' | 'sha384' | 'sha512' (기본 'sha256')
});
```

`name + 0x00 + value`에 대한 HMAC(쿠키 이름을 서명에 바인딩해 cross-name 재전송을 차단).
각 키는 HKDF로 도출되고 4바이트 KID가 붙으며, 검증은 **KID-strict** — KID가 설정된 어떤
키와도 일치하지 않는 서명은 즉시 거부됩니다. 로테이션은 새 키를 **맨 앞에 추가**해서 합니다.

각 시크릿은 **32 UTF-8 바이트 이상**이고 **Shannon 엔트로피 128비트 이상**이어야 합니다
(OWASP / NIST SP 800-131A). 약한 시크릿은 `create()`에서 `CookieError(WeakSecret)`를 던집니다.

### 암호화 — `encryptionSecret`

```typescript
CookieParser.create({
  encryptionSecret: [currentKey, previousKey], // string | string[]; [0]으로 암호화
});
```

Web Crypto 기반 AES-256-GCM: 12바이트 무작위 IV, 128비트 태그, 쿠키 이름을 AAD로 바인딩.
키는 HKDF로 도출(서명 키와 다른 `info`)되고 KID가 붙으며, `decrypt()`도 `unsign()`처럼
KID-strict입니다. 엔트로피 게이트는 `secrets`와 동일합니다.

### `kdfSalt`

```typescript
CookieParser.create({ kdfSalt: process.env.COOKIE_KDF_SALT }); // string | Uint8Array, 16바이트 이상
```

배포 단위 HKDF salt(RFC 5869 §3.1). 같은 시크릿을 공유하지만 salt가 다른 두 설치는 서로
독립적인 키를 도출합니다. 미지정 시 라이브러리 고정값을 사용합니다.

### `prefixValidation`

기본값 `true`. 켜져 있으면 `serialize()`가 `__Host-` / `__Secure-` 불변식(RFC 6265bis
§4.1.3)을 강제합니다: `__Secure-` ⇒ `Secure`; `__Host-` ⇒ `Secure` + `Path=/` + `Domain` 금지.

### 쿠키 기본값

`httpOnly`, `secure`(`boolean | 'auto'`), `sameSite`(`'strict' | 'lax' | 'none'`), `path`,
`domain`, `maxAge`, `expires`(`number | Date | string`), `partitioned`, `priority`
(`'low' | 'medium' | 'high'`). 파서가 만드는 모든 쿠키에 적용되며, 쿠키별로 덮어쓸 수
있습니다. `secure: 'auto'`는 직렬화 시점에 `SerializeContext.isSecure`가 필요하며(미들웨어가
요청 스킴에서 공급) — 결코 조용히 insecure로 강등하지 않습니다.

### `onEncrypt`

```typescript
CookieParser.create({
  encryptionSecret: key,
  onEncrypt: ({ keyIndex, counter }) => metrics.gauge('gcm.invocations', counter),
});
```

AES-GCM IV 사용량 텔레메트리(NIST SP 800-38D §8.3)를 위한 암호화별 훅. 호출 상한은
**프로세스 단위 best-effort 백스톱**일 뿐 fleet 전역 보장이 아닙니다 — 암호화 시크릿을
주기적으로 로테이션하세요.

<br>

## 📤 쿠키 읽기 — `CookieJar.get()`

`get()`은 Result 타입을 반환하므로, 변조되었거나 복호화 불가한 쿠키는 throw가 아니라 값입니다:

```typescript
import { isErr } from '@zipbul/result';

const result = await jar.get('session');
if (result === null) {
  // 쿠키 없음
} else if (isErr(result)) {
  // 존재하지만 복호화/서명검증 실패 — result.data.reason이 원인
} else {
  // result는 평문 문자열
}
```

인바운드 순서는 아웃바운드의 역순입니다: **복호화 → 서명검증**. `getRaw(name)`은 디코딩
전 원본 와이어 값을, `has(name)`은 처리 없이 존재 여부를 반환합니다.

<br>

## 🔬 고급 사용법

### 키 로테이션

```typescript
// 1단계 — 새 키를 맨 앞에 추가; 기존 쿠키도 검증됨
CookieParser.create({ secrets: [newKey, oldKey] });
// 2단계 — 기존 쿠키가 만료되면 옛 키 제거
CookieParser.create({ secrets: [newKey] });
```

서명/암호화는 항상 index `0`을 쓰고, 검증/복호화는 KID가 일치하는 설정 키를 모두
시도합니다. `encryptionSecret`도 동일한 패턴입니다.

### prefix 쿠키 삭제

```typescript
jar.delete('__Host-session'); // Secure + Path=/를 자동으로 붙여 UA가 만료를 수용
```

기본 옵션에서 `delete()`는 `__Host-`/`__Secure-` 이름에 `secure:true`(그리고 `__Host-`는
`Path=/`)를 설정해, 삭제 `Set-Cookie`가 prefix 검사를 통과하게 합니다. 일반 쿠키는 평문 HTTP
에서도 만료시킬 수 있도록 insecure가 기본입니다. 명시적으로 준 속성은 그대로 존중됩니다.

### 인바운드 손상 처리

`Bun.CookieMap`은 잘못된 퍼센트 인코딩을 U+FFFD로 치환합니다. jar는 그런 항목을 드롭하지만
(암호/인증 값의 조용한 손상은 허용 불가) — 원본 세그먼트가 **정상적으로 인코딩된 U+FFFD**인
경우는 그대로 유지합니다.

<br>

## 🔌 공개 API

| Export | 설명 |
| --- | --- |
| `CookieParser` | 엔진. `create(options?)`, `createCookie`, `serialize`, `sign`, `unsign`, `encrypt`, `decrypt`, `validatePrefix`, `isSigningConfigured`, `isEncryptionConfigured`. |
| `CookieJar` | `new CookieJar(parser, cookieHeader)`; `get`, `getRaw`, `has`, `set`, `delete`, `getSetCookieHeaders`. |
| `cookieMiddleware` | `(options?) => { onRequest, beforeResponse }` — `OnRequest` + `BeforeResponse`에 등록. |
| `cookieJarKey` | `contextKey<CookieJar>` — `ctx.use(cookieJarKey)`로 jar를 읽음. |
| `CookieError` / `CookieErrorReason` | 에러 클래스 + kebab-case 사유 enum. |
| 타입 | `CookieParserOptions`, `CookieAttributes`, `SerializeContext`, `SigningAlgorithm`, `CookieMiddleware`. |

<br>

## 📄 라이선스

MIT
