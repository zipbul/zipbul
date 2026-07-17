# Conditional Request Standards

**@zipbul/conditional-request가 origin server 응답자로서 준수해야 하는 국제 규칙의 정본.** 대상: 요청에 담겨 온 사전조건 4헤더(`If-Match`·`If-None-Match`·`If-Modified-Since`·`If-Unmodified-Since`)의 파싱·평가와 304/412 응답.

**스냅샷 2026-07-13** — RFC 9110 (HTTP Semantics). 각 규칙의 수준은 **원문 BCP14 키워드 그대로**다(MUST는 MUST, MAY는 MAY — 파생 아님). BCP14 키워드 없이 규정된 원문은 [무표기]로 표시한다.

**대조 기준일 2026-07-13** — 전 규칙을 RFC 9110 원문 발췌(§5.6.7 · §8.8 전문 · §13 전문 · §15.4.5 · §15.5.13)와 규칙 단위 대조. 3엔진(페이블·codex·grok) 적대리뷰 4회차 반복 — 반영 7건(≥2엔진 수렴 또는 원문 명백만), 기각 1건, 4회차에서 3엔진 동시 무발견(PASS)으로 수렴.

정본: RFC 9110 §8.8.3 · §8.8.3.2 · §5.6.7(수신 검증자 파싱·비교) — §13.1 · §13.2(평가·우선순위) — §15.4.5 · §15.5.13(304/412)

---

## 1. 수신 검증자 파싱 (§8.8.3 · §5.6.7 · §13.1)

- **§1.1** [무표기] entity-tag 문법: `entity-tag = [ weak ] opaque-tag`, `weak = %s"W/"`(case-sensitive), `opaque-tag = DQUOTE *etagc DQUOTE`, `etagc = %x21 / %x23-7E / obs-text`(VCHAR except double quotes, plus obs-text) [RFC 9110 §8.8.3]
- **§1.2** [무표기] 필드 문법: `If-Match = "*" / #entity-tag`, `If-None-Match = "*" / #entity-tag`, `If-Modified-Since = HTTP-date`, `If-Unmodified-Since = HTTP-date` [RFC 9110 §13.1.1–§13.1.4]
- **§1.3** [MUST] HTTP 필드의 timestamp 값을 파싱하는 수신자는 세 가지 HTTP-date 포맷(IMF-fixdate · RFC 850 · asctime)을 모두 수용한다 [RFC 9110 §5.6.7]
- **§1.4** [MUST] rfc850-date의 2자리 연도가 50년 넘게 미래로 보이는 timestamp는 같은 끝 두 자리를 가진 가장 최근의 과거 연도로 해석한다 [RFC 9110 §5.6.7]
- **§1.5** [무표기] HTTP-date는 case-sensitive이며 UTC를 나타낸다 — IMF-fixdate·rfc850-date는 `GMT` 표기, asctime-date는 UTC로 가정한다 [RFC 9110 §5.6.7]
- **§1.6** [무표기] `If-Match`/`If-None-Match` 목록에서 `*`를 다른 값(다른 `*` 포함)과 섞은 field는 문법상 무효라 생성이 허용되지 않으며 상호운용될 가능성이 낮다 — 수신 시 처리는 정본이 규정하지 않는다 [RFC 9110 §13.1.1·§13.1.2]

## 2. 비교 함수 (§8.8.3.2)

