# @zipbul/query-parser

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/query-parser)](https://www.npmjs.com/package/@zipbul/query-parser)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/query-parser-coverage.json)

엄격한 보안 제어를 갖춘 고성능 RFC 3986 준수 쿼리 스트링 파서.

> Bun 전용 설계. 옵션은 [@zipbul/baker](https://www.npmjs.com/package/@zipbul/baker)로 검증됩니다.

<br>

## 📦 설치

```bash
bun add @zipbul/query-parser
```

독립 실행형 `QueryParser`는 런타임 의존성이 없습니다. **HTTP 미들웨어** 형태(`queryParser()` + `request.getQuery(dto)`)를 쓰려면 peer 의존성도 함께 설치하세요:

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

중첩 객체 파싱의 최대 깊이 (`nesting: true` 필요). 한도를 초과하면 초과된 값은 버려지고 그 자리에 빈 컨테이너가 남습니다. strict 모드도 깊이 초과로는 throw하지 **않습니다**.

```typescript
const parser = QueryParser.create({ nesting: true, depth: 2 });

parser.parse('a[b][c]=1');    // { a: { b: { c: '1' } } }
parser.parse('a[b][c][d]=1'); // 깊이 초과 — '1' 버려짐: { a: { b: { c: {} } } }
```

### `maxParams`

파싱할 키-값 쌍의 최대 개수. 초과분은 무시됩니다.

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

parser.parse('a[3]=ok');   // { a: [undefined, undefined, undefined, 'ok'] }  (희소 배열)
parser.parse('a[100]=no'); // 한도 초과 → 객체: { a: { '100': 'no' } }
```

⚠️ 객체 폴백은 컨테이너가 처음 생성될 때만 적용됩니다. 키가 이미 **배열**을 갖고 있다면, 이후의 한도 초과 인덱스는 조용히 버려집니다:

```typescript
parser.parse('a[0]=x&a[100]=no'); // { a: ['x'] } — '100' 버려짐
```

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

`+`를 공백으로 디코딩합니다 — `application/x-www-form-urlencoded`(브라우저와 `URLSearchParams`가 쿼리 스트링을 다루는 방식)와 동일. 기본은 비활성이며 [RFC 3986 준수](#-rfc-3986-준수) 참고.

```typescript
QueryParser.create({ urlEncoded: true }).parse('q=hello+world');
// { q: 'hello world' }

QueryParser.create().parse('q=hello+world'); // 기본값 — '+'는 리터럴
// { q: 'hello+world' }
```

`+`→공백 변환과 퍼센트 디코딩은 독립적이라, 잘못된 이스케이프가 있어도 공백 변환은 유지됩니다: `parse('q=a+b%ZZ')` → `{ q: 'a b%ZZ' }`.

<br>

## 🚨 에러 처리

`QueryParser.create()`는 잘못된 옵션에서 throw합니다. `parse()`는 strict 모드에서 throw합니다.

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

| Reason | 발생 위치 | 설명 |
|:-------|:---------|:-----|
| `InvalidDepth` | `create()` | `depth`가 0 이상의 정수가 아님 |
| `InvalidMaxParams` | `create()` | `maxParams`가 양의 정수가 아님 |
| `InvalidArrayLimit` | `create()` | `arrayLimit`가 0 이상의 정수가 아님 |
| `InvalidDuplicates` | `create()` | `duplicates`가 `'first'`, `'last'`, `'array'` 중 하나가 아님 |
| `InvalidNesting` | `create()` | `nesting`이 불리언이 아님 |
| `InvalidStrict` | `create()` | `strict`가 불리언이 아님 |
| `InvalidUrlEncoded` | `create()` | `urlEncoded`가 불리언이 아님 |
| `MalformedQueryString` | `parse()` | 잘못된 문법 (strict 모드 전용) |
| `ConflictingStructure` | `parse()` | 키가 스칼라와 중첩 구조로 동시 사용됨 (strict 모드 전용) |

<br>

## 📐 RFC 3986 준수

이 파서는 [RFC 3986](https://datatracker.ietf.org/doc/html/rfc3986) 시맨틱을 따릅니다:

- **`+`는 기본적으로 리터럴** — 공백으로 디코딩하지 않습니다. ⚠️ `+`→공백으로 디코딩하는 브라우저·`URLSearchParams`·`qs`와 다릅니다. form-urlencoded 쿼리 스트링은 [`urlEncoded: true`](#urlencoded)를 사용하세요. 명확한 공백은 `%20`을 쓰세요.
- **퍼센트 디코딩** — `%HH` 시퀀스를 `decodeURIComponent`로 디코딩합니다. 잘못된 시퀀스는 non-strict 모드에서 원본 문자열로 폴백됩니다.
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

- `depth`로 중첩 객체 재귀 깊이 제한
- `maxParams`로 파싱 쌍 수 제한
- `arrayLimit`로 배열 인덱스 할당 제한

<br>

## ⚡ 성능

[mitata](https://github.com/evanwashere/mitata)로 Bun에서 벤치마크.

### vs 경쟁 라이브러리 (flat key-value)

| 입력 | @zipbul/query-parser | node:querystring | URLSearchParams | qs |
|:-----|---------------------:|-----------------:|----------------:|---:|
| flat 10 params | 423 ns | 368 ns | 2.62 us | 4.65 us |
| flat 50 params | 4.81 us | 4.36 us | 12.58 us | 19.40 us |
| encoded 5 params | **955 ns** | 1.24 us | 1.60 us | 2.24 us |

### vs qs (nested/array)

| 입력 | @zipbul/query-parser | qs | 속도 차이 |
|:-----|---------------------:|---:|----------:|
| nested depth 3 | 162 ns | 1.01 us | **6.3x** |
| array x10 | 1.39 us | 7.16 us | **5.2x** |
| e-commerce payload | 1.12 us | 4.50 us | **4.0x** |

로컬에서 벤치마크 실행:

```bash
bun run bench
```

<br>

## 📄 라이선스

MIT
