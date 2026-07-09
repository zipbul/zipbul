# @zipbul/cors

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/cors)](https://www.npmjs.com/package/@zipbul/cors)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/cors-coverage.json)

프레임워크에 종속되지 않는 CORS 처리 라이브러리.
응답을 직접 생성하지 않고, **판별 유니온(discriminated union)** 결과를 반환하여 호출자가 응답 방식을 완전히 제어할 수 있도록 설계되었습니다.

> 표준 Web API(`Request` / `Response`)를 사용합니다.

<br>

## 📦 설치

```bash
bun add @zipbul/cors
```

<br>

## 💡 핵심 개념

`handle()` 은 응답을 만들지 않습니다. **다음에 무엇을 해야 하는지**만 알려줍니다.

```
CorsResult
├── Continue          → CORS 헤더를 응답에 추가한 뒤 계속 처리
├── RespondPreflight  → 프리플라이트 전용 응답을 즉시 반환
└── Reject            → 거부 (사유 포함)
```

이 구조 덕분에 미들웨어 파이프라인, 엣지 런타임, 커스텀 에러 포맷 등 어떤 환경에도 자연스럽게 맞춰집니다.

<br>

## 🚀 빠른 시작

```typescript
import { Cors, CorsAction, CorsError } from '@zipbul/cors';

// Cors.create()는 잘못된 옵션이면 CorsError를 throw합니다
const cors = Cors.create({
  origin: 'https://my-app.example.com',
  credentials: true,
});

async function handleRequest(request: Request): Promise<Response> {
  // handle()은 origin 함수 실패 시 CorsError를 throw합니다
  const result = await cors.handle(request);

  if (result.action === CorsAction.Reject) {
    return new Response('Forbidden', { status: 403 });
  }

  if (result.action === CorsAction.RespondPreflight) {
    return new Response(null, {
      status: result.statusCode,
      headers: result.headers,
    });
  }

  // CorsAction.Continue — CORS 헤더를 응답에 병합
  const response = new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });

  for (const [key, value] of result.headers) {
    response.headers.set(key, value);
  }

  return response;
}
```

<br>

## ⚙️ 옵션

```typescript
interface CorsOptions {
  origin?: OriginOptions;              // 기본값: '*'
  methods?: HttpMethod[];              // 기본값: GET, HEAD, PUT, PATCH, POST, DELETE
  allowedHeaders?: string[];           // 기본값: 요청의 ACRH 반영
  exposedHeaders?: string[];           // 기본값: 없음
  credentials?: boolean;               // 기본값: false
  maxAge?: number;                     // 기본값: 없음 (헤더 미포함)
  preflightContinue?: boolean;         // 기본값: false
  optionsSuccessStatus?: number;       // 기본값: 204
  allowPrivateNetwork?: boolean;       // 기본값: false
}
```

### `origin`

| 값 | 동작 |
|:---|:---|
| `'*'` _(기본)_ | 모든 출처 허용 |
| `false` | 모든 출처 거부 |
| `true` | 요청 출처를 그대로 반영 |
| `'https://example.com'` | 정확히 일치하는 출처만 허용 |
| `/^https:\/\/(.+\.)?example\.com$/` | 정규식 매칭 |
| `['https://a.com', /^https:\/\/b\./]` | 배열 (문자열·정규식 혼합) |
| `(origin, request) => boolean \| string` | 함수 (동기·비동기) |

> `credentials: true`일 때 `origin: '*'`는 **검증 오류**를 발생시킵니다. 요청 출처를 반영하려면 `origin: true`를 사용하세요.
>
> RegExp origin은 **stateless**여야 합니다 — `g`(global)나 `y`(sticky) 플래그가 붙은 패턴은 `CorsErrorReason.InvalidOrigin`으로 거부됩니다(`lastIndex`가 호출 순서에 따라 매칭을 바꾸기 때문).
>
> RegExp origin은 catastrophic backtracking(ReDoS)에 대해 **검사하지 않습니다**. RegExp은 요청 `Origin`에 동기적으로 매칭되므로, 앵커드·선형시간 패턴(예: `/^https:\/\/([a-z0-9-]+\.)?example\.com$/`)만 넘기거나, 패턴이 복잡해질 경우 string/array/function origin을 사용하세요.

### `methods`

프리플라이트에서 허용할 HTTP 메서드 목록. `Array<HttpMethod | '*'>` 를 받습니다. `HttpMethod` enum (`@zipbul/http-adapter`) 은 Bun HTTP parser 가 받는 36개 메서드를 전부 정의합니다.

```typescript
import { HttpMethod } from '@zipbul/http-adapter';

Cors.create({ methods: [HttpMethod.Get, HttpMethod.Post, HttpMethod.Delete] });
Cors.create({ methods: [HttpMethod.Get, HttpMethod.Propfind] }); // WebDAV
```

와일드카드 `'*'`를 넣으면 모든 메서드를 허용합니다(자격증명 없는 요청 한정). `credentials: true`이면 `methods: ['*']`는 **부팅 시 거부**됩니다(`CredentialsWithWildcardMethods`) — 허용 메서드를 명시적으로 나열하세요.

### `allowedHeaders`

프리플라이트에서 허용할 요청 헤더 목록. 미설정 시 클라이언트의 `Access-Control-Request-Headers` 값을 그대로 반영합니다.

```typescript
Cors.create({ allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'] });
```

> **⚠️ Authorization 주의** — Fetch Standard에 따라, 와일드카드 `'*'`만으로는 `Authorization` 헤더가 허용되지 않습니다. 반드시 명시적으로 추가해야 합니다.
>
> ```typescript
> Cors.create({ allowedHeaders: ['*', 'Authorization'] });
> ```

### `exposedHeaders`

브라우저 JavaScript에서 접근 가능하게 노출할 응답 헤더 목록.

```typescript
Cors.create({ exposedHeaders: ['X-Request-Id', 'X-Rate-Limit-Remaining'] });
```

> `credentials: true` 환경에서 와일드카드 `'*'`를 사용하면 `Access-Control-Expose-Headers` 헤더 자체가 설정되지 않습니다.

### `credentials`

`Access-Control-Allow-Credentials: true` 헤더 포함 여부.

```typescript
Cors.create({ origin: 'https://app.example.com', credentials: true });
```

### `maxAge`

프리플라이트 결과를 브라우저가 캐시할 시간(초).

```typescript
Cors.create({ maxAge: 86400 }); // 24시간
```

### `preflightContinue`

`true`로 설정하면 프리플라이트를 자동 처리하지 않고, `CorsAction.Continue`를 반환하여 다음 핸들러에게 위임합니다.

### `optionsSuccessStatus`

프리플라이트 응답의 HTTP 상태 코드. 기본값 `204`. 일부 레거시 브라우저 호환이 필요하면 `200`으로 설정합니다.

### `allowPrivateNetwork`

`true`이면 `Access-Control-Request-Private-Network: true`를 담은 프리플라이트에 `Access-Control-Allow-Private-Network: true`를 응답해 사설망 접근을 허가합니다. 기본값 `false`. WICG [Private Network Access](https://wicg.github.io/private-network-access/) 초안 기반(비표준, Fetch Standard 미병합).

<br>

## 📤 반환 타입

`handle()`은 `Promise<CorsResult>`를 반환합니다. `CorsResult`는 세 가지 인터페이스의 판별 유니온입니다.

#### `CorsContinueResult`

```typescript
{ action: CorsAction.Continue; headers: Headers }
```

일반 요청(비-OPTIONS) 또는 `preflightContinue: true`인 프리플라이트에서 반환됩니다. `headers`를 응답에 직접 병합하세요.

#### `CorsPreflightResult`

```typescript
{ action: CorsAction.RespondPreflight; headers: Headers; statusCode: number }
```

`OPTIONS` + `Access-Control-Request-Method`가 포함된 프리플라이트에서 반환됩니다. `headers`와 `statusCode`를 사용하여 응답을 직접 구성합니다.

#### `CorsRejectResult`

```typescript
{ action: CorsAction.Reject; reason: CorsRejectionReason }
```

CORS 검증 실패 시 반환됩니다. `reason`으로 상세한 에러 응답을 구성할 수 있습니다.

| `CorsRejectionReason` | 의미 |
|:---|:---|
| `NoOrigin` | `Origin` 헤더 없음 또는 빈 문자열 |
| `OriginNotAllowed` | 출처가 허용 목록에 없음 |
| `MethodNotAllowed` | 요청 메서드가 허용 목록에 없음 |
| `HeaderNotAllowed` | 요청 헤더가 허용 목록에 없음 |

`Cors.create()`는 옵션 검증 실패 시 `CorsError`를 throw합니다:

| `CorsErrorReason` | 의미 |
|:------------------|:--------|
| `CredentialsWithWildcardOrigin` | `credentials:true` + `origin:'*'` 조합 불가 (Fetch Standard §3.3.5) |
| `CredentialsWithWildcardMethods` | `credentials:true` + `methods:['*']` 조합 불가 (와일드카드 메서드는 credential 요청에 허용되지 않음) |
| `InvalidMaxAge` | `maxAge`가 음수가 아닌 정수가 아님 (RFC 9111 §1.2.2) |
| `InvalidStatusCode` | `optionsSuccessStatus`가 2xx 정수가 아님 |
| `InvalidOrigin` | `origin`이 빈/공백 문자열, 또는 배열 내 빈/공백 요소 (RFC 6454) |
| `InvalidMethods` | `methods`가 빈 배열이거나 빈/공백 요소 포함 (RFC 9110 §5.6.2) |
| `InvalidAllowedHeaders` | `allowedHeaders`에 빈/공백 요소 포함 (RFC 9110 §5.6.2) |
| `InvalidExposedHeaders` | `exposedHeaders`에 빈/공백 요소 포함 (RFC 9110 §5.6.2) |
| `OriginFunctionError` | 런타임에 origin 함수가 예외를 오발 |

<br>

## 🔬 고급 사용법

### origin 옵션 패턴

```typescript
// 단일 출처
Cors.create({ origin: 'https://app.example.com' });

// 여러 출처 (문자열 + 정규식 혼합)
Cors.create({
  origin: [
    'https://app.example.com',
    'https://admin.example.com',
    /^https:\/\/preview-\d+\.example\.com$/,
  ],
});

// 정규식으로 서브도메인 전체 허용
Cors.create({ origin: /^https:\/\/(.+\.)?example\.com$/ });
```

### 비동기 origin 함수

데이터베이스나 외부 서비스를 통해 동적으로 출처를 검증할 수 있습니다.

```typescript
Cors.create({
  origin: async (origin, request) => {
    const tenant = request.headers.get('X-Tenant-Id');
    const allowed = await db.isOriginAllowed(tenant, origin);

    return allowed ? true : false;
    // true  → 요청 origin 그대로 반영
    // string → 지정한 문자열로 반영
    // false → 거부
  },
});
```

> origin 함수에서 예외가 발생하면 `handle()`은 `reason: CorsErrorReason.OriginFunctionError`와 함께 `CorsError`를 throw합니다.

### 와일드카드와 credentials

Fetch Standard에 따라 인증 요청(쿠키·`Authorization`)에는 와일드카드(`*`)를 사용할 수 없습니다.
`credentials: true`일 때 라이브러리가 자동으로 처리하는 항목은 다음과 같습니다.

| 옵션 | 와일드카드 시 동작 |
|:---|:---|
| `origin: '*'` | **검증 오류** — `origin: true`를 사용하여 요청 출처를 반영하세요 |
| `methods: ['*']` | **검증 오류** — 허용 메서드를 명시적으로 나열하세요 |
| `allowedHeaders: ['*']` | 요청 헤더를 그대로 반영 |
| `exposedHeaders: ['*']` | `Access-Control-Expose-Headers` 미설정 |

```typescript
// ✅ origin: true + credentials: true → 요청 origin 자동 반영
Cors.create({ origin: true, credentials: true });

// ✅ 특정 도메인 + credentials
Cors.create({ origin: 'https://app.example.com', credentials: true });

// ❌ origin: '*' + credentials: true → Cors.create()가 CorsError를 throw
Cors.create({ origin: '*', credentials: true }); // CorsErrorReason.CredentialsWithWildcardOrigin
```

> [!WARNING]
> **`origin: true` + `credentials: true`는 _아무_ 요청 출처에나 자격증명을 노출합니다.**
> 이는 스펙상 유효하며(브라우저 CORS check가 반영된 구체 origin을 허용) 여러 출처에서 자격증명 CORS를
> 지원하는 유일한 방법이지만, **모든** 웹사이트가 자격증명 요청을 보내 응답을 읽을 수 있다는 뜻입니다.
> **반드시** 1차 출처 허용목록이나 인증 게이트웨이 뒤에서만 사용하세요. 신뢰하는 출처 집합이 고정이라면
> `true` 대신 배열이나 함수를 넘기세요:
>
> ```typescript
> // ✅ 검증된 허용목록으로 자격증명 CORS 범위 제한
> Cors.create({ origin: ['https://app.example.com', 'https://admin.example.com'], credentials: true });
> Cors.create({ origin: (o) => allowlist.has(o), credentials: true });
> ```
>
> 참고: `origin: '*'` + `credentials`는 브라우저가 차단하는(작동 불가·깨진) 설정이라 **부팅 시 거부**되고,
> `origin: true` + `credentials`는 **실제로 작동하기 때문에 허용**됩니다 — 그래서 범위를 안 씌우면 위험한 건
> 오히려 이쪽입니다.
>
> **`origin: 'null'` + `credentials: true`**도 같은 주의가 필요합니다: 스펙상 유효해 허용되지만 `null`은
> sandboxed iframe·`data:`/`file:` 문서 등 opaque origin의 출처라, 그런 컨텍스트에 자격증명 응답을 공유하게
> 됩니다. 의도한 경우에만 허용하세요.

### 출처별 / 라우트별 정책 (다중 인스턴스)

요청마다 동적인 건 `origin`뿐입니다. `methods`·`allowedHeaders`·`credentials`·`maxAge` 등은
**고정 정책**으로 `Cors.create()` 시점에 한 번 검증됩니다. 라우트·테넌트·표면별로 _정책 전체_를 바꾸려면
정책마다 부팅 검증된 `Cors` 인스턴스를 만들어 상위에서 선택하세요 — 모든 인스턴스가 완전히 검증된 상태로
유지되고 요청 경로에 할당이 없습니다:

```typescript
const corsBySurface = new Map<string, Cors>([
  ['public', Cors.create({ origin: '*', methods: [HttpMethod.Get] })],
  ['app', Cors.create({ origin: 'https://app.example.com', credentials: true })],
]);

// 이 요청의 표면에 맞는 정책을 고른 뒤 평소대로 처리
const cors = corsBySurface.get(surfaceOf(request)) ?? corsBySurface.get('public')!;
const result = await cors.handle(request);
```

요청마다 옵션을 바꾸는 delegate보다 이 방식이 낫습니다 — 검증을 hot path로 옮기지 않고 fail-fast 부팅 검증을
그대로 보존합니다.

### 프리플라이트 위임

다른 미들웨어가 OPTIONS 요청을 직접 처리해야 하는 경우:

```typescript
const cors = Cors.create({ preflightContinue: true });

async function handle(request: Request): Promise<Response> {
  const result = await cors.handle(request);

  if (result.action === CorsAction.Reject) {
    return new Response('Forbidden', { status: 403 });
  }

  // Continue — 일반 요청과 프리플라이트 모두 여기로 진입
  const response = await nextHandler(request);

  for (const [key, value] of result.headers) {
    response.headers.set(key, value);
  }

  return response;
}
```

<br>

## 🔌 프레임워크 통합 예시

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { Cors, CorsAction } from '@zipbul/cors';

const cors = Cors.create({
  origin: ['https://app.example.com'],
  credentials: true,
  exposedHeaders: ['X-Request-Id'],
});

Bun.serve({
  async fetch(request) {
    const result = await cors.handle(request);

    if (result.action === CorsAction.Reject) {
      return new Response(
        JSON.stringify({ error: 'CORS policy violation', reason: result.reason }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (result.action === CorsAction.RespondPreflight) {
      return new Response(null, {
        status: result.statusCode,
        headers: result.headers,
      });
    }

    const response = await router.handle(request);

    for (const [key, value] of result.headers) {
      response.headers.set(key, value);
    }

    return response;
  },
  port: 3000,
});
```

</details>

<details>
<summary><b>범용 미들웨어 패턴 (프레임워크 무관)</b></summary>

```typescript
import { Cors, CorsAction } from '@zipbul/cors';
import type { CorsOptions } from '@zipbul/cors';

function withCors(options?: CorsOptions) {
  // 잘못된 옵션이면 CorsError를 throw
  const cors = Cors.create(options);

  return async (ctx: Context, next: () => Promise<void>) => {
    // origin 함수 실패 시 CorsError를 throw
    const result = await cors.handle(ctx.request);

    if (result.action === CorsAction.Reject) {
      ctx.status = 403;
      ctx.body = { error: 'CORS_VIOLATION', reason: result.reason };
      return;
    }

    if (result.action === CorsAction.RespondPreflight) {
      ctx.response = new Response(null, {
        status: result.statusCode,
        headers: result.headers,
      });
      return;
    }

    await next();

    for (const [key, value] of result.headers) {
      ctx.response.headers.set(key, value);
    }
  };
}
```

</details>

<details>
<summary><b>zipbul (<code>corsMiddleware</code>)</b></summary>

zipbul 앱에서는 export된 `corsMiddleware`를 사용하세요 — `Cors` 엔진을 `MiddlewareDefinition`으로 감쌉니다. 옵션은 등록 시점(`Cors.create`)에 검증되어, 잘못된 설정은 부팅 시 `CorsError`를 throw합니다. 거부된 요청에는 응답을 보내지 않고 **조용히 반환**합니다(`Access-Control-*` 헤더 미부착 → 브라우저가 교차 출처 접근을 차단, STANDARDS §9.1.4). 직접 403을 만들지 않습니다.

```typescript
import { corsMiddleware } from '@zipbul/cors';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';

httpAdapter.addMiddlewares(HttpAdapterPhase.OnRequest, [
  corsMiddleware({ origin: 'https://app.example.com', credentials: true }),
]);
```

</details>

<br>

## 📄 라이선스

MIT