- **§2.1** [무표기] strong comparison: 두 entity-tag 모두 weak가 아니고 opaque-tag가 문자 단위로 일치하면 동등하다 [RFC 9110 §8.8.3.2]
- **§2.2** [무표기] weak comparison: 어느 쪽이 weak로 표기됐는지와 무관하게 opaque-tag가 문자 단위로 일치하면 동등하다 [RFC 9110 §8.8.3.2]
- **§2.3** [MUST] `If-Match`의 entity-tag 대조에는 strong comparison을 쓴다 [RFC 9110 §13.1.1]
- **§2.4** [MUST] `If-None-Match`의 entity-tag 대조에는 weak comparison을 쓴다 [RFC 9110 §13.1.2]
- **§2.5** [무표기] 비교 결과(§8.8.3.2 Table 3): `W/"1"`↔`W/"1"` strong ✗/weak ✓; `W/"1"`↔`W/"2"` 둘 다 ✗; `W/"1"`↔`"1"` strong ✗/weak ✓; `"1"`↔`"1"` 둘 다 ✓. 따라서 weak로 표기된 ETag는 strong comparison을 통과할 수 없다 [RFC 9110 §8.8.3.2]

## 3. 평가 게이트 (§13.2.1)

- **§3.1** [MUST] (§3.2·§3.3의 제외가 아니면) 사전조건은 normal request checks를 성공적으로 마친 뒤, 요청 content 처리(있다면) 또는 메서드 수행 **직전**에 평가한다 — If-Modified-Since 평가의 필드 수준은 §5.3.5(SHOULD)다 [RFC 9110 §13.2.1]
- **§3.2** [MUST] 조건부 헤더 없는 동일 요청에 대한 응답이 (request content 처리 전 기준으로) 2xx도 412도 아니었을 경우, 수신한 모든 사전조건을 무시한다 — 유의미한 처리 전에 검출 가능한 redirect·실패가 사전조건 평가에 우선한다 [RFC 9110 §13.2.1]
- **§3.3** [MUST] selected representation의 선택·수정을 수반하지 않는 메서드(CONNECT·OPTIONS·TRACE 등)로 수신한 조건부 헤더는 무시한다 [RFC 9110 §13.2.1]

## 4. 우선순위 (§13.2.2)

- **§4.1** [MUST] 수신한 사전조건은 다음 단일 순서로 평가한다 — 원문 키워드는 평가 순서에 걸린다(*"MUST evaluate the request preconditions ... in the following order"*). 각 step의 응답 문면은 §13.2.2 알고리즘 원문이며, 같은 응답의 필드 수준 키워드는 §5.2.4(MUST)·§5.3.7(SHOULD)·§6.3.1/§6.3.2(MAY)에 있다 [RFC 9110 §13.2.2]:
  1. **origin server이고 If-Match present** → 평가: true면 step 3으로; false면 412 — 단, state-changing 요청이 이미 성공했다고 판정할 수 있으면 예외(§6.3.4)
  2. **origin server이고 If-Match 부재, If-Unmodified-Since present** → 평가: true면 step 3으로; false면 412 — §6.3.4 예외 동일
  3. **If-None-Match present** → 평가: true면 step 5로; false면 GET/HEAD는 304, 그 외 메서드는 412
  4. **GET/HEAD이고 If-None-Match 부재, If-Modified-Since present** → 평가: true면 step 5로; false면 304
  5. **GET이고 Range·If-Range 둘 다 present** → If-Range 평가: true이고 Range가 selected representation에 적용 가능하면 206; 아니면 Range 헤더를 무시하고 200
  6. **그 외** → 요청 메서드를 수행하고 그 성공/실패에 따라 응답한다
- **§4.2** [MUST] `If-None-Match`가 present이면 `If-Modified-Since`를 무시한다 [RFC 9110 §13.1.3]
- **§4.3** [MUST] `If-Match`가 present이면 `If-Unmodified-Since`를 무시한다 [RFC 9110 §13.1.4]

## 5. 사전조건 의미론 (§13.1)

### 5.1 If-Match (§13.1.1)

- **§5.1.1** [MUST] representation을 선택하는 요청이 `If-Match`를 포함하면, origin server는 메서드 수행 전에 §13.2대로 If-Match 조건을 평가한다 [RFC 9110 §13.1.1]
- **§5.1.2** [무표기] 평가: 값이 `*`면 origin server가 target resource의 current representation을 가지면 true; entity-tag 목록이면 나열된 태그 중 하나가 selected representation의 entity tag와 매치하면 true; 그 외에는 false [RFC 9110 §13.1.1]
- **§5.1.3** [MUST NOT] If-Match가 false로 평가되면 요청 메서드를 수행하지 않는다 [RFC 9110 §13.1.1]

