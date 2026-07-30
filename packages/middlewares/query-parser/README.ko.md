# @zipbul/query-parser

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/query-parser)](https://www.npmjs.com/package/@zipbul/query-parser)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/query-parser-coverage.json)

고성능 쿼리 스트링 파서 — RFC 3986 퍼센트 디코딩과 WHATWG application/x-www-form-urlencoded 값 시맨틱, 그리고 엄격한 보안 제어를 결합했습니다.

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

parser.parse('q=hello+world');
// { q: 'hello world' } — '+'는 공백으로 디코딩됩니다 (WHATWG application/x-www-form-urlencoded)
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

미들웨어에서 구조적으로 잘못된 쿼리 스트링은 **클라이언트** 오류입니다. `strict`가 켜져 있으면 공급 단계가 `httpError(BadRequest)`를 반환하고, 프레임워크가 파이프라인을 **400** 응답으로 즉시 단락(short-circuit)시키며 핸들러는 실행되지 않습니다. throw가 아니므로 악의적인 쿼리가 500으로 바뀔 수 없습니다. strict는 **구조**(브래킷, 스칼라/구조 충돌)와 **리소스 한도**(`depth`, `maxParams` — `LimitExceeded`)를 검증합니다 — 잘못된 퍼센트 이스케이프는 오류가 아니라 데이터이므로([`strict`](#strict) 참고) 400 경로를 유발하지 않습니다:

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
  duplicates?: DuplicateStrategy;  // 기본값: DuplicateStrategy.Array
  strict?: boolean;         // 기본값: false
}
```

### `depth`

키 하나의 최대 브래킷 중첩 깊이 (`nesting: true` 필요) — 브래킷 그룹의 개수(`a[b][c]`는 깊이 2)입니다. 키가 `depth`보다 더 깊은 중첩을 요구하면 **쌍 전체가 버려집니다** — 부분 기록도, 빈 컨테이너 잔재도 남기지 않습니다. `strict` 모드에서는 버리는 대신 `QueryParserErrorReason.LimitExceeded`를 throw합니다.

```typescript
const parser = QueryParser.create({ nesting: true, depth: 2 });

parser.parse('a[b][c]=1');    // { a: { b: { c: '1' } } }
parser.parse('a[b][c][d]=1'); // 깊이 초과 — 쌍 전체가 버려짐: {}

const strictParser = QueryParser.create({ nesting: true, depth: 2, strict: true });

strictParser.parse('a[b][c][d]=1'); // QueryParserError throw (LimitExceeded)
```

⚠️ 버림은 쌍 단위이지 키 단위가 아닙니다 — 같은 키에 대한 형제 쌍이 depth 이내라면 영향받지 않습니다: `a[b]=1&a[b][c][d]=2` (depth 2) → `{ a: { b: '1' } }`이지 `{}`가 아닙니다.

### `maxParams`

파싱할 키-값 쌍의 최대 개수. 초과분은 무시됩니다.

```typescript
const parser = QueryParser.create({ maxParams: 2 });

parser.parse('a=1&b=2&c=3'); // { a: '1', b: '2' }
```

`strict` 모드에서는 `maxParams` 초과 시 조용히 잘라내는 대신 `QueryParserErrorReason.LimitExceeded`를 throw합니다. 쌍의 개수가 `maxParams`와 **정확히** 같으면 — 뒤에 `&`가 붙어 있어도(빈 시퀀스일 뿐 쌍이 아니므로) — 절대 throw하지 않습니다:

```typescript
const strictParser = QueryParser.create({ maxParams: 2, strict: true });

strictParser.parse('a=1&b=2');   // { a: '1', b: '2' } — 정확히 한도, throw 없음
strictParser.parse('a=1&b=2&');  // { a: '1', b: '2' } — 트레일링 '&'는 빈 시퀀스, 쌍 아님, throw 없음
strictParser.parse('a=1&b=2&c'); // QueryParserError throw (LimitExceeded)
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

`nesting` 활성화 시 허용되는 최대 배열 인덱스. `[0, 10000]` 범위의 정수여야 하며, 10000을 초과하면 `create()`에서 `QueryParserErrorReason.InvalidArrayLimit`가 throw됩니다.

키는 인덱스가 `0`부터 조밀하게 이어지는 동안(`0`, `1`, `2`, … 또는 `[]` push)에만 실제 배열이 됩니다. 인덱스가 구멍을 만들거나(현재 길이보다 큼) `arrayLimit`를 초과하는 순간, 컨테이너 전체가 인덱스 문자열을 키로 갖는 일반 객체로 무손실 변환됩니다 — `undefined` 구멍도, 버려지는 값도 없습니다:

```typescript
const parser = QueryParser.create({ nesting: true, arrayLimit: 5 });

parser.parse('a[0]=x&a[1]=y');    // { a: ['x', 'y'] } — 조밀 → 배열 유지
parser.parse('a[3]=ok');          // { a: { '3': 'ok' } } — 구멍 → 객체 (홀 없음)
parser.parse('a[6]=x');           // { a: { '6': 'x' } } — 한도 초과 → 객체
parser.parse('a[0]=x&a[100]=no'); // { a: { '0': 'x', '100': 'no' } } — 한도 초과, 아무것도 안 버려짐
```

### `duplicates`

반복된 **같은 종류** 중복 값 처리 전략 (HTTP Parameter Pollution 방어). 스칼라↔컨테이너 형태 충돌은 이와 독립적으로 해소됩니다(strict는 모든 전략에서 거부 — [`strict`](#strict) 참고).

| 값 | `DuplicateStrategy` 멤버 | 동작 |
|:---|:------------------------|:-----|
| `DuplicateStrategy.Array` _(기본)_ | 모든 값을 배열로 보존 — 무손실; first/last/거부 결정은 DTO 계층에 위임 |
| `DuplicateStrategy.First` | 첫 번째 값 유지 (나머지 버림) |
| `DuplicateStrategy.Last` | 마지막 값 유지 (나머지 버림) |

```typescript
import { DuplicateStrategy, QueryParser } from '@zipbul/query-parser';

// 입력: 'role=admin&role=user'

QueryParser.create({ duplicates: DuplicateStrategy.First }).parse(input);
// { role: 'admin' }

QueryParser.create({ duplicates: DuplicateStrategy.Last }).parse(input);
// { role: 'user' }

QueryParser.create({ duplicates: DuplicateStrategy.Array }).parse(input);
// { role: ['admin', 'user'] }
```

**스칼라↔컨테이너 충돌** — 한 키가 한 번은 스칼라, 한 번은 중첩 구조로 쓰인 경우(`a=1` 다음 `a[b]=2`, 순서 무관, 어느 깊이든; `nesting: true` 필요) — 는 **형태 충돌**이며 `duplicates`와 **독립적으로** 해소됩니다. `strict`는 모든 전략에서 `ConflictingStructure`로 **거부**하고, 비-strict는 `duplicates`대로 해소합니다:

```typescript
// 입력: 'a=2&a[b]=1' (nesting: true) — 비-strict

QueryParser.create({ nesting: true, duplicates: DuplicateStrategy.First }).parse(input);
// { a: '2' } — 먼저 나온 값(스칼라)이 이김; 구조는 버려짐

QueryParser.create({ nesting: true, duplicates: DuplicateStrategy.Last }).parse(input);
// { a: { b: '1' } } — 나중 값(구조)이 이김; 스칼라는 버려짐

QueryParser.create({ nesting: true, duplicates: DuplicateStrategy.Array }).parse(input);
// { a: ['2', { b: '1' }] } — 둘 다 등장 순서대로 배열에 무손실 결합
```

충돌 규칙이 `duplicates`와 분리돼 있어, 기본값 `'array'`가 strict/미들웨어의 충돌-400을 조용히 무력화하지 않습니다. `strict`는 `'array'`를 포함한 모든 전략에서 `ConflictingStructure`를 throw합니다; 비-strict만 `duplicates`대로 해소합니다.

빈 브래킷 push(`a[]=x`)가 **스칼라**를 담고 있는 키에 떨어지면 그 자체가 스칼라↔컨테이너 충돌입니다: `a=2&a[]=1` → 비-strict `'array'`에서 `{ a: ['2', '1'] }`, `'last'`에서 `{ a: ['1'] }`, `'first'`에서 `{ a: '2' }` — 그리고 `strict`에서는 모든 전략이 `ConflictingStructure`를 throw합니다. (내재적 예외 하나: 이미 존재하는 `[]`-배열에 스칼라가 이어지는 `a[]=1&a=2`는 누적 배열과 중첩 배열을 구별할 수 없어 충돌이 아니라 또 다른 원소로 흡수됩니다 → `{ a: ['1', '2'] }`. `[]`가 **이미 평범한 객체인** 키에 떨어질 때는 충돌이 아니며 다음 정수 키에 추가됩니다 — 아래 노트 참고.)

> **이미 존재하는 평범한 객체에 대한 `[]` (충돌 아님):** `[]` push 문법이 이미 객체인 키를 대상으로 할 때(충돌로 만들어진 게 아닌 경우 — 예: `a[b]`가 객체를 만들고 `[]` push가 그 위에 추가되는 `a[b]=1&a[]=2`) push된 값은 리터럴 `""` 키가 아니라 다음 정수 키(`max(기존 숫자 키) + 1`, 없으면 `"0"`)에 놓입니다:
>
> ```typescript
> QueryParser.create({ nesting: true }).parse('a[b]=1&a[]=2');
> // { a: { '0': '2', b: '1' } } — { a: { '': '2', b: '1' } }이 아님
>
> QueryParser.create({ nesting: true }).parse('a[b]=1&a[]=2&a[]=3');
> // { a: { '0': '2', '1': '3', b: '1' } }
> ```

### `strict`

활성화 시 `parse()`는 무시하는 대신 **구조적** 문제에서 `QueryParserError`를 throw합니다. 퍼센트 인코딩 문법은 여기에 포함되지 않습니다 — strict 모드에서도 잘못된 이스케이프는 결코 오류가 아닙니다(WHATWG §2.6; [RFC 3986 준수](#-rfc-3986-준수) 참고). 잘못된 이스케이프는 리터럴로 보존되고, 무효한 UTF-8은 U+FFFD가 됩니다. strict·non-strict 모두 동일합니다:

- 불균형·중첩·미닫힘 브래킷 (`a]b[c]=1`, `a[[b]]=1`, `a[b=1`) 및 브래킷 그룹 사이의 잉여 문자 (`a[b]junk[c]=1`)
- **스칼라↔컨테이너** 충돌 (`a=1&a[b]=2`) — **모든** `duplicates` 전략에서(충돌 규칙이 `duplicates`와 분리돼 있음). 감지에는 `nesting: true`가 필요합니다. nesting이 꺼져 있으면 브래킷 키는 리터럴이라 충돌이 발생하지 않습니다. 배열↔객체 **키 종류** 불일치만 있는 경우(`a[]=1&a[foo]=2`, 또는 `a[0]=1&a[foo]=2`)는 스칼라↔컨테이너 충돌이 아니며, 항상 무손실로 객체화되고 throw하지 않습니다.
- `depth` 또는 `maxParams` 초과 — 조용히 버리는/자르는 대신 `LimitExceeded`를 throw합니다. 위 [`depth`](#depth), [`maxParams`](#maxparams) 참고.

```typescript
const parser = QueryParser.create({ strict: true, nesting: true });

parser.parse('valid=ok');           // { valid: 'ok' }
parser.parse('bad=%zz');            // { bad: '%zz' } — 잘못된 이스케이프는 오류가 아니라 데이터
parser.parse('a=1&a[b]=2');        // QueryParserError throw (구조 충돌)
```

### 위험한 키 (항상 차단)

`Object.prototype`의 own-property 이름과 일치하는 모든 키(`constructor`, `toString`, `hasOwnProperty`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__` 등)와 `__proto__`는 위치(루트·중첩 세그먼트·리프)에 관계없이 **무조건** 파싱 결과에서 버려집니다. opt-out은 없습니다(이전의 `allowPrototypes` 옵션은 제거됨 — 켜면 recursive-merge 오염 가젯과 메서드섀도 크래시를 HTTP 경계에서 재활성화할 뿐 정당한 이득이 없었음). `prototype`은 이 집합에 포함되지 **않습니다**(함수 객체의 own-property이지 `Object.prototype`의 이름이 아니므로) — 절대 차단되지 않습니다. 이유는 [보안 → 프로토타입 오염 방지](#프로토타입-오염-방지) 참고.

```typescript
QueryParser.create().parse('constructor=1');
// {} — 버려짐

QueryParser.create({ nesting: true }).parse('a[toString]=1');
// { a: {} } — 리프에서 버려짐; "a" 컨테이너 껍데기는 남음

QueryParser.create().parse('prototype=1');
// { prototype: '1' } — Object.prototype own-name이 아니므로 절대 차단되지 않음
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
| `MalformedQueryString` | `parse()` | 잘못된 브래킷/구조 문법 (strict 모드 전용) — 퍼센트 인코딩은 해당 없음 |
| `ConflictingStructure` | `parse()` | `duplicates: DuplicateStrategy.First`/`'last'`에서 키가 스칼라와 중첩 구조로 동시 사용됨 (strict 모드 전용) — `duplicates: DuplicateStrategy.Array`에서는 항상 무손실 결합되므로 절대 throw하지 않음 |
| `LimitExceeded` | `parse()` | `depth` 또는 `maxParams` 초과 (strict 모드 전용) — `arrayLimit`는 절대 throw하지 않음 |

<br>

## 📐 RFC 3986 준수

이 파서는 [RFC 3986](https://datatracker.ietf.org/doc/html/rfc3986) 시맨틱을 따릅니다:

- **`+`는 항상 공백으로 디코딩됩니다** — WHATWG `application/x-www-form-urlencoded`(브라우저·`URLSearchParams`·`qs`를 비롯한 모든 주류 쿼리 스트링 파서)와 동일합니다. 키와 값 모두에 조건 없이 적용되며, 퍼센트 디코딩보다 먼저 일어나므로 `%2B`는 여전히 리터럴 `+`로 복원됩니다. 리터럴 `+`가 필요하면 `%2B`로 보내세요.
- **퍼센트 디코딩은 WHATWG 준수이며, 단순 `decodeURIComponent`가 아닙니다** — 순수 ASCII 고속 경로는 유효한 값과 잘못된 값 모두 `%HH`를 `decodeURIComponent`의 throw 비용 없이 디코딩합니다. 멀티바이트 입력은 유효한 UTF-8이면 네이티브 `decodeURIComponent`를 사용하고, 그렇지 않으면 바이트 단위 디코더로 폴백합니다. 16진수는 대소문자를 구분하지 않습니다(`%3A` ≡ `%3a`). 잘못된 `%`(뒤에 16진수 2자리가 오지 않음)는 결코 오류가 아니며 리터럴 문자로 보존되고 디코딩이 계속됩니다(`%ZZ%41` → `%ZZA`). 무효한 UTF-8 바이트 시퀀스는 throw 대신 U+FFFD(대체 문자)로 디코딩됩니다. 선행 BOM은 제거되지 않고 보존됩니다. strict 모드에서도 동일합니다 — strict는 구조를 검증하며 퍼센트 문법은 검증하지 않습니다. WHATWG 인용 전문은 [STANDARDS.md](./STANDARDS.md) §2.5–§2.7을 참고하세요.
- **`&` 구분자만 사용** — `;`는 구분자로 인식하지 않습니다.

<br>

## 🔒 보안

### 프로토타입 오염 방지

`Object.prototype`의 own-property 이름과 일치하는 모든 키 — `constructor`, `toString`, `hasOwnProperty`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__` 등 — 가 모든 위치(루트·중첩 세그먼트·리프)에서 파싱 결과에서 버려지므로, `?constructor=1`, `?a[toString]=1`, 그리고 고전적인 `?constructor[prototype][x]=1` 체인이 모두 무력화됩니다. 중첩 세그먼트/리프에서 키가 버려져도 전체 결과가 아니라 상위 컨테이너 껍데기만 남습니다: `?a[toString]=1` → `{ a: {} }` (`{}`가 아님).

`__proto__`는 옵션과 무관하게, 모든 위치에서 **항상** 차단됩니다 — `__proto__`에 대한 평범한 할당은 프로토타입 setter를 호출하므로 절대 일반 파라미터가 될 수 없으며, opt-out도 없습니다.

`prototype`은 `Object.prototype`의 own-property 이름이 아니므로(함수 객체의 own-property이지 `Object.prototype`의 이름이 아님), 의도적으로 절대 차단되지 않고 일반 파라미터로 반환됩니다(`?prototype=1` → `{ prototype: '1' }`) — 이는 실수가 아니라 `qs`의 동작과 정확히 일치시킨 것입니다.

`__proto__`만 차단하던 이전 정책에는 실제로 존재했던 두 가지 취약점을 이번 정책이 막습니다:

- **오염 가젯:** `?constructor[prototype][x]=1`은 이전에는 평범한 own 객체 `{ constructor: { prototype: { x: '1' } } }`를 만들었습니다. 이 결과가 애플리케이션 어딘가의 naive recursive merge(`merge({}, parsed)`)에 전달되면 그 형태 그대로 `Object.prototype`에 도달해 오염시킵니다. 파서 자신은 공유 프로토타입에 병합하지 않지만, 반환한 객체를 다운스트림 소비자가 어떻게 다루는지는 통제할 수 없으므로 — 가젯 형태 자체를 소스에서 차단합니다.
- **메서드섀도 크래시:** `?k[toString]=1`은 이전에는 `{ k: { toString: '1' } }`을 만들었습니다 — 상속된 `Object.prototype.toString`을 *가리는* own-property 문자열입니다. 이후의 `String(parsed.k)` 호출은 throw합니다(`toString`이 함수가 아니므로). `?k[hasOwnProperty]=1`도 마찬가지로 이후의 `parsed.k.hasOwnProperty(...)` 호출을 깨뜨립니다.

> **파괴적 변경:** 이전에는 `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`가 모두 일반 own-property 값으로 노출되었습니다(`__proto__`만 차단). 기본값에서는 이제 다시 버려집니다(`prototype`은 예외 — 위 참고). 이 차단은 무조건적입니다(`allowPrototypes` opt-out은 제거됨).

### HPP (HTTP Parameter Pollution) 방어

기본값 `DuplicateStrategy.Array`는 모든 중복 값을 보존하며(조용히 하나를 고르지 않음), 스칼라 DTO 필드가 예상치 못한 다중성을 큰 소리(400)로 거부합니다. 파서 자체가 첫 값만 유지하길 원하면 `DuplicateStrategy.First`로 설정하세요.

### 리소스 제한

- `depth`로 중첩 객체 재귀 깊이 제한 — depth 초과 쌍은 버려짐(`strict` 모드에서는 `LimitExceeded` throw)
- `maxParams`로 파싱 쌍 수 제한 — 초과분은 버려짐(`strict` 모드에서는 `LimitExceeded` throw)
- `arrayLimit`로 배열 인덱스 할당 제한 — 한도 초과 인덱스는 거대한 희소 배열을 만드는 대신 평범한 객체로 객체화됨; 절대 throw하지 않음

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
