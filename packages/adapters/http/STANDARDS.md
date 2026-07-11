# HTTP Standards

**HTTP/1.1 origin-server가 지켜야 할 규칙의 정본.**

이 문서는 **규칙만** 담는다. 구현 분담은 `CLAUDE.md`, 런타임 동작은 `probe/`의 소관이다.

**대조 기준일 2026-07-02** — 전 규범 문장을 rfc-editor.org 원문(verified errata 포함) 및 WHATWG HTML(living standard, 동일 기준일 스냅숏)과 전수 대조 완료. RFC 인용은 불변이나, WHATWG SSE(§6)와 RFC 10008(신규 표준, errata 추가 가능)은 재대조 시 이 기준일 이후 변경분만 보면 된다. 2026-07-05 재대조: §5.8.2의 수준 오표기를 정정하고, 응답 측 content coding 선택 규칙(구 §5.8.3)을 coding 적용 미들웨어 소관으로 이관했다.

## 포맷 규격

모든 규칙은 정확히 이 문법의 bullet 한 줄이다 (기계 파싱 가능):

```
- **§<섹션>.<항목>.<연번>** [<수준>] <단일 규범 문장> [<출처>]
```

- **수준**은 `MUST` / `MUST NOT` / `SHOULD` / `SHOULD NOT` / `MAY` / `무표기` 6종. `무표기`는 1차 출처에 BCP14 규범 키워드가 없는 사실·정의·파생 요건이며 하드룰로 강제하지 않는다.
- **규칙 1개 = 규범 문장 1개 = 수준 1개 = 출처 대괄호 1개.** 출처 대괄호 안에는 복수 섹션을 `·`로 병기할 수 있다.
- 두 부분 ID(예: §2.12)는 그 항목의 규칙군 전체를 가리키고, 세 부분 ID(예: §2.12.4)는 규칙 하나를 가리킨다.
- 규칙 bullet 외의 산문(이 서두, 섹션 제목)은 규칙이 아니다.

## 적용 범위 · 프로토콜별 지배 표준

이 어댑터는 `Bun.serve` 위의 **HTTP/1.1 요청/응답 의미론만** 담당한다. 프로토콜이 다르면 별도 어댑터로 분리한다.

이 문서의 대상:
- **HTTP/1.1** — RFC 9110(의미론)·9112(메시징)·9111(캐싱); 부속 8259(JSON)·7239(Forwarded)·3986+5952/9844(URI/IPv6)·10008(QUERY)·6585(추가 status)·5789(PATCH). → §1~§11.
- **Server-Sent Events** — HTTP/1.1 응답의 한 형태(`text/event-stream`)이므로 포함 [WHATWG HTML §9.2]. → §6.

전송 계층(런타임 소관, 이 문서에 규칙을 담지 않음):
- **TLS/HTTPS** — Bun/런타임이 처리. 이 어댑터는 `https` authority 의미론(§4.9)만 강제하고 TLS 핸드셰이크·ALPN(RFC 8446·7301)은 담지 않는다.

별도 어댑터 소관(범위 밖):
- **WebSocket** (RFC 6455·7692) → `@zipbul/websocket-adapter`. request/response가 아닌 양방향 frame 모델이라 파이프라인이 다르다.
- **HTTP/3 over QUIC** (RFC 9114·9204 / QUIC 9000·9001·9002) → 별도 어댑터. HTTP 의미론(9110)은 공유하나 전송(QUIC)·메시징(9114)이 다르며 Bun에서 experimental.
- **HTTP/2 서버** — Bun.serve 미지원.

별도 미들웨어 소관(범위 밖):
- **응답 content coding 협상·적용** — `Accept-Encoding` 해석, `Content-Encoding` 생성, 인코딩에 따른 `Content-Length` 무효화·재생성, `ETag` weak 표기, `Vary: Accept-Encoding` 생성은 **그 coding을 적용하는 미들웨어**의 소관이다(압축: `@zipbul/compression`의 STANDARDS.md; `dcb`/`dcz`·`aes128gcm` 등 다른 coding은 각자의 미들웨어). coding 적용자가 장착되지 않으면 무인코딩 응답 그 자체로 표준 적합이므로(RFC 9110 §8.4는 coding 적용을 요구하지 않는다) 어댑터에 잔여 의무는 없다. 요청 측 content coding(미지원 coding의 415 판정, §5.8)은 어댑터 소관으로 남는다.

obsolete RFC(2616 / 7230–7235 / 6874)는 인용하지 않는다.

---

## 1. 메시지 수신·framing