### 5.2 If-None-Match (§13.1.2)

- **§5.2.1** [MUST] representation을 선택하는 요청이 `If-None-Match`를 포함하면, origin server는 메서드 수행 전에 §13.2대로 If-None-Match 조건을 평가한다 [RFC 9110 §13.1.2]
- **§5.2.2** [무표기] 평가: 값이 `*`면 origin server가 target resource의 current representation을 가지면 false; entity-tag 목록이면 나열된 태그 중 하나가 selected representation의 entity tag와 매치하면 false; 그 외에는 true [RFC 9110 §13.1.2]
- **§5.2.3** [MUST NOT] If-None-Match가 false로 평가되면 요청 메서드를 수행하지 않는다 [RFC 9110 §13.1.2]
- **§5.2.4** [MUST] §5.2.3의 경우 대신, 메서드가 GET/HEAD면 304로, **그 외 모든 메서드면 412로** 응답한다 — 원문 *"MUST respond with either a) the 304 (Not Modified) status code if the request method is GET or HEAD or b) the 412 (Precondition Failed) status code for all other request methods"* [RFC 9110 §13.1.2]

### 5.3 If-Modified-Since (§13.1.3)

- **§5.3.1** [MUST] 요청에 `If-None-Match`가 있으면 `If-Modified-Since`를 무시한다 [RFC 9110 §13.1.3]
- **§5.3.2** [MUST] 수신한 값이 유효한 HTTP-date가 아니거나, 필드 값이 둘 이상의 member를 가지거나, 요청 메서드가 GET도 HEAD도 아니면 `If-Modified-Since`를 무시한다 [RFC 9110 §13.1.3]
- **§5.3.3** [MUST] 리소스에 이용 가능한 modification date가 없으면 `If-Modified-Since`를 무시한다 [RFC 9110 §13.1.3]
- **§5.3.4** [MUST] `If-Modified-Since` 값의 timestamp는 origin server의 clock 기준으로 해석한다 [RFC 9110 §13.1.3]
- **§5.3.5** [SHOULD] representation을 선택하는 요청이 If-None-Match 없이 `If-Modified-Since`를 포함하면, origin server는 메서드 수행 전에 §13.2대로 평가한다 — §3.1의 일반 게이트는 MUST이나 이 필드의 평가 수준은 원문이 SHOULD로 둔다 [RFC 9110 §13.1.3]
- **§5.3.6** [무표기] 평가: selected representation의 최종 수정일이 필드의 date보다 **earlier or equal이면 false**; 그 외에는 true [RFC 9110 §13.1.3]
- **§5.3.7** [SHOULD NOT + SHOULD] false로 평가되면 요청 메서드를 수행하지 않고(SHOULD NOT perform), 304를 생성하되(SHOULD) 이전 캐시 응답의 식별·갱신에 유용한 metadata만 포함한다 — §13.2.2 알고리즘(§4.1 step 4)은 이 false 경로의 응답을 304로 지시한다 [RFC 9110 §13.1.3·§13.2.2]

### 5.4 If-Unmodified-Since (§13.1.4)

