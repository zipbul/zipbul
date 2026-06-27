# HTTP Standards

**HTTP/1.1 origin-server가 지켜야 할 규칙의 정본.** 각 규칙 항목은 현행 RFC/WHATWG에서 도출한 순수 규칙이며, 규범 수준(MUST / MUST NOT / SHOULD / SHOULD NOT / MAY)과 1차 출처를 갖는다. 규범 키워드 없이 서술된 항목은 규칙이 아니라 사실·함의·정의(클라이언트측 동작 포함)이며 의도적으로 무표기다.

이 문서는 **규칙만** 담는다. *누가/무엇으로 구현·충족하는지*(런타임·미들웨어·코드 분담)는 `CLAUDE.md`, *런타임이 실제로 어떻게 동작하는지*(측정·quirk)는 `probe/`의 소관이며 여기에 담지 않는다.

적용 표준(현행): RFC 9110(Semantics)·9112(HTTP/1.1)·9111(Caching)·8259(JSON)·7239(Forwarded)·3986+5952(URI/IPv6)·9844(6874 obsolete 근거)·10008(QUERY)·6585(추가 status)·5789(PATCH)·WHATWG HTML(Server-Sent Events)·WHATWG Fetch. obsolete RFC(2616 / 7230–7235 / 6874)는 인용하지 않는다.

---

## 1. 메시지 수신·framing

- **§1.1.1** [MUST] 메서드 토큰은 tchar로 구성되며 대소문자를 구분한다 [RFC 9110 §5.6.2·§9.1]. [SHOULD] 유효하지 않은 request-line은 400 또는 301로 응답한다 [RFC 9112 §3].
- **§1.1.2** [MUST] 상이값·비숫자·음수·유효하지 않은 `Content-Length`는 framing 오류이며 400으로 응답하고 연결을 닫는다 (동일값 중복 CL은 복구 가능) [RFC 9112 §6.3]. [MAY] `Transfer-Encoding`+`Content-Length` 동시 요청은 거부하거나 TE만으로 처리하되, 어느 경우든 응답 후 연결을 닫는다(MUST) [RFC 9112 §6.1].
- **§1.1.3** [MUST] obs-fold는 거부(400)하거나 SP로 치환한다 [RFC 9112 §5.2]; field value의 CR·LF·NUL은 거부하거나 SP로 치환한다(그 외 CTL은 무효이나 안전한 맥락에서 보존 MAY) [RFC 9110 §5.5]. bare CR는 무효로 보아 거부하거나 SP로 치환한다(bare LF는 종결자로 수용 가능) [RFC 9112 §2.2]. field-name은 token이어야 한다 [RFC 9110 §5.1].
- **§1.1.4** [MUST] chunked transfer coding을 파싱·디코딩하고 incomplete body를 처리한다 [RFC 9112 §6·§7.1].
- **§1.1.5** [MUST] request-line/헤더 필드 크기 한계를 강제한다 — 과대 request-target은 414 [RFC 9112 §3; RFC 9110 §15.5.15], 과대 헤더 필드는 적절한 4xx(431) [RFC 9110 §5.4; RFC 6585 §5].
- **§1.1.6** [MUST] clock이 있으면 2xx/3xx/4xx 응답에 `Date`를 생성한다 [RFC 9110 §6.6.1].
- **§1.1.7** [MUST] 100-continue expectation을 가진 HTTP/1.1(이상) 요청에는 — 헤더만으로 final status가 결정되면 즉시 그 응답을, 아니면 즉시 `100 (Continue)`를 보낸다; content를 받은 뒤에 100을 보내지 않는다(MUST NOT). [MUST] HTTP/1.0 요청의 100-continue expectation은 무시한다. [MAY] 100-continue 외의 expectation에는 417로 응답할 수 있다 [RFC 9110 §10.1.1].
- **§1.1.8** [MUST] `Transfer-Encoding`을 담은 HTTP/1.0 메시지는 `Content-Length`가 있어도 framing 오류로 보아 처리 후 연결을 닫는다. [SHOULD] 이해할 수 없는 transfer coding을 담은 요청에는 501로 응답한다 [RFC 9112 §6.1].
- **§1.1.9** [MUST] chunked 디코딩 시 대형 chunk-size의 정수 오버플로·정밀도 손실을 방어하고, 미인지 chunk extension은 무시한다. [MUST NOT] 수신한 trailer 필드를 해당 헤더 필드 정의가 명시적으로 허용하지 않는 한 header section에 병합하지 않는다 [RFC 9112 §7.1·§7.1.1·§7.1.2].
- **§1.1.10** [MUST] 메시지를 US-ASCII superset octet 시퀀스로 파싱한다(Unicode 문자 스트림으로 파싱 금지) [RFC 9112 §2.2]. [MUST] start-line과 첫 헤더 필드 사이의 whitespace는 메시지를 무효로 reject하거나 whitespace-preceded line을 소비한다(request smuggling 방지) [RFC 9112 §2.2]. [MUST] field-name과 colon 사이에 whitespace가 있는 요청은 400으로 거부한다 [RFC 9112 §5.1]. [SHOULD] request-line 앞의 빈 line(CRLF)은 무시한다 [RFC 9112 §2.2].

