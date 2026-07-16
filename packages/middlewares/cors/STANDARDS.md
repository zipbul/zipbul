# CORS Standards

**origin server 측 CORS 응답자가 준수해야 할 국제 규칙.**

**스냅샷 2026-07-10** — WHATWG Fetch Standard(living), WHATWG URL Standard, RFC 9110·9111, WICG Private Network Access(Draft CG Report 2024-09-26, 비-표준). Origin 직렬화는 Fetch `#origin-header`가 RFC 6454를 대체한다(*"This supplants the definition in The Web Origin Concept."*).

---

## 1. 헤더 문법

- **§1.1** [MUST] `Access-Control-Allow-Origin`은 `origin-or-null / "*"`로 생성한다 — `null`은 `%s"null"`(byte case-sensitive, 소문자만)이며, 이 문법에는 list 구문이 없으므로 복수 origin의 comma·공백 나열과 서브도메인 패턴(`https://*.example.com`)은 표현 자체가 불가능하다 [Fetch #http-new-header-syntax·#origin-header]
- **§1.2** [MUST] serialized origin은 `serialized-scheme "://" serialized-host [ ":" serialized-port ]`로 생성하며 trailing slash·path를 붙이지 않는다 — UA의 URL 파서는 scheme 기본 port(http 80·https 443)를 null로 만들어 직렬화에서 생략하므로, 기본 port를 명시한 값은 §2.2 byte 대조에서 실패한다 [Fetch #origin-header·URL §4.4]
- **§1.3** [MUST] serialized origin의 scheme·domain은 소문자 ASCII로 percent-encoding 없이 생성하고, IPv6 host는 대괄호로 감싸 소문자 hex·선행 0 금지·`::`로 단일 `0` 블록 생략 금지·**하위 비트의 IPv4 점표기(embedded-IPv4, 예 `[::ffff:192.168.0.1]`) 금지**를 지키며, port는 `1*5DIGIT`으로 생성한다 — `serialized-ipv6`에는 `dec-octet` 대안이 없다 [Fetch #origin-header]
- **§1.4** [MUST] `Access-Control-Allow-Credentials`는 `%s"true"`로 생성한다(byte case-sensitive — `True`/`TRUE` 무효) [Fetch #http-new-header-syntax]
- **§1.5** [MUST] `Access-Control-Allow-Methods`는 `#method`, `Access-Control-Allow-Headers`·`Access-Control-Expose-Headers`는 `#field-name` list 문법으로 생성한다 — `#` 생성 규칙상 각 원소는 `token = 1*tchar`이고 송신자는 빈 list 원소(선행·후행 comma, `,,`)를 생성할 수 없다(*"a sender MUST NOT generate empty list elements"*) — 요청 `Access-Control-Request-Headers`를 에코할 때도 빈 원소를 제거한 뒤 생성한다 [Fetch #http-new-header-syntax·RFC 9110 §5.6.1.1·§5.6.2]
- **§1.6** [MUST] `Access-Control-Max-Age`는 `delta-seconds = 1*DIGIT`로 생성한다(음수·지수표기 불가) [Fetch #http-new-header-syntax·RFC 9111 §1.2.2]

## 2. CORS check

- **§2.1** [MUST] 공유하려는 응답에는 `Access-Control-Allow-Origin`을 생성한다 — 부재는 리터럴 값 `null`과 다르며(*"Null is not `null`."*) 항상 CORS check failure다 [Fetch #cors-check]
- **§2.2** [MUST] `Access-Control-Allow-Origin` 값은 byte-serialized request origin과 byte 일치하게 생성한다 — `*`는 credentials mode가 "include"가 아닐 때만 이 대조를 우회한다(따라서 include 응답에 `*`는 항상 실패). UA는 hop마다 `Origin` 헤더를 재계산해 보내므로(redirect-taint가 "same-origin"이 아니면 `Origin: null` 수신) 수신한 `Origin` 값을 그대로 에코하면 항상 대조를 통과한다. 요청의 credentials mode는 서버에서 관측 불가하므로(*"not necessarily observable on the server"*) 쿠키 유무로 `*`/에코를 선택해선 안 된다 [Fetch #cors-check·#serializing-a-request-origin·#cors-protocol-and-credentials]
- **§2.3** [MUST] credentials mode "include" 요청의 응답을 공유하려면 `Access-Control-Allow-Credentials: true`를 생성한다 — 부재·타값이면 CORS check 마지막 스텝이 failure를 반환한다 [Fetch #cors-check]
- **§2.4** [MUST] `Access-Control-Allow-Origin`과 `Access-Control-Allow-Credentials`는 한 응답에 각각 한 번만 생성한다 — UA의 `get`이 중복 필드를 `0x2C 0x20`으로 결합해 읽으므로 결합값(`https://a.com, https://a.com`·`true, true`)이 byte 대조에 실패한다 [Fetch #cors-check·#terminology-headers]

## 3. Preflight

- **§3.1** [MUST] preflight 응답의 상태 코드는 ok status(200–299)로 생성하고 §2를 만족시킨다 — 어느 쪽이든 어기면 network error다 [Fetch #cors-preflight-fetch·#cors-check]
- **§3.2** [MUST] `Access-Control-Allow-Methods`·`Access-Control-Allow-Headers`의 값은 해당 ABNF로 추출 가능하게 생성한다 — *"If either methods or headerNames is failure, return a network error."* 파싱 실패가 5초 기본값으로 대체되는 `Access-Control-Max-Age`와 달리 preflight 전체가 실패한다 [Fetch #cors-preflight-fetch]
- **§3.3** [MUST] `Access-Control-Allow-Methods`에 요청 `Access-Control-Request-Method`를 포함해 생성한다 — 예외 셋: CORS-safelisted 메서드(`GET`·`HEAD`·`POST`)는 목록에 없어도 통과하고, non-credentialed 요청은 `*`로 갈음할 수 있으며, use-CORS-preflight flag로만 유발된 preflight에서 이 헤더를 아예 생략하면 UA가 요청 메서드로 목록을 합성한다(*"If methods is null and request's use-CORS-preflight flag is set, then set methods to a new list containing request's method."*) [Fetch #cors-preflight-fetch]
- **§3.4** [MUST] `Access-Control-Allow-Methods`의 메서드 이름은 request 메서드와 byte 일치하게 생성한다 — UA는 `DELETE`·`GET`·`HEAD`·`OPTIONS`·`POST`·`PUT`만 대문자로 정규화하므로 그 외 커스텀 메서드(예: `PATCH`)는 request가 쓰는 정확한 대소문자로 생성한다 [Fetch #cors-preflight-fetch·#concept-method-normalize]
- **§3.5** [MUST] 요청 header list에 `Authorization`이 있으면 `Access-Control-Allow-Headers`에 `Authorization`을 명시 포함해 생성한다 — CORS non-wildcard request-header name이라 non-credentialed에서도 `*`로 커버되지 않는다 [Fetch #cors-preflight-fetch·#cors-non-wildcard-request-header-name]
- **§3.6** [MUST] 요청의 각 CORS-unsafe request-header name을 `Access-Control-Allow-Headers`에 byte-case-insensitive로 포함해 생성한다 — non-credentialed 요청에서만 `*`로 갈음할 수 있다 [Fetch #cors-preflight-fetch]
- **§3.7** [MUST NOT] credentials mode "include" 요청의 응답에서 `Access-Control-Allow-Methods`·`Access-Control-Allow-Headers`·`Access-Control-Expose-Headers`의 값으로 `*`를 쓰지 않는다 — *"response headers can only use `*` as value when request's credentials mode is not "include"."* include에서 `*`는 리터럴 이름으로만 취급되어 ACAM/ACAH 위반은 network error로, ACEH 위반은 아무 헤더도 노출되지 않는 조용한 실패로 나타난다 [Fetch #cors-protocol-and-credentials·#cors-preflight-fetch·#main-fetch]
- **§3.8** [MUST] 후속 actual 요청이 credentialed라면 preflight 응답 자체에도 `Access-Control-Allow-Credentials: true`와 에코된(비-`*`) origin을 생성한다 — preflight의 CORS check는 actual request의 credentials mode로 실행되며, preflight 요청은 credentials를 절대 싣지 않으므로(*"a CORS-preflight request never includes credentials"*) 서버가 preflight에서 credentials를 관찰해 판단할 수 없다. *"Support therefore needs to be indicated as part of the HTTP response to the CORS-preflight request as well."* [Fetch #http-responses·#cors-preflight-fetch]

## 4. Actual 응답

- **§4.1** [MUST] 공유하려는(*"one where the server developer intends to share it"*) 응답에는 상태 코드와 무관하게 — 2xx뿐 아니라 4xx·5xx도 — §2를 만족하는 헤더를 생성한다. CORS check에 status 조건 스텝이 없다. 공유하지 않으려는 응답에서 헤더를 생략하는 것은 정본이 인정하는 표현이다(*"the 403 status can be used, coupled with omitting the relevant headers"*). 단 3xx redirect 응답은 CORS check에 실패하면 따라가기 전에 network error가 되므로, redirect가 이어지려면 그 응답 자체가 §2를 만족해야 한다. status 304·407과 service worker 응답에는 CORS check가 적용되지 않는다 [Fetch #http-responses·#http-fetch·#cors-check]
- **§4.2** [MUST] safelist(`Cache-Control`·`Content-Language`·`Content-Length`·`Content-Type`·`Expires`·`Last-Modified`·`Pragma`) 밖의 응답 헤더를 교차 출처 스크립트에 노출하려면 actual(non-preflight) 응답에 `Access-Control-Expose-Headers`로 그 이름을 생성한다 — preflight 응답에 실으면 무시된다 [Fetch #http-responses·#main-fetch]

## 5. Redirect

- **§5.1** [MUST NOT] cors 요청에 대한 3xx 응답의 `Location` URL에 credentials(userinfo, `https://user:pass@host/`)를 포함하지 않는다 — mode "cors"의 교차 출처 redirect와 response tainting "cors"의 모든 redirect(교차 출처 자원이 same-origin URL로 되돌리는 경우 포함)에서 network error다 [Fetch #http-redirect-fetch]

## 6. Private Network Access (비-표준 draft)

- **§6.1** [MUST] preflight 요청에 `Access-Control-Request-Private-Network: true`가 있고 그 사설망 접근을 허가한다면 응답에 `Access-Control-Allow-Private-Network: true`를 생성한다 — 리터럴 `"true"` 대조라 `True`/`TRUE`는 무효이며(*"If allow is not `"true"`, return a network error."*), 이 검사는 CORS check **직후**에 실행되므로 그 preflight 응답은 §2·§3도 함께 만족해야 한다 [PNA §3.4.2·Fetch #cors-check]
- **§6.2** [MUST] 비-보안(HTTP) 사설망 targetAddressSpace fetch를 허가하면서 `Private-Network-Access-ID`와 `Private-Network-Access-Name`을 **둘 다** 생성하는 경우, ID는 콜론으로 구분된 6개 16진 바이트(예 `01:23:45:67:89:0A`)로, Name은 `/^[a-z0-9_\-.]+$/`에 일치하고 UTF-8 code unit 248개 이하로 생성한다 — 형식 위반은 network error다. 둘 중 하나라도 부재·공백이면 형식 검사 없이 UA가 ephemeral 권한으로 처리한다 [PNA §3.4.2]

## 7. 캐시

- **§7.1** [SHOULD] `Access-Control-Allow-Origin`의 유무 또는 값이 요청 `Origin`에 따라 달라지는 자원은 그 자원의 **모든** 응답 — ACAO를 싣지 않는 응답(비-CORS 요청 응답, Origin 거부 응답) 포함 — 에 `Vary: Origin`을 생성한다 — 누락하면 ACAO 없는 캐시 응답이 후속 CORS 요청에 재사용된다(*"`Vary` is to be used"*) [Fetch #cors-protocol-and-http-caches·RFC 9110 §12.5.5]
- **§7.2** [SHOULD] `Access-Control-Allow-Origin`을 정적 `*` 또는 고정 단일 origin으로 운용한다면 비-CORS 요청 응답을 포함해 그 자원의 **모든 응답에 항상** 그 헤더를 생성하고 `Vary`를 쓰지 않는다 — *"configure the server to always send `Access-Control-Allow-Origin` in responses for the resource — for non-CORS requests as well as CORS requests — and do not use `Vary`."* [Fetch #cors-protocol-and-http-caches]

## 8. 보안

- **§8.1** [SHOULD NOT] IP 인증·방화벽 등 네트워크 위치로만 보호되는 자원에는 `Access-Control-Allow-Origin: *`를 생성하지 않는다 — *"if a resource cannot be accessed from a random device connected to the web using curl and wget the aforementioned header is not to be included."* [Fetch #basic-safe-cors-protocol-setup]
- **§8.2** [SHOULD] 서버는 CORS-safelisted가 아닌 Content-Type(`application/csp-report`·`application/expect-ct-report+json`·`application/xss-auditor-report`·`application/ocsp-request`)을 담은 교차 출처 요청도 preflight 없이 수신할 것으로 예상해야 한다 — *"servers should expect cross-origin web content to be allowed to trigger non-preflighted requests"* [Fetch #cors-protocol-exceptions]
