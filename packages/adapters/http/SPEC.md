# @zipbul/http-adapter — HTTP Server Specification

이 문서는 `@zipbul/http-adapter`(HTTP/1.1 origin-server 어댑터)가 **지켜야 할 규칙의 정본**이다. 각 항목은 **어댑터의 MUST / MUST NOT**이다. 코드가 이를 어기면 결함이며, 결함 판정·코드 변경·리뷰의 기준이다. 여기 명시되지 않은 것은 범위 밖이다. (패키지 정의는 `CLAUDE.md`.)

이 문서는 **어댑터의 규칙만** 담는다. "런타임(Bun)이 실제로 무엇을 거부/통과/생성하는가"는 *규칙이 아니라 측정 대상*이며 `probe/`(계측기 + baseline)가 그 정본이다 — 이 문서는 런타임 동작을 단언하지 않는다. 규칙이 런타임 위임을 전제하더라도, 그 전제의 사실 여부는 `probe/`가 보증한다.

표준 인용은 1차 출처(현행 RFC / WHATWG)로 검증한다.

---

## 1. 범위 경계

### 1.1 어댑터가 구현·검증하지 않는다 (wire-level, MUST NOT reimplement)
어댑터는 다음 wire-level 처리를 재구현하거나 이중 검증하지 않는다:
- 메시지 framing / 헤더 ABNF / 메서드 토큰 tchar 검증
- request smuggling(TE+CL) 거부, 중복·비숫자·음수 `Content-Length` 거부
- obs-fold·control char·NUL·CR/LF injection·bare CR/LF 거부, 비-tchar field-name 거부
- chunked 디코딩, idle timeout, incomplete body 처리, `Expect: 100-continue`
- 헤더 총량 한계, 잘못된 request-target 거부
- 어댑터는 `Date` 응답 헤더를 설정·덮어쓰기·제거하지 않는다.

### 1.2 어댑터가 반드시 결정·강제한다 (MUST)
- **absolute-form request-target** [RFC 9112 §3.2.2]: 받아들이되, 신뢰 경계 밖이거나 `Host`와 불일치하는 authority를 라우팅·origin·redirect 근거로 무비판 신뢰하지 않고 검증해 필요 시 misdirected(421)/404로 처리한다.
- **다중 Host**: comma-join된 다중 Host 요청은 거부한다.
- **메서드 allow-list**와 path `%00` 정책을 적용한다.
- **요청 body 크기**: 어댑터가 자체 한계(`DEFAULT_BODY_LIMIT_BYTES`)로 강제한다.

### 1.3 어댑터 core에 구현하지 않는다 (미들웨어 영역)
| 영역 | 담당 |
|---|---|
| CORS (Access-Control-*) | `@zipbul/cors` (규범: WHATWG Fetch) |
| 보안 헤더 (CSP/HSTS/X-Frame) | `@zipbul/helmet` |
| 압축 (응답 Content-Encoding) | `@zipbul/compression` |
| 쿠키 (Set-Cookie/파싱/서명) | `@zipbul/cookie` (RFC 6265) |
| query 파싱 (querystring→객체) | `@zipbul/query-parser` (어댑터는 raw `queryString`만 노출) |
| multipart/form-data | `@zipbul/multipart` (RFC 7578) |
| rate limit | `@zipbul/rate-limiter` |
| 캐싱(Cache-Control/ETag/Vary) · 조건부 요청(If-*→304) · content negotiation(Accept/Range) | 핸들러 / 캐시 미들웨어 (RFC 9110 §12·§14, RFC 9111) |

어댑터 core는 위 헤더의 **이름 enum과 범용 `setHeader`**만 제공하고 정책 로직은 담지 않는다.

---

## 2. 적용 표준 (현행)

규칙은 현행 RFC에서 도출한다. obsolete된 RFC 2616 / 7230–7235 / 6874는 인용하지 않는다.

| 표준 | 적용 |
|---|---|
| **RFC 9110** HTTP Semantics (STD 97) | 핵심 — §3 전반 |
| **RFC 9112** HTTP/1.1 (STD 99) | 응답 framing, request-target, Host, body-length |
| **RFC 9111** HTTP Caching (STD 98) | origin slice만 (`Warning`·`Pragma`·`Age` 금지) |
| **RFC 3986** URI + **6335** ports + **4291/5952** IPv6 | request-target·authority·IPv6 표현 |
| **RFC 8259** JSON (STD 90) | 응답 직렬화 UTF-8 |
| **RFC 7239** Forwarded | proxy 신뢰(§3.C) 형식 규범 |
| **RFC 10008** HTTP QUERY Method (2026) | 메서드 인지 — 501 거부 금지(§3.B) |
| **WHATWG HTML — Server-Sent Events** | SSE wire 포맷 |
| **WHATWG Fetch** | CORS 규범(미들웨어), null-body status 정의 |