## 2. 응답 framing

- **§2.1** [MUST NOT] null-body status(1xx·204·205·304)에 content를 생성하지 않는다. 304는 200이 보냈을 헤더 필드를 가질 수 있으나 message body는 갖지 않는다 [RFC 9110 §15.2·§15.3.5·§15.3.6·§15.4.5].
- **§2.2** [MUST NOT] `Content-Length`를 1xx·204 응답 및 CONNECT에 대한 2xx 응답에 보내지 않는다 [RFC 9110 §8.6].
- **§2.3** [MUST] `Content-Length`를 보낸다면 그 값은 전송 본문 octet 수와 일치한다; HEAD/304는 동일 GET이 보냈을 본문 octet 수와 일치한다 [RFC 9112 §6.3; RFC 9110 §8.6].
- **§2.4** [MUST NOT] HEAD 응답에 content를 포함하지 않는다. [SHOULD] 헤더 필드는 동일 GET이 생성했을 값과 같다(content 생성 시점에만 정해지는 필드는 생략 가능 MAY) [RFC 9110 §9.3.2].
- **§2.5** [MUST NOT] `Transfer-Encoding`이 있는 메시지에 `Content-Length`를 함께 보내지 않는다 [RFC 9112 §6.2].
- **§2.6** [MUST] 출력 응답 헤더를 검증한다 — field-name은 유효 token [RFC 9110 §5.1], 값에 CR/LF/NUL 금지(response splitting 방어) [RFC 9110 §5.5], singleton 필드는 중복 생성하지 않는다(list-valued·`Set-Cookie` 예외) [RFC 9110 §5.3].
- **§2.7** [SHOULD NOT] `Server` 헤더에 과도하게 세부적인 정보를 넣지 않는다 [RFC 9110 §10.2.4].
- **§2.8** 정상 응답 경로의 final status는 유효한 3자리 코드(2xx–5xx)다; 1xx는 정상 경로 밖이다(§9.1) [RFC 9110 §15].
- **§2.9** [MUST NOT] message framing·routing·인증·request modifier·response control·content format 범주의 필드를 trailer로 생성하지 않는다(해당 필드 정의가 trailer 전송을 허용하는 경우에 한해서만 생성). [SHOULD NOT] user agent가 반드시 수신해야 한다고 보는 필드를 trailer로 생성하지 않는다 [RFC 9110 §6.5.1].
- **§2.10** [MUST NOT] `Transfer-Encoding`을 1xx·204 응답 및 CONNECT에 대한 2xx 응답에 보내지 않으며, 대응 요청이 HTTP/1.1(이상)을 가리키지 않으면 보내지 않는다. [MUST NOT] chunked transfer coding을 message body에 두 번 이상 적용하지 않는다. [MUST] 응답 content에 chunked 외 transfer coding을 적용하면 chunked를 final transfer coding으로 두거나 연결을 닫아 메시지를 종결한다 [RFC 9112 §6.1].
- **§2.11** [MUST] status-line은 reason-phrase가 비어 있어도 status-code 뒤 SP를 보낸다 [RFC 9112 §4]. [MUST NOT] 서버가 conformant하지 않은 프로토콜 버전을 응답에 보내지 않는다 [RFC 9110 §6.2].
- **§2.12** [MUST] `206`을 생성하면 — 200이 보냈을 `Date`/`Cache-Control`/`ETag`/`Expires`/`Content-Location`/`Vary`를 생성하고, 단일 range는 `Content-Range`와 해당 범위 content를, 다중 range는 `multipart/byteranges`(필수 boundary 포함)를 생성하되 HTTP 헤더부에 `Content-Range`를 두지 않고(MUST NOT) 각 body part에 `Content-Range`를 둔다. [MUST NOT] 단일 range 요청에 multipart 응답을 생성하지 않는다 [RFC 9110 §15.3.7].
- **§2.13** [MUST] `304`를 생성하면 200이 보냈을 `Content-Location`/`Date`/`ETag`/`Vary`/`Cache-Control`/`Expires`를 생성한다. [SHOULD NOT] 캐시 갱신 목적이 아닌 한 그 외 표현 metadata는 생성하지 않는다 [RFC 9110 §15.4.5].
- **§2.14** [SHOULD] GET/HEAD에 대한 `200` 응답에 가능한 validator(강한 `ETag`·`Last-Modified` 선호)를 보낸다 [RFC 9110 §15.3.1]. validator를 생성할 때: [MUST] strong이 아닌 entity tag는 weak indicator(`W/`)를 붙이고 [RFC 9110 §8.8.3]; [MUST NOT] clock 있는 origin은 `Date`보다 늦은 `Last-Modified`를 보내지 않는다 [RFC 9110 §8.8.2.1].

