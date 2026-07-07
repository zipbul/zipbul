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

## 🔌 `@zipbul` 미들웨어로 사용

`queryParser`를 `HttpAdapterPhase.BeforeValidate`에 등록합니다. 요청 쿼리를 한 번
파싱하고 HTTP 요청에 타입 안전 `getQuery<T>(dto)` 접근자를 설치합니다:

```typescript
import { queryParser } from '@zipbul/query-parser';
import { defineModule } from '@zipbul/core';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';

export const appModule = defineModule({
  name: 'App',
  adapters: [
    {
      adapter: HttpAdapter,
      middlewares: {
        [HttpAdapterPhase.BeforeValidate]: [queryParser],
      },
    },
  ],
});
```

이후 핸들러나 다운스트림 미들웨어에서 파싱된 쿼리를 읽습니다:

```typescript
const query = ctx.request.getQuery(SearchQueryDto); // 타입 안전
```

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

### `arrayLimit`

`nesting` 활성화 시 허용되는 최대 배열 인덱스. 한도를 초과하는 인덱스는 값을 버리지 **않고**, 컨테이너가 인덱스 문자열을 키로 갖는 일반 객체로 폴백됩니다.

```typescript
const parser = QueryParser.create({ nesting: true, arrayLimit: 5 });

parser.parse('a[3]=ok');   // { a: [undefined, undefined, undefined, 'ok'] }  (희소 배열)
parser.parse('a[100]=no'); // 한도 초과 → 객체: { a: { '100': 'no' } }
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
- 불균형 또는 중첩 브래킷 (`a[[b]=1`, `a[b=1`)
- 충돌하는 키 구조 (`a=1&a[b]=2`)

```typescript
const parser = QueryParser.create({ strict: true });

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

다음 키들은 위치를 불문하고 모든 파싱 결과에서 차단됩니다 — 평범한 최상위 키여도 마찬가지입니다(리터럴 `?constructor=1`은 `{}`가 되므로, 이 이름들은 일반 파라미터로 쓸 수 없습니다):

`__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`

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
