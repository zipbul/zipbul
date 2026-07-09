# CORS Standards

**HTTP 응답의 Cross-Origin Resource Sharing(CORS) 정책 적용자가 지켜야 할 규칙의 정본.**

이 문서는 **규칙만** 담는다. 구현 분담은 `CLAUDE.md`, 런타임 동작은 테스트의 소관이다. 이 문서는 구현 코드가 아니라 **1차 출처(WHATWG Fetch·RFC·WICG PNA)만**을 근거로 하며, 전 규칙은 원문 텍스트와 직접 대조되었다.

## 적용 범위 · 주체 선언

이 미들웨어는 **origin server 측 CORS 응답자**다 — 요청의 `Origin`을 판정하고 `Access-Control-*` 응답 헤더를 생성해, 브라우저(user agent)의 CORS 알고리즘이 교차 출처 접근을 허가하도록 만든다.

정본인 WHATWG Fetch Standard는 **CORS를 전적으로 UA(브라우저) 알고리즘으로 규정한다.** §3.3 서두가 명시한다: *"This section explains the CORS protocol as it pertains to server developers. Requirements for user agents are part of the fetch algorithm, except for the new HTTP header syntax."* 따라서 서버 대상 문장은 BCP14 MUST가 아니라 서술형이고, 실제 강제는 fetch 알고리즘(#cors-preflight-fetch·#cors-check)의 "return a network error / return failure" 스텝에 있다. 유일하게 서버를 직접 구속하는 부분은 헤더 **문법**(#http-new-header-syntax)이다. 이 문서의 서버 규칙은 대부분 그 UA 알고리즘에서 **파생**된 의무다.

## 규범 수준 규약

Fetch가 알고리즘 기반이라, 이 문서의 수준은 컴프레션 문서(BCP14 키워드 기준)와 달리 **위반 시의 기능적 결과**로 정의한다:

- **MUST / MUST NOT** — 위반하면 브라우저가 교차 출처 접근을 거부하거나 프리플라이트가 network error로 실패한다(#cors-preflight-fetch·#cors-check 알고리즘이 강제). Fetch가 서버 MUST로 적지 않아도 결과는 하드 실패다. 각 규칙에 파생 원천과 원 수신 주체(대개 UA)를 밝힌다.
- **SHOULD / SHOULD NOT** — 외부 RFC의 서버 대상 권고(RFC 9110 §12.5.5 등) 또는 Fetch 개발자 가이드의 지시적 권고("is to be used").
- **무표기** — 사실·정의·정책. 하드룰로 강제하지 않는다.

출처 표기는 **안정적 dfn 앵커**(`#...`)를 쓴다 — Fetch는 living standard라 섹션 번호가 바뀌지만 앵커는 불변이다. 포맷: `- **§<섹션>.<항목>.<연번>** [<수준>] <단일 규범 문장> [<출처>]`. 규칙 1개 = 규범 문장 1개 = 수준 1개 = 출처 대괄호 1개(복수 출처는 `·`로 병기).

**대조 기준일 2026-07-06** — 전 규범 문장을 WHATWG Fetch Standard(fetch.spec.whatwg.org 원문 HTML), WICG Private Network Access(Draft CG Report, 2024-09-26 원문), RFC 6454·9110·9111 원문 텍스트와 규칙 단위로 직접 대조 완료(Fetch #cors-check 8스텝·#cors-preflight-fetch·#http-fetch·#http-requests·#http-responses·#cors-protocol-exceptions·#http-new-header-syntax ABNF·#cors-protocol-and-credentials 표·safelist 정의·RFC 6454 §6.2 직렬화·RFC 9110 §12.5.5·RFC 9111 §1.2.2·PNA §3.4.2 포함). Fetch·PNA는 living/draft이므로 재대조 시 이 기준일 이후 변경분만 본다.

인용 정본:
- **CORS 프로토콜·헤더 문법·알고리즘** — WHATWG Fetch Standard.
- **Origin 직렬화** — RFC 6454.
- **`Vary`·캐시 상호작용** — RFC 9110 §12.5.5·RFC 9111.
- **헤더 field-name·token 문법·delta-seconds** — RFC 9110 §5.6.2·RFC 9111 §1.2.2.
- **Private Network Access** — WICG PNA (Draft CG Report; **비-표준** — W3C Standards Track 아님, Fetch Living Standard에 미병합).

---

## 1. Origin 판정 · `Access-Control-Allow-Origin`

- **§1.1.1** [무표기] `Origin` 헤더가 없는 요청은 CORS 대상이 아니며 `Access-Control-*` 응답 헤더의 생성 근거가 없다 [Fetch #http-cors-protocol]
- **§1.1.2** [MUST] `Access-Control-Allow-Origin` 값은 serialized origin 또는 `*`로 생성하고, serialized origin은 `scheme "://" host [ ":" port ]`이므로 trailing slash·path를 붙이지 않으며, port는 scheme 기본 port(http 80·https 443)와 다를 때만 붙인다(기본 port는 생략) — RFC 6454 §6.2가 "기본 port와 다를 때만" 붙이도록 규정하므로 기본 port를 명시하면 §1.1.5 byte 대조에서 UA의 serialized origin과 불일치해 실패한다 [Fetch #http-new-header-syntax·RFC 6454 §6.2]
- **§1.1.3** [MUST NOT] credentials mode "include" 요청의 응답에서 `Access-Control-Allow-Origin`을 `*`로 생성하지 않는다 — 요청 `Origin`을 그대로 에코해야 한다(CORS check 스텝3은 include에 적용되지 않아 `*`가 스텝4 byte 대조에서 실패) [Fetch #cors-check·#cors-protocol-and-credentials]
- **§1.1.4** [무표기] non-credentialed 요청에는 `Access-Control-Allow-Origin: *`가 Origin 대조 없이 CORS check를 통과한다(스텝3) [Fetch #cors-check]
- **§1.1.5** [MUST] 요청 `Origin`에 따라 `Access-Control-Allow-Origin`을 동적으로 선택하면 그 판정에 쓴 Origin과 byte 일치하는 값을 에코한다(CORS check 스텝4는 serialized request origin과 byte 대조) [Fetch #cors-check]
- **§1.1.6** [무표기] 리터럴 `null`을 `Access-Control-Allow-Origin`으로 생성하면 opaque origin(sandboxed iframe·`data:`·`file:` 등, RFC 6454상 `null`로 직렬화됨)의 요청이 CORS check 스텝4를 통과한다 [Fetch #cors-check·RFC 6454 §6.2]
- **§1.1.7** [MUST] actual 응답의 CORS check는 status를 검사하지 않으므로(알고리즘에 status 조건 스텝이 없음), 2xx뿐 아니라 4xx·5xx 등 모든 actual 응답에도 `Access-Control-Allow-Origin`(credentialed면 `Access-Control-Allow-Credentials`)을 실어야 한다 — 성공 경로에만 CORS 헤더를 붙이면 오류 응답을 교차 출처 스크립트가 읽지 못한다(단 304·407은 HTTP fetch가 CORS check 자체를 적용하지 않음 → §1.1.9) [Fetch #cors-check·#http-fetch]
- **§1.1.8** [MUST] cors 요청이 교차 출처 redirect를 거치면 redirect-taint로 브라우저가 request origin을 리터럴 `null`로 byte-직렬화해 보내므로(§1.1.6의 opaque-origin `null`과 별개 출처), redirect 후 최종 응답 서버는 `Access-Control-Allow-Origin: null`(non-credentialed) 또는 `*`로 응답해야 CORS check 스텝4를 통과한다 — 원 `Origin` 에코는 byte 대조에서 실패한다 [Fetch #cors-check·#serializing-a-request-origin]
- **§1.1.9** [MUST] cors 요청 중 교차 출처 3xx(301·302·303·307·308) redirect 응답 **자체**에도 유효한 `Access-Control-Allow-Origin`을 실어야 한다 — HTTP fetch는 304·407 외 모든 응답(리다이렉트 포함)에 CORS check를 적용하며, 실패 시 redirect를 따라가기 전에 network error가 된다 [Fetch #http-fetch·#cors-check]
- **§1.1.10** [무표기] `Origin` 헤더의 존재가 요청이 교차 출처임을 보장하지 않는다 — 브라우저는 메서드가 GET·HEAD가 아닌 모든 요청(같은 출처 POST 등)에도 `Origin`을 실으므로, `Origin` 유무만으로 CORS 참여 여부를 판정할 수 없다 [Fetch #http-requests]
- **§1.1.11** [MUST] `Access-Control-Allow-Origin`은 단일 serialized origin 하나, `null`, 또는 `*` 중 하나만 생성하며 공백·comma로 복수 origin을 나열하거나 서브도메인 와일드카드(`https://*.example.com`)를 생성하지 않는다 — 문법이 `origin-or-null / "*"`뿐이라 다중값·패턴 문자열은 CORS check 스텝4 byte 대조에서 어떤 단일 request origin과도 일치하지 않아 실패한다(복수 origin 지원은 Origin 판정 후 에코 + `Vary: Origin`으로 구현) [Fetch #http-new-header-syntax·#cors-check]

## 2. Credentials

- **§2.1.1** [MUST] `Access-Control-Allow-Credentials`를 생성한다면 값은 정확히 소문자 `true`로 생성한다(ABNF `%s"true"` — byte case-sensitive, `True`/`TRUE` 무효) [Fetch #http-new-header-syntax·#cors-protocol-and-credentials]
- **§2.1.2** [무표기] `Access-Control-Allow-Credentials`는 credentials mode "include" 요청에서만 CORS check가 참조하며(스텝6–7), non-include 요청에서는 무시된다 [Fetch #cors-check·#cors-protocol-and-credentials]
- **§2.1.3** [MUST] credentials mode "include" 요청의 응답을 공유하려면 `Access-Control-Allow-Credentials: true`를 생성한다 — 부재 시 CORS check 스텝6에서 credentials가 `true`가 아니어서 스텝8이 failure를 반환해 응답이 공유되지 않는다 [Fetch #cors-check·#cors-protocol-and-credentials]
- **§2.1.4** [MUST] preflight를 유발하는 credentialed 요청에서는 `Access-Control-Allow-Credentials: true`를 preflight(OPTIONS) 응답과 actual 응답 **양쪽**에 생성한다 — CORS check가 각 응답에 독립 실행되어 한쪽에만 있으면 다른 쪽이 network error로 실패한다 [Fetch #cors-preflight-fetch·#cors-check]
- **§2.2.1** [MUST NOT] credentials mode "include" 요청의 응답에서 `Access-Control-Allow-Methods`·`Access-Control-Allow-Headers`·`Access-Control-Expose-Headers` 값으로 와일드카드 `*`를 쓰지 않는다 — include 요청에서 `*`는 리터럴 이름으로만 취급되어 아무것도 매치하지 않으므로 허용 대상을 명시 열거한다 [Fetch #http-new-header-syntax·#cors-protocol-and-credentials]

## 3. Preflight

- **§3.1.1** [무표기] 브라우저는 actual 요청의 메서드가 CORS-safelisted(GET/HEAD/POST)가 아니거나, CORS-unsafe 요청 헤더를 담거나, use-CORS-preflight flag가 설정될 때(XMLHttpRequestUpload에 이벤트 리스너가 등록됐거나 ReadableStream 본문일 때) preflight(`OPTIONS`)를 보내며, 서버는 preflight 발생 여부를 강제·억제할 수 없다 [Fetch #http-fetch]
- **§3.1.2** [무표기] 브라우저는 preflight에 `Access-Control-Request-Method`(actual 메서드)와, CORS-unsafe 요청 헤더가 있으면 `Access-Control-Request-Headers`(정렬·소문자·comma 결합)를 담아 보낸다 [Fetch #cors-preflight-fetch·#cors-unsafe-request-header-names]
- **§3.1.3** [무표기] 브라우저의 preflight(OPTIONS) 요청 자체는 credentials(쿠키·TLS client cert 등)를 싣지 않는다(preflight의 credentials mode는 include가 아니며, CORS check는 preflight가 아닌 actual request 기준으로 수행됨) — 따라서 서버는 preflight 응답을 인증 게이트 뒤에 두거나 preflight 처리를 쿠키·세션에 의존해선 안 된다 [Fetch #cors-preflight-fetch]
- **§3.2.1** [MUST] preflight 성공 응답의 상태 코드는 ok status(200–299)로 생성한다 — 그 외 상태는 CORS 헤더가 정확해도 network error로 실패한다 [Fetch #cors-preflight-fetch·#ok-status]
- **§3.2.2** [MUST] preflight 응답도 CORS check를 통과해야 하므로 §1·§2에 따라 유효한 `Access-Control-Allow-Origin`(credentialed면 `Access-Control-Allow-Credentials: true`)을 생성한다 — 이 check는 ACAM/ACAH 파싱보다 먼저 게이트하므로 ACAM/ACAH가 완벽해도 ACAO 부재면 network error다 [Fetch #cors-preflight-fetch·#cors-check]
- **§3.3.1** [MUST] preflight 응답의 `Access-Control-Allow-Methods`에 요청 `Access-Control-Request-Method`가 포함되도록 생성한다(단 CORS-safelisted 메서드 GET/HEAD/POST는 목록에 없어도 통과) [Fetch #cors-preflight-fetch]
- **§3.3.2** [무표기] `Access-Control-Allow-Methods: *`는 non-credentialed 요청에서만 임의 메서드를 매치하며 credentials include면 리터럴로 취급된다 [Fetch #cors-preflight-fetch·#cors-protocol-and-credentials]
- **§3.3.3** [MUST] `Access-Control-Allow-Methods`의 메서드 이름은 request 메서드와 byte-case-sensitive로 대조된다(§3.4.1 헤더 이름의 case-insensitive 대조와 다름) — UA는 DELETE·GET·HEAD·OPTIONS·POST·PUT만 대문자로 정규화하므로 그 외 커스텀 메서드(예: `PATCH`)는 request가 쓰는 정확한 대소문자로 생성한다 [Fetch #cors-preflight-fetch·#concept-method-normalize]
- **§3.3.4** [무표기] preflight의 허용 메서드는 오직 `Access-Control-Allow-Methods`로만 광고하며, 표준 HTTP `Allow` 헤더는 CORS 프로토콜과 무관해 브라우저가 참조하지 않는다 [Fetch #http-responses]
- **§3.4.1** [MUST] 요청 `Access-Control-Request-Headers`에 나열된 각 CORS-unsafe 헤더 이름이 `Access-Control-Allow-Headers`에 byte-case-insensitive로 포함되도록 생성한다(non-credentialed면 `*`로 갈음 가능) [Fetch #cors-preflight-fetch]
- **§3.4.2** [MUST] `Authorization`이 요청 `Access-Control-Request-Headers`에 있으면 `Access-Control-Allow-Headers`에 `Authorization`을 명시 포함한다 — `Authorization`은 CORS non-wildcard request-header name이라 non-credentialed에서도 `*`로 커버되지 않는다 [Fetch #cors-preflight-fetch·#cors-non-wildcard-request-header-name]
- **§3.5.1** [무표기] `Access-Control-Max-Age`는 preflight 결과 캐시 시간을 초(delta-seconds)로 지정하며, 부재·파싱실패 시 브라우저 기본값은 5초다 [Fetch #cors-preflight-fetch·#http-new-header-syntax]
- **§3.5.2** [무표기] 브라우저는 `Access-Control-Max-Age`에 UA 정의 상한을 적용하며(스펙에 수치 없음), 서버가 그보다 큰 값을 보내도 상한으로 절삭된다 [Fetch #cors-preflight-fetch]

## 4. Expose-Headers · safelist

- **§4.1.1** [무표기] 응답 헤더 `Cache-Control`·`Content-Language`·`Content-Length`·`Content-Type`·`Expires`·`Last-Modified`·`Pragma`(CORS-safelisted response-header name)는 항상 스크립트에 노출되므로 `Access-Control-Expose-Headers`에 나열할 필요가 없다 [Fetch #cors-safelisted-response-header-name]
- **§4.1.2** [MUST] 위 safelist 외의 응답 헤더를 교차 출처 스크립트에 노출하려면 `Access-Control-Expose-Headers`에 그 이름을 생성한다 [Fetch #http-fetch·#http-new-header-syntax]
- **§4.1.3** [무표기] `Access-Control-Expose-Headers: *`는 non-credentialed 요청에서만 모든 응답 헤더 이름으로 확장되고, credentials include 요청에서는 리터럴 `*`로 취급된다 [Fetch #http-fetch·#cors-protocol-and-credentials]
- **§4.1.4** [MUST NOT] `Set-Cookie`·`Set-Cookie2`(forbidden response-header name)를 `Access-Control-Expose-Headers`로 노출하려 시도하지 않는다 — 명시 나열로도 `*`로도 스크립트에 노출되지 않는다 [Fetch #forbidden-response-header-name·#cors-safelisted-response-header-name]
- **§4.2.1** [무표기] CORS-safelisted request-header(accept·accept-language·content-language·content-type·range)는 값 제약(각 value ≤128 octet; content-type essence는 `application/x-www-form-urlencoded`·`multipart/form-data`·`text/plain`만) 충족 시 preflight 없이 전송되며, 서버는 이를 non-preflighted 요청에서 받을 수 있다 [Fetch #cors-safelisted-request-header]
- **§4.2.2** [무표기] safelisted 요청 헤더들의 value 길이 합계가 1024 octet을 넘으면 브라우저가 그것들을 CORS-unsafe로 전환해 preflight를 유발한다 [Fetch #cors-unsafe-request-header-names]
- **§4.2.3** [무표기] 서버는 CORS-safelisted가 아닌 Content-Type `application/csp-report`·`application/expect-ct-report+json`·`application/xss-auditor-report`·`application/ocsp-request`를 담은 교차 출처 요청도 preflight 없이 수신할 수 있다 — "non-safelisted Content-Type이면 preflight를 거쳤다"고 가정하면 안 된다 [Fetch #cors-protocol-exceptions]
- **§4.3.1** [무표기] forbidden request-header(`Cookie`·`Host`·`Origin`·`Connection`·`sec-*`·`proxy-*` 등)와 `Access-Control-Request-*`는 브라우저가 스크립트의 설정을 차단하므로, 서버는 스크립트가 이를 위조 설정하는 상황을 방어할 필요가 없다 [Fetch #forbidden-request-header]

## 5. `Vary` · 캐시

- **§5.1.1** [SHOULD] `Access-Control-Allow-Origin`을 요청 `Origin`에 따라 동적으로 생성하는 응답에는 `Vary: Origin`을 생성한다 — 없으면 non-CORS 응답이 캐시되어 후속 CORS 요청에 ACAO 없이 재사용된다 [RFC 9110 §12.5.5·Fetch #cors-protocol-and-http-caches]
- **§5.1.2** [무표기] `Access-Control-Allow-Origin`이 정적 `*` 또는 고정 단일 origin이고 모든 응답(비-CORS 포함)에 항상 실린다면 `Vary: Origin`은 불필요하다 [Fetch #cors-protocol-and-http-caches]
- **§5.2.1** [SHOULD] preflight 응답이 요청 `Access-Control-Request-Method`/`-Headers`에 따라 달라지면 그 응답에 해당 요청 헤더를 `Vary`로 표시해 캐시 정합을 유지한다 [RFC 9110 §12.5.5]

## 6. Private Network Access (Draft — 비-표준)

- **§6.1.1** [무표기] PNA 헤더 `Access-Control-Request-Private-Network`/`Access-Control-Allow-Private-Network`는 WICG Private Network Access draft §2.3(Additional CORS Headers)에만 정의되며 Fetch Living Standard에 미병합이고, 이 draft는 비-표준이다(원문: *"not a W3C Standard nor is it on the W3C Standards Track"* — 번호 없는 "Status of this document" 섹션) [PNA Draft CG Report 2024-09-26 §2.3·SotD]
- **§6.2.1** [MUST] preflight 요청에 `Access-Control-Request-Private-Network: true`가 있고 그 사설망 접근을 허가한다면 응답에 `Access-Control-Allow-Private-Network: true`(정확히 소문자 `true`)를 생성한다 — 아니면 preflight가 network error로 실패한다 [PNA §3.4.2]
- **§6.2.2** [무표기] 사설망 접근을 허가하지 않으면 `Access-Control-Allow-Private-Network`를 생성하지 않으며(브라우저가 접근 차단), 이 헤더는 PNA preflight 요청에만 의미가 있다 [PNA §3.4.2·§1.2.1]

## 7. 헤더 문법 (ABNF — Fetch가 규정하는 유일한 서버-normative 부분)

- **§7.1.1** [MUST] `Access-Control-Allow-Origin`은 `origin-or-null / "*"` 문법으로 생성한다 [Fetch #http-new-header-syntax]
- **§7.1.2** [MUST] `Access-Control-Allow-Methods`(`#method`)·`Access-Control-Allow-Headers`(`#field-name`)·`Access-Control-Expose-Headers`(`#field-name`)는 comma-분리 list 문법으로 생성한다 [Fetch #http-new-header-syntax·RFC 9110 §5.6.1]
- **§7.1.3** [MUST] `Access-Control-Max-Age`는 `delta-seconds`(1*DIGIT, 비음·지수표기 아님) 문법으로 생성한다 [Fetch #http-new-header-syntax·RFC 9111 §1.2.2]
- **§7.1.4** [MUST] `Access-Control-Allow-Methods`·`Access-Control-Allow-Headers`·`Access-Control-Expose-Headers`에 나열하는 각 메서드·헤더 이름은 유효한 RFC 9110 §5.6.2 token으로 생성한다 [RFC 9110 §5.6.2]

## 8. 범위 밖 (이 미들웨어가 다루지 않는 것)

- **§8.1.1** [무표기] 브라우저의 CORS 강제(CORS check·preflight fetch 알고리즘)는 UA 소관이며, 이 미들웨어는 UA가 접근을 허가하도록 응답 헤더를 생성할 뿐 브라우저 동작을 구현하지 않는다 [Fetch #cors-preflight-fetch·#cors-check]
- **§8.2.1** [무표기] wire-level 메시지 framing·`Content-Length` 전송 정합·상태줄 생성은 http-adapter/메시징 계층 소관이며 이 미들웨어의 규칙이 아니다 [경계: http-adapter STANDARDS.md]
- **§8.3.1** [무표기] `Origin` 헤더의 생성·직렬화는 UA 소관이며, 서버는 수신한 `Origin`을 신뢰 경계 판정 입력으로만 쓴다 [RFC 6454 §7·Fetch #http-cors-protocol]
- **§8.4.1** [무표기] CSRF 방어는 CORS와 별개다 — CORS는 응답 공유를 통제할 뿐 요청 도달 자체를 막지 않으므로 CSRF 완화 수단으로 의존하지 않는다 [파생]

## 9. 규칙이 아닌 것 (정책)

- **§9.1.1** [무표기] 어떤 origin을 허용할지의 판정 방식은 순수 정책이며 어떤 정본도 규정하지 않는다 [파생]
- **§9.1.2** [무표기] preflight 응답을 다음 핸들러로 넘길지, 성공 상태로 200·204 중 무엇을 쓸지는 정책이다(단 §3.2.1의 ok-status 범위는 지킨다) [Fetch #cors-preflight-fetch]
- **§9.1.3** [무표기] 기본 허용 메서드 집합·기본 `maxAge` 유무·기본 origin 판정은 정책이다 [파생]
- **§9.1.4** [무표기] CORS 실패는 관련 `Access-Control-*` 헤더를 생성하지 않음으로 표현하며(브라우저가 접근 차단), 이를 명시적으로 표기하려면 `403`을 함께 쓸 수 있다 — 단 서버가 수행한 작업은 타이밍 등 side channel로 새어나갈 수 있다 [Fetch #http-responses]