## 3. 메서드·라우팅

- **§3.1** [MUST] 405 응답은 지원 메서드를 나열한 `Allow`를 생성한다(빈 list 요소 금지) [RFC 9110 §15.5.6·§10.2.1·§5.6.1.1].
- **§3.2** [SHOULD] 메서드 불허는 405, 리소스 부재는 404로 응답한다 [RFC 9110 §9.1·§15.5.5].
- **§3.3** [SHOULD] 인지되지 않은/미구현 메서드 토큰은 501로 응답한다 [RFC 9110 §9.1·§15.6.2]. 표준 등록 메서드: GET/HEAD/POST/PUT/DELETE/OPTIONS [§9.3], PATCH [RFC 5789], QUERY [RFC 10008].
- **§3.4** [MUST] HEAD 응답은 GET에서 content만 제거한 것과 같다(헤더 parity는 §2.4) [RFC 9110 §9.3.2].
- **§3.5** [SHOULD] OPTIONS 성공 응답은 지원 메서드를 나타내는 `Allow`를 보낸다 [RFC 9110 §9.3.7].
- **§3.6** [MUST] QUERY 요청은 `Content-Type`이 없거나 content와 불일치하면 실패시키고 content를 sniffing해 media type을 추론하지 않는다 [RFC 10008 §2·§2.1].
- **§3.7** [MAY] TRACE는 지원하지 않을 수 있다(XST 위험). [MUST NOT] client는 TRACE 요청에 content를 보내지 않는다. [SHOULD] final recipient가 반사한다면 민감 필드를 제외하고 수신 message를 200의 content로 반사한다 [RFC 9110 §9.3.8].
- **§3.8** [MUST] general-purpose server는 GET·HEAD를 지원한다(그 외 메서드는 OPTIONAL) [RFC 9110 §9.1].
- **§3.9** [MUST] PUT이 표현을 새로 생성하면 `201`, 기존 표현을 수정하면 `200` 또는 `204`로 응답한다. [MUST NOT] 요청 표현이 변환 없이 저장되고 validator가 그 새 표현을 반영하는 경우가 아니면 PUT 성공 응답에 `ETag`/`Last-Modified` 등 validator를 보내지 않는다. [MUST] 변경을 다른 리소스에 적용하려면 적절한 `3xx`로 응답한다 [RFC 9110 §9.3.4].
- **§3.10** [SHOULD] DELETE 성공은 `202`(미적용)·`204`(content 없음)·`200`(content 있음) 중으로 응답한다 [RFC 9110 §9.3.5]. [SHOULD] POST가 리소스를 새로 생성하면 `201`과 `Location`을 보낸다 [RFC 9110 §9.3.3].
- **§3.11** [MUST] CONNECT 요청의 빈/유효하지 않은 port는 거부한다(보통 400) [RFC 9110 §9.3.6].
- **§3.12** [MUST] PATCH는 patch 전체를 atomic하게 적용하고 부분 적용된 표현을 노출하지 않으며, 전체 적용이 불가하면 어떤 변경도 적용하지 않는다 [RFC 5789 §2]. [MUST] 받은 patch 문서가 대상 리소스 타입에 적합한지 보장한다 [RFC 5789 §2]. [SHOULD] PATCH를 지원하는 리소스의 OPTIONS 응답과 미지원 patch media type의 `415` 응답에 `Accept-Patch`를 보낸다 [RFC 5789 §3.1·§2.2].

