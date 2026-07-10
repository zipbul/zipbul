# Helmet Standards

**HTTP 응답 보안 헤더 방출자(response security-header emitter)가 지켜야 할 규칙의 정본.**

이 문서는 **규칙만** 담는다. 구현 분담은 `CLAUDE.md`, 런타임 동작은 테스트의 소관이다. 이 문서는 구현 코드가 아니라 **1차 출처(RFC·W3C·WHATWG 원문)만**을 근거로 한다. 1차 출처가 존재하지 않는 헤더는 §14에서 **"표준 문서 없음"을 명시**한다.

**검증 방법과 그 한계** — 이 문서의 정확성 주장은 다음까지만 미친다:
- 본문의 영어 verbatim 인용 **전건(87건)**을 대조했다. 83건은 1차 출처 원문에 기계적으로 문자열 일치를 확인했고, 나머지 4건(WICG 상태 보일러플레이트 2건·Chromium 설계문서 1건·OWASP 1건)은 발행본에서 개별 확인했다. 이 과정에서 생략부호 없이 잘린 인용 4건과 대소문자를 바꾼 인용 1건을 원문 형태로 복원했다.
- 인용이 **정말 그 앵커 절 안에 있는지**까지 기계 대조했다(47건). 앵커는 실재하지만 인용문은 다른 절에 있던 3건(§13.3.4·§13.3.12·§13.3.14)을 교정했다.
- 규칙이 다는 **출처 앵커 전건(206건)**이 발행본 스펙 문서에 실제 `id`로 존재하는지 대조했다. TR 스타일 앵커가 편집자 초안에 없던 다수를 교정했다.
- **MUST·MUST NOT 전건(70건)**의 정당성을 재감사했다. RFC 출처는 BCP14 키워드의 실재를 개별 확인했고, 키워드도 구조적 실패도 없는 규칙은 강등했다 — 앞뒤 공백(§1.1.5), SF 중복 키(§2.4.3·§9.3.5), CSP 중복 디렉티브(§4.1.7), `'none'` 혼용(§4.2.2), `Referrer-Policy` 소문자(§8.1.6), Permissions-Policy의 `src`와 `report-to` 타입(§9.2.5·§9.2.6), 엔드포인트 이름(§11.1.6), NEL 삭제 멤버(§11.3.9), Document-Policy `report-to` 타입(§13.3.6), `X-XSS-Protection`(§14.1.3), 그리고 `includeSubDomains` 값(§5.1.4)이 그 사례다. 판정 기준은 규범 수준 규약의 **(ㄷ) 실패 귀결 판정** 하나로 통일했다 — 의도한 리소스·기능이 차단되는 것도 경성 실패로 본다(§9.2.3·§13.1.2). 같은 판정으로 강등을 **되돌린** 경우도 있다 — §9.2.3은 잘못된 `'self'` 표기가 allowlist를 비워 그 기능을 차단하므로 MUST NOT을 유지한다(항목만 무시되고 나머지가 남는 §9.2.6과 결말이 다르다).
- 규칙이 언급하는 기술 식별자(헤더명·디렉티브·토큰)가 인용 출처에 실재하는지 대조했다. 그 결과 NEL의 두 멤버가 편집자 초안에서 삭제되었음(§11.3.9), NEL의 `endpoint group` 참조가 현행 Reporting-1에서 정의를 잃어 **끊긴 참조**임(§11.3.5), DIP 편집자 초안이 report-only 헤더명을 오타로 조회함(§10.6.5), Document Policy가 `Require-Document-Policy`를 정의해놓고 알고리즘에서는 `Required-Document-Policy`를 조회함(§13.4.3), Reporting-1의 `destination`은 URL이 아니라 **엔드포인트 이름**인데 HTML·DIP 산문은 이를 "valid URL string"이라 부름(§11.1.6–§11.1.7)을 발견했다.
- 문서 내부 정합성도 기계 검사했다 — 규칙 번호 연속성, 교차참조 dangling, 그리고 boolean 설정점 규칙이 §2.4.1(Dictionary Boolean true는 값 생략)과 충돌하던 것을 §13.3.7(타입)과 §13.3.8(`?1` 금지)로 분리해 교정했다.
- helmet의 공개 옵션 표면을 역방향으로 대조해 **누락된 헤더**(`Require-Document-Policy`·`Document-Policy-Report-Only`)와 누락된 규칙(COOP/COEP/DIP Report-Only, Document-Policy 값 타입·범위, DIP `report-to`)을 찾아 보강했다.
- **한계:** 규범 키워드가 없는 서술형 규칙(무표기)의 개별 문장은 위 식별자 대조 수준까지만 검증되었고, 문장 단위 의미 대조는 전수로 수행되지 않았다. 이 문서는 서로 다른 두 엔진(codex·grok)의 적대적 교차 검토를 **일곱 라운드** 거쳤고 — 마지막 7라운드는 두 엔진 모두 네 범주(원문 모순·수준 도출·내부 모순·방출 의무 누락) 전부에서 **검증된 결함 0건**을 보고해 수렴했고, 두 엔진의 지적은 채택 전에 1차 출처로 재검증했다 — 이 검증 자체도 오류를 냈고 후속 라운드가 잡았다 — 1라운드의 BCP14 감사는 줄바꿈으로 나뉜 *"A sender MUST NOT generate the quoted-string form"*(RFC 9111 §5.2.2.1)을 놓쳐 `Cache-Control` 따옴표 금지를 "RFC에 없음"으로 오판·강등했으며, 6라운드에서 복원했다(§12.1.2). 실제로 각 엔진이 여러 번 틀렸다 — codex의 RFC 9651 §3.1.2 오독, grok이 인용한 존재하지 않는 `network_reporting_endpoints`, 그리고 4라운드에서 두 엔진이 함께 준 존재하지 않는 CSP3 앵커와 *"processing algorithm"*(원문은 *"processing steps"*)이라는 잘못된 인용이 그것이다. 그 과정에서 발견된 정본 오지정(`X-Frame-Options`를 RFC 7034로 인용)·사실 반전(XFO 중복의 fail-open↔fail-closed)·앵커 부재·정책의 MUST 둔갑은 모두 수정되었다.

## 적용 범위 · 주체 선언

이 미들웨어는 **origin server 측 응답 보안 헤더 생성자**다 — 요청을 판정하지 않고, 브라우저(user agent)가 보안 정책을 적용하도록 응답 헤더를 생성한다. 추가로 **CSP 위반 리포트의 서버측 수신자(ingestor)** 역할을 겸한다(§11.4).

**규칙 선별 기준 — 무엇이 이 문서에 들어오고 무엇이 빠지는가.** 포함 대상은 **helmet이 방출하거나 제거하는 헤더**뿐이다. 헤더가 표준인지 폐기됐는지는 포함 여부를 정하지 않는다 — 방출한다면 규칙이 있어야 하고, 규칙이 없는 방출은 통제되지 않는 방출이기 때문이다. 그래서 이 문서는 폐기된 것까지 담는다: `X-Frame-Options`(§6, WHATWG HTML이 정본), 레거시 `Report-To`(§11.2, NEL이 아직 요구하므로 helmet이 `Reporting-Endpoints`에서 합성한다), `Feature-Policy` 문법 재사용 금지(§9.2.7), `Pragma`·`Expires`(§12), 그리고 표준 문서가 아예 없는 §14의 벤더 헤더들이다. 각 레거시 헤더는 **정본의 지위**(폐기·대체·표준 없음)와 **방출 여부 규칙**을 함께 단다.

반대로 **helmet이 방출하지 않는 헤더는 다루지 않는다** — `Expect-CT`·`Public-Key-Pins`가 그렇다. 둘 다 브라우저에서 제거되어 helmet의 옵션 표면에 없으므로, 이 문서의 부재는 **누락이 아니라 범위 밖**이다. 반대로 `X-Robots-Tag`(§14.5)나 `Timing-Allow-Origin`(§14.6)처럼 엄밀히는 보안 통제가 아닌 헤더도 helmet이 방출하므로 규칙을 둔다. §16은 이 기준의 바깥 경계를, §17은 규칙이 아닌 정책을 따로 선언한다.

이 미들웨어는 **user agent가 아니다.** 인용 정본의 절대다수(WHATWG HTML·Fetch, W3C CSP·Permissions-Policy·Reporting·Referrer-Policy)는 **행위 규범을 UA 알고리즘으로만 규정**하며, 서버를 직접 구속하는 부분은 대개 **헤더 문법**뿐이다. 따라서 이 문서의 서버 규칙 상당수는 그 UA 알고리즘에서 **파생**된 의무다.

## 규범 수준 규약

인용 정본이 두 부류라 수준 판정도 **혼합**한다. 각 규칙은 어느 부류인지 출처로 식별된다.

**(가) BCP14 원문 부류** — RFC 6797·9110·9111·9112·9651. 규범 키워드가 원문에 실재하므로 **원문 수준을 그대로** 쓰고, 원 수신 주체(sender·recipient·cache·UA)를 규칙 문장에 밝힌다. 수신 주체가 서버가 아닌 규칙은 서버의 파생 의무로 수용하며 그 사실을 적는다. 원문에 **송신자 대상 키워드가 없는** 경우에는 키워드를 지어내지 않고 **(ㄷ) 실패 귀결 판정**을 쓴다: 잘못된 출력이 수신 파서를 실패시켜 헤더가 통째로 무시되거나 보호가 소멸하면 MUST·MUST NOT이고, 파싱은 성공하는데 **값만 조용히 소실**되거나 수신자가 알아서 복구하면 SHOULD·SHOULD NOT을 넘지 않는다. 각 규칙은 둘 중 어느 쪽인지 문장에서 드러낸다.

**(가)의 예외 — RFC 9651 직렬화 알고리즘.** RFC 9651 §1.2는 *"For serialization to HTTP fields, the algorithms define the **recommended** way to produce them. Implementations **MAY vary** from the specified behavior so long as the output is still correctly handled by the parsing algorithm described in Section 4.2."*라고 명시한다. 따라서 §4.1의 명령형 단계(*"fail serialization"*·*"do not serialize the field at all"*)는 그 자체로 MUST 강도가 **아니다.** 이 문서가 SF 방출에 MUST를 붙일 때 그 근거는 (ㄱ) §3의 **데이터 모델 산문에 실재하는 BCP14 키워드**(예: RFC 9651 §3.1.2·§3.2의 *"MUST omit that value when serialized"*)이거나, (ㄴ) 잘못된 출력이 §4.2의 파서 MUST(*"the entire field value MUST be ignored"*)에 걸려 **헤더 전체가 소멸하는 기능적 실패**다. 각 규칙은 둘 중 어느 근거인지 문장에서 드러낸다. 반대로 잘못된 출력이 **파싱을 실패시키지 않고 값만 조용히 소실**시키는 경우는 §1.2의 면제 조건(*"so long as the output is still correctly handled by the parsing algorithm"*)을 만족하므로 어떤 MUST도 도출되지 않는다 — 이는 위 (ㄷ) 판정과 같은 결론이며, SF 중복 키(§2.4.3·§9.3.5)가 그 예다.

**(나) UA 알고리즘 부류** — WHATWG HTML·Fetch·MIME Sniffing, W3C CSP3·Permissions-Policy·Referrer-Policy·Reporting·NEL·Clear-Site-Data·SRI·Secure Contexts, WICG DIP·Document-Policy. 규범 수준을 **위반 시의 기능적 결과**로 정의한다:

- **MUST / MUST NOT** — 위반하면 브라우저가 헤더 전체를 무시하거나(구조적 실패), 보호가 소멸하거나, 리소스가 차단된다. 원문에 서버 대상 MUST가 없어도 결과는 하드 실패다.
- **SHOULD / SHOULD NOT** — 원문의 서버·저자 대상 권고, 또는 위반 시 보호가 약화되나 소멸하지는 않는 경우.
- **무표기** — 사실·정의·UA 동작 서술. 하드룰로 강제하지 않는다.

**(다) 표준 없음 부류** — §14의 비표준·레거시 헤더. **IETF·W3C·WHATWG 어디에도 이들을 정의하는 표준 문서가 없다.** 어떤 BCP14 의무도 존재하지 않으므로, 규칙은 **벤더 문서(Chromium 설계문서·Adobe·Google Search Central) 또는 OWASP 권고 근거의 SHOULD**이거나 순수 정책이며, 그 사실을 규칙마다 적는다. **RFC를 근거로 제시하지 않는다.** 이 부류에 한해 1차 출처 원칙의 예외로 벤더 문서를 인용하며(달리 인용할 문서가 존재하지 않으므로), 이는 §14 서두에 다시 명시한다. 단 §14.6 `Timing-Allow-Origin`은 이 부류가 아니라 실제 표준 문서를 가진다.

출처 표기는 **안정적 dfn 앵커**(`#...`)를 우선한다 — WHATWG·W3C ED는 living이라 섹션 번호가 바뀌지만 앵커는 불변이다. RFC는 섹션 번호를 쓴다. 포맷: `- **§<섹션>.<항목>.<연번>** [<수준>] <단일 규범 문장> [<출처>]`. 규칙 1개 = 규범 문장 1개 = 수준 1개 = 출처 대괄호 1개(복수 출처는 `·`로 병기). 파생 규칙은 문장 안에 원 수신 주체를 밝힌다.

**대조 기준일 2026-07-10** — 전 규범 문장을 다음 원문과 규칙 단위로 직접 대조 완료: RFC 6797·7034·9110·9111·9112·9651 원문 텍스트(rfc-editor.org), W3C CSP3(WD 2026-05-05)·Trusted Types(ED 2026-06-23)·Permissions Policy(ED, TR WD 2026-06-18)·Referrer Policy(ED 2026-03-20)·Reporting-1(WD 2025-06-11)·NEL(WD 2025-05-05)·Clear-Site-Data(WD 2017-11-30 / ED 2023-11-10)·SRI(WD 2026-03-20)·Secure Contexts(CR Draft 2023-11-10)·Resource Timing(CR Draft 2026-04-20)·CSP2(REC 2016-12-15), WHATWG HTML·Fetch·MIME Sniffing(Living, 2026-07-10 스냅숏), WICG Document Isolation Policy(CG-DRAFT 2025-04-23)·Document Policy(CG-DRAFT 2022-03-30), Google Search Central·Chromium XSS Auditor 설계문서·OWASP Secure Headers(`headers_remove.json` 2026-06-30).

