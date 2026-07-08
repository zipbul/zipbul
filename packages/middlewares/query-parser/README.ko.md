# @zipbul/query-parser

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/query-parser)](https://www.npmjs.com/package/@zipbul/query-parser)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/query-parser-coverage.json)

Bun을 위한 빠르고 보안에 강한 쿼리 스트링 파서: 프로토타입 오염에 안전하고, WHATWG `x-www-form-urlencoded`에 정렬되며, 중첩/배열 입력에서 `qs`보다 수 배 빠릅니다.

> Bun 전용 설계. 옵션은 [@zipbul/baker](https://www.npmjs.com/package/@zipbul/baker)로 검증됩니다.

<br>

## 📦 설치

```bash
bun add @zipbul/query-parser
```

`@zipbul/query-parser`는 zipbul 프레임워크 미들웨어라, zipbul 앱에서는 의존성이 이미 갖춰져 있습니다. **HTTP 미들웨어** 형태(`queryParser()` + `request.getQuery(dto)`)는 다음 프레임워크 peer 의존성을 필요로 합니다:

```bash
bun add @zipbul/common @zipbul/http-adapter
```

<br>

## 🚀 빠른 시작

```typescript
import { QueryParser } from '@zipbul/query-parser';

const parser = QueryParser.create();

parser.parse('name=hello&city=seoul');
// { name: 'hello', city: 'seoul' }

parser.parse('q=hello%20world&lang=ko');
// { q: 'hello world', lang: 'ko' }
```

<br>

## 🧩 HTTP 미들웨어

이 패키지는 zipbul HTTP 미들웨어 팩토리 `queryParser(options?)`도 함께 제공합니다. 호출할 때마다 독립적인 미들웨어 인스턴스가 생성되므로, 등록 지점마다 서로 다른 옵션을 사용할 수 있습니다. 옵션은 부트 시점에 검증됩니다 — 잘못된 옵션이면 앱이 서비스를 시작하기 전에 `queryParser()`가 즉시 `QueryParserError`를 throw합니다.

검증(Validation) **이전** 단계(일반적으로 `HttpAdapterPhase.BeforeValidate`)에 등록하세요:

```typescript
import { queryParser } from '@zipbul/query-parser';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';

// 어댑터 설정에서:
middlewares: {
  [HttpAdapterPhase.BeforeValidate]: [queryParser({ nesting: true })],
}
```

이 미들웨어는 `augments` 슬롯을 통해 타입이 지정된 `request.getQuery(dto)` 컨텍스트 접근자를 선언합니다. 미들웨어는 파싱된 원시 쿼리를 **공급**하기만 하고, 프레임워크가 핸들러의 `getQuery(SomeDto)` 호출 지점으로부터 [@zipbul/baker](https://www.npmjs.com/package/@zipbul/baker) DTO 검증을 연결합니다. 설치된 접근자는 검증된 인스턴스를 반환합니다 — `getBody`/`getParams`와 정확히 동일한 방식입니다:

```typescript
@Get()
search(ctx: HttpContext) {
  const query = ctx.request.getQuery(SearchQueryDto); // 타입 지정 + 검증 완료
}
```

`zb build middleware`가 접근자 선언을 `dist/context-augments.d.ts`(소비자 타입)와 `dist/context-augments.json`(앱 AOT 매니페스트)으로 추출합니다.

### 잘못된 쿼리 → 400 (500 아님)

미들웨어에서 잘못된 쿼리 스트링은 **클라이언트** 오류입니다. `strict`가 켜져 있으면 공급 단계가 `httpError(BadRequest)`를 반환하고, 프레임워크가 파이프라인을 **400** 응답으로 즉시 단락(short-circuit)시키며 핸들러는 실행되지 않습니다. throw가 아니므로 악의적인 `?q=%ZZ`가 500으로 바뀔 수 없습니다:

```typescript
middlewares: {
  [HttpAdapterPhase.BeforeValidate]: [queryParser({ strict: true, nesting: true })],
}
// GET /search?q=%ZZ        → 400 Bad Request  (잘못된 퍼센트 이스케이프)
// GET /search?a[b]c[d]=1   → 400 Bad Request  (잘못된 브래킷, nesting 필요)
// GET /search?q=hello      → 핸들러 정상 실행
```

기본값(`strict: false`)에서는 잘못된 쿼리도 관대하게 파싱되며 요청을 실패시키지 않습니다.

<br>

## ⚙️ 옵션

```typescript
interface QueryParserOptions {
  depth?: number;           // 기본값: 5
  maxParams?: number;       // 기본값: 1000
  nesting?: boolean;        // 기본값: false
  arrayLimit?: number;      // 기본값: 20
  duplicates?: 'first' | 'last' | 'array';  // 기본값: 'first'
  strict?: boolean;         // 기본값: false
  urlEncoded?: boolean;     // 기본값: false
}
```

### `depth`

중첩 객체 파싱의 최대 깊이 (`nesting: true` 필요). 한도를 초과하면 더 이상 중첩하지 않고 **값을 허용된 가장 깊은 레벨에 리프로 보존**합니다 — 값을 버리지 않으며, 빈 플레이스홀더 객체도 남기지 않습니다. 이는 리소스 제한이며 strict 오류가 아니므로 깊이 초과로는 throw하지 **않습니다**.

```typescript
const parser = QueryParser.create({ nesting: true, depth: 2 });

parser.parse('a[b][c]=1');    // { a: { b: { c: '1' } } }
parser.parse('a[b][c][d]=1'); // 깊이 초과 — 값은 c에 리프로 보존: { a: { b: { c: '1' } } }
```

### `maxParams`

파싱할 키-값 쌍의 최대 개수. 초과분은 조용히 버려집니다. 빈 `&` 구분자는 쌍을 만들지 않으므로 이 한도에 포함되지 않습니다.

```typescript
const parser = QueryParser.create({ maxParams: 2 });

parser.parse('a=1&b=2&c=3'); // { a: '1', b: '2' }
```

### `nesting`

브래킷 기반 배열 및 중첩 객체 문법을 활성화합니다.

```typescript
const parser = QueryParser.create({ nesting: true });

parser.parse('tags[]=a&tags[]=b');
// { tags: ['a', 'b'] }

parser.parse('items[0][name]=x&items[1][name]=y');
// { items: [{ name: 'x' }, { name: 'y' }] }

parser.parse('filter[status]=active&filter[role]=admin');
// { filter: { status: 'active', role: 'admin' } }
```

`false`(기본값)이면 브래킷은 키 이름의 리터럴 문자로 처리됩니다.

> **디코딩 후 파싱:** 키는 브래킷 감지 **이전에** 퍼센트 디코딩이 완전히 수행되므로, `nesting: true`에서는 인코딩된 브래킷(`%5B`/`%5D`)도 구조적으로 동작합니다 — `a%5Bb%5D=c`는 `a[b]=c`와 동일하게 파싱됩니다(`qs`와 동일). nesting이 활성화된 상태에서 리터럴 `[` 또는 `]`를 키 이름에 넣을 방법은 없습니다.

### `arrayLimit`

`nesting` 활성화 시 허용되는 최대 배열 인덱스. **컨테이너 생성 시점**에는 한도를 초과하는 인덱스도 값을 버리지 않고, 컨테이너가 인덱스 문자열을 키로 갖는 일반 객체로 폴백됩니다.

```typescript
const parser = QueryParser.create({ nesting: true, arrayLimit: 5 });

parser.parse('a[3]=ok');   // { a: [ <빈 항목 3개>, 'ok' ] }  (희소 배열)
parser.parse('a[100]=no'); // 한도 초과 → 객체: { a: { '100': 'no' } }
```

⚠️ 희소 배열의 빈 자리는 홀(hole)로 유지됩니다. `JSON.stringify`는 홀을 `null`로 직렬화하므로 `a[3]=ok`는 `{"a":[null,null,null,"ok"]}`가 됩니다. DTO 계층이 `null` 요소를 거부한다면 명시적 인덱스를 쓰거나 `arrayLimit`을 낮추세요.

⚠️ 객체 폴백은 컨테이너가 처음 생성될 때만 적용됩니다. 키가 이미 **배열**을 갖고 있다면, 이후의 한도 초과 인덱스는 조용히 버려집니다:

```typescript
parser.parse('a[0]=x&a[100]=no'); // { a: ['x'] } — '100' 버려짐
```

⚠️ `arrayLimit`은 리소스 한계이기도 합니다: 한도 내 인덱스는 그 인덱스까지 희소 배열을 할당하므로, 기본값보다 크게 올리면 작은 입력으로 거대한 배열을 할당할 수 있습니다(`arrayLimit: 1_000_000` + `a[999999]=x`). 신뢰할 수 없는 입력에는 작게 유지하세요. (인덱스는 최대 10자리까지 허용되며, JS 실제 최대 배열 인덱스 2³²−2를 넘는 값은 배열 요소가 아니라 문자열 키 속성으로 보관됩니다.)

### `duplicates`

중복 키 처리 전략 (HTTP Parameter Pollution 방어).

| 값 | 동작 |
|:---|:-----|
| `'first'` _(기본)_ | 첫 번째 값 유지 — HPP 공격에 가장 안전 |
| `'last'` | 마지막 값 유지 |
| `'array'` | 모든 값을 배열로 수집 |

```typescript
// 입력: 'role=admin&role=user'

QueryParser.create({ duplicates: 'first' }).parse(input);
// { role: 'admin' }

QueryParser.create({ duplicates: 'last' }).parse(input);
// { role: 'user' }

QueryParser.create({ duplicates: 'array' }).parse(input);
// { role: ['admin', 'user'] }
```

### `strict`

활성화 시 `parse()`가 오류를 무시하는 대신 `QueryParserError`를 throw합니다:

- 잘못된 퍼센트 인코딩 (`%zz`, 불완전한 `%E0%A4`)
- 불균형·중첩·미닫힘 브래킷 (`a]b[c]=1`, `a[[b]]=1`, `a[b=1`) 및 브래킷 그룹 사이의 잉여 문자 (`a[b]junk[c]=1`)
- 충돌하는 키 구조 (`a=1&a[b]=2`) — 구조 충돌 감지에는 `nesting: true`가 필요합니다. nesting이 꺼져 있으면 브래킷 키는 리터럴이라 충돌이 발생하지 않습니다

```typescript
const parser = QueryParser.create({ strict: true, nesting: true });

parser.parse('valid=ok');           // { valid: 'ok' }
parser.parse('bad=%zz');            // QueryParserError throw
parser.parse('a=1&a[b]=2');        // QueryParserError throw (구조 충돌)
```

### `urlEncoded`

`+`를 공백으로 디코딩합니다 — `application/x-www-form-urlencoded`(브라우저와 `URLSearchParams`가 쿼리 스트링을 다루는 방식)와 동일. 기본은 비활성이며 [인코딩 & 스펙 정렬](#-인코딩--스펙-정렬) 참고.

```typescript
QueryParser.create({ urlEncoded: true }).parse('q=hello+world');
// { q: 'hello world' }

QueryParser.create().parse('q=hello+world'); // 기본값 — '+'는 리터럴
// { q: 'hello+world' }
```

`+`→공백 변환과 퍼센트 디코딩은 독립적이라, 잘못된 이스케이프가 있어도 공백 변환은 유지됩니다: `parse('q=a+b%ZZ')` → `{ q: 'a b%ZZ' }`.

<br>

## 🚨 에러 처리

`QueryParser.create()`는 잘못된 옵션에서 `QueryParserError`를 throw합니다. `parse()`는 strict 모드의 잘못된 쿼리에서 throw하며, `parseResult()`는 같은 이유를 throw 대신 `Err`로 반환합니다(미들웨어는 이를 **400**으로 매핑).

```typescript
import { QueryParser, QueryParserError, QueryParserErrorReason } from '@zipbul/query-parser';

try {
  const parser = QueryParser.create({ depth: -1 });
} catch (e) {
  if (e instanceof QueryParserError) {
    e.reason;  // QueryParserErrorReason.InvalidDepth
    e.message; // "depth: min"
  }
}
```

### `parseResult()` — throw하지 않는 변형

`parse()`는 strict 모드에서 throw하지만, `parseResult()`는 대신 `Result`를 반환하므로 `try`/`catch` 없이 잘못된 쿼리를 분기 처리할 수 있습니다. (HTTP 미들웨어가 잘못된 쿼리를 400으로 매핑할 때 쓰는 방식입니다.)

```typescript
import { QueryParser, isErr } from '@zipbul/query-parser';

const parser = QueryParser.create({ strict: true });
const result = parser.parseResult('q=%ZZ');

if (isErr(result)) {
  result.data.reason;   // QueryParserErrorReason.MalformedQueryString
  result.data.message;  // 사람이 읽을 수 있는 상세 메시지
} else {
  result;               // 파싱된 쿼리 레코드
}
```

### `QueryParserErrorReason`

| Reason | 노출 위치 | 설명 |
|:-------|:---------|:-----|
| `InvalidDepth` | `create()` | `depth`가 0 이상의 정수가 아님 |
| `InvalidMaxParams` | `create()` | `maxParams`가 양의 정수가 아님 |
| `InvalidNesting` | `create()` | `nesting`이 불리언이 아님 |
| `InvalidArrayLimit` | `create()` | `arrayLimit`가 0 이상의 정수가 아님 |
| `InvalidDuplicates` | `create()` | `duplicates`가 `'first'`, `'last'`, `'array'` 중 하나가 아님 |
| `InvalidStrict` | `create()` | `strict`가 불리언이 아님 |
| `InvalidUrlEncoded` | `create()` | `urlEncoded`가 불리언이 아님 |
| `MalformedQueryString` | `parse()` throw / `parseResult()` → `Err` → 400 | 잘못된 문법 (strict 모드 전용) |
| `ConflictingStructure` | `parse()` throw / `parseResult()` → `Err` → 400 | 키가 스칼라와 중첩 구조로 동시 사용됨 (strict 모드 전용) |

<br>

## 📐 인코딩 & 스펙 정렬

RFC 3986은 URI *문법*(쿼리에 어떤 문자가 허용되는지)을 정의하지만, 쿼리 스트링을 키/값 쌍으로 나누는 방법이나 `application/x-www-form-urlencoded` 바이트를 디코딩하는 방법은 정의하지 않습니다 — 그것은 [WHATWG url-encoded 파서](https://url.spec.whatwg.org/#application/x-www-form-urlencoded)(즉 `URLSearchParams`)의 영역입니다. 이 파서는 WHATWG 모델에 정렬되며, 몇 가지 의도적인 선택이 있습니다:

- **`+`는 기본적으로 리터럴** — 공백으로 디코딩하지 않습니다. ⚠️ `+`→공백으로 디코딩하는 브라우저·`URLSearchParams`·`qs`와 다릅니다. form-urlencoded 쿼리 스트링은 [`urlEncoded: true`](#urlencoded)를 사용하세요. 명확한 공백은 `%20`을 쓰세요.
- **퍼센트 디코딩** — `%HH` 시퀀스를 `decodeURIComponent`(UTF-8, RFC 3986 준수)로 디코딩합니다. ⚠️ `URLSearchParams`(절대 throw하지 않고 잘못된 `%ZZ`를 리터럴로 유지)와 달리, 잘못된 escape는 non-strict 모드에서 원본 문자열로 폴백되고 `strict` 모드에서는 **400**으로 거부됩니다.
- **퍼센트 인코딩된 브라켓은 구조 파싱 전에 디코딩됩니다** — `nesting: true`에서 `a%5Bb%5D=c`는 키 `a[b]`로 디코딩되어 `{ a: { b: 'c' } }`로 파싱됩니다. 키에 리터럴 `[`/`]`를 유지하려면 `nesting`을 켜지 마세요.
- **`&` 구분자만 사용** — `;`는 구분자로 인식하지 않습니다.

<br>

## 🔒 보안

### 프로토타입 오염 방지

`__proto__`가 유일하게 차단되는 키입니다 — 모든 위치(루트·중첩 세그먼트·리프)에서 차단되므로 `?__proto__[x]=1`과 `?a[__proto__][x]=1`은 무력화됩니다. `__proto__`에 대한 평범한 할당은 프로토타입 setter를 호출하므로, 절대 일반 파라미터가 될 수 없습니다.

그 외의 모든 키 — `constructor`, `prototype`, `__defineGetter__` 등 — 는 **안전한 own-property 값**입니다: 파서는 항상 own 속성만 쓰며(`hasOwnProperty`로 create-own-or-skip), 프로토타입 체인에 도달하지 않습니다. 고전적인 `?constructor[prototype][x]=y` 페이로드도 `Object.prototype`을 오염시키지 않고 평범한 own 객체를 만듭니다. 따라서 이 이름들은 조용히 버려지지 않고 일반 파라미터로 반환됩니다(`?constructor=1` → `{ constructor: '1' }`).

> **동작 변경 (이번 릴리스부터):** `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`는 이전에는 모든 위치에서 버려졌습니다. 이제는 일반 own-property 값으로 노출됩니다(`__proto__`만 차단 유지). 앱이 이 키들의 부재에 의존했다면, `parsed.constructor`가 이제 `Object`가 아니라 클라이언트가 보낸 문자열이라는 점에 유의하세요.

### HPP (HTTP Parameter Pollution) 방어

기본값 `duplicates: 'first'`는 공격자가 중복 키를 추가하여 값을 주입하는 것을 방지합니다.

### 리소스 제한

- `depth`로 중첩 제한: 한도를 넘는 키는 중첩을 멈추고 값은 허용된 가장 깊은 레벨에 리프로 보존됩니다(버려지지 않으며 빈 플레이스홀더 객체도 남지 않음)
- `maxParams`로 파싱 쌍 수 제한; 빈 `&` 구분자는 포함되지 않음
- `arrayLimit`로 배열 인덱스 할당 제한

> 참고: 이 한도들은 *출력* 구조를 제한하며, 원본 입력 길이는 제한하지 않습니다 — 하나의 매우 긴 키는 여전히 전체가 스캔됩니다. 신뢰할 수 없는 입력에는 상위 계층에서 요청 URL/본문 크기를 제한하세요.

<br>

## ⚡ 성능

솔직한 위치: **`qs`보다 몇 배 빠르고, 퍼센트 인코딩·`+` 많은(폼) 입력에서 우세하지만, 가장 빠른 파서는 _아닙니다_** — flat은 `fast-querystring`, 중첩/배열은 `picoquery`가 앞섭니다. 이는 의도된 트레이드입니다: 타입드 `Result` 에러, 정밀한 프로토타입 오염 차단, 엄격한 검증 — 순수 속도 리더들이 제공하지 않는 것들.

경쟁 비교는 동일 클래스 상대끼리만 합니다(건너뛴 작업으로 크레딧을 주지 않음). 아래 수치: Bun 1.3.14, i7-13700K — **참고용이며 머신/버전 의존적**. `bun run bench:vs`로 재현하세요(`dist/` 빌드 후 배포 아티팩트를 핀 고정된 경쟁자와 비교).

### flat 전용 파서 (중첩 없음)

| 입력 | @zipbul (`nesting:false`) | node:querystring | fast-querystring | URLSearchParams→record |
|:-----|--------------------------:|-----------------:|-----------------:|-----------------------:|
| flat 10 | 496 ns | 424 ns | **366 ns** | 2.64 µs |
| flat 50 | 5.30 µs | 4.79 µs | **3.40 µs** | 12.90 µs |
| encoded 5 | **978 ns** | 1.20 µs | 1.47 µs | 1.60 µs |

순수 flat은 `fast-querystring`이 약 1.4× 빠르고, 값이 퍼센트 인코딩되면 @zipbul이 앞섭니다.

### 풀 파서 (브라켓 지원)

| 입력 | @zipbul (`nesting:true`) | qs | picoquery |
|:-----|-------------------------:|---:|----------:|
| flat 10 | 487 ns | 4.26 µs | **387 ns** |
| nested depth 3 | 155 ns | 1.11 µs | **84 ns** |
| array ×10 | 1.36 µs | 6.60 µs | **429 ns** |
| e-commerce | 1.15 µs | 4.66 µs | **633 ns** |
| plus-heavy (폼) | **604 ns** | 1.47 µs | — |

@zipbul은 중첩/배열에서 **`qs` 대비 5–15× 빠르고** `+` 많은 폼 입력에서 가장 빠르지만, 브라켓 구조에서는 `picoquery`가 1.8–3.2× 빠릅니다. (picoquery는 중복키 처리가 다릅니다 — `bench:vs`가 출력하는 parity preview 참고.)

로컬에서 벤치마크 실행:

```bash
bun run bench:self   # @zipbul 단독 회귀 마이크로벤치 (src)
bun run bench:vs     # vs qs / node:querystring / fast-querystring / picoquery (dist)
```

<br>

## 📄 라이선스

MIT