## 4. 요청 해석·신뢰

- **§4.1** [MUST] origin-form과 absolute-form request-target을 받아들인다 [RFC 9112 §3.2]. authority-form은 CONNECT 전용이며, CONNECT 미지원 시 미구현 메서드로 처리한다(§3.3) [RFC 9112 §3.2]. asterisk-form(`OPTIONS *`)은 서버 전체에 대한 OPTIONS 요청이다 [RFC 9110 §9.3.7].
- **§4.2** absolute-form에서는 request-target authority가 권위이고 `Host`는 무시된다(HTTP/1.1은 `Host` 필수) [RFC 9112 §3.2.2].
- **§4.3** [MUST] HTTP/1.1 요청은 정확히 하나의 유효한 `Host`를 가져야 한다; 없거나 둘 이상이거나 comma로 결합되었거나 유효하지 않으면 400 [RFC 9112 §3.2].
- **§4.4** [MUST NOT] 신뢰된 intermediary가 아니면 `Forwarded`/`X-Forwarded-*`를 client 주소·scheme·host의 권위로 신뢰하지 않는다(형식은 RFC 7239 §4). [SHOULD NOT] `Forwarded`를 응답에 echo하지 않는다 [RFC 7239 §1·§4·§8.2].
- **§4.5** [MAY] 이 서버가 서비스하도록 구성되지 않은 authority는 421로 응답할 수 있다 [RFC 9110 §15.5.20].
- **§4.6** [MAY] 처리 의사를 넘는 크기의 요청 content는 413으로 거부할 수 있다 [RFC 9110 §15.5.14].
- **§4.7** [SHOULD] 요청 해석 오류는 400으로 응답한다 [RFC 9110 §15.5.1].
- **§4.8** [SHOULD] 미인지 요청 헤더/트레일러를 무시한다(거부하지 않음) [RFC 9110 §5.1]; GET/HEAD/DELETE 요청 본문을 라우팅·의미 입력으로 쓰지 않는다 [RFC 9110 §9.3.1·§9.3.2·§9.3.5].
- **§4.9** [MUST] 신뢰된 gateway 연결이 아니면 target URI의 scheme 요건을 충족하지 못하는 요청을 거부한다; 특히 `https` 리소스 요청은 그 origin에 유효한 인증서로 보안된 연결에서 받지 않았으면 거부한다 [RFC 9110 §7.4].

## 5. 인코딩·redirection