**published TR과 편집자 초안(ED)이 갈라진 경우 이 문서는 ED를 정본으로 삼고 그 사실을 규칙에 밝힌다** — 예: NEL의 `request_headers`·`response_headers`는 TR에 남아 있으나 ED에서 삭제되었으므로 §11.3.9는 방출하지 않기를 권고한다(파스 오류를 일으키지 않아 금지는 아니다). Referrer Policy의 *"should not be quoted"* 문장도 ED에만 있다(§8.1.3).

**RFC 인용은 불변이나, WHATWG living standard·W3C ED/WD·WICG draft·벤더 문서는 재대조 시 이 기준일 이후 변경분만 본다.** W3C 인용 정본 중 **Recommendation은 CSP2 하나뿐**이며(§11.4의 legacy 리포트 전송 근거), 나머지 W3C 문서는 전부 WD/CR/ED다 — 즉 이 문서가 근거하는 웹 보안 헤더 규범의 대부분은 **미확정 상태**다.

인용 정본:
- **헤더 필드 문법·주입** — RFC 9110(HTTP Semantics, STD 97)·RFC 9112(HTTP/1.1, STD 99).
- **Structured Fields 직렬화** — RFC 9651(RFC 8941을 obsolete).
- **Secure context** — W3C Secure Contexts.
- **CSP·Trusted Types** — W3C CSP Level 3·W3C Trusted Types. (legacy 리포트 전송: W3C CSP2 REC)
- **HSTS** — RFC 6797. (preload: hstspreload.org — **비표준 벤더 목록**)
- **프레이밍** — WHATWG HTML `#the-x-frame-options-header`(**현행 정본 — RFC 7034을 supersede**)·CSP3 `#directive-frame-ancestors`. RFC 7034은 Informational이며 HTML이 *"the definition and processing model here supersedes that document"*로 대체를 선언했으므로 이 문서는 HTML을 인용한다.
- **MIME 스니핑 차단** — WHATWG Fetch·WHATWG MIME Sniffing.
- **Referrer** — W3C Referrer Policy.
- **Permissions-Policy** — W3C Permissions Policy·W3C feature registry(`features.md`, **living registry**).
- **교차 출처 격리** — WHATWG HTML(COOP·COEP·OAC)·WHATWG Fetch(CORP)·WICG DIP(**비표준**).
- **리포팅** — W3C Reporting-1·W3C NEL. (`Report-To`: **현행 스펙 부재**, 2018 WD 아카이브)
- **캐시** — RFC 9111(STD 98). **Clear-Site-Data** — W3C Clear Site Data(**RFC 아님**).
- **무결성** — W3C SRI(Integrity-Policy 포함). **Document-Policy** — WICG(**비표준**).
- **타이밍 노출** — W3C Resource Timing·WHATWG Fetch.
- **정보 노출 최소화** — RFC 9110 §10.2.4·§17.12. (제거 목록: OWASP Secure Headers — **권고**)

---

## 1. 헤더 필드 문법 · 주입 방어 (전 헤더 횡단)

- **§1.1.1** [무표기] field-name은 `token`이며 case-insensitive하다 [RFC 9110 §5.1]
- **§1.1.2** [무표기] field-value 문법은 `field-value = *field-content`, `field-content = field-vchar [ 1*( SP / HTAB / field-vchar ) field-vchar ]`, `field-vchar = VCHAR / obs-text`이며, 이 문법은 CR(%x0D)·LF(%x0A)·NUL(%x00)을 포함한 모든 CTL을 구조적으로 배제한다 [RFC 9110 §5.5]
- **§1.1.3** [MUST NOT] 사용자·설정에서 유래해 헤더 값에 삽입되는 모든 문자열(CSP nonce·report URL·origin·디렉티브 값 등)에 CR·LF·NUL을 생성하지 않는다 — 원문은 이를 *"invalid and dangerous"*로 규정하고 **수신자에게** 메시지 거부 또는 SP 치환을 MUST로 명하므로, 방출자가 이를 생성하면 메시지가 거부되거나 헤더가 분할된다 [RFC 9110 §5.5]
- **§1.1.4** [무표기] quoted-string으로 감싸는 것은 §1.1.3의 방어가 되지 못한다 — `qdtext`가 CR·LF·NUL을 이미 배제하므로 인용 부호는 이들 문자를 무해화하지 않는다 [RFC 9110 §5.6.4]
- **§1.1.5** [SHOULD NOT] field-value 앞뒤에 선행·후행 공백(SP·HTAB)을 생성하지 않는다 — 금지 규범은 **없다**. 원문은 오히려 *"A field line value might be preceded and/or followed by optional whitespace (OWS); a single SP preceding the field line value is preferred for consistent readability by humans"*라 하고, *"The field line value does not include that leading or trailing whitespace"*라고 못박는다. 따라서 그 공백은 값에 실리지 않고 조용히 사라질 뿐이므로 (ㄷ)에 따라 SHOULD NOT을 넘지 않으며, 값이 공백으로 의미를 나르지 않게 하는 것이 이 규칙의 목적이다 [RFC 9112 §5]
- **§1.1.6** [MUST NOT] sender는 BWS(bad whitespace)를 생성하지 않는다 — 원문이 *"A sender MUST NOT generate BWS in messages"*로 규정한다 [RFC 9110 §5.6.3]
- **§1.1.7** [SHOULD] 선택적 공백(OWS)을 생성할 때는 단일 SP로 생성한다 [RFC 9110 §5.6.3]
- **§1.1.8** [MUST NOT] sender는 obs-fold(`OWS CRLF RWS`, 폐기된 줄 접기)를 포함하는 메시지를 생성하지 않는다(`message/http` 매체 타입 포장 목적 제외) — 이 금지는 RFC 9110이 아니라 HTTP/1.1 메시지 문법에 있다 [RFC 9112 §5.2]
- **§1.1.9** [SHOULD] 방출 옥텟을 가시 US-ASCII(VCHAR)·SP·HTAB로 제한하고, 더 넓은 문자 범위가 필요하면 RFC 8187 인코딩을 쓴다 — 수신자는 obs-text(%x80-FF)를 opaque data로 취급할 것이 SHOULD이므로 비-ASCII는 의도대로 해석되지 않는다 [RFC 9110 §5.5]

