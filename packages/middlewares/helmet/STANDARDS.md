# Helmet Standards

**HTTP 응답 보안 헤더 방출자(response security-header emitter)가 지켜야 할 규칙의 정본.**

기능 단위로 규칙을 쌓는다. 각 규칙은 1차 출처(RFC·W3C·WHATWG 원문)만을 근거로 하며, 방출자를 직접 구속하는 규범과 UA 알고리즘에서 파생된 의무를 구분한다.

**대조 기준일 2026-07-12** — 각 규칙의 인용문은 이 날짜의 발행본 원문과 문자 그대로 대조되었다. WHATWG living standard는 이 기준일 이후 변경분만 재대조한다.

**규범 수준 규약**
- **[MUST]/[MUST NOT]** — 원문에 방출자(웹 개발자·conformance checker·sender)를 직접 구속하는 BCP14/동등 키워드가 실재하거나, 위반 시 UA가 헤더를 무시하거나 보호가 소멸하는 하드 실패.
- **[SHOULD]/[SHOULD NOT]** — 원문의 권고, 또는 위반 시 보호가 약화되나 소멸하지는 않는 경우.
- **[무표기]** — 사실·정의·UA 동작 서술. 하드룰로 강제하지 않는다.

---

## 1. X-Content-Type-Options (MIME 혼동 차단)

- **§1.1** [무표기] 현행 정본은 **WHATWG Fetch §3.6**이다 — 원문이 *"The `X-Content-Type-Options` response header can be used to require checking of a response's `Content-Type` header against the destination of a request"*로 헤더의 역할을 정의한다 [Fetch #x-content-type-options-header]
- **§1.2** [MUST] 이 헤더를 방출한다면 값은 정확히 `nosniff`로 생성한다 — 원문이 *"Web developers and conformance checkers must use the following value ABNF for `X-Content-Type-Options`: X-Content-Type-Options = \"nosniff\" ; case-insensitive"*로 방출자를 직접 구속하며, **유효한 토큰은 `nosniff` 하나뿐**이다 [Fetch #x-content-type-options-header]
- **§1.3** [무표기] 헤더의 **방출 자체**는 Fetch가 MUST로 명하지 않는다 — 원문은 헤더가 *"can be used"*라고만 하고 서버 대상 방출 의무를 두지 않는다. 방출 권장의 근거는 §1.6의 UA 차단 게이트가 주는 기능적 보안이며, "필수 보안 헤더"는 OWASP 등의 체크리스트 언어이지 Fetch 규범 문구가 아니다 [Fetch #x-content-type-options-header]
- **§1.4** [무표기] UA의 *determine nosniff* 알고리즘은 헤더 값들 중 **`values[0]`만** `nosniff`와 대조한다 — 원문이 *"If values[0] is an ASCII case-insensitive match for \"nosniff\", then return true. Return false"*로 규정하므로, 첫 값이 `nosniff`가 아니면 보호가 적용되지 않는다 [Fetch #determine-nosniff]
- **§1.5** [MUST NOT] `X-Content-Type-Options`를 두 번 이상 방출하지 않는다 — 복수 방출은 결합·분할되어 `values[0]`이 `nosniff`가 아니게 될 수 있고, 그러면 §1.4에 따라 보호가 **오류 없이 소멸**한다 [Fetch #determine-nosniff]
- **§1.6** [무표기] *determine nosniff*가 true면 UA는 *should response be blocked due to nosniff?*를 실행해, destination이 script-like인데 MIME이 JavaScript MIME이 아니거나 destination이 `style`인데 essence가 `text/css`가 아니면 응답을 차단한다 — 즉 정확한 `Content-Type` 방출이 권고가 아니라 이 보호의 전제가 된다 [Fetch #should-response-to-request-be-blocked-due-to-nosniff?]
- **§1.7** [무표기] ORB·Sec-Fetch-* 등은 nosniff를 대체하지 않는다 — 기준일 발행본 Fetch에 `ORB`·`CORB` 명칭은 존재하지 않고(0건) nosniff 차단은 독립 알고리즘이며, Sec-Fetch-*는 서버측 판정용 별개 레이어다 [Fetch #determine-nosniff]
