# @zipbul/cors

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/cors)](https://www.npmjs.com/package/@zipbul/cors)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/cors-coverage.json)

**zipbul** 프레임워크용 CORS 미들웨어.
HTTP 어댑터의 `OnRequest` phase에 등록하면 모든 요청에 대해 Fetch CORS 프로토콜을 평가합니다 — 프리플라이트 응답, 자격증명 grant, `Vary` 캐시 정합, Private Network Access까지.

> 내부적으로는 독립 엔진(`Cors`)이 정책을 평가해 **판별 유니온** 결과를 반환하고, `corsMiddleware`가 이를 zipbul 파이프라인에 연결합니다. 엔진은 커스텀 어댑터·테스트 등 고급 용도로 export되어 있습니다.

<br>

## 📦 설치

```bash
bun add @zipbul/cors
```

<br>

## 🚀 빠른 시작

`corsMiddleware`를 모듈에서 HTTP 어댑터의 `OnRequest` phase에 선언적으로 등록하세요. 옵션은 등록 시점(`Cors.create`)에 검증되므로 잘못된 설정은 요청마다가 아니라 **부팅 시** `CorsError`를 throw합니다.

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

요청별 동작:

- **프리플라이트** (`OPTIONS` + `Access-Control-Request-Method`) — **허용된** 프리플라이트는 협상된 `Access-Control-*` 헤더와 설정된 성공 상태(기본 `204`)로 직접 응답하고, `preflightContinue: true`면 다음 핸들러로 위임합니다.
- **일반 요청** — 해당하는 CORS 헤더를 응답에 부착하고 라우트를 계속 실행합니다: grant 시 `Access-Control-Allow-Origin`은 항상, `-Allow-Credentials`는 `credentials: true`일 때만, `-Expose-Headers`는 설정했을 때만, `Vary: Origin`은 allow-origin 판정이 요청 origin에 따라 달라질 때만.
- **거부된 요청** — grant를 부착하지 않고(브라우저가 교차 출처 접근 차단) 요청은 그대로 진행시키며 직접 403을 만들지 않습니다. 정책이 origin에 따라 달라지는 경우(정적 `'*'`/`false` 외 전부)에는 `Vary: Origin`을 STANDARDS §7.1에 따라 여전히 기록합니다.

> ⚠️ 반드시 `OnRequest`에 등록하세요. 라우트 해석 이전에 실행되는 유일한 phase이고(라우트 없는 경로의 프리플라이트도 응답해야 하므로), `ParseBody` 이후 phase에서는 body 파서가 원시 요청을 소비해 미들웨어가 요청을 볼 수 없습니다.

<br>

## 💡 핵심 개념

미들웨어는 독립 엔진을 감쌉니다: `Cors.handle()`은 응답을 만들지 않고 **다음에 무엇을 해야 하는지**를 판별 유니온으로 반환하며, `corsMiddleware`가 이를 zipbul 파이프라인에 매핑합니다.

```
CorsResult
├── Continue          → CORS 헤더를 응답에 추가한 뒤 계속 처리
├── RespondPreflight  → 프리플라이트 전용 응답을 즉시 반환
└── Reject            → grant 미부착 (사유 + 캐시 정합 헤더 포함)
```

엔진은 커스텀 어댑터·테스트 등 고급 용도로 export되어 있습니다. [엔진 사용법](#-엔진-사용법-고급) 참고.

<br>

## ⚙️ 옵션

```typescript
interface CorsOptions {
  origin?: OriginOptions;              // 기본값: '*'
  methods?: Array<HttpMethod | '*'>;   // 기본값: GET, HEAD, PUT, PATCH, POST, DELETE
  allowedHeaders?: string[] | null;    // 기본값: null (요청의 ACRH 반영)
  exposedHeaders?: string[] | null;    // 기본값: null (헤더 미포함)
  credentials?: boolean;               // 기본값: false
  maxAge?: number | null;              // 기본값: null (헤더 미포함)
  preflightContinue?: boolean;         // 기본값: false
  optionsSuccessStatus?: HttpStatus;   // 기본값: 204 (실존 2xx HttpStatus만)
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
| `(origin, request) => boolean \| string \| Promise<boolean \| string>` | 함수 (동기·비동기) |

> `credentials: true`일 때 `origin: '*'`는 **검증 오류**를 발생시킵니다. 요청 출처를 반영하려면 `origin: true`를 사용하세요.
>
> `g`·`y` 플래그가 붙은 RegExp은 **부팅 시 거부**됩니다(`InvalidOrigin`) — 이 플래그들은 `test()` 간에 `lastIndex`를 변경해 공유 matcher가 요청마다 다른 결과를 내기 때문입니다. stateless 플래그(`i`·`m`·`s`·`u`·`d`)를 사용하세요.
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

> CORS-safelisted 메서드 `GET`·`HEAD`·`POST`는 목록에 없어도 프리플라이트 메서드 검사를 **항상 통과**합니다 — 브라우저가 어차피 통과시키므로 여기서 거부하면 UA와 모순될 뿐입니다(STANDARDS §3.3).

### `allowedHeaders`

프리플라이트에서 허용할 요청 헤더 목록. 미설정 시 클라이언트가 요청한 헤더 이름들을 반영하되, 원문 문자열이 아니라 정규화된 comma 목록으로 재직렬화합니다(공백·빈 list 원소 제거 — RFC 9110 §5.6.1.1 송신자 규칙).

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

> `credentials: true` 환경에서 `'*'` 항목은 제거됩니다(브라우저가 credentials 하에서 리터럴 이름으로 취급하므로): `['*']`만 넘기면 헤더 자체가 설정되지 않고, `['*', 'X-Foo']`처럼 명시 항목이 함께 있으면 그 항목들은 그대로 방출됩니다.

### `credentials`

`Access-Control-Allow-Credentials: true` 헤더 포함 여부.

```typescript
Cors.create({ origin: 'https://app.example.com', credentials: true });
```

### `maxAge`

프리플라이트 결과를 브라우저가 캐시할 시간(초). 10²¹ 미만의 음수가 아닌 정수여야 합니다(RFC 9111 `delta-seconds`).

```typescript
Cors.create({ maxAge: 86400 }); // 24시간
```

### `preflightContinue`

`true`로 설정하면 **허용된** 프리플라이트를 자동 응답하지 않고, 협상된 헤더를 실은 `CorsAction.Continue`를 반환하여 다음 핸들러에게 위임합니다. 검증에 실패한 프리플라이트는 여전히 `Reject`를 반환합니다.

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

비-프리플라이트 요청 전부에서 반환됩니다 — `Access-Control-Request-Method` **없는** `OPTIONS`(실제 동사로 쓰인 OPTIONS)와 정적 와일드카드의 무-Origin 요청 포함 — 그리고 `preflightContinue: true`일 때 허용된 프리플라이트에서도. `headers`를 응답에 직접 병합하세요.

#### `CorsPreflightResult`

```typescript
{ action: CorsAction.RespondPreflight; headers: Headers; statusCode: HttpStatus }
```

`OPTIONS` + `Access-Control-Request-Method`가 포함된 프리플라이트에서 반환됩니다. `headers`와 `statusCode`를 사용하여 응답을 직접 구성합니다.

#### `CorsRejectResult`

```typescript
{ action: CorsAction.Reject; reason: CorsRejectionReason; headers: Headers }
```

CORS 검증 실패 시 반환됩니다. `reason`으로 상세한 에러 응답을 구성하고, **`headers`는 어떤 응답을 보내든 반드시 병합하세요** — 캐시 정합 헤더(대표적으로, allow-origin 판정이 요청 origin에 따라 달라질 때의 `Vary: Origin` — Fetch의 CORS-and-HTTP-caches 지침)를 담고 있습니다. 없으면 공유 캐시가 grant 없는 응답을 저장해 허용된 origin에 재사용할 수 있습니다.

| `CorsRejectionReason` | 의미 |
|:---|:---|
| `NoOrigin` | `Origin` 헤더 없음 또는 빈 문자열 |
| `OriginNotAllowed` | 출처가 허용 목록에 없음 |
| `MethodNotAllowed` | 프리플라이트의 `Access-Control-Request-Method`가 정책상 불허 (CORS-safelisted `GET`·`HEAD`·`POST`는 항상 통과) |
| `HeaderNotAllowed` | 프리플라이트의 `Access-Control-Request-Headers` 항목이 정책상 불허 |

> 예외: 정적 와일드카드(`origin: '*'`)에서는 `Origin` 헤더가 **없는** 요청을 거부하지 않습니다 — `Access-Control-Allow-Origin: *`를 실은 `Continue`를 반환합니다. Fetch의 캐시 지침이 정적 와일드카드를 비-CORS 응답을 포함한 모든 응답에 싣도록 요구하기 때문입니다(STANDARDS §7.2).

`Cors.create()`는 옵션 부팅 검증 실패 시 `CorsError`를 throw합니다. 두 reason은 `handle()` 런타임에 발생합니다: `OriginFunctionError`, 그리고 origin **함수**가 `credentials: true` 하에서 `'*'`를 반환한 경우의 `CredentialsWithWildcardOrigin`.

| `CorsErrorReason` | 의미 |
|:------------------|:--------|
| `CredentialsWithWildcardOrigin` | 부팅 시 `credentials:true` + `origin:'*'`, 또는 런타임에 origin 함수가 `'*'` 반환 (Fetch Standard §3.3.5) |
| `CredentialsWithWildcardMethods` | `credentials:true` + `methods:['*']` 조합 불가 (Fetch Standard §3.2.6) |
| `InvalidMaxAge` | `maxAge`가 10²¹ 미만의 음수가 아닌 정수가 아님 (RFC 9111 `delta-seconds`) |
| `InvalidStatusCode` | `optionsSuccessStatus`가 실존하는 2xx `HttpStatus` 멤버가 아님 (예: `299`는 throw) |
| `InvalidOrigin` | `origin`이 boolean, 직렬화된 origin 문자열(`'*'`·`'null'` 허용), stateless RegExp(`g`·`y` 플래그 불가), 그 배열, 함수 중 어느 것도 아님 |
| `InvalidMethods` | `methods`가 빈 배열이거나, `HttpMethod` 멤버도 `'*'`도 아닌 요소 포함 |
| `InvalidAllowedHeaders` | `allowedHeaders`에 유효한 HTTP token이 아닌 요소 포함 (RFC 9110 §5.6.2) |
| `InvalidExposedHeaders` | `exposedHeaders`에 유효한 HTTP token이 아닌 요소 포함 (RFC 9110 §5.6.2) |
| `InvalidCredentials` | `credentials`가 boolean이 아님 |
| `InvalidPreflightContinue` | `preflightContinue`가 boolean이 아님 |
| `InvalidAllowPrivateNetwork` | `allowPrivateNetwork`가 boolean이 아님 |
| `OriginFunctionError` | 런타임에 origin 함수가 예외를 던짐 (`handle()`) |

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
    // string → 지정한 문자열로 반영 (serialized origin·'null'·'*'만 유효)
    // false → 거부
  },
});
```

> 함수가 반환한 문자열은 설정 origin과 동일한 기준으로 검증됩니다: 자기 자신의 URL origin 직렬화(trailing slash·path·기본 포트 명시 불가)이거나 리터럴 `'null'`/`'*'`여야 합니다. 그 외 값은 방출되지 않고 **불허**로 처리됩니다 — 어차피 브라우저의 byte 대조에서 실패할 값이기 때문입니다.
>
> 예외: `credentials: true` 상태에서 `'*'`를 반환하면 `handle()`이 `CorsError`(`CredentialsWithWildcardOrigin`)를 **throw**합니다 — 정적 설정에서 부팅 시 거부되는 것과 같은 조합입니다.

> origin 함수에서 예외가 발생하면 `handle()`은 `reason: CorsErrorReason.OriginFunctionError`와 함께 `CorsError`를 throw합니다.

### 와일드카드와 credentials

Fetch Standard에 따라 인증 요청(쿠키·`Authorization`)에는 와일드카드(`*`)를 사용할 수 없습니다.
`credentials: true`일 때 라이브러리가 자동으로 처리하는 항목은 다음과 같습니다.

| 옵션 | 와일드카드 시 동작 |
|:---|:---|
| `origin: '*'` | **검증 오류** — `origin: true`를 사용하여 요청 출처를 반영하세요 |
| `methods: ['*']` | **검증 오류** — 허용 메서드를 명시적으로 나열하세요 |
| `allowedHeaders: ['*']` | 요청된 헤더 이름들을 반영 (리터럴 `*`는 절대 방출 안 함; `Authorization`은 여전히 명시 필요) |
| `exposedHeaders: ['*']` | `['*']`만이면 헤더 미방출; `'*'` 옆의 명시 항목은 그대로 방출 |

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
유지되고 옵션 재검증·재구성이 요청 경로에서 사라집니다:

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
const cors = Cors.create({ origin: 'https://app.example.com', preflightContinue: true });

async function handle(request: Request): Promise<Response> {
  const result = await cors.handle(request);

  if (result.action === CorsAction.Reject) {
    // 위 origin은 요청에 따라 달라지므로 result.headers에 Vary: Origin이 실림 —
    // 병합해서 403에도 캐시 정합 유지
    return new Response('Forbidden', { status: 403, headers: result.headers });
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

## 🔬 엔진 사용법 (고급)

zipbul 앱은 `corsMiddleware`로 충분합니다. 하부 엔진 `Cors`는 미들웨어가 닿지 않는 경우 — 커스텀 어댑터, 직접 테스트 — 를 위해 export되어 있습니다. 표준 `Request`를 받아 `CorsResult`를 반환하며, 그것을 전송 계층에 옮기는 건 호출자의 몫입니다:

```typescript
import { Cors, CorsAction } from '@zipbul/cors';

const cors = Cors.create({ origin: 'https://my-app.example.com', credentials: true });

async function handleRequest(request: Request): Promise<Response> {
  const result = await cors.handle(request); // origin 함수 실패 시 CorsError throw

  if (result.action === CorsAction.Reject) {
    // result.headers에 Vary: Origin이 실려 있음 — 403에도 캐시 정합 유지
    return new Response('Forbidden', { status: 403, headers: result.headers });
  }

  if (result.action === CorsAction.RespondPreflight) {
    return new Response(null, { status: result.statusCode, headers: result.headers });
  }

  // CorsAction.Continue — result.headers를 응답에 병합
  const response = await next(request);
  for (const [key, value] of result.headers) {
    response.headers.set(key, value);
  }
  return response;
}
```

<br>

## 📄 라이선스

MIT
