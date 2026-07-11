# Query Parser Standards

**HTTP request-target query 컴포넌트 해석자(query string 파서)가 지켜야 할 규칙의 정본.** 각 항목은 규범 수준과 1차 출처를 갖는 순수 규칙이다. 규범 키워드 없이 서술된 항목은 규칙이 아니라 사실·정의(무표기)다.

## 적용 범위 · 주체 선언

이 미들웨어는 **origin server 내부의 query string 해석자**다 — request-target의 query 컴포넌트(raw 문자열)를 (이름, 값) 쌍 리스트로 해석한다. query를 생성·직렬화하지 않으므로 producer 대상 규범은 구속하지 않는다.

정본 분담: **RFC 3986**은 query를 비계층(non-hierarchical) 데이터로 정의하며 octet 문법·퍼센트 인코딩 일반론만 규정한다(§1). **쌍 분해의 정본은 WHATWG URL Standard의 application/x-www-form-urlencoded 파서**다(§2) — 브라우저 폼·URLSearchParams와의 상호운용 기준이다.

## 규범 수준 규약

- **[MUST]** — WHATWG 파서 알고리즘 스텝에서 파생. WHATWG 적합성은 결과 동등성으로 정의되므로(알고리즘형 적합성 요건은 최종 결과가 동등한 한 임의 방식으로 구현 가능 — URL 표준이 의존을 선언한 Infra의 적합성 규정) 스텝과 다른 파스 결과는 상호운용 위반이다 [WHATWG Infra #conformance; WHATWG URL #infrastructure].
- **무표기** — 사실·정의, 그리고 RFC 3986의 규범 전부: RFC 3986은 BCP14 선언이 없고 대문자 규범 키워드가 0회이므로, 소문자 규범("must"·"must not"·"should")은 원문 표기를 따라 무표기로 두되 괄호에 원문 수준을 밝힌다.

**대조 기준일 2026-07-11** — 전 규범 문장을 rfc-editor.org 원문(verified errata 포함)·WHATWG URL Standard(living)·WHATWG Encoding Standard·WHATWG Infra Standard 원문과 전수 대조 완료.

인용 정본:
- **query 컴포넌트 문법·퍼센트 인코딩 일반론** — RFC 3986 (URI Generic Syntax, STD 66).
- **쌍 분해 알고리즘·percent-decode** — WHATWG URL Standard.
- **문자열화(UTF-8 디코딩)** — WHATWG Encoding Standard.
- **적합성 정의(결과 동등성)** — WHATWG Infra Standard.

---

## 1. Query 컴포넌트 (octet 계층 — RFC 3986)

- **§1.1** query 컴포넌트는 첫 `?` 뒤에서 시작해 `#` 또는 URI 끝에서 종료하며, 문법은 `query = *( pchar / "/" / "?" )`다 — `&`·`=`·`;`·`+`는 sub-delims로서 이 계층의 구조 구분자가 아니고, 구분자 역할이 부여되지 않은 reserved 문자는 그 문자의 US-ASCII 인코딩에 해당하는 데이터 octet으로 해석한다(원문 소문자 must) [RFC 3986 §3.4·§2.2].
- **§1.2** 컴포넌트·서브컴포넌트를 구분자로 분리한 **뒤에만** 퍼센트 디코딩한다(원문 소문자 must — 먼저 디코딩하면 데이터 octet이 구분자로 오인된다; reserved 문자는 디코딩이 해석을 바꾼다: `%3D`≢`=`·`%26`≢`&`) [RFC 3986 §2.4·§2.2·§7.3].
- **§1.3** 같은 문자열을 두 번 이상 퍼센트 인코딩/디코딩하지 않는다(원문 소문자 must not — 이중 디코딩은 `%` 데이터 octet을 인코딩 시작으로 오인시킨다) [RFC 3986 §2.4].
- **§1.4** `%XX`의 16진 숫자는 대소문자 등가로 취급한다(`%3A` ≡ `%3a` — 등가 선언은 무조건 서술) [RFC 3986 §2.1·§6.2.2.1].
- **§1.5** query 컴포넌트는 스킴이 달리 정의하지 않는 한 대소문자를 구분하는 것으로 가정된다(원문 "are assumed to be case-sensitive unless specifically defined otherwise by the scheme"; `%XX` 내부 hex 등가는 §1.4) [RFC 3986 §6.2.2.1].
- **§1.6** 디코딩된 데이터에 대한 보안 검사는 디코딩 **후에** 적용하며, `%00`(NUL)은 컴포넌트 안에 raw 데이터를 기대하는 경우가 아니면 거부한다(두 문장 모두 원문 소문자 should — 수신 주체는 URI를 처리하는 application, 즉 이 해석자를 포함한 서버 구현) [RFC 3986 §7.3].
- **§1.7** RFC 3986은 key=value 구조·쌍 구분자·`+`의 공백 치환을 일절 규정하지 않는다("key=value"는 §3.4에 1회, 유사 표현 "key/value"는 §7.3에 1회 — 모두 비규범 서술; `[`·`]`는 query 프로덕션에 포함되지 않아 리터럴로도 불법이다 — Appendix D가 host의 IP 리터럴 구분자 외 사용을 불허) — 구조 해석은 §2의 소관이며 RFC 3986을 그 근거로 인용할 수 없다 [RFC 3986 §3.4·§7.3·§2.2·Appendix D].

## 2. 쌍 분해 (application/x-www-form-urlencoded 해석 — WHATWG URL)

- **§2.1** [MUST] 입력은 0x26(`&`)에서만 분리한다 — `;`(0x3B)는 구분자가 아니라 이름/값 안의 데이터 octet이다(파서 알고리즘에 0x3B 처리 부재) [WHATWG URL #concept-urlencoded-parser step 1].
- **§2.2** [MUST] 빈 바이트 시퀀스(선행·후행·연속 `&`)는 쌍을 생성하지 않고 건너뛴다 [WHATWG URL #concept-urlencoded-parser step 3.1].
- **§2.3** [MUST] 각 시퀀스는 **첫** 0x3D(`=`)에서 이름/값으로 나눈다 — 두 번째 이후의 `=`는 값의 데이터다; `=`가 없으면 전체가 이름이고 값은 빈 문자열, `=`가 첫 byte면 이름이 빈 문자열, 마지막 byte면 값이 빈 문자열이다 [WHATWG URL #concept-urlencoded-parser step 3.2–3.3].
- **§2.4** [MUST] 0x2B(`+`)는 퍼센트 디코딩 **전에**(raw byte 단계에서) 0x20(SP)으로 치환한다 — 순서의 귀결로 `%2B`는 리터럴 `+`로 복원되며 공백이 되지 않는다 [WHATWG URL #concept-urlencoded-parser step 3.4→3.5].
- **§2.5** [MUST] 이름·값은 퍼센트 디코딩 후 UTF-8 decode without BOM으로 문자열화한다 — 무효 UTF-8 시퀀스는 파스 실패가 아니라 U+FFFD(replacement character)로 치환된다 [WHATWG URL #concept-urlencoded-parser step 3.5; WHATWG Encoding #utf-8-decode-without-bom].
- **§2.6** [MUST] 기형 퍼센트 시퀀스(`%` 뒤 두 byte가 hex 범위 0x30–0x39/0x41–0x46/0x61–0x66이 아니거나 부족한 경우)는 오류가 아니다 — `%`를 리터럴 octet으로 보존하고 계속한다 [WHATWG URL #percent-decode step 2.2].
- **§2.7** [MUST] 파스 결과는 입력 순서를 보존하고 중복 이름을 전부 유지하는 (이름, 값) 문자열 쌍 리스트다 — 이름·값은 문자열이며 그 외 타입은 없다 [WHATWG URL #concept-urlencoded-parser step 2·4; #interface-urlsearchparams].
- **§2.8** 적합 UA의 URL 파서는 query의 비-URL 코드포인트·hex 미동반 `%`를 validation error로 표시하되 **보존하고 계속**한다(하드 실패 아님) — 그런 octet은 적합하게 생성된 query 입력에도 존재할 수 있다 [WHATWG URL #query-state step 3].