- **§1.1.1** [MUST] 메서드 토큰은 tchar로 구성된다(method = token = 1*tchar) [RFC 9110 §5.6.2·§9.1]
- **§1.1.2** [MUST] 메서드 토큰은 case-sensitive하게 취급한다 — 대소문자를 정규화하거나 접어서 매칭하지 않는다(`get`은 `GET`이 아니다) [RFC 9110 §9.1]
- **§1.1.3** [SHOULD] 유효하지 않은 request-line은 400 또는 301로 응답한다 [RFC 9112 §3.2]
- **§1.1.4** [SHOULD NOT] 유효하지 않은 request-line을 자동교정한 뒤 redirect 없이 그대로 처리하지 않는다 [RFC 9112 §3.2]
- **§1.2.1** [MUST] 상이값·비숫자·음수·유효하지 않은 `Content-Length`는 400으로 응답하고 연결을 닫는다(동일값 중복 CL은 복구 가능) [RFC 9112 §6.3]
- **§1.2.2** [MAY] `Transfer-Encoding`+`Content-Length` 동시 요청은 거부하거나 TE만으로 처리할 수 있다 [RFC 9112 §6.1]
- **§1.2.3** [MUST] `Transfer-Encoding`+`Content-Length` 동시 요청을 처리했다면 응답 후 연결을 닫는다 [RFC 9112 §6.1]
- **§1.3.1** [MUST] obs-fold는 거부(400)하거나 SP로 치환한다 [RFC 9112 §5.2]
- **§1.3.2** [MUST] field value의 CR·LF·NUL은 거부하거나 SP로 치환한다 [RFC 9110 §5.5]
- **§1.3.3** [MAY] field value의 그 외 CTL octet은 안전한 맥락에서 보존할 수 있다 [RFC 9110 §5.5]
- **§1.3.4** [MUST] bare CR는 거부하거나 SP로 치환한다(bare LF는 종결자로 수용 가능) [RFC 9112 §2.2]
- **§1.3.5** [무표기] field-name은 token이다 [RFC 9110 §5.1]
- **§1.3.6** [MUST] field value를 평가하기 전에 선행·후행 whitespace(OWS)를 제외한다 [RFC 9110 §5.5]
- **§1.3.7** [MUST] BWS(bad whitespace)를 파싱해 프로토콜 요소 해석 전에 제거한다 [RFC 9110 §5.6.3]
- **§1.3.8** [SHOULD] field content의 그 외 허용 octet(obs-text, %x80–FF)은 opaque data로 취급한다 [RFC 9110 §5.5]
- **§1.4.1** [MUST] chunked transfer coding을 파싱·디코딩하고 incomplete body를 처리한다 [RFC 9112 §6·§7.1]
- **§1.4.2** [MUST] 유효한 `Content-Length`가 있고 `Transfer-Encoding`이 없는 요청에서 표시된 octet 수를 받기 전에 연결이 닫히거나 timeout되면 메시지를 incomplete로 간주하고 연결을 닫는다 [RFC 9112 §6.3]
- **§1.5.1** [MUST] 과대 request-target에는 414로 응답한다 [RFC 9112 §3·RFC 9110 §15.5.15]
- **§1.5.2** [MUST] 과대 헤더 필드에는 적절한 4xx(431)로 응답한다 [RFC 9110 §5.4·RFC 6585 §5]
- **§1.5.3** [SHOULD] 단일 헤더 필드가 한계를 초과해 431을 반환하면 응답 representation에 어느 헤더 필드가 과대했는지 명시한다 [RFC 6585 §5]
- **§1.5.4** [SHOULD] 자신이 구현하는 어떤 메서드보다 긴 method 토큰을 수신하면 501로 응답한다 [RFC 9112 §3]
- **§1.5.5** [SHOULD] request-line 길이를 최소 8000 octet까지 지원한다 [RFC 9112 §3]
- **§1.6.1** [MUST] clock이 있으면 2xx/3xx/4xx 응답에 `Date`를 생성한다 [RFC 9110 §6.6.1]
- **§1.6.2** [MAY] clock이 있으면 1xx·5xx 응답에 `Date`를 생성할 수 있다 [RFC 9110 §6.6.1]
- **§1.6.3** [MUST NOT] clock이 없으면 `Date`를 생성하지 않는다 [RFC 9110 §6.6.1]
- **§1.6.4** [SHOULD] `Date`를 생성하면 그 값은 메시지 생성 시각의 가능한 최선의 근사로 만든다 [RFC 9110 §6.6.1]
- **§1.6.5** [MUST] HTTP-date를 담는 응답 필드(`Date`·`Last-Modified`·`Expires`·`Retry-After` 등)는 IMF-fixdate 형식으로 생성하고 rfc850·asctime 형식으로 생성하지 않는다 [RFC 9110 §5.6.7]
- **§1.7.1** [MUST] 100-continue expectation을 가진 HTTP/1.1(이상) 요청에는 헤더만으로 final status가 결정되면 즉시 그 응답을, 아니면 즉시 `100 (Continue)`를 보낸다 [RFC 9110 §10.1.1]
- **§1.7.2** [MUST NOT] content를 받은 뒤에 `100 (Continue)`를 보내지 않는다 [RFC 9110 §10.1.1]
- **§1.7.3** [MUST] HTTP/1.0 요청의 100-continue expectation은 무시한다 [RFC 9110 §10.1.1]
- **§1.7.4** [MAY] 100-continue 외의 expectation에는 417로 응답할 수 있다 [RFC 9110 §10.1.1]
- **§1.8.1** [MUST] `Transfer-Encoding`을 담은 HTTP/1.0 메시지는 `Content-Length`가 있어도 framing 오류로 보아 처리 후 연결을 닫는다 [RFC 9112 §6.1]
- **§1.8.2** [SHOULD] 이해할 수 없는 transfer coding을 담은 요청에는 501로 응답한다 [RFC 9112 §6.1]
- **§1.9.1** [MUST] chunked 디코딩 시 대형 chunk-size의 정수 오버플로·정밀도 손실을 방어한다 [RFC 9112 §7.1]
- **§1.9.2** [MUST] 미인지 chunk extension은 무시한다 [RFC 9112 §7.1.1]
- **§1.9.3** [SHOULD] chunked coding에 파라미터가 존재하면 오류로 처리한다 [RFC 9112 §7.1]
- **§1.9.4** [MUST NOT] 수신한 trailer 필드를 해당 헤더 필드 정의가 명시적으로 허용하지 않는 한 header section에 병합하지 않는다 [RFC 9112 §7.1.2]
- **§1.10.1** [MUST] 메시지를 US-ASCII superset octet 시퀀스로 파싱한다 [RFC 9112 §2.2]
- **§1.10.2** [MUST] start-line과 첫 헤더 필드 사이에 whitespace가 있으면 메시지를 무효로 reject하거나 whitespace-preceded line을 소비한다 [RFC 9112 §2.2]
- **§1.10.3** [MUST] field-name과 colon 사이에 whitespace가 있는 요청은 400으로 거부한다 [RFC 9112 §5.1]
- **§1.10.4** [SHOULD] request-line 앞의 빈 line(CRLF)은 무시한다 [RFC 9112 §2.2]
- **§1.11.1** [MUST] 요청에 `Transfer-Encoding`이 있고 chunked가 final transfer coding이 아니면 400으로 응답하고 연결을 닫는다 [RFC 9112 §6.3]
- **§1.12.1** [MUST NOT] 전체 request header section을 수신하기 전에는 요청을 target resource에 적용하지 않는다 [RFC 9110 §5.3]
- **§1.13.1** [MUST] list(#) 구조 필드 값을 파싱할 때 합리적 개수의 빈 list 요소를 파싱하고 무시한다 [RFC 9110 §5.6.1]
- **§1.13.2** [MUST] quoted-string 값을 처리할 때 quoted-pair를 backslash 다음 octet으로 치환된 것으로 처리한다 [RFC 9110 §5.6.4]
- **§1.13.3** [MAY] 동일 field-name의 다중 field line을 순서대로 comma로 이어 붙여 하나의 field line으로 결합할 수 있다 [RFC 9110 §5.3]

## 2. 응답 framing

- **§2.1.1** [MUST NOT] null-body status(1xx·204·205·304)에 content를 생성하지 않는다(304는 200이 보냈을 헤더 필드를 가질 수 있으나 message body는 갖지 않는다) [RFC 9110 §15.2·§15.3.5·§15.3.6·§15.4.5]
- **§2.2.1** [MUST NOT] `Content-Length`를 1xx·204 응답 및 CONNECT에 대한 2xx 응답에 보내지 않는다 [RFC 9110 §8.6]
- **§2.3.1** [MUST] `Content-Length`를 보낸다면 그 값은 전송 본문 octet 수와 일치한다(HEAD/304는 동일 GET이 보냈을 본문 octet 수와 일치) [RFC 9112 §6.3·RFC 9110 §8.6]
- **§2.3.2** [SHOULD] 금지 예외(§2.2)·별도 규칙(HEAD/304)에 해당하지 않는 한, `Transfer-Encoding`이 없고 content 크기를 완전한 header section 송신 전에 알 수 있으면 `Content-Length`를 생성한다 [RFC 9110 §8.6]
- **§2.4.1** [MUST NOT] HEAD 응답에 content를 포함하지 않는다 [RFC 9110 §9.3.2]
- **§2.4.2** [SHOULD] HEAD 응답의 헤더 필드는 동일 GET이 생성했을 값과 같다 [RFC 9110 §9.3.2]
- **§2.4.3** [MAY] HEAD 응답에서 content 생성 시점에만 정해지는 필드는 생략할 수 있다 [RFC 9110 §9.3.2]
- **§2.5.1** [MUST NOT] `Transfer-Encoding`이 있는 메시지에 `Content-Length`를 함께 보내지 않는다 [RFC 9112 §6.2]
- **§2.6.1** [MUST] 출력 응답 헤더의 field-name은 유효한 token으로 생성한다 [RFC 9110 §5.1]
- **§2.6.2** [MUST NOT] 출력 응답 헤더 값에 CR·LF·NUL을 생성하지 않는다 [RFC 9110 §5.5]
- **§2.6.3** [MUST NOT] singleton 필드를 중복 생성하지 않는다(list-valued·`Set-Cookie` 예외) [RFC 9110 §5.3]
- **§2.6.4** [MUST NOT] list 구조(#-construct)를 쓰는 어떤 출력 응답 헤더도 빈 list 요소를 생성하지 않는다 [RFC 9110 §5.6.1.1]
- **§2.6.5** [MUST NOT] 출력 응답 메시지에 BWS를 생성하지 않는다 [RFC 9110 §5.6.3]
- **§2.6.6** [SHOULD] OWS를 생성한다면 단일 SP로, RWS가 필요하면 단일 SP로 생성한다 [RFC 9110 §5.6.3]
- **§2.6.7** [MUST NOT] start-line과 첫 header field 사이에 whitespace를 생성하지 않는다 [RFC 9112 §2.2]
- **§2.6.8** [MUST NOT] content를 제외한 어떤 protocol element 안에도 bare CR(뒤에 LF가 없는 CR)을 생성하지 않는다 [RFC 9112 §2.2]
- **§2.6.9** [MUST NOT] message/http 컨테이너로 패키징할 의도가 아니면 obs-fold(line folding)를 포함한 메시지를 생성하지 않는다 [RFC 9112 §5.2]
- **§2.6.10** [MUST NOT] qvalue를 생성할 때 소수점 이하 3자리를 초과하여 생성하지 않는다 [RFC 9110 §12.4.2]
- **§2.6.11** [SHOULD] 응답 필드에 media-range와 weight를 함께 생성한다면 `q` 파라미터는 모든 media-range 파라미터 뒤 마지막에 생성한다 [RFC 9110 §12.5.1]
- **§2.7.1** [MAY] 응답에 `Server` 헤더 필드를 생성할 수 있다 [RFC 9110 §10.2.4]
- **§2.7.2** [SHOULD NOT] `Server` 헤더에 과도하게 세부적인 정보를 넣지 않는다 [RFC 9110 §10.2.4]
- **§2.7.3** [SHOULD] `Server` 헤더에 third party가 추가하는 subproduct를 제한한다 [RFC 9110 §10.2.4]
- **§2.8.1** [무표기] 정상 응답 경로의 final status는 유효한 3자리 코드(2xx–5xx)이며, 1xx는 정상 경로 밖이다(§9.1) [RFC 9110 §15]
- **§2.9.1** [MUST NOT] message framing·routing·인증·request modifier·response control·content format 범주의 필드를 trailer로 생성하지 않는다(해당 필드 정의가 trailer 전송을 허용하는 경우에 한해서만 생성) [RFC 9110 §6.5.1]
- **§2.9.2** [SHOULD NOT] user agent가 반드시 수신해야 한다고 보는 필드를 trailer로 생성하지 않는다 [RFC 9110 §6.5.1]
- **§2.9.3** [SHOULD] 하나 이상의 trailer 필드를 생성할 의사가 있으면 header section에 `Trailer` 헤더 필드를 생성한다 [RFC 9110 §6.6.2]
- **§2.10.1** [MUST NOT] `Transfer-Encoding`을 1xx·204 응답 및 CONNECT에 대한 2xx 응답에 보내지 않는다 [RFC 9112 §6.1]
- **§2.10.2** [MUST NOT] 대응 요청이 HTTP/1.1(이상)을 가리키지 않으면 `Transfer-Encoding`을 보내지 않는다 [RFC 9112 §6.1]
- **§2.10.3** [MUST NOT] chunked transfer coding을 message body에 두 번 이상 적용하지 않는다 [RFC 9112 §6.1]
- **§2.10.4** [MUST] 응답 content에 chunked 외 transfer coding을 적용하면 chunked를 final transfer coding으로 두거나 연결을 닫아 메시지를 종결한다 [RFC 9112 §6.1]
- **§2.11.1** [MUST] status-line은 reason-phrase가 비어 있어도 status-code 뒤 SP를 보낸다 [RFC 9112 §4]
- **§2.11.2** [MUST NOT] 자신이 conformant하지 않은 프로토콜 버전을 응답에 보내지 않는다 [RFC 9110 §6.2]
- **§2.11.3** [SHOULD] 요청에 담긴 버전의 major 버전 이하 중 자신이 conformant한 최고 버전과 같은 프로토콜 버전을 응답에 보낸다 [RFC 9110 §6.2]
- **§2.12.1** [MUST] 206을 생성하면 200이 보냈을 `Date`/`Cache-Control`/`ETag`/`Expires`/`Content-Location`/`Vary`를 생성한다 [RFC 9110 §15.3.7]
- **§2.12.2** [MUST] 단일 range의 206에는 `Content-Range`와 해당 범위 content를 생성한다 [RFC 9110 §15.3.7]
- **§2.12.3** [MUST] 다중 range의 206에는 `multipart/byteranges`(필수 boundary 포함)를 생성하고 각 body part에 `Content-Range`를 둔다 [RFC 9110 §15.3.7]
- **§2.12.4** [MUST NOT] 다중 range의 206에서 HTTP 헤더부에 `Content-Range`를 두지 않는다 [RFC 9110 §15.3.7]
- **§2.12.5** [MUST NOT] 단일 range 요청에 multipart 응답을 생성하지 않는다 [RFC 9110 §15.3.7]
- **§2.12.6** [SHOULD] multipart/byteranges에서 선택 표현이 200에서 `Content-Type`을 가졌다면 각 body part 헤더부에 동일 `Content-Type`을 생성한다 [RFC 9110 §15.3.7.2]
- **§2.12.7** [SHOULD NOT] `If-Range` 포함 요청에 206을 생성할 때는 필수 외 추가 representation 헤더를 생성하지 않는다 [RFC 9110 §15.3.7]
- **§2.12.8** [MUST] `If-Range` 없는 요청에 206을 생성하면 200이 보냈을 representation 헤더를 모두 생성한다 [RFC 9110 §15.3.7]
- **§2.12.9** [SHOULD] byte-range 206의 `Content-Range`에는 표현의 complete-length를 표시한다(알 수 없으면 `*`) [RFC 9110 §14.4]
- **§2.12.10** [MAY] 다중 range가 요청되면 겹치거나 다중 part 전송 오버헤드보다 작은 간격으로 분리된 range들을(요청 순서와 무관하게) coalesce할 수 있다 [RFC 9110 §15.3.7.2]
- **§2.12.11** [MAY] 다중 range가 요청되었으나 만족 가능한 range가 하나뿐이거나 coalesce 후 하나만 남으면 단일 body part만 담은 `multipart/byteranges` 응답을 생성할 수 있다 [RFC 9110 §15.3.7.2]
- **§2.12.12** [SHOULD] multipart 응답에서는 unsatisfiable로 판정되거나 다른 range로 coalesce된 range를 제외하고, 수신한 `Range` 필드에 range-spec이 나타난 순서대로 각 part를 보낸다 [RFC 9110 §15.3.7.2]
- **§2.13.1** [MUST] 304를 생성하면 200이 보냈을 `Content-Location`/`Date`/`ETag`/`Vary`/`Cache-Control`/`Expires`를 생성한다 [RFC 9110 §15.4.5]
- **§2.13.2** [SHOULD NOT] 304에는 캐시 갱신 목적이 아닌 한 그 외 표현 metadata를 생성하지 않는다 [RFC 9110 §15.4.5]
- **§2.14.1** [SHOULD] GET/HEAD에 대한 200 응답에 가능한 validator(강한 `ETag`·`Last-Modified` 선호)를 보낸다 [RFC 9110 §15.3.1]
- **§2.14.2** [MUST] strong이 아닌 entity tag는 weak indicator(`W/`)를 붙인다 [RFC 9110 §8.8.3]
- **§2.14.3** [MUST NOT] clock 있는 origin은 `Date`보다 늦은 `Last-Modified`를 보내지 않는다 [RFC 9110 §8.8.2.1]
- **§2.14.4** [MUST NOT] clock 없는 origin은 그 날짜 값이 다른(시계 있는) 시스템이 리소스에 부여한 경우가 아니면 `Last-Modified`를 생성하지 않는다 [RFC 9110 §8.8.2.1]
- **§2.14.5** [SHOULD] `Last-Modified` 값은 응답의 `Date` 필드 값을 생성하는 시각에 최대한 가깝게 획득한다 [RFC 9110 §8.8.2.1]

## 3. 메서드·라우팅

- **§3.1.1** [MUST] 405 응답에는 지원 메서드를 나열한 `Allow`를 생성한다(빈 list 요소 금지) [RFC 9110 §15.5.6·§10.2.1·§5.6.1.1]
- **§3.1.2** [MAY] 405 외의 어떤 응답에도 `Allow` 필드를 생성할 수 있다 [RFC 9110 §10.2.1]
- **§3.2.1** [SHOULD] 메서드 불허는 405, 리소스 부재는 404로 응답한다 [RFC 9110 §9.1·§15.5.5]
- **§3.3.1** [SHOULD] 인지되지 않은/미구현 메서드 토큰은 501로 응답한다 [RFC 9110 §9.1·§15.6.2]
- **§3.3.2** [무표기] 표준 메서드는 GET/HEAD/POST/PUT/DELETE/CONNECT/OPTIONS/TRACE 8개이며, 그 외 PATCH·QUERY를 인지한다 [RFC 9110 §9.3.1–§9.3.8·RFC 5789·RFC 10008]
- **§3.4.1** [MUST] HEAD 응답은 GET에서 content만 제거한 것과 같다(헤더 parity는 §2.4) [RFC 9110 §9.3.2]
- **§3.5.1** [SHOULD] OPTIONS 성공 응답은 지원 메서드를 나타내는 `Allow`를 보낸다 [RFC 9110 §9.3.7]
- **§3.6.1** [MUST] QUERY 요청은 `Content-Type`이 없거나 content와 불일치하면 실패시키고 content를 sniffing해 media type을 추론하지 않는다 [RFC 10008 §2·§2.1]
- **§3.6.2** [SHOULD] QUERY 결과를 나타내는 임시 리소스에 URI를 할당해 `Location`/`Content-Location`에 쓸 때, 요청 content에 로깅 불가한 민감 정보가 있으면 그 URI는 원본 요청 content의 민감 부분을 포함하지 않게 선택한다 [RFC 10008 §4]
- **§3.7.1** [MAY] TRACE는 지원하지 않을 수 있다(GET·HEAD 외 메서드는 OPTIONAL) [RFC 9110 §9.1]
- **§3.7.2** [SHOULD] TRACE를 반사한다면 final recipient는 민감 필드를 제외하고 수신 message를 200의 content로 반사한다 [RFC 9110 §9.3.8]
- **§3.8.1** [MUST] general-purpose server는 GET·HEAD를 지원한다(그 외 메서드는 OPTIONAL) [RFC 9110 §9.1]
- **§3.9.1** [MUST] PUT이 표현을 새로 생성하면 201, 기존 표현을 수정하면 200 또는 204로 응답한다 [RFC 9110 §9.3.4]
- **§3.9.2** [MUST NOT] 요청 표현이 변환 없이 저장되고 validator가 그 새 표현을 반영하는 경우가 아니면 PUT 성공 응답에 validator를 보내지 않는다 [RFC 9110 §9.3.4]
- **§3.9.3** [MUST] PUT의 변경을 다른 리소스에 적용하려면 적절한 3xx로 응답한다 [RFC 9110 §9.3.4]
- **§3.9.4** [SHOULD] PUT 표현이 대상 리소스의 구성 제약과 불일치하면 정합화하거나 적절한 오류로 응답한다(권고 409, `Content-Type` 제약 위반이면 415) [RFC 9110 §9.3.4]
- **§3.10.1** [SHOULD] DELETE 성공은 202·204·200 중으로 응답한다 [RFC 9110 §9.3.5]
- **§3.10.2** [SHOULD] POST가 리소스를 새로 생성하면 201과 `Location`을 보낸다 [RFC 9110 §9.3.3]
- **§3.11.1** [MUST] CONNECT 요청의 빈/유효하지 않은 port는 거부한다(보통 400) [RFC 9110 §9.3.6]
- **§3.12.1** [MUST] PATCH는 patch 전체를 atomic하게 적용하고 부분 적용된 표현을 노출하지 않으며, 전체 적용이 불가하면 어떤 변경도 적용하지 않는다 [RFC 5789 §2]
- **§3.12.2** [MUST] 받은 patch 문서가 대상 리소스 타입에 적합한지 보장한다 [RFC 5789 §2]
- **§3.12.3** [MUST NOT] 요청에 담긴 entity-header는 포함된 patch 문서에만 적용하고 수정 대상 리소스에 적용하지 않는다 [RFC 5789 §2]
- **§3.12.4** [SHOULD] PATCH를 지원하는 리소스의 OPTIONS 응답과 미지원 patch media type의 415 응답에 `Accept-Patch`를 보낸다 [RFC 5789 §3.1·§2.2]
- **§3.12.5** [MUST] 악의적 클라이언트가 PATCH 사용으로 과도한 서버 자원(CPU·디스크 I/O 등)을 소비하지 못하도록 적절한 예방조치를 취한다 [RFC 5789 §5]
- **§3.13.1** [MAY] 금지 리소스의 현재 존재를 숨기려 할 때 403 대신 404로 응답할 수 있다 [RFC 9110 §15.5.4]

## 4. 요청 해석·신뢰

- **§4.1.1** [MUST] origin-form과 absolute-form request-target을 받아들인다 [RFC 9112 §3.2]
- **§4.1.2** [무표기] authority-form은 CONNECT 전용이며, CONNECT 미지원 시 미구현 메서드로 처리한다(§3.3) [RFC 9112 §3.2]
- **§4.1.3** [무표기] asterisk-form(`OPTIONS *`)은 서버 전체에 대한 OPTIONS 요청이다 [RFC 9110 §9.3.7]
- **§4.2.1** [MUST] absolute-form request-target 요청에서는 수신한 `Host`(있어도)를 무시하고 request-target의 host 정보를 권위로 사용한다 [RFC 9112 §3.2.2]
- **§4.3.1** [MUST] HTTP/1.1 요청은 정확히 하나의 유효한 `Host`를 가져야 하며, 없거나 둘 이상이거나 comma로 결합되었거나 유효하지 않으면 400으로 응답한다 [RFC 9112 §3.2]
- **§4.4.1** [무표기] 신뢰된 intermediary가 아니면 `Forwarded`/`X-Forwarded-*`는 client 주소·scheme·host의 권위로 신뢰할 수 없다 [RFC 7239 §8.1]
- **§4.4.2** [무표기] origin server는 `Forwarded`를 응답에 copy하지 않는다(§8.2는 소문자 should — 비규범 보안 권고) [RFC 7239 §8.2]
- **§4.5.1** [무표기] 서비스하도록 구성되지 않은 authority의 거부에는 421을 사용한다 [RFC 9110 §15.5.20]
- **§4.6.1** [MAY] 처리 의사를 넘는 크기의 요청 content는 413으로 거부할 수 있다 [RFC 9110 §15.5.14]
- **§4.6.2** [MAY] 413 응답 시 프로토콜 버전이 허용하면 요청을 중단할 수 있고, 그렇지 않으면 연결을 닫을 수 있다 [RFC 9110 §15.5.14]
- **§4.6.3** [MAY] message body는 있으나 `Content-Length`가 없는 요청은 411 (Length Required)로 거부할 수 있다 [RFC 9112 §6.3]
- **§4.7.1** [SHOULD] robustness 예외에 해당하지 않는 한, HTTP-message 문법에 맞지 않는 octet 시퀀스를 수신하면 400으로 응답하고 연결을 닫는다 [RFC 9112 §2.2]
- **§4.7.2** [무표기] 400 (Bad Request)은 클라이언트 오류로 보이는 것 때문에 서버가 요청을 처리할 수 없거나 처리하지 않겠다는 의미다 [RFC 9110 §15.5.1]
- **§4.8.1** [SHOULD] 미인지 요청 헤더/트레일러를 무시한다 [RFC 9110 §5.1]
- **§4.8.2** [SHOULD] GET/HEAD/DELETE 요청 본문을 라우팅·의미 입력으로 쓰지 않는다 [RFC 9110 §9.3.1·§9.3.2·§9.3.5]
- **§4.9.1** [MUST] 신뢰된 gateway 연결이 아니면 target URI의 scheme 요건을 충족하지 못하는 요청을 거부한다 — 특히 `https` 리소스 요청은 그 origin에 유효한 인증서로 보안된 연결에서 받지 않았으면 거부한다 [RFC 9110 §7.4]
- **§4.10.1** [SHOULD NOT] `From` 헤더 필드를 access control이나 인증에 사용하지 않는다(그 값은 요청 경로상 누구에게나 보이며 로그에 남는다) [RFC 9110 §10.1.2]

## 5. 인코딩·redirection

- **§5.1.1** [MUST] JSON 응답은 UTF-8로 인코딩하고 BOM(U+FEFF)을 붙이지 않는다 [RFC 8259 §8.1]
- **§5.1.2** [MUST] JSON 문자열의 제어문자(U+0000–U+001F)·`"`·`\`를 escape한다 [RFC 8259 §7]
- **§5.1.3** [MAY] JSON 문자열의 임의 문자를 escape할 수 있다(BMP 문자는 `\uXXXX` 6문자 시퀀스로 생성 가능) [RFC 8259 §7]
- **§5.1.4** [MAY] 수신한 JSON text를 파싱할 때 선두 BOM(U+FEFF)을 오류로 취급하지 않고 무시할 수 있다 [RFC 8259 §8.1]
- **§5.1.5** [SHOULD] JSON 객체 멤버 이름은 유일하다 [RFC 8259 §4]
- **§5.2.1** [SHOULD] content가 있는 응답에 `Content-Type`을 보낸다 [RFC 9110 §8.3]
- **§5.3.1** [SHOULD] 3xx redirect(301/302/303/307/308)는 `Location`을 생성한다 [RFC 9110 §15.4.2–§15.4.9]
- **§5.3.2** [SHOULD] 300은 HEAD 외 메서드에 표현 metadata·URI 목록을 content로 생성하고, 선호 선택지가 있으면 그 URI 참조를 담은 `Location`을 생성한다 [RFC 9110 §15.4.1]
- **§5.4.1** [MUST] URI를 직접 생성·emit할 때 IPv6 리터럴은 대괄호로 감싼다 [RFC 3986 §3.2.2]
- **§5.4.2** [MUST] IPv6 리터럴은 canonical 표현(leading zero 억제, 소문자 hex)을 따른다 [RFC 5952 §4.1·§4.2.1·§4.2.2·§4.3]
- **§5.4.3** [MUST] `::` 배치는 가장 긴 연속 16비트 0필드 run을 압축하고, run 길이가 같으면 첫 번째 0 시퀀스를 압축하며, 단일 16비트 0필드에는 `::`를 사용하지 않는다 [RFC 5952 §4.2.1·§4.2.2·§4.2.3]
- **§5.4.4** [MUST NOT] zone identifier를 URI에 넣지 않는다 [RFC 3986 §3.2.2]
- **§5.4.5** [MUST NOT] 기존 IPv4·IPv6 리터럴 주소 형식에 version flag(IPvFuture 'v' 형식)를 붙여 emit하지 않는다 [RFC 3986 §3.2.2]
- **§5.5.1** [SHOULD] 생성하는 4xx/5xx 오류 응답은 오류 상황을 설명하는 representation을 포함한다(HEAD 제외) [RFC 9110 §15.5·§15.6]
- **§5.6.1** [SHOULD] proactive content negotiation으로 수용 가능한 표현이 없고 기본 표현 제공도 거부하면 406을 생성하며, 응답 content에 가용 표현 특성과 대응 resource identifier 목록을 담는다 [RFC 9110 §15.5.7·§12.1]
- **§5.7.1** [SHOULD] 409 (Conflict)를 생성하면 사용자가 충돌의 출처를 인지하기에 충분한 정보를 담은 content를 생성한다 [RFC 9110 §15.5.10]
- **§5.8.1** [MUST NOT] content coding과 무관한 이유로 415를 생성할 때 `Accept-Encoding` 헤더 필드를 포함하지 않는다 [RFC 9110 §12.5.3]
- **§5.8.2** [무표기] 미지원 content coding으로 인한 415에는 `Accept-Encoding`을 포함하는 것이 권고된다(원문 "ought to" — BCP14 키워드 아님; 2026-07-05 재대조에서 [MAY] 오표기 정정) [RFC 9110 §12.5.3]

## 6. 스트리밍 (SSE) [WHATWG HTML §9.2 — Server-Sent Events]

- **§6.1.1** [무표기] SSE 응답의 `Content-Type`은 `text/event-stream`으로 보낸다 — EventSource 클라이언트는 `Content-Type`이 `text/event-stream`이 아니면 연결을 실패시키므로(§9.2.3 처리 모델) 파생되는 상호운용 요건이다 [WHATWG HTML §9.2.3·§9.2.5]
- **§6.2.1** [MUST] event stream은 UTF-8로 인코딩한다 [WHATWG HTML §9.2.5]
- **§6.3.1** [MUST] 라인 구분자는 CRLF·LF·CR 중 하나다 [WHATWG HTML §9.2.5]
- **§6.4.1** [무표기] `id` 필드 값에 U+0000 NULL이 있으면 클라이언트가 그 `id` 필드를 무시한다 [WHATWG HTML §9.2.6]
- **§6.5.1** [무표기] 선두 BOM(U+FEFF) 1개는 클라이언트의 UTF-8 decode에서 제거되며, `:`로 시작하는 라인은 주석으로 무시된다 [WHATWG HTML §9.2.6]
- **§6.6.1** [MAY] 약 15초마다 `:`로 시작하는 주석 라인을 keep-alive로 보낼 수 있다 [WHATWG HTML §9.2.7]

## 7. 캐시·조건부·폐기 헤더

- **§7.1.1** [무표기] `Warning`은 RFC 9111 §5.5가 obsolete 처리했다(규범 키워드 없음); emit하지 않는다 [RFC 9111 §5.5]
- **§7.2.1** [무표기] `Pragma`는 HTTP/1.0 request header로 정의되었고 RFC 9111 §5.4가 deprecated 처리했다(응답에서의 의미는 미정의); emit하지 않는다 [RFC 9111 §5.4]
- **§7.3.1** [무표기] origin server는 `Age`를 생성하지 않는다 [RFC 9111 §5.1]
- **§7.4.1** [MUST] `If-Match`에 strong, `If-None-Match`에 weak 비교 함수를 쓴다 [RFC 9110 §13.1.1·§13.1.2]
- **§7.4.2** [MUST] 선택된 표현을 고르는 요청에 precondition이 있으면 정상 검사 직후·메서드 수행 직전에 If-Match → If-Unmodified-Since → If-None-Match → If-Modified-Since → If-Range 순서로 평가한다 [RFC 9110 §13.2.1·§13.2.2]
- **§7.4.3** [MUST] 동일 요청을 precondition 없이 진행했을 때 응답이 2xx 또는 412가 아니었을 경우에는 수신한 모든 precondition을 무시한다 [RFC 9110 §13.2.1]
- **§7.4.4** [MUST] condition이 거짓이면 요청 메서드를 수행하지 않는다 [RFC 9110 §13.1.1·§13.1.2·§13.1.4]
- **§7.4.5** [MUST] `If-None-Match`가 거짓이고 GET/HEAD면 304를, 그 외 메서드에는 412를 생성한다 [RFC 9110 §13.1.2]
- **§7.4.6** [MUST] `If-Match`/`If-Unmodified-Since`가 거짓이면 412를 생성한다 [RFC 9110 §13.1.1·§13.1.4]
- **§7.4.7** [MAY] `If-Match` 또는 `If-Unmodified-Since` 조건이 거짓이어도 상태 변경 요청이 이미 적용된 것으로 판단되면 412 대신 2xx로 응답할 수 있다 [RFC 9110 §13.1.1·§13.1.4]
- **§7.4.8** [MUST] precondition 무시 규칙을 지킨다 — `If-Modified-Since`/`If-Unmodified-Since`는 각각 `If-None-Match`/`If-Match`가 있거나 값이 유효 HTTP-date가 아니거나 메서드가 GET/HEAD가 아니거나(IMS) 수정일이 없으면 무시하고, `If-Range`는 `Range`가 없거나 range 미지원 리소스면 무시하며, CONNECT/OPTIONS/TRACE에는 모든 precondition을 무시한다 [RFC 9110 §13.1.3·§13.1.4·§13.1.5·§13.2.1]
- **§7.4.9** [MUST] `If-Modified-Since`·`If-Unmodified-Since` 필드값의 timestamp는 origin server의 clock 기준으로 해석한다 [RFC 9110 §13.1.3·§13.1.4]
- **§7.4.10** [MUST] HTTP 필드의 timestamp 값을 파싱할 때 세 가지 HTTP-date 형식(IMF-fixdate·rfc850·asctime)을 모두 수용한다 [RFC 9110 §5.6.7]
- **§7.4.11** [MUST] 두 자리 연도의 rfc850-date timestamp가 50년 넘게 미래로 보이면 같은 마지막 두 자리를 갖는 가장 최근 과거 연도로 해석한다 [RFC 9110 §5.6.7]
- **§7.4.12** [SHOULD NOT] `If-Modified-Since`가 거짓이면 요청 메서드를 수행하지 않는다 [RFC 9110 §13.1.3]
- **§7.4.13** [SHOULD] `If-Modified-Since`가 거짓이면 304를 생성한다 [RFC 9110 §13.1.3]
- **§7.5.1** [SHOULD] cacheable 응답을 selecting header field에 따라 선택적으로 재사용시키려면 그 응답에 `Vary`를 생성한다 [RFC 9110 §12.5.5]
- **§7.6.1** [MUST NOT] clock 없는 origin은 값이 고정된 과거이거나 clock 있는 시스템이 리소스에 부여한 값이 아니면 `Expires`를 생성하지 않는다 [RFC 9111 §5.3]
- **§7.7.1** [SHOULD] 428 (Precondition Required)을 생성하면 요청을 성공적으로 재제출하는 방법을 설명하는 representation을 생성한다 [RFC 6585 §3]
- **§7.8.1** [MUST NOT] `max-age`·`s-maxage` 응답 지시어를 생성한다면 quoted-string 형식으로 생성하지 않는다(token 형식만: `max-age=5`) [RFC 9111 §5.2.2.1·§5.2.2.10]
- **§7.8.2** [SHOULD NOT] 필드명 인자를 갖는 `no-cache`·`private` 지시어를 생성한다면 token 형식으로 생성하지 않는다(quoted-string 형식 사용) [RFC 9111 §5.2.2.4·§5.2.2.7]
- **§7.8.3** [SHOULD] `must-understand` 지시어를 담은 응답에는 `no-store` 지시어도 함께 생성한다 [RFC 9111 §5.2.2.3]

## 8. 인증

- **§8.1.1** [MUST] 401 응답에는 target resource에 적용 가능한 challenge를 최소 하나 담은 `WWW-Authenticate` 헤더 필드를 생성한다 [RFC 9110 §15.5.2·§11.6.1]
- **§8.1.2** [MUST] `WWW-Authenticate` challenge에 `realm`을 생성한다면 그 값은 token이 아니라 quoted-string 구문으로만 생성한다 [RFC 9110 §11.5·§16.4.2]
- **§8.1.3** [SHOULD NOT] quoted-string 값을 생성할 때 문자열 내 DQUOTE·backslash octet을 인용하기 위해 필요한 경우가 아니면 quoted-pair를 생성하지 않는다 [RFC 9110 §5.6.4]
- **§8.1.4** [SHOULD NOT] comment 안에서 괄호(`(`·`)`)·backslash octet 인용에 필요한 경우가 아니면 quoted-pair를 생성하지 않는다 [RFC 9110 §5.6.4]
- **§8.2.1** [MAY] 401 외 응답에서도 credential 제공이 응답에 영향을 줄 수 있음을 알리려 `WWW-Authenticate`를 생성할 수 있다 [RFC 9110 §11.6.1]
- **§8.3.1** [SHOULD] 보호된 리소스 요청이 credential을 누락·무효·부분 제시하면 401로 응답하고, 요청 리소스에 적용 가능한 challenge를 최소 하나 담은 `WWW-Authenticate`를 포함한다 [RFC 9110 §11.4]
- **§8.4.1** [MUST] 생성하는 각 challenge 안에서 auth-param 이름은 challenge당 1회만 등장한다 [RFC 9110 §11.2]

## 9. 프로토콜 엣지

- **§9.1.1** [무표기] 이 어댑터는 프로토콜 전환(`101 Switching Protocols`/`Upgrade`)을 수행하지 않으며(업그레이드는 별도 어댑터 소관 — 범위 밖), 100/103도 정상 응답 경로 밖이다(서버가 101을 보낼 때의 규칙은 RFC 9110 §7.8·§15.2.2 참조) [RFC 9110 §7.8·§15.2.2]
- **§9.2.1** [MUST] 426을 emit한다면 `Upgrade`(및 `Connection: Upgrade`)를 보낸다 [RFC 9110 §15.5.22·§7.8]
- **§9.3.1** [MUST NOT] HTTP/1.0 클라이언트에 1xx 응답을 보내지 않는다 [RFC 9110 §15.2]
- **§9.4.1** [MUST] `100 (Continue)`를 보냈으면 요청 content를 받아 처리한 뒤 반드시 final status code로 종결한다(연결이 조기 종료된 경우 제외) [RFC 9110 §10.1.1]
- **§9.4.2** [SHOULD] 전체 요청 content를 읽기 전에 final status로 응답하면 연결을 닫을지 계속 읽을지 의사를 표시한다 [RFC 9110 §10.1.1]
- **§9.5.1** [SHOULD NOT] origin server는 511을 생성하지 않는다 [RFC 6585 §6]
- **§9.6.1** [SHOULD] 505를 생성하면 미지원 버전 이유와 지원 프로토콜을 설명하는 representation을 생성한다 [RFC 9110 §15.6.6]
- **§9.6.2** [SHOULD] 일시적 조건의 413에는 `Retry-After`를 생성한다 [RFC 9110 §15.5.14]
- **§9.6.3** [MAY] 503에는 재시도 전 대기시간을 제시하는 `Retry-After`를 보낼 수 있다 [RFC 9110 §15.6.4]

## 10. 연결 관리

- **§10.1.1** [SHOULD] HTTP/1.1 구현은 persistent connection을 지원한다 [RFC 9112 §9.3]
- **§10.1.2** [MUST] persistent connection을 지원하지 않으면 1xx가 아닌 모든 응답에 `close` connection option을 보낸다 [RFC 9112 §9.3]
- **§10.2.1** [MUST] 응답 전송 후 요청 message body를 끝까지 읽거나 연결을 닫는다 [RFC 9112 §9.3]
- **§10.3.1** [MUST] `close` connection option을 받았거나 보냈으면 그 요청에 대한 final response 이후 연결 종료를 개시한다 [RFC 9112 §9.6]
- **§10.3.2** [MUST NOT] `close`를 주고받은 연결에서 이후 요청을 처리하지 않는다 [RFC 9112 §9.6]
- **§10.3.3** [SHOULD] 닫는 연결의 final response에 `close` option을 보낸다 [RFC 9112 §9.6]
- **§10.4.1** [MAY] 파이프라인된 요청들은 모두 safe method일 때에 한해 병렬 처리할 수 있다 [RFC 9112 §9.3.2]
- **§10.4.2** [MUST] 병렬 처리 여부와 무관하게 각 응답은 요청을 받은 순서대로 보낸다 [RFC 9112 §9.3.2]
- **§10.5.1** [SHOULD] persistent connection을 timeout 처리하려면 급작스럽게 끊지 않고 graceful close를 개시하며, 열린 연결의 closure 신호를 지속 감시해 대응한다 [RFC 9112 §9.5]
- **§10.5.2** [SHOULD] 가능하면 persistent connection을 유지하고 일시적 과부하는 하부 전송의 flow-control로 해소하며, 연결을 종료해 클라이언트 재시도를 유도하지 않는다 [RFC 9112 §9.5]
- **§10.5.3** [MAY] 전송 연결을 언제든 닫을 수 있다 [RFC 9112 §9.5]
- **§10.6.1** [MUST NOT] `Connection` 헤더에 모든 수신자 대상(end-to-end) 필드명을 connection option으로 나열하지 않으며, immediate recipient만을 위한 hop-by-hop 필드만 나열한다 [RFC 9110 §7.6.1]
- **§10.6.2** [MUST] `Connection` 외의 필드로 현재 연결에 대한/관한 제어 정보를 보내면 그 필드명을 `Connection` 헤더에 나열한다 [RFC 9110 §7.6.1]

## 11. Range 요청

- **§11.1.1** [MUST] range 처리가 정의되지 않은/미인지 메서드와 함께 온 `Range`는 무시한다 [RFC 9110 §14.2]
- **§11.1.2** [MUST] 이해하지 못하는 range unit의 `Range`는 무시한다 [RFC 9110 §14.2]
- **§11.1.3** [MUST] `Range`/`Content-Range`의 decimal numeral 정수 오버플로를 방어한다 [RFC 9110 §14.1.2]
- **§11.2.1** [SHOULD] 만족 가능한 byte-range 요청에는 206(헤더 규칙은 §2.12)을 보낸다 [RFC 9110 §14.2]
- **§11.2.2** [SHOULD] 모든 range가 현재 표현과 겹치지 않아 만족 불가하면 416을 보낸다 [RFC 9110 §14.2·§15.5.17]
- **§11.2.3** [MUST] 이해하지 못하는 range unit의 `Range`는 416이 아니라 무시하고 200으로 전체 표현을 보낸다(§11.1) [RFC 9110 §14.2]
- **§11.2.4** [SHOULD] 416에는 현재 표현 길이를 담은 `Content-Range`를 생성한다 [RFC 9110 §15.5.17·§14.4]
- **§11.3.1** [MUST] `Content-Range` 지원이 정의되지 않은 메서드와 함께 온 `Content-Range`는 무시한다 [RFC 9110 §14.4]
- **§11.3.2** [SHOULD] partial PUT을 지원하지 않는 리소스에 `Content-Range`가 온 PUT은 400으로 응답한다 [RFC 9110 §14.5]
- **§11.4.1** [MUST] `If-Range` 조건이 거짓이면 `Range`를 무시한다 [RFC 9110 §13.1.5]
- **§11.4.2** [SHOULD] `If-Range` 조건이 참이면 `Range`를 요청대로 처리한다 [RFC 9110 §13.1.5]
- **§11.5.1** [MAY] `Range`를 무시할 수 있다 [RFC 9110 §14.2]
- **§11.5.2** [MAY] 유효하지 않은 ranges-specifier·2개 초과로 겹치는 range·오름차순이 아닌 다수 소range를 담은 `Range`를 무시·거부할 수 있다 [RFC 9110 §14.2·§17.15]
- **§11.5.3** [MAY] range를 전혀 지원하지 않는 리소스에는 `Accept-Ranges: none`을 보낼 수 있다 [RFC 9110 §14.3]
- **§11.5.4** [MAY] 선택 표현에 content가 없으면(zero-length) `Range`를 무시할 수 있다 [RFC 9110 §14.2]
- **§11.5.5** [MAY] `Accept-Ranges` 필드를 trailer section에 보낼 수 있다(header field로 보내는 것이 선호됨) [RFC 9110 §14.3]

## 12. 규칙이 아닌 것 (하드룰로 강제하지 않음)

- **§12.1.1** [무표기] URI 정규화와 JSON 객체 키 유일성은 SHOULD이며 하드룰로 강제하지 않는다 [RFC 3986 §6·RFC 8259 §4]
- **§12.2.1** [무표기] TRACE "self only" 제약은 RFC 9110에 없다(obsolete된 RFC 7231 오인용 금지) [RFC 9110 §9.3.8]
- **§12.3.1** [무표기] OPTIONS 응답의 `Content-Length: 0` 강제와 408 응답의 `close` connection option 규칙은 RFC 9110에 없다(RFC 7231의 규범이었으나 RFC 9110에서 의도적으로 삭제 — 재도입 금지) [RFC 9110 Appendix B]