인지만(현재 미적용): RFC 9651 Structured Field Values, RFC 8297 Early Hints(103), 6265bis.

---

## 3. 어댑터 코어 규칙 (MUST)

### A. 응답 framing 정합 [RFC 9110/9112]
- **null-body status에 content 금지** — 204(§15.3.5), 205(§15.3.6 MUST NOT), 304(§15.4.5), 1xx. 어댑터는 이 status에 body를 설정하지 않는다. **`Content-Length`**: 204·1xx에는 emit하지 않는다(§8.6 MUST NOT). 205·304는 §8.6의 CL-MUST-NOT 대상이 아니므로 강제 제거하지 않는다. 이 null-body 정합은 **어댑터가 유일한 방어선이다**(런타임 백스톱을 전제하지 않는다).
- **HEAD 응답에 content 금지**(§9.3.2)하되 헤더는 would-be GET과 동일, `Content-Length`는 GET 본문 길이와 일치(§8.6).
- 어댑터가 emit하는 final status는 **200–599**다. 1xx는 일반 응답 경로 밖이다(§G).
- **hop-by-hop / connection-specific 헤더를 설정하지 않는다**: `Connection`·`Keep-Alive`·`Transfer-Encoding`·`Upgrade`·`Proxy-Connection`(SSE 포함).
- `Content-Length` + `Transfer-Encoding` 동시 emit 금지(RFC 9112 §6.2).
- 위 framing 규칙(null-body content 금지, HEAD body 제거, status 범위)은 `HttpResponse` 경로뿐 아니라 **핸들러가 반환한 native `Response`에도 적용**한다 — 어댑터는 출력 경로에서 framing 위반을 검증해 HEAD body 제거·null-body content 제거를 적용한다(이 출력 정규화는 §4.3의 *입력* 파서 변이 금지와 무관하다).

### B. 라우팅·메서드 (어댑터가 라우터를 소유)
- **405 응답에 `Allow` 헤더 MUST**(§15.5.6). method mismatch는 404가 아니라 405 + Allow.
- **OPTIONS**: 등록 메서드가 있고 명시 핸들러가 없으면 204 + `Allow` 자동 응답.
- **HEAD**: GET 라우트 등록 시 자동 alias하여 GET 핸들러로 라우팅, body 제거 + `Content-Length` parity(§A). 같은 path에 `@Head`+`@Get` 동시 명시는 충돌(금지).
- **미지원 메서드**(어느 라우트에도 없는 토큰)는 **501**로 응답한다(§15.6.2). path는 있고 메서드만 mismatch면 405.
- **알려진 표준 메서드**(GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS 및 `QUERY` [RFC 10008])는 501로 거부하지 않는다.
- 핸들러가 `undefined`/`null`을 반환하면 **204**로 응답한다.

### C. request 해석·신뢰 (보안)
- **request-target authority 우선순위** [RFC 9112 §3.2.2]: origin-form은 검증된 `Host`로 권위 결정. absolute-form은 MUST accept하며 request-target authority가 권위이고 `Host`는 무시된다. 어댑터는 받아들이되 신뢰 경계 밖이거나 `Host`와 불일치하는 authority를 무비판 신뢰하지 않고 검증해 필요 시 421/404로 처리한다. 다중 Host comma-join은 거부한다.
- **proxy trust = 기본 NONE** — 기본은 socket peer. 운영자가 신뢰 proxy를 **명시 설정(`trustProxy`)**한 경우에만 `X-Forwarded-*`·`Forwarded`(RFC 7239)를 해석한다. 신뢰 hop이 CIDR/함수로 지정되면 XFF chain을 신뢰 경계까지 **역방향**으로 평가하고 그 바깥 hop 값은 폐기한다 — **naive한 first-XFF 채택 금지**. `trustProxy: true`(전체 신뢰) opt-in일 때만 first 값을 그대로 쓴다. client IP·`proto`·`host`는 신뢰 hop 범위의 `Forwarded`/`X-Forwarded-*`에서 동일 규칙으로 결정한다.
- path `%00` 정책을 적용하고, 요청 body 크기를 §1.2대로 제한한다.
- request-target 파싱 실패 등 early-parse 오류는 **400**으로 응답한다.