- **§5.1** [MUST] JSON 응답은 UTF-8로 인코딩하고 BOM(U+FEFF)을 붙이지 않으며 [RFC 8259 §8.1], 제어문자(U+0000–U+001F)·`"`·`\`를 escape한다 [RFC 8259 §7]. [SHOULD] 객체 멤버 이름은 유일하다 [RFC 8259 §4].
- **§5.2** [SHOULD] content가 있는 응답에 `Content-Type`을 보낸다 [RFC 9110 §8.3].
- **§5.3** [SHOULD] 3xx redirect(301/302/303/307/308)는 `Location`을 생성한다 [RFC 9110 §15.4.2–§15.4.9]; [SHOULD] `300`은 HEAD 외 메서드에 표현 metadata·URI 목록을 content로 생성한다 [RFC 9110 §15.4.1]. (201 Created는 `Location` 또는 target URI로 created 리소스를 식별 — §15.3.2는 서술적.)
- **§5.4** URI를 직접 생성·emit할 때: [MUST] IPv6 리터럴은 대괄호로 감싸고 [RFC 3986 §3.2.2]; [SHOULD] canonical 표현(소문자 hex, `::` 압축)을 쓰며 [RFC 5952 §4]; [MUST NOT] zone identifier를 URI에 넣지 않는다 [RFC 3986 §3.2.2].
- **§5.5** [SHOULD] 생성하는 4xx/5xx 오류 응답은 오류 상황을 설명하는 representation을 포함한다(HEAD 제외) [RFC 9110 §15.5·§15.6].

## 6. 스트리밍 (SSE) [WHATWG HTML — Server-Sent Events]

- **§6.1** [MUST] SSE 응답의 `Content-Type`은 `text/event-stream`이다.
- **§6.2** [MUST] event stream은 UTF-8로 인코딩한다.
- **§6.3** [MUST] 라인 구분자는 CRLF·LF·CR 중 하나다.
- **§6.4** `id` 필드 값에 U+0000 NULL이 있으면 클라이언트가 그 `id` 필드를 무시한다 [WHATWG HTML].
- **§6.5** 선두 BOM(U+FEFF) 1개는 클라이언트의 UTF-8 decode에서 제거된다 [WHATWG HTML].

## 7. 캐시·조건부·폐기 헤더

- **§7.1** [SHOULD NOT] `Warning`을 emit하지 않는다 (RFC 9111 §5.5 obsolete).
- **§7.2** [SHOULD NOT] `Pragma`를 emit하지 않는다 (RFC 9111 §5.4 deprecated).
- **§7.3** [SHOULD NOT] origin으로서 `Age`를 생성하지 않는다 — `Age`의 존재 자체가 응답이 origin이 아닌 캐시를 경유했음을 의미한다(§5.1은 이를 규범 문장이 아니라 함의로 규정) [RFC 9111 §5.1].
- **§7.4** [MUST] origin server는 `If-Match`에 strong, `If-None-Match`에 weak 비교 함수를 쓴다 [RFC 9110 §13.1.1·§13.1.2]. [MUST] 선택된 표현을 고르는 요청에 precondition이 있으면 정상 검사 직후·메서드 수행 직전에 다음 순서로 평가한다 — If-Match → If-Unmodified-Since → If-None-Match → If-Modified-Since → If-Range [RFC 9110 §13.2.1·§13.2.2]. condition이 거짓이면 메서드를 수행하지 않고, `If-None-Match`는 GET/HEAD에 `304`·그 외 메서드에 `412`를, `If-Match`/`If-Unmodified-Since`는 `412`를 생성한다 [RFC 9110 §13.1.1·§13.1.2·§13.1.4]. [MUST] precondition 무시 규칙을 지킨다 — `If-Modified-Since`/`If-Unmodified-Since`는 각각 `If-None-Match`/`If-Match`가 있거나 값이 유효 HTTP-date가 아니거나 메서드가 GET/HEAD가 아니거나(IMS) 수정일이 없으면 무시; `If-Range`는 `Range`가 없거나 range 미지원 리소스면 무시; CONNECT/OPTIONS/TRACE에는 모든 precondition을 무시 [RFC 9110 §13.1.3·§13.1.4·§13.1.5·§13.2.1].
- **§7.5** [SHOULD] cacheable 응답을 selecting header field(예: `Accept-Language`)에 따라 선택적으로 재사용시키려면 그 응답에 `Vary`를 생성한다 [RFC 9110 §12.5.5].
- **§7.6** [MUST NOT] clock 없는 origin은 값이 고정된 과거(항상 만료)이거나 clock 있는 시스템이 리소스에 부여한 값이 아니면 `Expires`를 생성하지 않는다 [RFC 9111 §5.3].

## 8. 인증

- **§8.1** [MUST] 401 응답은 최소 하나의 `WWW-Authenticate` 헤더를 보낸다 [RFC 9110 §15.5.2·§11.6.1].

## 9. 프로토콜 엣지

- **§9.1** 1xx(100/101/103)는 정상 응답 경로 밖이다; 101을 emit하거나 프로토콜 전환용 `Upgrade`/`Connection`을 설정하지 않는다 [RFC 9110 §15.2].
- **§9.2** [MUST] 426을 emit한다면 `Upgrade`(및 `Connection: Upgrade`)를 보낸다 [RFC 9110 §15.5.22·§7.8].
- **§9.3** [MUST NOT] HTTP/1.0 클라이언트에 1xx 응답을 보내지 않는다(HTTP/1.0은 1xx를 정의하지 않음) [RFC 9110 §15.2].
- **§9.4** [MUST] `100 (Continue)`를 보냈으면 요청 content를 받아 처리한 뒤 반드시 final status code로 종결한다(연결이 조기 종료된 경우 제외). [SHOULD] 전체 요청 content를 읽기 전에 final status로 응답하면 연결을 닫을지 계속 읽을지 의사를 표시한다 [RFC 9110 §10.1.1].
- **§9.5** [SHOULD NOT] origin server는 `511`을 생성하지 않는다(intercepting proxy 전용) [RFC 6585 §6].
- **§9.6** [SHOULD] `505`를 생성하면 미지원 버전 이유와 지원 프로토콜을 설명하는 representation을 생성한다 [RFC 9110 §15.6.6]. [SHOULD] 일시적 조건의 `413`에는 `Retry-After`를 생성한다 [RFC 9110 §15.5.13].

## 10. 연결 관리

- **§10.1** [MUST] persistent connection을 지원하지 않으면 1xx가 아닌 모든 응답에 `close` connection option을 보낸다 [RFC 9112 §9.3].
- **§10.2** [MUST] 응답 전송 후 요청 message body를 끝까지 읽거나 연결을 닫는다(잔여 데이터가 다음 요청으로 오인되는 request smuggling 방지) [RFC 9112 §9.3].
- **§10.3** [MUST] `close` connection option을 받았거나 보냈으면 그 요청에 대한 final response 이후 연결 종료를 개시하고, 그 연결에서 이후 요청을 처리하지 않는다(MUST NOT). [SHOULD] 닫는 연결의 final response에 `close` option을 보낸다 [RFC 9112 §9.6].
- **§10.4** [MUST] 파이프라인된 요청들을 병렬 처리하더라도 응답은 요청을 받은 순서대로 보낸다 [RFC 9112 §9.3.2].

## 11. Range 요청

- **§11.1** [MUST] range 처리가 정의되지 않은/미인지 메서드와 함께 온 `Range`는 무시하고, origin server는 이해하지 못하는 range unit의 `Range`를 무시한다 [RFC 9110 §14.2]. [MUST] `Range`/`Content-Range`의 decimal numeral 정수 오버플로를 방어한다 [RFC 9110 §14.1.2].
- **§11.2** [SHOULD] 만족 가능한 byte-range 요청에는 `206`(헤더 규칙은 §2.12)을, 만족 불가하거나 range 미지원이면 `416`을 보낸다. [SHOULD] `416`에는 현재 표현 길이를 담은 `Content-Range`를 생성한다 [RFC 9110 §14.2·§15.5.17·§14.4].
- **§11.3** [MUST] `Content-Range` 지원이 정의되지 않은 메서드와 함께 온 `Content-Range`는 무시한다 [RFC 9110 §14.4]. [SHOULD] partial PUT을 지원하지 않는 리소스에 `Content-Range`가 온 PUT은 `400`으로 응답한다 [RFC 9110 §14.5].
- **§11.4** [SHOULD] `If-Range` 조건이 거짓이면 `Range`를 무시하고, 참이면 `Range`를 처리한다 [RFC 9110 §13.1.5].

## 12. 규칙이 아닌 것 (하드룰로 강제하지 않음)

- URI 정규화 [RFC 3986 §6]·JSON 객체 키 유일성 [RFC 8259 §4]은 SHOULD이며 하드룰로 강제하지 않는다.
- TRACE "self only" 제약은 RFC 9110에 없다(obsolete된 RFC 7231 오인용 금지).