- **§1.2.1** [무표기] 같은 field-name이 한 섹션에 반복되면 수신자는 각 field line value를 순서대로 comma로 이어 붙여 하나의 field value로 결합한다 [RFC 9110 §5.2]
- **§1.2.2** [MUST NOT] sender는 같은 이름의 field line을 복수 생성하지 않는다 — 원문이 *"a sender MUST NOT generate multiple field lines with the same name in a message"*로 규정하며, 그 필드 정의가 comma로 구분된 리스트(`#(values)`)로의 재결합을 허용하는 경우만 예외다 [RFC 9110 §5.3]
- **§1.2.3** [MUST NOT] 리스트형이 아닌 보안 헤더(`X-Frame-Options`·`Strict-Transport-Security`·`X-Content-Type-Options`·`Cross-Origin-Opener-Policy`·`Cross-Origin-Embedder-Policy`·`Cross-Origin-Resource-Policy`·`Origin-Agent-Cluster`)를 두 번 이상 방출하지 않는다 — §1.2.1의 결합으로 값이 comma 리스트가 되며 각 헤더의 파서가 이를 처리하는 방식은 서로 다르다(HSTS는 첫 헤더만 처리 §5.3.3, COEP·CORP는 보호가 소멸 §10.2.4·§10.3.3, nosniff는 첫 값만 검사 §7.1.2, XFO는 오히려 차단 §6.1.5) [RFC 9110 §5.2·§5.3]
- **§1.2.4** [무표기] `Content-Security-Policy`는 §1.2.2의 예외다 — 복수 field line은 comma 결합 후 **복수의 독립 정책**으로 파싱되며, 각 정책은 독립 강제되어 교집합으로만 좁혀진다(§4.1.4) [CSP3 #parse-response-csp·RFC 9110 §5.3]

## 2. Structured Fields 직렬화 (SF 기반 헤더 횡단)

적용 대상: `Permissions-Policy`(§9)·`Origin-Agent-Cluster`(§10.4)·`Reporting-Endpoints`(§11.1)·`Integrity-Policy`(§13.2)·`Document-Policy`(§13.3)·COOP/COEP/DIP의 token+parameter(§10). **`Cross-Origin-Resource-Policy`(§10.3)와 `Clear-Site-Data`(§12.2)는 SF가 아니다.**

- **§2.1.1** [무표기] RFC 9651은 RFC 8941을 obsolete하며, Date(RFC 9651 §3.3.7)·Display String(RFC 9651 §3.3.8) 타입을 추가하고 ABNF를 informative 부록으로 옮겼다 — 규범적 방출자 의무는 RFC 9651 §3의 데이터 모델 제약과 §4.1의 직렬화 알고리즘에 있다 [RFC 9651 Abstract·Appendix D]
- **§2.1.2** [무표기] SF 문법을 어긴 값은 수신 파서를 실패시키고, 원문이 *"If parsing fails, either the entire field value MUST be ignored (i.e., treated as if the field were not present in the section), or alternatively the complete HTTP message MUST be treated as malformed"*라고 규정한다 — 그러므로 §2의 모든 문법 규칙 위반은 **헤더 전체 소멸**이라는 경성 실패를 낳으며, 이것이 §2의 MUST·MUST NOT를 정당화하는 (ㄴ) 근거다 [RFC 9651 §4.2]
- **§2.1.3** [무표기] Permissions Policy는 `[[!RFC8941]]`을 인용하나, Dictionary·Token·String·key 문법은 RFC 9651과 동일하므로 이 문서는 현행 정본인 RFC 9651을 인용한다 [Permissions Policy #structured-header-serialization·RFC 9651 Abstract]

- **§2.2.1** [MUST] Dictionary·Parameters의 key는 `key = ( lcalpha / "*" ) *( lcalpha / DIGIT / "_" / "-" / "." / "*" )` 문법을 만족하도록 생성하며, 위반 시 §2.1.2에 따라 수신 파서가 실패해 헤더 전체가 소멸한다 [RFC 9651 §4.1.1.3]
- **§2.2.2** [MUST NOT] key에 대문자를 생성하지 않는다 — `lcalpha`는 `%x61-7A`(a–z)뿐이며 원문이 *"parameter keys cannot contain uppercase letters"*로 못박는다 [RFC 9651 §3.1.2·§4.1.1.3]
- **§2.2.3** [MUST NOT] key의 첫 문자로 `lcalpha` 또는 `*` 외의 문자(숫자·`-`·`.`·`_`)를 생성하지 않는다 — 위반 시 §2.1.2에 따라 수신 파서가 실패해 헤더 전체가 소멸한다 [RFC 9651 §4.1.1.3]

- **§2.3.1** [MUST NOT] sf-string에 %x20–%x7E(가시 ASCII·SP) 밖의 문자를 생성하지 않는다 — 원문이 *"Strings are zero or more printable ASCII [RFC0020] characters (i.e., the range %x20 to %x7E)"*로 규정하고, 직렬화 알고리즘은 %x00-1f·%x7f-ff에서 실패한다 [RFC 9651 §3.3.3·§4.1.6]
- **§2.3.2** [MUST] sf-string은 double quote로 감싸고 그 안의 `\`와 `"`만 backslash로 이스케이프한다 — 그 외 어떤 문자도 이스케이프하지 않는다 [RFC 9651 §3.3.3·§4.1.6]
- **§2.3.3** [MUST] 비-ASCII를 담아야 하는 URL·값은 sf-string에 넣기 전에 percent-encoding 또는 punycode로 ASCII화한다 — 그러지 않으면 §2.3.1 위반으로 파서가 §2.5.1에 따라 헤더 전체를 무시한다(값 타입이 Display String으로 정의된 필드라면 §2.3.8이 대신 적용된다) [RFC 9651 §3.3.3]
- **§2.3.4** [MUST] sf-token은 따옴표 없이 생성하며 첫 문자가 ALPHA 또는 `*`이고 나머지는 `tchar`·`:`·`/`여야 한다 — 위반 시 §2.1.2에 따라 수신 파서가 실패해 헤더 전체가 소멸한다 [RFC 9651 §3.3.4·§4.1.7]
- **§2.3.5** [무표기] sf-token 문법은 `:`·`/`·`.`를 허용하므로 따옴표 없는 origin(`https://a.example`)은 **유효한 token으로 파싱되어 파싱 실패를 일으키지 않고**, 상위 스펙의 의미 판정에서 조용히 탈락한다(§9.2.3) [RFC 9651 §3.3.4]
- **§2.3.6** [MUST] sf-boolean은 `?1`(true) 또는 `?0`(false)로 생성한다 [RFC 9651 §3.3.6·§4.1.9]
- **§2.3.7** [MUST NOT] sf-integer 범위 −999,999,999,999,999 ~ 999,999,999,999,999 밖의 값을 생성하지 않는다 — 위반 시 §2.1.2에 따라 수신 파서가 실패해 헤더 전체가 소멸한다 [RFC 9651 §3.3.1·§4.1.4]
- **§2.3.8** [SHOULD NOT] String이나 Token으로 충분한 자리에 Display String(`%"…"`)을 생성하지 않는다 — 원문이 *"It is NOT RECOMMENDED that they be used in situations where a String … or Token … would be adequate"*라는 BCP14 NOT RECOMMENDED를 두며, 이 문서가 다루는 헤더 중 값 타입이 Display String으로 정의된 것은 없다 [RFC 9651 §3.3.8]

- **§2.4.1** [MUST] Dictionary 멤버의 값이 Boolean true이면 그 값을 **생략**해 `key`로만 생성한다(`key=?1` 금지) — 원문이 *"Members whose value is Boolean (see Section 3.3.6) true MUST omit that value when serialized"*로 규정한다 [RFC 9651 §3.2]
- **§2.4.2** [MUST] Parameter의 값이 Boolean true이면 그 값을 **생략**해 `;key`로만 생성한다(`;key=?1` 금지) — 원문이 *"Parameters whose value is Boolean (see Section 3.3.6) true MUST omit that value when serialized"*로 규정한다 [RFC 9651 §3.1.2]
- **§2.4.3** [SHOULD NOT] 하나의 Dictionary·Parameters에 같은 key를 두 번 생성하지 않는다 — 키 유일성은 데이터 모델 속성일 뿐 파싱은 실패하지 않고, 파서가 *"overwrite its value"* 하여 *"all but the last instance are ignored"*(마지막 값만 남고 앞선 값은 조용히 사라진다). 송신자에 대한 BCP14 금지는 없으므로 MUST NOT이 아니다 [RFC 9651 §3.2·§4.2.2·§4.2.3.2]
- **§2.4.4** [SHOULD] 최상위 구조가 Dictionary·List이고 멤버가 하나도 없으면 **필드명과 필드값을 모두 생략**해 헤더 자체를 방출하지 않는다 — RFC 9651 §4.1 step 1의 명령형 단계이나, §1.2에 따라 직렬화 알고리즘은 recommended이고 구현이 MAY vary하므로 MUST가 아니다(빈 헤더는 파싱 실패를 일으키지 않고 빈 정책으로 해석될 뿐이다) [RFC 9651 §4.1·§1.2]
- **§2.4.5** [무표기] List·Dictionary의 멤버 구분자는 `","` 뒤 단일 SP이며, Inner List는 `(`…`)`로 감싸고 항목을 단일 SP로 구분한다 [RFC 9651 §4.1.1·§4.1.1.1·§4.1.2]

- **§2.5.1** [무표기] 파싱이 실패하면 **파서는** 필드 값 전체를 무시하거나 메시지 전체를 malformed로 취급해야 하며(MUST), 원문은 이 엄격성을 *"field specifications that use Structured Fields are not allowed to loosen this requirement"*로 못박는다 [RFC 9651 §4.2]
- **§2.5.2** [MUST] 방출한 값이 그 필드가 요구하는 Structured Field 타입으로 **정확히 파싱되도록** 생성한다 — RFC 9651 §1.2는 직렬화 구현이 달라도 좋다고 허용하나 *"so long as the output is still correctly handled by the parsing algorithm"*이라는 조건을 달며, §2.5.1에 따라 한 글자의 문법 오류가 헤더 전체와 그 보안 효과를 소멸시킨다 [RFC 9651 §1.2·§4.2]
- **§2.5.3** [SHOULD] 헤더 값을 문자열 결합으로 손수 조립하지 않고 타입별 직렬화기를 거친다 — 이는 §2.5.2를 만족시키는 공학적 수단이며 RFC가 명하는 구현 기법이 아니다 [파생]

## 3. Secure context 전제 (횡단)

- **§3.1.1** [무표기] *potentially trustworthy origin* 판정 알고리즘의 정본은 **W3C Secure Contexts**이며, WHATWG URL Standard에는 이 알고리즘이 존재하지 않는다 [Secure Contexts #is-origin-trustworthy]
- **§3.1.2** [무표기] origin의 scheme이 `https`·`wss`이거나, host가 `127.0.0.0/8`·`::1/128`에 속하거나, host가 `localhost`·`.localhost`로 끝나거나, scheme이 `file`이면 Potentially Trustworthy이며, opaque origin은 Not Trustworthy다 [Secure Contexts #is-origin-trustworthy]
- **§3.1.3** [무표기] origin의 domain·port는 이 판정에 영향을 주지 않는다 [Secure Contexts #potentially-trustworthy-origin]
- **§3.2.1** [무표기] `Strict-Transport-Security`(§5.2.4)·`Clear-Site-Data`(§12.2.4)·`Cross-Origin-Opener-Policy`(§10.1.4)·`Cross-Origin-Embedder-Policy`(§10.2.5)·`Origin-Agent-Cluster`(§10.4.2)·`Document-Isolation-Policy`(§10.6.3)·`NEL`(§11.3.6)은 **응답·요청 출처가 신뢰 불가**이면 UA가 헤더를 무시하므로, 비-HTTPS 응답에 실으면 무효다 [Secure Contexts #is-origin-trustworthy]
- **§3.2.2** [무표기] `Reporting-Endpoints`는 §3.2.1과 다르다 — 신뢰 불가 판정 대상은 응답의 출처가 아니라 **각 엔드포인트 URL**이며, 신뢰 불가한 엔드포인트 멤버만 무시된다(§11.1.3) [Reporting-1 #header]

## 4. Content Security Policy · Trusted Types

### 4.1 헤더 전달 · 정책 문법

- **§4.1.1** [MAY] 서버는 HTTP 응답 헤더로 정책을 선언할 수 있다 [CSP3 #policy-delivery]
- **§4.1.2** [무표기] `Content-Security-Policy = 1#serialized-policy`이고 `Content-Security-Policy-Report-Only = 1#serialized-policy`이며, `#` 규칙은 CSP3 §2.1의 수정을 반영한 RFC 9110 §5.6.1 리스트다 [CSP3 #csp-header·#cspro-header]
- **§4.1.3** [무표기] `serialized-policy`는 `;`로 구분된 serialized-directive의 나열이고, 한 헤더 값 안의 `,`는 디렉티브가 아니라 **새 정책**을 시작한다 [CSP3 #grammardef-serialized-policy·#grammardef-serialized-policy-list]
- **§4.1.4** [무표기] 복수 정책은 각각 독립 강제되며 능력을 **좁히기만** 한다 — 추가 정책으로 기존 정책을 완화할 수 없다 [CSP3 #multiple-policies]
- **§4.1.5** [무표기] `directive-name = 1*( ALPHA / DIGIT / "-" )`이고 `directive-value`는 `;`(%x3B)와 `,`(%x2C)를 포함할 수 없다 [CSP3 #grammardef-serialized-directive]
- **§4.1.6** [무표기] 디렉티브 이름은 파싱 시 ASCII lowercase되므로 case-insensitive하다 [CSP3 #parse-serialized-policy]
- **§4.1.7** [SHOULD NOT] 한 정책 안에 같은 디렉티브 이름을 두 번 생성하지 않는다 — 파서가 *"If policy's directive set contains a directive whose name is directive name, continue"*로 **첫 번째만 채택하고 이후를 버리므로**, 나중 값으로 덮어쓰려는 시도는 조용히 무시된다 — 파싱은 실패하지 않고 첫 값이 그대로 정책이 되므로 보호가 소멸하지 않고 **의도한 값만 조용히 소실**된다. 이는 §2.4.3의 last-wins와 같은 부류이므로 규범 수준 규약 (ㄷ)에 따라 SHOULD NOT을 넘지 않는다. 원문도 UA가 *"SHOULD notify developers that a duplicate directive was ignored"*라고 덧붙인다 [CSP3 #parse-serialized-policy]
- **§4.1.8** [무표기] 문법에 맞지만 알려지지 않은 디렉티브 이름은 저장되되 강제되지 않는다 — 오타는 오류 없이 무효과다 [CSP3 #parse-serialized-policy]

### 4.2 소스 표현식 문법

- **§4.2.1** [무표기] `serialized-source-list = ( source-expression *( required-ascii-whitespace source-expression ) ) / "'none'"`이므로 **`'none'`은 소스 목록 전체를 대체하는 배타적 대안**이며 목록의 한 원소가 아니다 [CSP3 #grammardef-serialized-source-list]
- **§4.2.2** [SHOULD NOT] `'none'`을 다른 소스 표현식과 함께 한 디렉티브 값에 생성하지 않는다 — §4.2.1의 ABNF는 `'none'`을 배타적 대안으로 두므로 조합은 **문법상 무효**이나, 파서는 이를 거부하지 않고 원문 주석이 *"The 'none' keyword has no effect when other source expressions are present"*, *"A list consisting of « 'none', https://example.com », on the other hand, would match https://example.com/"*라고 밝힌다. 헤더도 디렉티브도 살아 있고 `'none'`만 조용히 무효가 되므로 (ㄷ)에 따라 SHOULD NOT이다 [CSP3 #grammardef-serialized-source-list·#match-url-to-source-list]
- **§4.2.3** [무표기] CSP3의 keyword-source 전체 집합은 `'self'`·`'unsafe-inline'`·`'unsafe-eval'`·`'strict-dynamic'`·`'unsafe-hashes'`·`'report-sample'`·`'unsafe-allow-redirects'`·`'wasm-unsafe-eval'`·`'trusted-types-eval'`·`'report-sha256'`·`'report-sha384'`·`'report-sha512'`·`'unsafe-webtransport-hashes'`다 [CSP3 #grammardef-keyword-source]
- **§4.2.4** [무표기] `'inline-speculation-rules'`는 CSP3에 존재하지 않는다 — 브라우저 확장이며 이 문서의 정본 근거가 없다 [CSP3 #grammardef-keyword-source]
- **§4.2.5** [무표기] `nonce-source = "'nonce-" base64-value "'"`, `hash-source = "'" hash-algorithm "-" base64-value "'"`, `hash-algorithm = "sha256" / "sha384" / "sha512"`다 [CSP3 #grammardef-nonce-source·#grammardef-hash-source]
- **§4.2.6** [무표기] `base64-value = 1*( ALPHA / DIGIT / "+" / "/" / "-" / "_" ) *2( "=" )`이며 base64와 base64url을 모두 허용하고 **hash-source 처리 시 두 인코딩을 동등 취급**한다 [CSP3 #grammardef-base64-value]
- **§4.2.7** [무표기] nonce는 인코딩 동등성을 적용받지 않는다 — UA는 디코딩하지 않고 **문자열 그대로** 대조한다 [CSP3 #grammardef-base64-value]
- **§4.2.8** [MUST] 국제화 도메인 이름(IDN)은 host-source에 직접 쓰지 않고 Punycode로 인코딩해 생성한다 — 원문이 *"internationalized domain names cannot be entered directly as part of a serialized CSP, but instead MUST be Punycode-encoded"*로 규정하며 `üüüüüü.de`는 `xn--tdaaaaaa.de`로 써야 한다 [CSP3 #grammardef-host-source]
- **§4.2.9** [무표기] IP 리터럴 중 실제로 URL과 매치되는 것은 `127.0.0.1`뿐이다 [CSP3 #grammardef-host-source]
- **§4.2.10** [무표기] keyword·scheme·host·hash-algorithm 라벨은 ASCII case-insensitive로 대조되고, nonce의 base64-value와 hash의 base64-value는 **byte 그대로** 대조된다 [CSP3 #match-nonce-to-source-list·#match-hosts]

### 4.3 nonce (서버 직접 구속 — CSP3에서 가장 강한 방출자 의무)

- **§4.3.1** [MUST] nonce-source를 정책에 실어 보낸다면 **정책을 전송할 때마다 고유한 값**을 생성한다 — 원문이 *"If a server delivers a nonce-source expression as part of a policy, the server MUST generate a unique value each time it transmits a policy"*로 서버를 직접 지목한다 [CSP3 #security-nonces]
- **§4.3.2** [SHOULD] nonce 값은 인코딩 전 기준 최소 128비트로 생성한다 [CSP3 #security-nonces]
- **§4.3.3** [SHOULD] nonce 값은 암호학적으로 안전한 난수 생성기로 생성한다 [CSP3 #security-nonces]
- **§4.3.4** [무표기] nonce는 자신이 담긴 디렉티브의 다른 제약을 무효화하므로, 예측 가능하면 정책 우회가 자명해진다 [CSP3 #security-nonces]
- **§4.3.5** [MUST] 헤더의 nonce 값은 요소의 `nonce` 속성과 **대소문자 포함 완전 일치**하도록 생성한다 — 빈 문자열 nonce는 어떤 것과도 매치되지 않는다 [CSP3 #match-nonce-to-source-list]

### 4.4 디렉티브 의미 · fallback

- **§4.4.1** [무표기] `default-src`는 fetch 디렉티브의 fallback이며 상속은 없다 — `script-src`가 명시되면 `default-src`는 script 요청에 영향을 주지 않는다 [CSP3 #directive-default-src]
- **§4.4.2** [무표기] `frame-ancestors`·`base-uri`·`form-action`은 fallback 목록에 없어 `default-src`로 fallback되지 **않는다** — `default-src 'none'`만 선언한 정책은 프레이밍·base 태그 탈취·폼 전송을 전혀 제한하지 않는다 [CSP3 #directive-frame-ancestors·#directive-fallback-list]
- **§4.4.3** [무표기] `frame-ancestors`의 값 문법은 `ancestor-source-list`이며 `scheme-source`·`host-source`·`'self'`·`'none'`만 허용한다 — nonce·hash·`'unsafe-*'`는 허용되지 않는다 [CSP3 #grammardef-ancestor-source-list]
- **§4.4.4** [무표기] `frame-ancestors`는 `meta` 요소로 선언된 정책 안에서는 UA가 MUST로 무시하므로, 반드시 HTTP 헤더로 전달해야 한다 [CSP3 #directive-frame-ancestors]
- **§4.4.5** [무표기] `sandbox`의 각 token 값은 HTML의 iframe `sandbox` 속성 허용값이어야 하며(MUST), 이 디렉티브는 `Content-Security-Policy-Report-Only` 헤더와 `meta` 요소 안에서 **전부 무시**된다 [CSP3 #directive-sandbox]
- **§4.4.6** [무표기] `Content-Security-Policy-Report-Only` 헤더는 `meta` 요소에서 지원되지 않으며, `report-uri`·`frame-ancestors`·`sandbox` 디렉티브도 `meta`에서 지원되지 않는다 [CSP3 #meta-element]
- **§4.4.7** [무표기] report-only 정책은 차단하지 않고 보고만 한다 [CSP3 #should-block-request]
- **§4.4.8** [무표기] `'strict-dynamic'`이 `script-src`·`default-src`에 있으면 script 로딩 시 host-source·scheme-source·`'unsafe-inline'`·`'self'`가 무시되고 hash-source·nonce-source만 유효하다 [CSP3 #strict-dynamic-usage]
- **§4.4.9** [무표기] `'strict-dynamic'`은 script에만 적용되며 다른 리소스 타입에는 적용되지 않는다 [CSP3 #allow-all-inline]
- **§4.4.10** [무표기] 같은 소스 목록에 nonce-source 또는 hash-source가 존재하면 `'unsafe-inline'`은 무효화된다 [CSP3 #allow-all-inline]
- **§4.4.11** [무표기] `upgrade-insecure-requests`와 `block-all-mixed-content`의 규범은 CSP3에 없고 각자의 별도 정본에 있으므로, 이 문서는 그 규칙을 규정하지 않는다 [CSP3 #directives-elsewhere]
- **§4.4.12** [SHOULD] §4.4.2의 세 sink(프레이밍·base·폼 전송)를 통제하려는 정책이라면 각 디렉티브를 명시적으로 생성한다 — 어떤 정본도 서버에 이들의 방출을 명하지 않으므로(§4.1.1의 MAY) 방출 여부 자체는 §17.1.1의 정책이며, 이 규칙은 §4.4.2의 사실에서 나오는 파생 권고다 [파생]

### 4.5 리포팅 디렉티브

- **§4.5.1** [무표기] `report-uri`는 deprecated이며, 같은 정책에 `report-to`가 있으면 UA가 `report-uri`를 무시한다 [CSP3 #directive-report-uri]
- **§4.5.2** [SHOULD] 하위 호환을 위해 `report-uri`와 `report-to`를 함께 생성한다 — 원문이 *"we suggest specifying both"*로 권한다 [CSP3 #directive-report-uri]
- **§4.5.3** [무표기] `report-uri`의 값 문법은 `uri-reference *( required-ascii-whitespace uri-reference )`다 [CSP3 #directive-report-uri]
- **§4.5.4** [MUST] `report-to` 디렉티브의 값은 URL이 아니라 `token` 하나로 생성한다 — 이 token은 리포팅 엔드포인트 이름이다 [CSP3 #directives-reporting]
- **§4.5.5** [무표기] 이 token이 가리키는 엔드포인트가 §11.1의 `Reporting-Endpoints`에 정의되어 있지 않으면 리포트가 배달되지 않을 뿐, CSP 파싱은 실패하지 않고 정책은 그대로 강제된다 — 엔드포인트의 존재를 요구하는 CSP 규범은 없다 [CSP3 #directives-reporting]
- **§4.5.6** [무표기] CSP 디렉티브 `report-to`(token)와 HTTP 헤더 `Report-To`(JSON)는 서로 다른 것이다 [CSP3 #directive-report-to·Reporting-1 2018 WD §3.1]
- **§4.5.7** [무표기] `'report-sample'`은 차단 여부에 영향을 주지 않고 리포트에 위반 코드 앞 40자 `sample`을 포함시킬 뿐이다 [CSP3 #grammardef-report-sample]

### 4.6 Trusted Types

- **§4.6.1** [무표기] `require-trusted-types-for`의 값 문법은 `trusted-types-sink-group-keyword`이며 현재 정의된 유일한 값은 따옴표 붙은 `'script'`다 [Trusted Types #require-trusted-types-for-directive]
- **§4.6.2** [무표기] `trusted-types`의 값 문법은 `tt-expression`의 나열이고, `tt-keyword = "'allow-duplicates'" / "'none'"`, `tt-wildcard = "*"`, `tt-policy-name = 1*( ALPHA / DIGIT / "-" / "#" / "=" / "_" / "/" / "@" / "." / "%" )`다 [Trusted Types #trusted-types-directive]
- **§4.6.3** [무표기] `trusted-types`의 값이 비었거나 `'none'`이면 어떤 정책도 생성할 수 없어 DOM XSS 싱크를 전혀 쓸 수 없다 [Trusted Types #trusted-types-directive]
- **§4.6.4** [무표기] `trusted-types`의 `'none'`은 다른 keyword·policy name이 함께 있으면 무시된다 [Trusted Types #should-block-create-policy]
- **§4.6.5** [무표기] `trusted-types`에 `default`라는 이름이 있으면 그것이 default policy이며, 싱크로 전달되는 모든 문자열이 거부 대신 그 정책을 통과한다 [Trusted Types #trusted-types-directive]

## 5. HTTP Strict Transport Security

- **§5.1.1** [무표기] 필드 문법은 `Strict-Transport-Security = "Strict-Transport-Security" ":" [ directive ] *( ";" [ directive ] )`, `directive = directive-name [ "=" directive-value ]`, `directive-value = token | quoted-string`이다 [RFC 6797 §6.1]
- **§5.1.2** [SHOULD] 보안 전송으로 전달된 요청에 응답할 때 HSTS Host는 STS 헤더 필드를 포함하며, 포함한다면 그 값은 §6.1 문법을 **MUST** 만족한다 [RFC 6797 §7.1]
- **§5.1.3** [MUST] STS 헤더 필드를 방출한다면 그 안에 `max-age` 디렉티브를 생성한다 — REQUIRED이며 값 문법은 `delta-seconds = 1*DIGIT`다(헤더 방출 자체는 §5.1.2의 SHOULD이므로 무조건적 의무가 아니다) [RFC 6797 §6.1.1]
- **§5.1.4** [SHOULD NOT] `includeSubDomains`에 값을 붙이지 않는다 — 원문이 이를 *"a valueless directive"*로 정의하지만, §6.1의 ABNF는 `directive = directive-name [ "=" directive-value ]`로 **모든 디렉티브에 값을 허용**하므로 값을 붙여도 문법 위반이 아니고(§6.1 요구사항 4항의 전체 무시가 발동하지 않는다), 인식된 디렉티브라 5항의 개별 무시 대상도 아니다 — 정의된 처리 결과가 없는 위생 규칙이므로 MUST NOT의 근거가 없다 [RFC 6797 §6.1·§6.1.2]
- **§5.1.5** [무표기] 디렉티브 이름은 case-insensitive하다 [RFC 6797 §6.1]
- **§5.1.6** [MAY] `max-age` 값을 quoted-string으로 생성할 수 있다 — 문법상 유효하다 [RFC 6797 §6.2]

- **§5.2.1** [MUST NOT] 비보안 전송으로 전달되는 HTTP 응답에 STS 헤더 필드를 포함하지 않는다 — 원문이 *"An HSTS Host MUST NOT include the STS header field in HTTP responses conveyed over non-secure transport"*로 규정한다 [RFC 6797 §7.2]
- **§5.2.2** [MUST] STS 헤더 필드를 포함한다면 **오직 하나만** 포함한다 — 원문이 *"the HSTS Host MUST include only one such header field"*로 규정한다 [RFC 6797 §7.1]
- **§5.2.3** [MUST] 한 STS 헤더 필드 안에서 각 디렉티브는 **한 번만** 나타나도록 생성한다 — 위반 시 UA가 헤더 **전체를 무시**한다(§5.3.2). 이는 STS 헤더를 두 개 보낸 경우(UA가 첫 번째만 처리, §5.3.3)와 결과가 다르다 [RFC 6797 §6.1]
- **§5.2.4** [무표기] 비보안 전송으로 받은 응답의 STS 헤더는 UA가 MUST로 무시한다 [RFC 6797 §8.1]

- **§5.3.1** [무표기] `max-age=0`은 UA에게 해당 호스트를 Known HSTS Host에서 해제하도록 지시하며(`includeSubDomains` 포함), 이때 함께 실린 `includeSubDomains`는 무시된다 [RFC 6797 §6.1.1·§6.2]
- **§5.3.2** [무표기] UA는 §6.1 문법에 부합하지 않는 STS 헤더 필드를 MUST로 무시한다 [RFC 6797 §6.1·§8.1]
- **§5.3.3** [무표기] 보안 전송으로 STS 헤더 필드를 둘 이상 받으면 UA는 **첫 번째만** MUST로 처리한다 [RFC 6797 §8.1]
- **§5.3.4** [무표기] UA가 인식하지 못하는 디렉티브는 무시하고, 나머지 요건이 충족되면 인식한 디렉티브를 처리한다 [RFC 6797 §6.1]
- **§5.3.5** [무표기] 요청 URI의 host가 IP-literal·IPv4address 문법과 일치하면 UA는 그 호스트를 Known HSTS Host로 MUST NOT 기록한다 — IP로 접근된 호스트에 HSTS를 실어도 무효다 [RFC 6797 §8.1.1]
- **§5.3.6** [무표기] 하위 보안 전송에 경고·치명 오류가 하나라도 있으면 UA는 해당 호스트 정보를 기록하지 않으며, Known HSTS Host 접속 시 연결을 MUST로 종료한다 — 자체 서명·만료 인증서 뒤에서는 헤더가 정확해도 아무 효과가 없다 [RFC 6797 §8.4·§14.3]
- **§5.3.7** [무표기] UA는 `<meta http-equiv="Strict-Transport-Security">` 설정을 MUST NOT 반영하므로 HSTS는 실제 응답 헤더로만 전달된다 [RFC 6797 §8.5]
- **§5.3.8** [무표기] Known HSTS Host에서 STS 헤더가 빠진 응답을 받아도 UA는 max-age 만료까지 정책을 유지하므로, 헤더 생략은 정책 취소가 아니다 — 취소하려면 §5.3.1의 `max-age=0`을 능동적으로 보내야 한다 [RFC 6797 §8.6]

- **§5.4.1** [무표기] `preload` 디렉티브는 RFC 6797에 **존재하지 않는다** — §6.1 ABNF에 없으며, 준수 UA는 이를 §5.3.4에 따라 미인식 디렉티브로 무시한다 [RFC 6797 §6.1]
- **§5.4.2** [무표기] hstspreload.org는 IETF 표준이 아니라 Chrome 프로젝트가 운영하는 **벤더 목록**이며, 그 제출 요건(`max-age`가 최소 31536000 이상, `includeSubDomains` 명시, `preload` 명시, 유효 인증서, 포트 80 수신 시 HTTP→HTTPS 리다이렉트)은 RFC가 아니라 그 사이트가 정한다 [hstspreload.org Submission Requirements]
- **§5.4.3** [무표기] RFC 6797 §11은 non-normative이며 `max-age`의 최소·권장값을 정하지 않는다 — 오히려 §11.2는 배포 설정의 기본값으로 **0**을 고려하라고 서술한다 [RFC 6797 §11.2]

## 6. 프레이밍 통제 (X-Frame-Options ↔ frame-ancestors)

- **§6.1.1** [무표기] `X-Frame-Options`의 **현행 정본은 WHATWG HTML**이다 — 원문이 *"It was originally defined in HTTP Header Field X-Frame-Options, but the definition and processing model here supersedes that document"*로 RFC 7034(Informational)의 대체를 선언한다 [HTML #the-x-frame-options-header]
- **§6.1.2** [MUST] 값은 `DENY` 또는 `SAMEORIGIN` 중 하나로 생성한다 — 웹 개발자·적합성 검사기를 위한 값 ABNF가 `X-Frame-Options = "DENY" / "SAMEORIGIN"` 둘뿐이다 [HTML #the-x-frame-options-header]
- **§6.1.3** [MUST NOT] `ALLOW-FROM`을 생성하지 않는다 — 원문이 *"that is not to be implemented"*로 못박으며, UA는 이를 무효값으로 취급해 헤더가 생략된 것처럼 처리하므로 프레이밍 보호가 **성립하지 않는다** [HTML #the-x-frame-options-header]
- **§6.1.4** [무표기] UA는 헤더 값들을 ASCII lowercase해 **집합**으로 만들므로 값은 case-insensitive하며 동일한 값의 중복은 집합에서 하나로 합쳐진다 [HTML #the-x-frame-options-header]
- **§6.1.5** [무표기] 집합의 크기가 1을 넘고 그 안에 `deny`·`allowall`·`sameorigin` 중 하나라도 있으면 UA는 `false`를 반환해 **프레이밍을 차단**한다 — 원문이 *"The intention here is to block any attempts at applying X-Frame-Options which were trying to do something valid, but appear confused"*라고 밝히듯 이는 fail-open이 아니라 **fail-closed**다 [HTML #the-x-frame-options-header]
- **§6.1.6** [무표기] 집합의 크기가 1을 넘고 그 값이 전부 무효면 UA는 `true`를 반환해 헤더가 생략된 것과 동일하게 취급한다 — 이 경우에만 보호가 성립하지 않는다 [HTML #the-x-frame-options-header]
- **§6.1.7** [MUST NOT] `X-Frame-Options`를 서로 다른 값으로 두 번 이상 방출하지 않는다 — 리스트형 필드가 아니므로 §1.2.2의 sender MUST NOT이 적용되며, §6.1.5에 따라 결과는 의도치 않은 차단이다 [RFC 9110 §5.3·HTML #the-x-frame-options-header]

- **§6.2.1** [무표기] `frame-ancestors`의 `'none'`은 `DENY`에, `'self'`는 `SAMEORIGIN`에 대략 대응한다 [CSP3 #frame-ancestors-and-frame-options]
- **§6.2.2** [무표기] 같은 응답에 enforce 처분의 `frame-ancestors` 디렉티브와 `X-Frame-Options`가 함께 있으면 `X-Frame-Options`는 무시된다 — CSP3는 이를 MUST 없이 서술하고 규범적 강제를 HTML 처리 모델에 위임하며, HTML의 알고리즘이 enforce 정책에 `frame-ancestors`가 있으면 XFO 검사를 통과시킨다 [HTML #the-x-frame-options-header·CSP3 #frame-ancestors-and-frame-options]
- **§6.2.3** [SHOULD] `frame-ancestors`를 미지원하는 UA를 위해 의미가 일치하는 `X-Frame-Options`를 함께 생성한다 — §6.2.2에 따라 지원 UA에서는 무시되므로 충돌하지 않는다 [CSP3 #frame-ancestors-and-frame-options]

## 7. MIME 혼동 차단 (X-Content-Type-Options)

- **§7.1.1** [MUST] 값 ABNF는 `X-Content-Type-Options = "nosniff" ; case-insensitive`이며, 원문이 *"Web developers and conformance checkers must use the following value ABNF"*로 방출자를 직접 구속한다 — **유효한 토큰은 `nosniff` 하나뿐**이다 [Fetch #x-content-type-options-header]
- **§7.1.2** [무표기] UA의 *determine nosniff* 알고리즘은 결합·분할된 값들 중 **`values[0]`만** `nosniff`와 ASCII case-insensitive 대조하므로, 첫 값이 `nosniff`가 아니면 보호가 적용되지 않는다 [Fetch #determine-nosniff]
- **§7.1.3** [무표기] nosniff가 적용되면 destination이 script-like인데 MIME 타입이 JavaScript MIME 타입이 아니거나, destination이 `style`인데 essence가 `text/css`가 아니면 UA가 응답을 차단한다 — 즉 정확한 `Content-Type` 방출이 권고가 아니라 전제가 된다 [Fetch #should-response-to-request-be-blocked-due-to-nosniff?]
- **§7.1.4** [무표기] no-sniff flag가 설정되면 계산된 MIME 타입은 공급된 MIME 타입 그대로이며 UA는 스니핑으로 이를 교정하지 않는다 [MIME Sniffing #mime-type-sniffing-algorithm]

## 8. Referrer-Policy

- **§8.1.1** [무표기] referrer policy 값 집합은 빈 문자열, `no-referrer`, `no-referrer-when-downgrade`, `same-origin`, `origin`, `strict-origin`, `origin-when-cross-origin`, `strict-origin-when-cross-origin`, `unsafe-url`이다 [Referrer Policy #referrer-policies]
- **§8.1.2** [무표기] 헤더 문법은 `"Referrer-Policy:" 1#(policy-token / extension-token)`이며 `extension-token = 1*( ALPHA / "-" )`은 미지 값 때문에 헤더 전체 파싱이 실패하지 않도록 존재한다 [Referrer Policy #referrer-policy-header]
- **§8.1.3** [SHOULD NOT] 값을 따옴표로 감싸지 않는다 — 원문이 *"Referrer-Policy header values should not be quoted"*라 하고, 따옴표 붙은 값은 `policy-token`과 매치되지 않아 §8.1.6과 똑같이 UA 기본 정책으로 되돌아갈 뿐 헤더가 버려지지 않는다 [Referrer Policy #referrer-policy-header]
- **§8.1.4** [무표기] UA는 토큰들을 순회하며 referrer policy이면서 빈 문자열이 아닌 것을 만날 때마다 정책을 갱신하므로, **마지막 유효 토큰이 채택되고 미지 토큰은 무시된다** [Referrer Policy #parse-referrer-policy-from-header]
- **§8.1.5** [SHOULD] 구형 UA용 보수적 토큰을 앞에, 선호 토큰을 뒤에 두어 comma로 나열한다 — §8.1.4의 last-valid-wins가 폴백 배포를 위해 존재한다고 원문이 밝힌다 [Referrer Policy #unknown-policy-values]
- **§8.1.6** [SHOULD] 토큰을 소문자로 생성한다 — 이 스펙은 **ABNF와 처리 알고리즘이 충돌한다**: `policy-token`은 RFC 5234 문자열 리터럴이라 대소문자를 무시하지만(RFC 5234 §2.3), 규범 알고리즘은 *"if token is a referrer policy"*라는 Infra 문자열 동등 비교(대소문자 구분)를 수행하며 XFO(§6.1.4)·nosniff(§7.1.1)와 달리 case-insensitive 대조를 지시하지 않는다. 소문자만이 두 해석 모두에서 적용되므로 fail-safe 선택이다. 다만 대문자 토큰이라도 헤더가 버려지지 않고 UA 기본 정책으로 되돌아갈 뿐이므로 (ㄷ)에 따라 MUST가 아니다 [Referrer Policy #referrer-policies·#parse-referrer-policy-from-header·RFC 5234 §2.3]
- **§8.1.7** [무표기] 빈 문자열은 "정책 없음"을 뜻해 상위 정책 또는 기본 정책으로 폴백하며, 리다이렉트 시 빈 문자열은 기존 정책을 덮어쓰지 않는다 [Referrer Policy #referrer-policy-empty-string]
- **§8.1.8** [무표기] 유지보수되는 정본의 기본 referrer policy는 `strict-origin-when-cross-origin`이다 — 2017년 CR 텍스트의 `no-referrer-when-downgrade`에서 변경되었으므로 UA 기본값에 의존하지 말고 명시적으로 생성한다 [Referrer Policy #referrer-policies]

## 9. Permissions-Policy

- **§9.1.1** [MUST] `Permissions-Policy` 값은 Structured Fields **Dictionary**로 생성한다 — 원문이 *"Its value must be a dictionary"*로 규정한다 [Permissions Policy #permissions-policy-header]
- **§9.1.2** [MUST] feature 이름(Dictionary member key)은 §2.2의 `key` 문법을 만족하도록 **소문자**로 생성한다 — 대문자 key는 SF 파싱 실패를 일으켜 §9.3.1로 헤더 전체가 사라진다 [RFC 9651 §4.1.1.3·Permissions Policy #structured-header-serialization]
- **§9.1.3** [MUST] `Permissions-Policy-Report-Only`도 같은 Dictionary 문법으로 생성한다 [Permissions Policy #permissions-policy-report-only-header]

- **§9.2.1** [MUST] Member Value는 `*` token, `self` token, ASCII permissions-source-expression을 담은 String, 또는 이들 0개 이상을 담은 Inner List 중 하나로 생성한다 — 원문이 *"Member Values of any other form will cause the entire Dictionary Member to be ignored by the processing steps"*라 하므로, 형태가 어긋나면 그 feature 선언이 통째로 사라지고 **기본 allowlist로 되돌아가 의도한 제한이 소멸한다** [Permissions Policy #structured-header-serialization]
- **§9.2.2** [MUST] origin은 **따옴표 붙은 sf-string**으로, `self`와 `*`는 **따옴표 없는 sf-token**으로 생성한다 — 예: `geolocation=(self "https://a.example")` [Permissions Policy #structured-header-serialization]
- **§9.2.3** [MUST NOT] CSP식 따옴표 표기 `'self'`나 따옴표 없는 origin을 생성하지 않는다 — 전자는 아포스트로피를 포함한 리터럴 문자열이라 어떤 origin과도 매치되지 않고, 후자는 유효한 SF Token이지만 `*`·`self`가 아니라 인식되지 않는다. 원문이 *"Any other items inside of an Inner List will be ignored by the processing steps, and the Member Value will be processed as if they were not present"*라 하므로 allowlist가 비어 **그 기능이 차단된다** — §9.2.6과 달리 남는 항목이 없다 [Permissions Policy #structured-header-serialization]
- **§9.2.4** [무표기] 빈 Inner List `()`는 그 feature를 **모든 origin에서 비활성화**하며, 이는 멤버를 **생략**해 feature의 기본 allowlist로 남기는 것과 정반대의 결과다 [Permissions Policy #structured-header-serialization]
- **§9.2.5** [SHOULD] `report-to` 파라미터를 붙인다면 그 값은 String으로 생성한다 — 원문이 *"Member Values may have a Parameter named \"report-to\", whose value must be a String. Any other parameters will be ignored"*라 하고, UA는 *"If params[\"report-to\"] exists, and is a string"*일 때에만 채택한다. String이 아니면 리포팅만 사라지고 allowlist는 그대로 적용되므로 §13.3.6과 같은 이유로 SHOULD다 [Permissions Policy #structured-header-serialization·#algo-construct-policy]
- **§9.2.6** [SHOULD NOT] `src`를 헤더에 생성하지 않는다 — `'src'`는 iframe `allow` 속성 문법 전용이며 헤더의 construct-policy 알고리즘은 `*`와 `self`와 origin 표현식만 인식한다. 인식되지 않는 항목은 *"will be ignored by the processing steps"*라 헤더가 버려지지 않으므로 (ㄷ)에 따라 SHOULD NOT이다 [Permissions Policy #structured-header-serialization·#algo-construct-policy]
- **§9.2.7** [MUST NOT] 폐기된 `Feature-Policy` 헤더의 값 문법(세미콜론 구분·따옴표 붙은 키워드)을 `Permissions-Policy`에 재사용하지 않는다 — 두 헤더의 문법은 무관하다 [Permissions Policy #ascii-serialization]

- **§9.3.1** [무표기] SF 파싱이 실패하면 UA는 헤더 전체를 무시하고 빈 정책을 반환하므로, **단 하나의 문법 오류가 그 헤더의 모든 feature 제한을 소멸시킨다** [Permissions Policy #algo-process-response-policy·RFC 9651 §4.2]
- **§9.3.2** [무표기] Member Value가 §9.2.1의 형태가 아니면 UA는 **그 멤버만** 버리고, 해당 feature는 (때로 허용적인) 기본 allowlist로 복귀한다 [Permissions Policy #structured-header-serialization]
- **§9.3.3** [무표기] Inner List 안의 부적합 항목은 그 항목만 조용히 버려지고 나머지 멤버는 유지된다 [Permissions Policy #structured-header-serialization]
- **§9.3.4** [무표기] UA가 인식하지 못하는 feature 이름의 멤버는 건너뛰며 나머지 Dictionary는 적용된다 — 이는 §9.3.1의 문법 실패와 다르다 [Permissions Policy #algo-construct-policy]
- **§9.3.5** [SHOULD NOT] 같은 feature key를 두 번 생성하지 않는다 — §2.4.3에 따라 파싱은 성공하고 마지막 값만 남으므로, 더 좁은 allowlist를 앞에 두면 그것이 조용히 무시된다 [RFC 9651 §4.2.2]
- **§9.3.6** [무표기] W3C `features.md`는 Recommendation이 아니라 living registry이며, 실제 적용 여부는 UA가 지원하는 집합이 결정하므로 방출자가 이 목록으로 정합성을 보장할 수 없다 [W3C Permissions Policy features.md]

## 10. 교차 출처 격리 (COOP · COEP · CORP · OAC · DIP)

### 10.1 Cross-Origin-Opener-Policy

- **§10.1.1** [무표기] COOP·COOP-Report-Only는 structured header이며 값은 token이어야 하고, token에는 `report-to` 파라미터를 붙일 수 있다 — 산문은 이 파라미터를 *"a valid URL string identifying an appropriate reporting endpoint"*라 서술하나, 실제로 채택되는 값은 §11.1.7이 밝히는 대로 엔드포인트 **이름**이다 [HTML #the-coop-headers·#obtain-coop]
- **§10.1.2** [MUST] 값은 `unsafe-none`·`same-origin`·`same-origin-allow-popups`·`noopener-allow-popups` 중 하나를 **따옴표 없는 sf-token**으로 생성한다 — UA는 유효하지 않은 값이나 token으로 파싱되지 않는 값을 담은 헤더를 무시한다 [HTML #the-coop-headers·#cross-origin-opener-policy-value]
- **§10.1.3** [MUST NOT] `same-origin-plus-COEP`를 직접 생성하지 않는다 — 원문이 *"cannot be directly set via the Cross-Origin-Opener-Policy header"*로 명시하며, 이 값은 `COOP: same-origin`과 호환 COEP의 조합으로 파생된다 [HTML #cross-origin-opener-policy-value]
- **§10.1.4** [무표기] 비보안 컨텍스트에서는 UA가 COOP 획득 알고리즘 2단계에서 조기 반환하므로 헤더가 완전히 무시된다 [HTML #obtain-coop]
- **§10.1.5** [MUST NOT] COOP 헤더를 두 번 이상 방출하지 않는다 — §1.2.1의 결합으로 값이 sf-list가 되어 token으로 파싱되지 않고, §10.1.2에 따라 UA가 헤더를 무시해 기본값 `unsafe-none`으로 되돌아간다 [HTML #the-coop-headers·RFC 9110 §5.3]
- **§10.1.6** [무표기] `Cross-Origin-Opener-Policy-Report-Only`는 COOP와 같은 structured header·token 문법을 쓰나, 그 값은 opener policy struct의 **report-only value**에 들어가 리포팅에만 관여하며 강제되는 policy value를 바꾸지 않는다 [HTML #the-coop-headers]
- **§10.1.7** [SHOULD NOT] `Cross-Origin-Opener-Policy-Report-Only`에 `noopener-allow-popups`를 생성하지 않는다 — COOP 획득 알고리즘의 report-only 분기는 `same-origin`과 `same-origin-allow-popups`만 처리하고 `noopener-allow-popups` 분기를 **두지 않으므로**, 파싱은 성공하나 report-only value가 설정되지 않아 아무 리포트도 발생하지 않는다 [HTML #obtain-coop]
- **§10.1.8** [SHOULD] COOP의 `report-to` 파라미터를 붙인다면 그 값을 SF **String**으로 생성한다 — UA는 *"If parsedItem[1][\"report-to\"] exists and it is a string"*일 때에만 리포팅 엔드포인트로 채택하므로, String이 아니면 리포팅만 사라지고 격리 정책은 그대로 적용된다 [HTML #obtain-coop]
- **§10.1.9** [MUST NOT] `Cross-Origin-Opener-Policy-Report-Only` 헤더를 두 번 이상 방출하지 않는다 — §10.1.5와 동일하게 결합된 값이 `"item"`으로 파싱되지 않아 UA가 헤더를 무시하고 report-only value가 기본값으로 남는다 [HTML #obtain-coop·RFC 9110 §5.3]
- **§10.1.10** [무표기] report-only COOP의 `same-origin`은 강제 COEP뿐 아니라 **report-only COEP**도 교차 출처 격리 호환으로 인정해 `same-origin-plus-COEP`를 부여한다 — 원문 주석이 *"This allows developers more freedom in the order of deployment of COOP and COEP"*로 그 의도를 밝힌다 [HTML #obtain-coop]

### 10.2 Cross-Origin-Embedder-Policy

- **§10.2.1** [무표기] COEP·COEP-Report-Only는 structured header이며 값은 token이어야 하고 `report-to` 파라미터를 붙일 수 있다 [HTML #the-coep-headers]
- **§10.2.2** [MUST] 값은 `unsafe-none`·`require-corp`·`credentialless` 중 하나를 따옴표 없는 sf-token으로 생성한다 [HTML #embedder-policy-value]
- **§10.2.3** [SHOULD] COEP·COEP-Report-Only의 `report-to` 파라미터를 붙인다면 그 값을 SF **String**으로 생성한다 — COOP(§10.1.8)과 달리 UA 알고리즘은 *"If parsedItem[1][\"report-to\"] exists, then set policy's endpoint to parsedItem[1][\"report-to\"]"*로 **존재만 검사하므로**, String 요구는 알고리즘이 아니라 헤더 산문과 §11.1.6에서 파생된다 [HTML #obtain-an-embedder-policy]
- **§10.2.4** [MUST NOT] COEP 헤더를 두 번 이상 방출하지 않는다 — 원문이 *"The processing model fails open (by defaulting to \"unsafe-none\") in the presence of a header that cannot be parsed as a token. This includes inadvertent lists created by combining multiple instances"*로 규정하므로, 중복은 오류 없이 격리를 소멸시킨다 [HTML #the-coep-headers]
- **§10.2.5** [무표기] 비보안 컨텍스트에서는 UA가 COEP 획득 알고리즘 2단계에서 조기 반환하므로 헤더가 무시된다 [HTML #obtain-an-embedder-policy]
- **§10.2.6** [무표기] `require-corp` 하에서는 CORS도 CORP도 없는 교차 출처 no-cors 하위 리소스가 차단되며, `credentialless`는 no-cors 요청의 credentials를 제거하는 대신 CORP를 요구하지 않는다 [HTML #embedder-policy-value·Fetch #cross-origin-resource-policy-internal-check]
- **§10.2.7** [MUST NOT] `Cross-Origin-Embedder-Policy-Report-Only` 헤더도 두 번 이상 방출하지 않는다 — 원문이 §10.2.4의 fail-open 문장 직후 *"(The same applies to `Cross-Origin-Embedder-Policy-Report-Only`.)"*라고 명시하므로 중복 시 동일하게 `unsafe-none`으로 되돌아간다 [HTML #the-coep-headers]

### 10.3 Cross-Origin-Resource-Policy

- **§10.3.1** [무표기] CORP는 Structured Field가 **아니다** — 값 문법은 `Cross-Origin-Resource-Policy = %s"same-origin" / %s"same-site" / %s"cross-origin" ; case-sensitive`다 [Fetch #cross-origin-resource-policy-header]
- **§10.3.2** [MUST] 값을 정확히 소문자 `same-origin`·`same-site`·`cross-origin` 중 하나로, 따옴표 없이 생성한다 — case-sensitive 대조이므로 `Same-Origin`이나 `"same-origin"`은 policy를 null로 만들어 보호가 사라진다 [Fetch #cross-origin-resource-policy-header·#cross-origin-resource-policy-internal-check]
- **§10.3.3** [MUST NOT] CORP 헤더를 두 번 이상 방출하지 않는다 — 원문이 *"Two or more Cross-Origin-Resource-Policy headers will have the same effect"*(어떤 값과도 매치되지 않아 허용됨)로 규정한다 [Fetch #cross-origin-resource-policy-internal-check]
- **§10.3.4** [무표기] `same-site`는 scheme을 인식한다 — 보안 전송으로 전달된 응답은 비보안 요청 출처와 매치되지 않으므로 HTTPS 리소스의 `same-site`는 HTTP same-site 요청자를 차단한다 [Fetch #cross-origin-resource-policy-internal-check]
- **§10.3.5** [무표기] CORP는 문서가 아니라 **리소스 응답**에 실어 request의 mode가 `no-cors`일 때 출처를 대조하게 하는 헤더다 [Fetch #cross-origin-resource-policy-header]

### 10.4 Origin-Agent-Cluster

- **§10.4.1** [MUST] `Origin-Agent-Cluster` 값은 structured header **boolean**으로 생성한다 — 활성화는 `?1`이며, 원문이 *"values that are not the structured header boolean true value (i.e., `?1`) will be ignored"*로 규정하고 헤더 정의도 *"This header is a structured header whose value must be a boolean"*이므로 `1`·`true`·`"?1"`은 모두 무시된다 [HTML #origin-keyed-agent-clusters]
- **§10.4.2** [무표기] 이 헤더는 secure context로 전달된 문서만 origin-keyed agent cluster를 요청할 수 있으며, opaque origin 문서에는 효과가 없다 [HTML #origin-keyed-agent-clusters]
- **§10.4.3** [SHOULD] 한 origin의 **모든 응답에 동일한 값**을 생성한다 — 원문은 서버 대상 MUST를 두지 않으나, browsing context group 안에서는 historical agent cluster key map 때문에 먼저 로드된 동일 출처 문서의 결정이 이후를 지배하므로 부분 적용은 조용히 뒤집히고 `originAgentCluster`가 방출한 값과 반대로 읽힐 수 있다 [HTML #origin-keyed-agent-clusters]
- **§10.4.4** [무표기] `?1`을 켜면 `document.domain`으로 same-origin 제약을 완화하는 동작이 무효화되고 교차 출처 문서로 `WebAssembly.Module`을 전송할 수 없게 된다 [HTML #origin-keyed-agent-clusters]

### 10.5 교차 출처 격리 성립 조건

- **§10.5.1** [무표기] 교차 출처 격리는 최상위 문서의 `Cross-Origin-Opener-Policy: same-origin`과 모든 문서의 격리 호환 COEP가 **동시에** 성립할 때 얻어진다 — 스펙은 격리가 성립하는 조건을 정의할 뿐 방출자에게 BCP14 의무를 부과하지 않으며, 어느 쪽을 택할지는 §17.1.3의 정책이다 [HTML #cross-origin-isolation-mode]
- **§10.5.2** [무표기] 격리와 호환되는 embedder policy 값은 `credentialless`와 `require-corp`뿐이다 [HTML #compatible-with-cross-origin-isolation]
- **§10.5.3** [무표기] 격리 모드가 `none`이면 UA가 전역 객체에서 `SharedArrayBuffer`를 삭제한다 [HTML #creating-a-new-javascript-realm]
- **§10.5.4** [무표기] 실제 능력을 부여하는 `concrete` 격리 모드 채택 여부는 구현 정의이며 서버가 강제할 수 없다 [HTML #cross-origin-isolation-mode]

### 10.6 Document-Isolation-Policy (비표준)

- **§10.6.1** [무표기] DIP는 **WICG Draft Community Group Report**이며 원문이 *"It is not a W3C Standard nor is it on the W3C Standards Track"*로 명시한다 — 이 절의 모든 규칙은 draft 근거다 [WICG DIP Status]
- **§10.6.2** [MUST] DIP·DIP-Report-Only 값은 `none`·`isolate-and-require-corp`·`isolate-and-credentialless` 중 하나를 **따옴표 없는 sf-token**으로 생성한다 — 획득 알고리즘이 `"item"`으로 파싱한 뒤 이 세 값만 채택하므로, 그 밖의 값은 정책이 기본값 `none`으로 남아 **격리가 성립하지 않는다** [WICG DIP #dip-headers·#obtain-dip]
- **§10.6.3** [무표기] 비보안 컨텍스트에서는 UA가 DIP 획득 알고리즘 2단계에서 조기 반환하므로 헤더가 무시된다 [WICG DIP #obtain-dip]
- **§10.6.4** [무표기] DIP·DIP-Report-Only의 token에는 파라미터를 붙일 수 있고, 그중 `report-to` 파라미터는 리포팅 엔드포인트를 가리키는 **valid URL string**을 가질 수 있다 — 원문이 *"The token may also have attached parameters; of these, the \"report-to\" parameter can have a valid URL string identifying an appropriate reporting endpoint"*로 규정한다 — 다만 이 "URL 문자열" 서술은 §11.1.7의 스펙 간 불일치에 해당하며, 실제로 채택되는 값은 엔드포인트 **이름**이다 [WICG DIP #dip-headers·Reporting-1 #concept-reports]
- **§10.6.5** [무표기] DIP 편집자 초안의 획득 알고리즘은 report-only 헤더를 `Document-Isolation-Policyi-Report-Only`라는 **오타된 이름**으로 조회한다 — 헤더 정의 산문은 `Document-Isolation-Policy-Report-Only`이므로, 아래 report-only 규칙들은 산문의 의도를 따른 파생이며 알고리즘 원문만으로는 근거가 불안정하다 [WICG DIP #dip-headers·#obtain-dip]
- **§10.6.6** [SHOULD] DIP의 `report-to` 파라미터를 붙인다면 그 값을 SF **String**으로, §11.1.6에 따라 엔드포인트 **이름**으로 생성한다 — String이 아니면 리포팅만 사라지고 격리 정책은 그대로 적용된다 [WICG DIP #obtain-dip·Reporting-1 #concept-reports]
- **§10.6.7** [무표기] UA는 `parsedItem[1]["report-to"]`가 존재할 때에만 리포팅 엔드포인트를 설정하므로, `report-to` 없이 DIP-Report-Only만 방출하면 아무 리포트도 도착하지 않는다 [WICG DIP #obtain-dip]
- **§10.6.8** [MUST NOT] `Document-Isolation-Policy`·`Document-Isolation-Policy-Report-Only`를 각각 두 번 이상 방출하지 않는다 — §10.1.5와 동일하게 결합된 값이 `"item"`으로 파싱되지 않아 UA가 헤더를 무시하고 기본값 `none`으로 되돌아간다 [WICG DIP #obtain-dip·RFC 9110 §5.3]

## 11. 리포팅

### 11.1 Reporting-Endpoints (현행)

- **§11.1.1** [MUST] `Reporting-Endpoints` 값은 SF **Dictionary**로 생성하며 각 엔트리가 엔드포인트 하나를 정의한다 [Reporting-1 #header]
- **§11.1.2** [MUST] 엔트리 값은 String으로 생성한다 — 원문이 *"The entry value MUST be a string"*으로 규정하며, 유효한 URI-reference가 아니면 UA가 그 멤버를 MUST로 무시한다 [Reporting-1 #header]
- **§11.1.3** [MUST] 엔드포인트 URL은 potentially trustworthy여야 한다 — 원문이 *"the URL that the member's value represents MUST be potentially trustworthy [SECURE-CONTEXTS]. Non-secure endpoints will be ignored"*로 규정한다 [Reporting-1 #header]
- **§11.1.4** [MUST] 엔드포인트 **이름**은 §2.2의 `key` 문법(소문자 시작, `[a-z0-9_.\-*]`)을 만족하도록 생성한다 [RFC 9651 §4.1.1.3]
- **§11.1.5** [무표기] 엔드포인트 URL은 응답 URL을 base로 파싱되므로 상대 참조도 허용된다 [Reporting-1 #process-header]
- **§11.1.6** [SHOULD] 다른 헤더의 `report-to` 파라미터에는 URL이 아니라 §11.1의 Dictionary **키(엔드포인트 이름)**를 생성한다 — Reporting-1이 *"Each report has a destination, which is a string representing the name of the endpoint that the report will be sent to"*로 규정하기 때문이다. 이름이 어긋나면 리포트만 배달되지 않고 헤더의 보안 효력은 그대로이므로 MUST가 아니다 [Reporting-1 #concept-reports]
- **§11.1.7** [무표기] 그럼에도 WHATWG HTML(COOP·COEP)과 WICG DIP의 산문은 `report-to` 파라미터를 *"a valid URL string identifying an appropriate reporting endpoint"*라고 서술한다 — 알고리즘은 그 값을 `generate and queue a report`의 destination(=이름)으로 그대로 넘기므로, **산문과 알고리즘이 어긋난다**. 이 문서는 알고리즘을 따른다(§11.1.6) [HTML #the-coep-headers·WICG DIP #dip-headers·Reporting-1 #concept-reports]

### 11.2 Report-To (폐기 — 현행 스펙 부재)

- **§11.2.1** [무표기] `Report-To` 헤더는 **현행 Reporting-1(TR·ED) 어디에도 정의되어 있지 않으며**, 2018-09-25 WD 아카이브에만 남아 있다 — `Reporting-Endpoints`가 이를 대체한다 [Reporting-1 (WD 2018-09-25) §3.1]
- **§11.2.2** [무표기] 그 값은 SF가 아니라 바깥 `[`·`]`를 생략한 JSON 객체 배열이며, `max_age`와 `endpoints`가 REQUIRED, `group`·`include_subdomains`가 OPTIONAL이고, `endpoints[].url`은 potentially trustworthy여야 MUST 한다 [Reporting-1 (WD 2018-09-25) §3.1]
- **§11.2.3** [무표기] `max_age: 0`은 해당 엔드포인트 그룹을 UA 리포팅 캐시에서 제거한다 [Reporting-1 (WD 2018-09-25) §3.1]

### 11.3 Network Error Logging

- **§11.3.1** [무표기] `NEL` 헤더 값은 JSON 객체 배열로 해석된다 [NEL #nel-response-header]
- **§11.3.2** [MUST] `NEL` 값을 **JSON 객체의 배열**로 생성하고 그 배열에 REQUIRED 멤버를 모두 갖춘 정책 객체를 최소 하나 담는다 — 원문이 *"A valid NEL header field MUST, at a minimum, contain one object with all of the \"REQUIRED\" fields defined in this specification"*라 하고, UA는 *"MUST process the first valid policy in the array and ignore any additional policies in the array"*이므로 두 번째 이후 정책은 무의미하다 [NEL #nel-response-header]
- **§11.3.3** [MUST] `max_age`를 non-negative integer로 생성한다 — REQUIRED이며 *"Its value MUST be an non-negative integer; any other type will result in a parse error"*이고, `0`은 이 origin의 NEL 정책을 정책 캐시에서 제거한다 [NEL #max-age-member]
- **§11.3.4** [MUST] NEL 정책을 등록하려면 `report_to`를 String으로 생성한다 — REQUIRED이며 *"If present, its value MUST be a string; any other type will result in a parse error"*다 [NEL #report-to-member]
- **§11.3.5** [무표기] `report_to`의 값은 *"the endpoint group that reports for this NEL policy will be sent to"*이며, NEL은 이 *endpoint group* 개념을 `[REPORTING]`의 외부 정의에 위임한다 — 그런데 **현행 Reporting-1 편집자 초안에는 endpoint group의 정의가 존재하지 않는다**(그 개념은 폐기된 `Report-To`와 함께 사라졌다). 즉 NEL의 이 규범 참조는 현재 **연결이 끊긴 상태**이며, NEL 자신의 예시는 여전히 `Report-To` 헤더를 사용한다 [NEL #report-to-member·Reporting-1 ED]
- **§11.3.6** [무표기] UA는 요청 origin이 Potentially Trustworthy가 아니면 NEL 정책 처리를 중단한다 [NEL #process-policy-headers]
- **§11.3.7** [무표기] `success_fraction`이 없으면 UA는 성공 요청의 NEL 리포트를 수집하지 않고, `failure_fraction`이 없으면 실패 요청 전부를 수집한다 [NEL #success-fraction-member·#failure-fraction-member]
- **§11.3.8** [MUST] `success_fraction`·`failure_fraction`을 방출한다면 각각 **0.0 이상 1.0 이하의 number**로 생성한다 — 원문이 두 멤버 모두에 대해 *"If present, its value MUST be a number between 0.0 and 1.0, inclusive; any other value will result in a parse error"*라 규정하며, 파스 오류는 그 정책을 무효로 만든다 [NEL #success-fraction-member·#failure-fraction-member]
- **§11.3.9** [SHOULD NOT] `request_headers`·`response_headers` 멤버를 생성하지 않는다 — published TR(WD 2025-05-05)에는 NEL TR §4.1.6·§4.1.7로 남아 있으나 편집자 초안에서 **삭제되었다**(커밋 *"Remove \"request headers\" and \"response headers\" from NEL"*). 원문이 *"User agents MUST ignore any unknown or invalid field(s) or value(s)"*라고 하므로 이 멤버는 무시될 뿐 파스 오류를 일으키지 않아 MUST NOT은 아니다 [NEL ED·#nel-response-header]
- **§11.3.10** [무표기] 이 두 멤버의 존재 여부는 NEL의 published TR과 편집자 초안이 **갈라진 지점**이므로, TR만 보고 구현하면 이미 제거된 기능을 방출하게 된다 [NEL ED·NEL TR §4.1.6·§4.1.7]
- **§11.3.11** [무표기] `include_subdomains` 멤버는 OPTIONAL 불리언으로 이 NEL 정책을 origin의 모든 하위 도메인에 적용한다 [NEL #include-subdomains-member]

### 11.4 리포트 수신 (ingestor 측)

- **§11.4.1** [무표기] legacy `report-uri` 경로에서 UA는 `Content-Type: application/csp-report`로 `POST`하며 본문은 `csp-report` 단일 키를 가진 JSON 객체이고, 이 fetch에서 리다이렉트를 MUST NOT 따른다 [CSP2 #violation-reports]
- **§11.4.2** [무표기] legacy 본문의 키는 하이픈 표기 `document-uri`·`referrer`·`blocked-uri`·`effective-directive`·`violated-directive`·`original-policy`·`disposition`·`status-code`·`script-sample`(및 위치 정보 시 `source-file`·`line-number`·`column-number`)이다 [CSP3 #deprecated-serialize-violation]
- **§11.4.3** [무표기] modern 경로에서 UA는 `Content-Type: application/reports+json`으로 리포트 **배열**을 POST하며, 각 원소는 `age`·`type`·`url`·`user_agent`·`body`를 갖는다 [Reporting-1 #media-type·#serialize-reports]
- **§11.4.4** [무표기] CSP 위반의 modern 리포트 타입은 `csp-violation`이고 `body`의 키는 camelCase `documentURL`·`referrer`·`blockedURL`·`effectiveDirective`·`originalPolicy`·`sourceFile`·`sample`·`disposition`·`statusCode`·`lineNumber`·`columnNumber`다 [CSP3 #report-violation]
- **§11.4.5** [SHOULD] 수신기는 `Content-Type`으로 분기해 §11.4.2의 하이픈 스키마와 §11.4.4의 camelCase 스키마를 **모두** 처리한다 — 어떤 정본도 리포트 수신기에 의무를 부과하지 않으나(정본들은 UA의 전송 형식만 규정한다) 한쪽만 처리하면 그 경로의 리포트를 전부 잃는다 [CSP2 #violation-reports·CSP3 #report-violation]
- **§11.4.6** [무표기] modern 리포트는 mode `"cors"`·credentials `"same-origin"`으로 전송되므로, 교차 출처 수신 엔드포인트는 `application/reports+json`이 CORS-safelisted Content-Type이 아니라서 preflight를 받고 credentials를 받지 못한다(이는 Reporting 스펙이 명시하지 않은 Fetch CORS 규칙의 파생 결과다) [Reporting-1 #try-delivery]

## 12. 캐시 · Clear-Site-Data

### 12.1 Cache-Control

- **§12.1.1** [무표기] 문법은 `Cache-Control = #cache-directive`, `cache-directive = token [ "=" ( token / quoted-string ) ]`이며 디렉티브 이름은 case-insensitive하게 대조된다 [RFC 9111 §5.2]
- **§12.1.2** [MUST NOT] `max-age`·`s-maxage`의 인자를 quoted-string으로 생성하지 않는다 — 두 디렉티브 모두 원문이 *"This directive uses the token form of the argument syntax"*라 하고 *"A sender MUST NOT generate the quoted-string form"*으로 송신자를 직접 금지한다(수신자는 두 형식 모두 수용하라고 권고되므로 경성 실패는 아니나 BCP14 송신 금지다) [RFC 9111 §5.2.2.1·§5.2.2.10]
- **§12.1.3** [SHOULD NOT] `no-cache`·`private`에 필드 이름 인자를 붙일 때 token 형식으로 생성하지 않는다 — 이 두 디렉티브는 반대로 *"This directive uses the quoted-string form of the argument syntax"*이며 원문이 *"A sender SHOULD NOT generate the token form (even if quoting appears not to be needed for single-entry lists)"*라 한다 [RFC 9111 §5.2.2.4·§5.2.2.7]
- **§12.1.4** [무표기] 캐시는 자신이 표현할 수 있는 최대 정수를 넘는 `delta-seconds`를 2147483648로 MUST 간주한다 [RFC 9111 §1.2.2]
- **§12.1.5** [무표기] `no-store`는 캐시가 요청·응답의 어떤 부분도 저장하지 않고 다른 요청에 재사용하지 않을 것을 MUST로 명하나, 원문은 그 저장 금지가 *"best-effort"*임을 밝히고 *"This directive is not a reliable or sufficient mechanism for ensuring privacy"*라고 스스로 한계를 규정한다 [RFC 9111 §5.2.2.5]
- **§12.1.6** [무표기] `no-cache`는 저장을 금지하지 않고 재사용 전 검증을 강제할 뿐이므로 `no-store`와 다르다 [RFC 9111 §5.2.2.4]
- **§12.1.7** [무표기] `private`는 **shared cache**의 저장만 금지하며 사용자 브라우저의 개인 캐시는 저장할 수 있다 [RFC 9111 §5.2.2.7]
- **§12.1.8** [무표기] `must-revalidate`는 응답이 stale해진 뒤의 재사용을 금지할 뿐 저장을 금지하지 않는다 [RFC 9111 §5.2.2.2]
- **§12.1.9** [무표기] `max-age=0`은 즉시 stale을 뜻하며 저장 금지가 아니다 [RFC 9111 §5.2.2.1]
- **§12.1.10** [무표기] 캐시는 인식하지 못하는 디렉티브를 MUST 무시한다 [RFC 9111 §5.2.3]
- **§12.1.11** [무표기] RFC 9111은 `Pragma`를 deprecate하며, *"the meaning of \"Pragma: no-cache\" in responses was never specified"*라고 명시한다 — 따라서 응답의 `Pragma: no-cache`는 규정된 의미가 없고 `Cache-Control: no-cache`의 신뢰할 수 있는 대체가 아니다 [RFC 9111 §5.4]
- **§12.1.12** [무표기] 캐시는 무효 날짜 형식, 특히 값 `"0"`을 이미 만료된 시각으로 MUST 해석하므로 `Expires: 0`은 유효한 freshness 신호다 [RFC 9111 §5.3]

### 12.2 Clear-Site-Data

- **§12.2.1** [무표기] `Clear-Site-Data`에는 **RFC 번호가 없다** — W3C Working Draft이며 Recommendation에 이른 적이 없다 [W3C Clear Site Data Status]
- **§12.2.2** [MUST] 값 문법은 `Clear-Site-Data = 1#( quoted-string )`이므로 각 타입 토큰을 **double quote로 감싸** 생성한다 — 이는 RFC 7230 `#rule` 기반의 quoted-string 리스트이며 **Structured Field가 아니다** [W3C Clear Site Data #header]
- **§12.2.3** [무표기] 정의된 타입은 `"cache"`·`"cookies"`·`"storage"`·`"executionContexts"`·`"*"`이며, ED는 `"clientHints"`를 추가했다 [W3C Clear Site Data #types]
- **§12.2.4** [무표기] UA는 응답 URL이 a priori authenticated URL이 아니면 처리를 중단하므로, 비보안 전송에서는 조용히 무시된다 [W3C Clear Site Data #parsing]
- **§12.2.5** [무표기] UA는 헤더 파싱 시 미지 타입을 MUST 무시한다 [W3C Clear Site Data #header]
- **§12.2.6** [무표기] 이 헤더는 네트워크로 가져온 응답에서만 존중되고 service worker가 합성한 응답에서는 존중되지 않는다 [W3C Clear Site Data #fetch-integration]

## 13. 무결성 · Document-Policy

### 13.1 SRI 해시 값

- **§13.1.1** [무표기] 유효한 SRI 해시 알고리즘 토큰 집합은 정확히 `"sha256"`·`"sha384"`·`"sha512"`이며, 그 외 토큰의 해시는 UA가 조용히 버린다 [SRI #valid-sri-hash-algorithm-token-set]
- **§13.1.2** [MUST NOT] `sha1`·`md5` 해시를 생성하지 않는다 — CSP3의 `hash-algorithm = "sha256" / "sha384" / "sha512"`에 없어 `'sha1-…'`은 어떤 hash-source와도 매치되지 않고, 허용하려던 그 스크립트가 **차단된다**(경성 실패 — helmet의 해시 방출 경로는 CSP뿐이다). 참고로 SRI `integrity` **속성** 쪽 알고리즘은 반대로 미지 토큰을 건너뛴 뒤 *"If parsedMetadata is empty set, return true"*로 **무결성 검사 없이 통과**시키므로(fail-open) 결말이 다르다 [CSP3 #grammardef-hash-source·SRI #valid-sri-hash-algorithm-token-set·#does-response-match-metadatalist]
- **§13.1.3** [MUST] 다이제스트 출력은 **표준 base64(RFC 4648 §4)**로 인코딩해 생성한다 — SRI의 생성 알고리즘이 *"Return the result of base64 encoding result"*이고 그 base64는 RFC 4648 §4(base64url인 §5가 아님)를 가리킨다 [SRI "Apply algorithm to bytes"]
- **§13.1.4** [무표기] CSP3의 `base64-value`는 base64와 base64url을 모두 수용해 hash-source 처리 시 동등 취급하므로(§4.2.6), 표준 base64를 방출하면 `integrity` 속성과 CSP hash-source 양쪽에서 유효하다 [CSP3 #grammardef-base64-value·SRI "Apply algorithm to bytes"]
- **§13.1.5** [무표기] CSP hash-source는 작은따옴표로 감싼 `'<alg>-<b64>'` 문법이고 SRI `integrity` 속성의 hash-expression은 따옴표 없는 `<alg>-<b64>` 문법이므로(`<alg>` ∈ {sha256, sha384, sha512}), 같은 base64 값을 두 곳에 쓸 때 따옴표를 붙이거나 떼어야 한다 [CSP3 #grammardef-hash-source·SRI #the-integrity-attribute]

### 13.2 Integrity-Policy

- **§13.2.1** [무표기] `Integrity-Policy`·`Integrity-Policy-Report-Only`는 W3C SRI 문서에 정의되어 있으나 그 문서 자체가 **Working Draft**이므로 미확정이다 [SRI Status·#integrity-policy-section]
- **§13.2.2** [MUST] 값은 RFC 9651 **Dictionary**로 생성하며 모든 member-value는 **token의 Inner List**여야 한다 — 원문이 *"a Dictionary [RFC9651], with every member-value being an inner list of tokens"*로 규정한다 [SRI #integrity-policy-section]
- **§13.2.3** [MUST NOT] Inner List 항목을 따옴표 붙은 String으로 생성하지 않는다 — `blocked-destinations=(script)`이지 `blocked-destinations=("script")`가 아니다. String을 쓰면 SF 파싱은 **성공하지만** UA 알고리즘의 *"If its value contains \"script\""* 대조가 타입 불일치로 어긋나 어떤 destination도 차단되지 않는다 — 오류 없이 보호가 통째로 소멸하므로 (나)에 따라 MUST NOT이다 [SRI #processing-an-integrity-policy·RFC 9651 §3.3.4]
- **§13.2.4** [무표기] `blocked-destinations`의 가능한 값은 `script`와 `style`뿐이고, `sources`의 유일한 가능값은 `inline`이다 [SRI #integrity-policy-section]
- **§13.2.5** [MUST] member key(`blocked-destinations`·`sources`·`endpoints`)는 §2.2의 `key` 문법을 만족하도록 소문자로 생성한다 [RFC 9651 §4.1.1.3]

### 13.3 Document-Policy (비표준)

- **§13.3.1** [무표기] Document-Policy는 **WICG Draft Community Group Report**이며 원문이 *"It is not a W3C Standard nor is it on the W3C Standards Track"*로 명시한다 — 이 절의 모든 규칙은 draft 근거다 [WICG Document Policy Status]
- **§13.3.2** [MUST] `Document-Policy` 값을 Structured Header **dictionary**로 생성한다 — dictionary로 파싱되지 않으면 정책 전체가 소실되므로, §13.4.2의 `Require-Document-Policy`와 동급의 의무다 [WICG Document Policy §7.2.1]
- **§13.3.3** [무표기] 어떤 디렉티브에도 `report-to` 파라미터를 붙여 위반 리포트 엔드포인트를 지정할 수 있다 [WICG Document Policy §6.1.1]
- **§13.3.4** [무표기] report-only 정책은 `Document-Policy-Report-Only` 헤더로 지정하며, 위반 시 강제 정책과 동일하게 리포트를 생성하되 *"they do not cause any other action to be taken by the user agent"*이므로 차단하지 않는다 [WICG Document Policy #report-only]
- **§13.3.5** [MUST] `Document-Policy-Report-Only` 값을 Structured Header **dictionary**로, `Document-Policy`와 동일한 문법으로 생성한다 — 원문이 *"The Document-Policy-Report-Only header is a Structured Header. Its value must be a dictionary. It has exactly the same syntax as the `Document-Policy` header"*로 규정하므로 §13.3.2가 그대로 적용된다 [WICG Document Policy #document-policy-report-only-header]
- **§13.3.6** [SHOULD] `report-to` 파라미터를 붙인다면 그 값을 **String**으로 생성한다 — 원문이 *"Any document policy directive may include a parameter named `report-to`, whose value must be a string"*라 하고 UA는 *"If parameters[\"report-to\"] exists, and is a string"*일 때에만 엔드포인트로 채택하나, String이 아니면 그 파라미터가 **건너뛰어질 뿐 파싱은 실패하지 않는다** — 리포팅만 사라지고 정책은 살아남으므로 §13.3.7·§13.3.9·§13.3.10의 MUST와 달리 SHOULD다 [WICG Document Policy #document-policy-directive-parameters·#parse-document-policy]
- **§13.3.7** [MUST] `boolean` 타입 설정점의 값을 SF **Boolean**으로 생성한다 — UA 알고리즘이 *"If value is not a Boolean, then fail"*로 파싱을 중단하기 때문이다 [WICG Document Policy #parse-document-policy]
- **§13.3.8** [MUST] `boolean` 설정점이 true이면 값을 **생략**해 `feature`로만 생성하고 `feature=?1`을 쓰지 않는다 — 근거는 Document Policy가 아니라 §2.4.1이 인용한 RFC 9651 §3.2의 *"MUST omit that value when serialized"*뿐이다. `?1`도 Boolean이라 `then fail`에 걸리지 않고 원문이 *"parsers are still required to correctly handle the true Boolean value when it appears in Dictionary values"*라 하므로, 이 금지는 파싱 실패가 아니라 직렬화 의무다 [RFC 9651 §3.2]
- **§13.3.9** [MUST] `enum` 타입 설정점의 값을 그 설정점이 허용하는 **Token** 중 하나로 생성한다 — *"If value is not a Token, then fail"*이고 *"If value is not the name of one of configuration points allowed enum values, then fail"*이다 [WICG Document Policy #parse-document-policy]
- **§13.3.10** [MUST] `integer` 타입 설정점의 값을 SF **Integer**로, `float` 타입 설정점의 값을 SF **Decimal**로 생성하며 각각 그 설정점의 **range 안**에 있게 한다 — 타입 불일치와 범위 이탈 모두 *"then fail"*이다 [WICG Document Policy #parse-document-policy]
- **§13.3.11** [무표기] 파싱 알고리즘은 *"returns a document policy … or else fails"*로 두 결말을 구분한다 — 헤더가 없으면 `return null`이고, 디렉티브 하나라도 값 타입·범위를 어기면 `then fail`이어서 그 헤더에서 **어떤 정책도 생성되지 않는다**. 즉 오류 하나가 그 문서의 document policy 전부를 잃게 만든다 [WICG Document Policy #parse-document-policy]
- **§13.3.12** [무표기] 특수 엔드포인트 이름 `none`은 그 feature의 리포팅을 **끈다** — 원문이 *"This will override the default endpoint and disable reporting for that feature"*로 설명한다 [WICG Document Policy #reporting-disable]
- **§13.3.13** [SHOULD] `none`을 지정할 때 `report-to="none"`처럼 **String**으로 생성한다 — 초안의 예시는 따옴표 없는 `report-to=none`(SF Token)을 쓰지만, `#parse-document-policy`는 *"exists, and is a string"*일 때만 엔드포인트를 채택하므로 Token 형태는 알고리즘상 무시된다. 초안 내부의 모순이며 §13.3.6과 정합하는 String 형태를 택한다 [WICG Document Policy #reporting-disable·#parse-document-policy]
- **§13.3.14** [SHOULD] `Document-Policy-Report-Only`의 디렉티브에는 `report-to` 파라미터를 붙인다 — 원문이 *"The `report-to` directive parameter should be used with directives in this header, or else they will have no effect at all"*로 경고한다 [WICG Document Policy #report-only]

### 13.4 Require-Document-Policy (비표준)

- **§13.4.1** [무표기] `Require-Document-Policy`는 WICG Document Policy가 정의하는 **응답 헤더**로, 중첩된 모든 콘텐츠에 적용될 **최소 요구 document policy**를 클라이언트에 전달한다 — §13.3.1의 비표준 단서가 동일하게 적용된다 [WICG Document Policy #require-document-policy-header]
- **§13.4.2** [MUST] `Require-Document-Policy` 값은 `Document-Policy`와 **정확히 같은 문법**의 Structured Header dictionary로 생성한다 — 원문이 *"is a Structured Header dictionary, with exactly the same syntax as the `Document-Policy` header"*로 규정하므로 §2의 SF 규칙과 §13.3.2·§13.3.6–§13.3.10의 값 타입·범위 규칙이 그대로 적용된다 [WICG Document Policy #require-document-policy-header]
- **§13.4.3** [무표기] 스펙은 이 헤더를 `Require-Document-Policy`로 정의하나, Fetch 통합 알고리즘은 *"get a structured field value with header name Required-Document-Policy and type \"dictionary\""*로 **정의된 적 없는 이름**을 조회한다 — §10.6.5의 DIP 오타와 같은 부류이며, 방출자는 정의된 이름을 따른다 [WICG Document Policy #integration-with-fetch]
- **§13.4.4** [무표기] 이 헤더는 중첩 콘텐츠(iframe 등)에 부과되는 요구사항이므로 자신의 문서에 적용되는 §13.3의 `Document-Policy`와 역할이 다르다 [WICG Document Policy #require-document-policy-header]

## 14. 비표준 · 레거시 · 노출 헤더

**§14.1~§14.5의 헤더에는 IETF·W3C·WHATWG 표준 문서가 존재하지 않는다.** 따라서 BCP14 의무도 없다. 이 절에 한해 1차 출처 원칙의 예외로 **벤더 문서(Chromium 설계문서·Adobe·Google Search Central)와 OWASP 권고**를 인용하며, 달리 인용할 정본이 없기 때문이다. **어떤 RFC도 이들의 방출을 요구하지 않는다.** §14.6 `Timing-Allow-Origin`은 예외로 실제 표준 문서를 가지므로 이 단서가 적용되지 않는다.

- **§14.1.1** [무표기] `X-XSS-Protection`을 정의하는 **IETF·W3C·WHATWG 표준 문서는 존재하지 않는다** — 구현은 브라우저 벤더의 XSS 필터에서 유래했고 현재는 폐기되었다 [Chromium XSS Auditor design document]
- **§14.1.2** [무표기] Chromium 설계문서 스스로 XSS Auditor가 교차 출처 페이지 내용을 알아내는 데 악용될 수 있어 *"a violation of Same Origin Policy"*라고 밝히며, 2019-08-05에 영구 비활성화되고 Chrome 78에서 제거되었다 [Chromium XSS Auditor design document]
- **§14.1.3** [SHOULD NOT] `X-XSS-Protection: 1` 또는 `1; mode=block`을 생성하지 않는다 — 필터가 켜진 UA에서 오히려 취약점을 만들지만, 근거가 RFC가 아니라 **Chromium 설계문서**뿐이므로 규범 수준 규약 (다)에 따라 SHOULD NOT을 넘지 않는다 [Chromium XSS Auditor design document]
- **§14.1.4** [SHOULD] `X-XSS-Protection`을 방출한다면 값 `0`으로 잔존 레거시 필터를 명시적으로 끄고, 그렇지 않으면 헤더를 생략하며, XSS 방어는 CSP(§4)에 의존한다 — Chromium 설계문서 자신이 비활성화 지시로 `X-XSS-Protection: 0`을 제시한다 [Chromium XSS Auditor design document]

- **§14.2.1** [무표기] `X-Download-Options: noopen`을 정의하는 **표준 문서는 존재하지 않는다** — IE8 전용 벤더 동작이며 현대 브라우저는 구현하지 않는다 [표준 문서 없음]
- **§14.2.2** [SHOULD NOT] 신규 배포에서 `X-Download-Options`를 방출하지 않는다 — 지원 브라우저가 없어 어떤 보호도 성립하지 않는다 [표준 문서 없음]

- **§14.3.1** [무표기] `X-DNS-Prefetch-Control`을 정의하는 **표준 문서는 존재하지 않는다** — 브라우저 벤더의 DNS prefetch 통제 동작에서 유래했으며 값은 `on`·`off`다 [표준 문서 없음]
- **§14.3.2** [무표기] OWASP Secure Headers가 `off`를 하드닝 기본값으로 권고하나 이는 **권고이지 규범이 아니다** [OWASP Secure Headers]

- **§14.4.1** [무표기] `X-Permitted-Cross-Domain-Policies`의 정본은 Adobe Cross Domain Policy File Specification이라는 **벤더 문서**이며, 그것이 통제하는 Flash는 2020-12-31에 지원 종료되었다 [Adobe Cross Domain Policy File Specification]
- **§14.4.2** [무표기] 값은 `none`·`master-only`·`by-content-type`·`by-ftp-filename`·`all`·`none-this-response`이며 `none-this-response`는 HTTP 헤더 전용이다 [Adobe Cross Domain Policy File Specification]

- **§14.5.1** [무표기] `X-Robots-Tag`의 정본은 Google Search Central이라는 **벤더 문서**이며 IETF·W3C 규격이 아니다 — 검색 색인 통제 수단이지 보안 통제가 아니다 [Google Search Central]
- **§14.5.2** [무표기] 헤더 이름·user agent 이름·지정 값은 모두 case-insensitive하며, 규칙 앞에 `googlebot:` 같은 user agent 접두사를 선택적으로 붙일 수 있다 [Google Search Central]
- **§14.5.3** [무표기] `noarchive`는 Google의 현행 문서에 없다 — Bing이 여전히 존중하므로 Google 문서를 근거로 인용해서는 안 된다 [Google Search Central]

- **§14.6.1** [무표기] `Timing-Allow-Origin`은 이 절에서 **유일하게 표준 문서를 가진 헤더**다 — W3C Resource Timing(CR Draft)이 정의하고 매칭은 WHATWG Fetch의 TAO check에 위임된다 [Resource Timing #sec-timing-allow-origin·Fetch #tao-check]
- **§14.6.2** [무표기] 값 문법은 `Timing-Allow-Origin = 1#( origin-or-null / wildcard )`이며 sender는 복수 필드를 MAY 생성한다 [Resource Timing #sec-timing-allow-origin]
- **§14.6.3** [무표기] TAO check는 값에 `*`가 있거나 요청 출처를 직렬화한 문자열이 값에 있으면 성공을 반환하므로, 교차 출처 타이밍을 노출하려면 둘 중 하나를 정확히 생성해야 한다 [Fetch #tao-check]
- **§14.6.4** [무표기] 이 헤더의 방출은 보호가 아니라 **보호의 해제**다 — 명명된 출처에 상세 리소스 타이밍을 노출하므로, 타이밍 노출을 의도하지 않으면 방출하지 않는다 [Resource Timing #sec-timing-allow-origin]

## 15. 정보 노출 최소화

- **§15.1.1** [MAY] origin server는 `Server` 헤더 필드를 응답에 생성할 수 있다 [RFC 9110 §10.2.4]
- **§15.1.2** [SHOULD NOT] `Server` 헤더 필드에 불필요하게 세밀한 정보를 담아 생성하지 않는다 [RFC 9110 §10.2.4]
- **§15.1.3** [SHOULD] `Server` 헤더 필드에 제3자 subproduct를 추가하는 것을 제한한다 [RFC 9110 §10.2.4]
- **§15.1.4** [무표기] RFC 9110은 `Server` 제거를 **요구하지 않으며**, §17.12는 이 정보 노출의 실효성에 대해 *"in practice, attackers tend to try all potential holes regardless of the apparent software versions being used"*라고 스스로 낮게 평가한다 [RFC 9110 §17.12]
- **§15.1.5** [무표기] `X-Powered-By`·`X-AspNet-Version`·`X-AspNetMvc-Version` 등 프레임워크 식별 헤더를 정의하는 **공개 표준(IETF·W3C·WHATWG)이 존재하지 않으므로** 이를 제거해도 어떤 표준도 위반하지 않는다 [표준 문서 없음]
- **§15.1.6** [SHOULD] 식별 헤더를 제거하거나 최소화한다 — 근거는 RFC가 아니라 **OWASP Secure Headers Project의 권고**이며, 이는 규격 준수 요건이 아니라 obscurity 하드닝이다 [OWASP Secure Headers `headers_remove.json`]

## 16. 경계 (다른 계층 · UA 소관 — 이 미들웨어가 구현하지 않는 것)

- **§16.1.1** [무표기] CSP의 차단 판정(should-block-request·should-block-inline·should-block-navigation-request)·소스 매칭·위반 이벤트 발화는 UA 소관이며 이 미들웨어는 문법 준수 헤더를 생성할 뿐이다 [CSP3 #should-block-request]
- **§16.1.2** [무표기] HSTS의 저장·만료·축출·도메인 매칭·URI 스킴 및 포트 치환은 UA 소관이다 [RFC 6797 §8.1.1·§8.2·§8.3]
- **§16.1.3** [무표기] COOP/COEP 획득, CORP check, agent cluster 할당, `SharedArrayBuffer` 삭제는 UA 소관이다 [HTML #obtain-coop·Fetch #cross-origin-resource-policy-internal-check]
- **§16.1.4** [무표기] potentially trustworthy origin 판정은 UA가 수행한다 [Secure Contexts #is-origin-trustworthy]
- **§16.1.5** [무표기] 리포트 생성·큐잉·전달(배치·재시도·credentials)은 UA 소관이며, 이 미들웨어는 엔드포인트를 선언하고 리포트를 수신할 뿐이다 [Reporting-1 #try-delivery]
- **§16.1.6** [무표기] 캐시의 저장·재사용·검증 판정은 캐시 소관이다 [RFC 9111 §5.2]
- **§16.1.7** [무표기] wire-level 메시지 framing·상태줄 생성·`Content-Length` 정합은 http-adapter/메시징 계층 소관이며 이 미들웨어의 규칙이 아니다 [경계: http-adapter STANDARDS.md]
- **§16.1.8** [무표기] 요청 측 CORS 판정과 preflight 응답 생성은 이 미들웨어의 소관이 아니다 [경계: cors STANDARDS.md]
- **§16.1.9** [무표기] `Content-Type` 자체의 생성은 이 미들웨어의 소관이 아니나, §7.1.3에 따라 `nosniff` 방출은 정확한 `Content-Type`을 전제한다 [Fetch #should-response-to-request-be-blocked-due-to-nosniff?]

## 17. 규칙이 아닌 것 (정책)

- **§17.1.1** [무표기] 어떤 헤더를 방출할지, 어떤 소스·출처·feature를 허용할지는 순수 정책이며 어떤 정본도 규정하지 않는다 [파생]
- **§17.1.2** [무표기] HSTS `max-age` 값의 선택, `includeSubDomains` 주장 여부, `preload` 제출 여부는 정책이다 — RFC 6797은 최소·권장값을 정하지 않는다(§5.4.3) [RFC 6797 §11.2]
- **§17.1.3** [무표기] COEP를 `require-corp`로 할지 `credentialless`로 할지, COOP를 `same-origin`으로 할지 `same-origin-allow-popups`로 할지는 정책이다 [파생]
- **§17.1.4** [무표기] CSP를 enforce로 배포할지 report-only로 먼저 관측할지, `default-src 'none'` 기저를 채택할지는 정책이며 CSP3 §8은 non-normative다 [CSP3 #strict-csp]
- **§17.1.5** [무표기] nonce 길이를 128비트 초과로 할지, base64와 base64url 중 무엇을 쓸지는 정책이다(§4.3.2·§4.2.6) [파생]
- **§17.1.6** [무표기] `no-store`·`no-cache, max-age=0`·`private` 중 무엇을 쓸지는 정책이며 RFC 9111은 각 의미만 정의한다 [RFC 9111 §5.2.2]
- **§17.1.7** [무표기] 비보안 응답에서 secure-context 전용 헤더(§3.2.1)를 아예 생성하지 않을지, 생성하되 무효를 감수할지는 정책이다 — 단 `Strict-Transport-Security`는 §5.2.1의 MUST NOT이 적용되어 정책 대상이 아니다 [파생]
- **§17.1.8** [무표기] `Timing-Allow-Origin` 방출 여부와 `*` 사용 여부는 정책이며, 이는 보호가 아니라 노출의 선택이다(§14.6.4) [파생]
- **§17.1.9** [무표기] 어떤 식별 헤더를 제거할지의 목록(OWASP 70종 등)은 벤더 권고 기반 정책이며 규격 요건이 아니다(§15.1.6) [파생]