- **§5.4.1** [MUST] 요청에 `If-Match`가 있으면 `If-Unmodified-Since`를 무시한다 [RFC 9110 §13.1.4]
- **§5.4.2** [MUST] 수신한 값이 유효한 HTTP-date가 아니면(값이 날짜 목록으로 보이는 경우 포함) `If-Unmodified-Since`를 무시한다 [RFC 9110 §13.1.4]
- **§5.4.3** [MUST] 리소스에 이용 가능한 modification date가 없으면 `If-Unmodified-Since`를 무시한다 [RFC 9110 §13.1.4]
- **§5.4.4** [MUST] `If-Unmodified-Since` 값의 timestamp는 origin server의 clock 기준으로 해석한다 [RFC 9110 §13.1.4]
- **§5.4.5** [MUST] representation을 선택하는 요청이 If-Match 없이 `If-Unmodified-Since`를 포함하면, origin server는 메서드 수행 전에 §13.2대로 평가한다 [RFC 9110 §13.1.4]
- **§5.4.6** [무표기] 평가: selected representation의 최종 수정일이 필드의 date보다 **earlier or equal이면 true**; 그 외에는 false — §5.3.6과 반대 방향 [RFC 9110 §13.1.4]
- **§5.4.7** [MUST NOT] If-Unmodified-Since가 false로 평가되면 요청 메서드를 수행하지 않는다 [RFC 9110 §13.1.4]

## 6. 응답 (§15.4.5 · §15.5.13 · §13.1)

### 6.1 304 Not Modified (§15.4.5)

- **§6.1.1** [무표기] 304는 조건부 GET/HEAD 요청이, 조건이 false로 평가되지 않았다면 200이 됐을 경우를 나타낸다 [RFC 9110 §15.4.5]
- **§6.1.2** [MUST] 304를 생성하는 서버는 동일 요청의 200 응답에서 보냈을 다음 헤더 필드들을 생성한다: `Content-Location`·`Date`·`ETag`·`Vary`, 그리고 `Cache-Control`·`Expires` [RFC 9110 §15.4.5]
- **§6.1.3** [SHOULD NOT] §6.1.2 목록 외의 representation metadata는 304에 생성하지 않는다 — 단 캐시 갱신 안내 목적으로 존재하는 metadata는 예외(예: 응답에 ETag가 없으면 `Last-Modified`가 유용할 수 있음) [RFC 9110 §15.4.5]
- **§6.1.4** [무표기] 304 응답은 header section의 끝에서 종료된다 — content·trailer를 담을 수 없다(원문 *"it cannot contain content or trailers"*) [RFC 9110 §15.4.5]

### 6.2 412 Precondition Failed (§15.5.13)

- **§6.2.1** [무표기] 412는 요청 헤더 필드에 주어진 하나 이상의 조건이 서버에서 검사됐을 때 false로 평가됐음을 나타낸다 [RFC 9110 §15.5.13]

### 6.3 실패 시 응답 수준 (§13.1.1 · §13.1.2 · §13.1.4)

- **§6.3.1** [MAY] `If-Match`가 false면 412로 응답하여 조건부 요청 실패를 알릴 수 있다 — 메서드 미수행 자체는 §5.1.3의 MUST NOT이고, §13.2.2 알고리즘(§4.1 step 1)은 이 false 경로의 응답을 412로 지시한다(§6.3.4 예외 제외) [RFC 9110 §13.1.1·§13.2.2]
- **§6.3.2** [MAY] `If-Unmodified-Since`가 false면 412로 응답할 수 있다 — 메서드 미수행 자체는 §5.4.7의 MUST NOT이고, §13.2.2 알고리즘(§4.1 step 2)은 이 false 경로의 응답을 412로 지시한다(§6.3.4 예외 제외) [RFC 9110 §13.1.4·§13.2.2]
- **§6.3.3** [MUST] `If-None-Match`가 false면 GET/HEAD는 304로, 그 외 모든 메서드는 412로 응답한다 — §5.2.4와 동일 규칙이며, §6.3.1·§6.3.2의 MAY와 달리 수준이 MUST다 [RFC 9110 §13.1.2]
- **§6.3.4** [MAY] state-changing 요청이 이미 selected representation에 적용된 것으로 보이면 §6.3.1·§6.3.2의 412 대신 2xx(Successful)로 응답할 수 있다 [RFC 9110 §13.1.1·§13.1.4]