### D. 응답 인코딩·redirect
- JSON 응답은 **UTF-8**(RFC 8259 §8.1).
- body 타입 기반 `Content-Type`을 자동 추론·설정하며 text/* 응답에는 `charset=utf-8`을 포함한다.
- `redirect(url)`의 `url`은 핸들러 제공값이며 어댑터는 위험 scheme(`javascript:`/`data:`/`vbscript:` 등)을 차단하고 `Location`에 설정한다(정규화하지 않음). 어댑터가 **직접 URL을 생성·emit하는 경우에 한해** IPv6는 bracket + canonical(lowercase·`::` 압축, §3986 3.2.2 / §5952 4). 어댑터는 IPv6 zone-id를 URI에 emit하지 않는다(RFC 9844는 6874의 `%25` zone-in-URI 방식을 폐기).

### E. 스트리밍
- SSE: Content-Type **`text/event-stream; charset=utf-8`**, **UTF-8 고정**, 유효 line separator(CRLF/LF/CR), `id` 필드에 NULL(U+0000) 금지(WHATWG HTML §9.2).
- 스트리밍 핸들러 throw는 어댑터 logger로 로깅하고 스트림을 종료한다 — SSE는 `controller.close()`(수신 이벤트 유지·재연결), raw는 `controller.error()`(truncated 신호). 스트림은 pipeline·AdapterContext 밖에서 소비되므로 logger가 유일 경로다.

### F. lifecycle
- drain/shutdown은 in-flight를 보장하고, `end()`는 idempotent하며, 스트리밍 scope는 응답 종료까지 유효하다.

### G. 프로토콜 엣지 (명시)
- **request-target 형식** [RFC 9112 §3.2]: 어댑터는 origin-form / absolute-form을 라우팅한다. **authority-form**(CONNECT 전용)·**asterisk-form(`OPTIONS *`)**은 미지원이며, 도달하면 어댑터가 404/4xx로 응답한다.
- **1xx / upgrade**: 1xx(100/101/103)는 어댑터의 일반 HTTP 응답 경로 밖이다. 어댑터는 101을 emit하거나 `Connection`/`Upgrade`를 설정하지 않는다(§3.A hop-by-hop 금지와 정합). 103(Early Hints)은 미지원.
- **426 Upgrade Required**: 어댑터는 426을 emit하지 않는다. (만약 emit해야 한다면 RFC 9110 §15.5.22·§7.8상 `Upgrade`(+`Connection: Upgrade`)가 필수이므로 §3.A hop-by-hop 금지의 **명시적 예외**다.)
- **Trailer 필드**: 어댑터는 trailer를 emit하지 않는다(미지원).
- **조건부 요청** [RFC 9110 §13]: `If-Match`/`If-None-Match`/`If-Modified-Since`/`If-Range`를 어댑터가 pre-inspect하지 않는다 — 평가·304 생성은 핸들러/캐시 미들웨어 책임(§1.3).
- **`Allow` 구성**: 405·auto-OPTIONS의 `Allow`는 해당 path가 처리 가능한 모든 메서드를 나열하며, GET에서 alias된 **HEAD를 포함**한다(§3.B).

---

## 4. 하지 말 것

### 4.1 MUST 아닌 것을 하드룰로 박지 않는다
- URI 정규화(RFC 3986 §6), JSON 중복키 uniqueness(RFC 8259 §4)는 RFC상 **SHOULD**이며 어댑터가 하드룰로 강제하지 않는다. (OPTIONS→Allow[§9.3.7]·Content-Type emission[§8.3]도 RFC SHOULD이나 어댑터는 §3.B·§3.D에서 정책적으로 채택함 — 모순 아님.)
- RFC 5952 §4(IPv6 생성 규칙)는 어댑터가 IPv6를 emit할 때만 적용한다. 수신 파싱 MUST 아님(legitimate 형식은 모두 수용).
- TRACE "self only"는 RFC 9110에 **없다**(legacy 7231 오인용 금지).

### 4.2 obsolete/deprecated 헤더를 emit하지 않는다 [RFC 9111]
- `Warning`(RFC 9111 obsolete)·`Pragma`(§5.4 deprecated)·`Age`(§5.1, cache 전용).

### 4.3 책임 경계를 침범하지 않는다
- §1.1 wire 파싱 영역을 재구현하지 않는다.
- §1.3 미들웨어 영역(CORS/security/compression/cookie/query/multipart/rate-limit) 로직을 어댑터 core에 넣지 않는다.
- **입력 처리(body·URL 파서)는 응답을 변이시키지 않는다** — 요청 Content-Type/Encoding을 읽어 파싱 방식을 결정할 뿐, 응답 헤더를 설정하지 않는다.

---

## 5. 어댑터 자체 계약 (표준 외 불변식)
1. **Self-consistency** — 공개 계약(JSDoc·타입·docstring)과 런타임 동작이 불일치하면 결함이다.
2. **Fail-safe** — 보안 경계는 fail-closed (proxy trust 평가 실패 시 비신뢰, 검증 실패 시 throw).
3. **No `as` 우회** — 타입을 정확히 만들어 단언이 필요 없게 한다.
4. **결함 판정 기준**: ① 현행 RFC MUST/MUST NOT 위반, ② runtime crash/hang 재현, ③ 보안 우회 재현, ④ self-inconsistency. 이 넷 중 하나여야 결함. "타 프레임워크 관행·modern 기대치·DX/네이밍 nit·이론적 허점"은 결함 아님.
