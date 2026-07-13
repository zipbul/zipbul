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

미들웨어에서 구조적으로 잘못된 쿼리 스트링은 **클라이언트** 오류입니다. `strict`가 켜져 있으면 공급 단계가 `httpError(BadRequest)`를 반환하고, 프레임워크가 파이프라인을 **400** 응답으로 즉시 단락(short-circuit)시키며 핸들러는 실행되지 않습니다. throw가 아니므로 악의적인 쿼리가 500으로 바뀔 수 없습니다. strict는 **구조**(브래킷, 스칼라/구조 충돌)만 검증합니다 — 잘못된 퍼센트 이스케이프는 오류가 아니라 데이터이므로([`strict`](#strict) 참고) 400 경로를 유발하지 않습니다:

```typescript
middlewares: {
  [HttpAdapterPhase.BeforeValidate]: [queryParser({ strict: true, nesting: true })],
}
// GET /search?a[b]c[d]=1   → 400 Bad Request  (잘못된 브래킷, nesting 필요)
// GET /search?q=%ZZ        → 핸들러 정상 실행; q === '%ZZ' (잘못된 이스케이프가 보존됨, 오류 아님)
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
  allowPrototypes?: boolean; // 기본값: false
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

`nesting` 활성화 시 허용되는 최대 배열 인덱스. `[0, 10000]` 범위의 정수여야 하며, 10000을 초과하면 `create()`에서 `QueryParserErrorReason.InvalidArrayLimit`가 throw됩니다. **컨테이너 생성 시점**에는 한도를 초과하는 인덱스도 값을 버리지 않고, 컨테이너가 인덱스 문자열을 키로 갖는 일반 객체로 폴백됩니다.

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

중복 키 처리 전략 (HTTP Parameter Pollution 방어). 문자열 리터럴 또는 패키지가 export하는 `DuplicateStrategy` 문자열 enum 중 어느 쪽을 써도 동일하게 동작합니다.

| 값 | `DuplicateStrategy` 멤버 | 동작 |
|:---|:------------------------|:-----|
| `'first'` _(기본)_ | `DuplicateStrategy.First` | 첫 번째 값 유지 — HPP 공격에 가장 안전 |
| `'last'` | `DuplicateStrategy.Last` | 마지막 값 유지 |
| `'array'` | `DuplicateStrategy.Array` | 모든 값을 배열로 수집 |

```typescript
import { DuplicateStrategy, QueryParser } from '@zipbul/query-parser';

// 입력: 'role=admin&role=user'

QueryParser.create({ duplicates: 'first' }).parse(input);
// { role: 'admin' }

QueryParser.create({ duplicates: DuplicateStrategy.Last }).parse(input);
// { role: 'user' }

QueryParser.create({ duplicates: 'array' }).parse(input);
// { role: ['admin', 'user'] }
```

### `strict`

활성화 시 `parse()`는 무시하는 대신 **구조적** 문제에서 `QueryParserError`를 throw합니다. 퍼센트 인코딩 문법은 여기에 포함되지 않습니다 — strict 모드에서도 잘못된 이스케이프는 결코 오류가 아닙니다(WHATWG §2.6; [RFC 3986 준수](#-rfc-3986-준수) 참고). 잘못된 이스케이프는 리터럴로 보존되고, 무효한 UTF-8은 U+FFFD가 됩니다. strict·non-strict 모두 동일합니다:

- 불균형·중첩·미닫힘 브래킷 (`a]b[c]=1`, `a[[b]]=1`, `a[b=1`) 및 브래킷 그룹 사이의 잉여 문자 (`a[b]junk[c]=1`)
- 충돌하는 키 구조 (`a=1&a[b]=2`) — 구조 충돌 감지에는 `nesting: true`가 필요합니다. nesting이 꺼져 있으면 브래킷 키는 리터럴이라 충돌이 발생하지 않습니다

```typescript
const parser = QueryParser.create({ strict: true, nesting: true });

parser.parse('valid=ok');           // { valid: 'ok' }
parser.parse('bad=%zz');            // { bad: '%zz' } — 잘못된 이스케이프는 오류가 아니라 데이터
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

### `allowPrototypes`

기본적으로 `Object.prototype`의 own-property 이름과 일치하는 모든 키(`constructor`, `toString`, `hasOwnProperty`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__` 등)는 위치(루트·중첩 세그먼트·리프)에 관계없이 파싱 결과에서 버려집니다. `prototype`은 이 집합에 포함되지 **않습니다**(함수 객체의 own-property이지 `Object.prototype`의 이름이 아니므로) — 절대 차단되지 않습니다. `__proto__`는 이 옵션과 무관하게 **항상** 차단됩니다. 이유는 [보안 → 프로토타입 오염 방지](#프로토타입-오염-방지) 참고.

```typescript
QueryParser.create().parse('constructor=1');
// {} — 기본값에서는 버려짐

QueryParser.create({ nesting: true }).parse('a[toString]=1');
// { a: {} } — 리프에서 버려짐; "a" 컨테이너 껍데기는 남음

QueryParser.create().parse('prototype=1');
// { prototype: '1' } — Object.prototype own-name이 아니므로 절대 차단되지 않음
```

⚠️ **보안 경고:** `allowPrototypes: true`로 설정하면 `__proto__`만 차단하던 이전 정책으로 되돌아가고, 위의 다른 모든 키가 다시 일반 own-property 값으로 노출됩니다. 이는 실제 프로토타입 오염 원시성을 재활성화합니다 — `?constructor[prototype][x]=1`은 `{ constructor: { prototype: { x: '1' } } }`을 만들며, 애플리케이션 어딘가의 naive recursive merge(`merge({}, parsed)`)가 이를 그대로 `Object.prototype`까지 오염시킵니다. 메서드섀도 크래시도 재활성화됩니다(`?k[toString]=1`은 `String(parsed.k)`를 throw시킵니다). 파싱 결과를 어떻게 소비하는지 완전히 통제할 수 있을 때만 활성화하세요. `qs`의 `allowPrototypes` opt-in과 동일합니다.

```typescript
QueryParser.create({ nesting: true, allowPrototypes: true }).parse('a[toString]=1');
// { a: { toString: '1' } } — 이전 동작 복원

QueryParser.create({ allowPrototypes: true }).parse('a[__proto__][x]=1');
// { a: {} } — __proto__는 여전히 항상 차단됨
```

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

parser.parseResult('q=%ZZ');
// Ok — 잘못된 퍼센트 이스케이프는 구조 오류가 아니라 데이터입니다: { q: '%ZZ' }

const nested = QueryParser.create({ strict: true, nesting: true });
const result = nested.parseResult('a[b]c[d]=1'); // 구조 오류: 브래킷 그룹 사이의 잉여 문자

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
| `InvalidAllowPrototypes` | `create()` | `allowPrototypes`가 불리언이 아님 |
| `MalformedQueryString` | `parse()` | 잘못된 브래킷/구조 문법 (strict 모드 전용) — 퍼센트 인코딩은 해당 없음 |
| `ConflictingStructure` | `parse()` | 키가 스칼라와 중첩 구조로 동시 사용됨 (strict 모드 전용) |

<br>

## 📐 RFC 3986 준수

이 파서는 [RFC 3986](https://datatracker.ietf.org/doc/html/rfc3986) 시맨틱을 따릅니다:

- **`+`는 기본적으로 리터럴** — 공백으로 디코딩하지 않습니다. ⚠️ `+`→공백으로 디코딩하는 브라우저·`URLSearchParams`·`qs`와 다릅니다. form-urlencoded 쿼리 스트링은 [`urlEncoded: true`](#urlencoded)를 사용하세요. 명확한 공백은 `%20`을 쓰세요.
- **퍼센트 디코딩은 WHATWG 준수이며, 단순 `decodeURIComponent`가 아닙니다** — 순수 ASCII 고속 경로는 유효한 값과 잘못된 값 모두 `%HH`를 `decodeURIComponent`의 throw 비용 없이 디코딩합니다. 멀티바이트 입력은 유효한 UTF-8이면 네이티브 `decodeURIComponent`를 사용하고, 그렇지 않으면 바이트 단위 디코더로 폴백합니다. 16진수는 대소문자를 구분하지 않습니다(`%3A` ≡ `%3a`). 잘못된 `%`(뒤에 16진수 2자리가 오지 않음)는 결코 오류가 아니며 리터럴 문자로 보존되고 디코딩이 계속됩니다(`%ZZ%41` → `%ZZA`). 무효한 UTF-8 바이트 시퀀스는 throw 대신 U+FFFD(대체 문자)로 디코딩됩니다. 선행 BOM은 제거되지 않고 보존됩니다. strict 모드에서도 동일합니다 — strict는 구조를 검증하며 퍼센트 문법은 검증하지 않습니다. WHATWG 인용 전문은 [STANDARDS.md](./STANDARDS.md) §2.5–§2.7을 참고하세요.
- **`&` 구분자만 사용** — `;`는 구분자로 인식하지 않습니다.

<br>

## 🔒 보안

### 프로토타입 오염 방지

기본값(`allowPrototypes: false`)에서는 `Object.prototype`의 own-property 이름과 일치하는 모든 키 — `constructor`, `toString`, `hasOwnProperty`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__` 등 — 가 모든 위치(루트·중첩 세그먼트·리프)에서 파싱 결과에서 버려지므로, `?constructor=1`, `?a[toString]=1`, 그리고 고전적인 `?constructor[prototype][x]=1` 체인이 모두 무력화됩니다. 중첩 세그먼트/리프에서 키가 버려져도 전체 결과가 아니라 상위 컨테이너 껍데기만 남습니다: `?a[toString]=1` → `{ a: {} }` (`{}`가 아님).

`__proto__`는 옵션과 무관하게, 모든 위치에서 **항상** 차단됩니다 — `__proto__`에 대한 평범한 할당은 프로토타입 setter를 호출하므로, `allowPrototypes: true`를 설정해도 절대 일반 파라미터가 될 수 없습니다.

`prototype`은 `Object.prototype`의 own-property 이름이 아니므로(함수 객체의 own-property이지 `Object.prototype`의 이름이 아님), 의도적으로 절대 차단되지 않고 일반 파라미터로 반환됩니다(`?prototype=1` → `{ prototype: '1' }`) — 이는 실수가 아니라 `qs`의 동작과 정확히 일치시킨 것입니다.

`__proto__`만 차단하던 이전 정책에는 실제로 존재했던 두 가지 취약점을 이번 정책이 막습니다:

- **오염 가젯:** `?constructor[prototype][x]=1`은 이전에는 평범한 own 객체 `{ constructor: { prototype: { x: '1' } } }`를 만들었습니다. 이 결과가 애플리케이션 어딘가의 naive recursive merge(`merge({}, parsed)`)에 전달되면 그 형태 그대로 `Object.prototype`에 도달해 오염시킵니다. 파서 자신은 공유 프로토타입에 병합하지 않지만, 반환한 객체를 다운스트림 소비자가 어떻게 다루는지는 통제할 수 없으므로 — 가젯 형태 자체를 소스에서 차단합니다.
- **메서드섀도 크래시:** `?k[toString]=1`은 이전에는 `{ k: { toString: '1' } }`을 만들었습니다 — 상속된 `Object.prototype.toString`을 *가리는* own-property 문자열입니다. 이후의 `String(parsed.k)` 호출은 throw합니다(`toString`이 함수가 아니므로). `?k[hasOwnProperty]=1`도 마찬가지로 이후의 `parsed.k.hasOwnProperty(...)` 호출을 깨뜨립니다.

이전 동작이 필요하다면 — 예를 들어 이미 다운스트림에서 위험한 키 이름을 정제/거부하거나, 파싱 결과를 어디에도 병합하지 않는다면 — [`allowPrototypes: true`](#allowprototypes)를 설정해 `__proto__`만 차단하던 정책으로 되돌릴 수 있습니다. ⚠️ 이는 위의 두 취약점을 모두 재활성화합니다. 전체 경고는 [`allowPrototypes`](#allowprototypes) 절을 참고하세요.

> **파괴적 변경:** 이전에는 `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`가 모두 일반 own-property 값으로 노출되었습니다(`__proto__`만 차단). 기본값에서는 이제 다시 버려집니다(`prototype`은 예외 — 위 참고). 노출되는 이전 동작에 의존하는 앱이라면 `allowPrototypes: true`를 전달하세요.

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
