# Cookie Standards

**@zipbul/cookie — origin server 측 쿠키 생산자(`Set-Cookie` 생성)이자 인바운드 `Cookie` 헤더 수신자가 준수해야 할 국제 규칙의 정본.** 주체는 6265bis-22 §3.2.1의 cookie producing implementation(서버·프레임워크)이다. 1차 규범은 §4(Server Requirements)이고, §5(User Agent Requirements)는 방출한 쿠키가 실제로 저장·반송되게 하기 위한 파생 의무로만 미러링한다.

**스냅샷 2026-07-21** — **draft-ietf-httpbis-rfc6265bis-22**(2025-12-01). 아직 RFC가 아니다(IESG 승인, RFC Ed Queue); 발행 시 RFC 6265(2011, 현행 발행 표준)를 대체한다. 전송 계층은 RFC 9110(STD 97). 코덱 확장(§10)은 RFC 5869·RFC 4648·NIST SP 800-38D·FIPS 198-1. 재대조 시 draft-ietf-httpbis-layered-cookies(httpbis WG, 6265·6265bis 통합 대체 예정)의 진행을 확인한다.

**대조 기준일 2026-07-22** — 전 규칙을 draft-22 원문 텍스트(ietf.org archive)와 규칙 단위로 대조했다.

**규범 수준 규약**
- **[MUST]/[MUST NOT]** — 원문에 서버(방출자)를 직접 구속하는 BCP14 키워드가 실재하거나, 위반 시 UA가 쿠키를 통째로 무시하거나(*"abort this algorithm and ignore the cookie entirely"*) 수신자가 메시지를 거부할 수 있는(RFC 9110 §5.5) 하드 실패. 파생은 본문에 **UA-파생**(또는 수신자-파생)으로 표기한다.
- **[SHOULD]/[SHOULD NOT]/[MAY]** — 서버(방출자) 대상 원문 키워드 그대로이거나, 위반 시 보호·의미가 약화되나 소멸하지는 않는 파생(표기).
- **[무표기]** — 사실·정의·UA 동작 서술(UA를 수신 주체로 하는 BCP14 키워드 포함). 하드룰로 강제하지 않는다.

---

## 1. Set-Cookie 생성 문법

- **§1.1** [MUST NOT] 문법에서 벗어난 `Set-Cookie`를 보내지 않는다 — *"Servers conforming to this profile MUST NOT send Set-Cookie header fields that deviate from the following grammar"*: `set-cookie-string = BWS cookie-pair *( BWS ";" OWS cookie-av )`, `cookie-pair = cookie-name BWS "=" BWS cookie-value` [6265bis-22 §4.1.1]
- **§1.2** [무표기] `cookie-name = token`(RFC 9110 §5.6.2: `token = 1*tchar`, tchar = *"any VCHAR, except delimiters"* — delimiter는 DQUOTE와 `(),/:;<=>?@[\]{}`) — `%`는 tchar에 포함된다 [6265bis-22 §4.1.1·RFC 9110 §5.6.2]
- **§1.3** [무표기] `cookie-value = *cookie-octet / ( DQUOTE *cookie-octet DQUOTE )`, `cookie-octet = %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E` — CTL·whitespace·DQUOTE·comma·semicolon·backslash를 제외한 US-ASCII다(원문 ABNF 주석) [6265bis-22 §4.1.1]
- **§1.4** [MUST NOT] 이름 없는 쿠키를 만들지 않는다 — *"servers MUST NOT produce nameless cookies (i.e.: an empty cookie-name) as such cookies may be unpredictably serialized by UAs when sent back to the server"* [6265bis-22 §4.1.1]
- **§1.5** [무표기] cookie-value의 의미론은 정본이 정의하지 않는다 — *"The semantics of the cookie-value are not defined by this document."* [6265bis-22 §4.1.1]
- **§1.6** [SHOULD] 임의 데이터를 value에 실으려면 인코딩한다 — *"servers that wish to store arbitrary data in a cookie-value SHOULD encode that data, for example, using Base64"* [6265bis-22 §4.1.1·RFC 4648]
- **§1.7** [MAY] value는 DQUOTE로 감쌀 수 있다(*"the cookie-value MAY be wrapped in DQUOTE characters"*) — 그 DQUOTE는 값의 일부다: *"the initial and trailing DQUOTE characters are not stripped.  They are part of the cookie-value, and will be included in Cookie header fields sent to the server."* [6265bis-22 §4.1.1]
- **§1.8** [MUST NOT] 한 set-cookie-string에 같은 이름의 속성을 두 번 만들지 않는다 — *"servers MUST NOT produce two attributes with the same name in the same set-cookie-string"* — 중복 시 Max-Age·Expires·SameSite는 UA가 마지막 것을 취하고(§5.7 steps 6·17), Domain·Path는 1024 octet 이하인 값 중 마지막 것을 취하며(steps 7·11), Secure·HttpOnly는 존재 여부만 본다(steps 12·14) [6265bis-22 §4.1.1·§5.7]
- **§1.9** [MUST NOT] 한 응답에 같은 cookie-name의 `Set-Cookie`를 두 줄 이상 만들지 않는다 — *"Servers MUST NOT include more than one Set-Cookie header field in the same response with the same cookie-name."* [6265bis-22 §4.1.1]
- **§1.10** [MUST NOT] `extension-av`에 선행·후행 WSP를 넣지 않는다 — *"extension-av MUST NOT contain leading or trailing WSP characters as they will be interpreted as BWS and removed"* [6265bis-22 §4.1.1]
- **§1.11** [무표기] 속성 이름은 case-insensitive다 — *"while they are presented here in CamelCase, such as "HttpOnly" or "SameSite", any case is accepted"* [6265bis-22 §4.1.1]

## 2. 속성 생성

- **§2.1** [MUST] `Expires` 값은 IMF-fixdate로 생성한다 — `expires-av = "Expires" BWS "=" BWS sane-cookie-date`, `sane-cookie-date = <IMF-fixdate, defined in [HTTP], Section 5.6.7>`(§1.1의 문법 구속); IMF-fixdate에서 day는 `2DIGIT`, year는 `4DIGIT`, zone은 리터럴 `GMT`다. [SHOULD] rfc1123-date 형식(4자리 연도를 요구하는 형식)을 쓴다 — *"servers SHOULD use the rfc1123-date format, which requires a four-digit year"* [6265bis-22 §4.1.1·RFC 9110 §5.6.7]
- **§2.2** [무표기] `max-age-av = "Max-Age" BWS "=" BWS non-zero-digit *DIGIT`, `non-zero-digit = %x31-39` — 0·음수·부호·소수는 이 production으로 도출할 수 없다. 삭제는 과거 `Expires`로 표현한다 — *"servers can delete cookies by sending the user agent a new cookie with an Expires attribute with a value in the past"* [6265bis-22 §4.1.1·§4.1.2]
- **§2.3** [무표기] 둘 다 있으면 Max-Age가 Expires에 우선한다 — *"If a cookie has both the Max-Age and the Expires attribute, the Max-Age attribute has precedence"*(§5.7 step 6 동일 순서) — 삭제용 과거 Expires에 Max-Age를 동반하면 Max-Age를 지원하는 UA에서는 우선순위 규칙에 따라 삭제가 무효화된다(반면 Max-Age 미지원 UA는 그 속성을 무시하므로 과거 Expires가 그대로 삭제로 작용한다 — *"User agents that do not support the Max-Age attribute ignore the attribute."*) [6265bis-22 §4.1.2.2·§5.7]
- **§2.4** [MUST NOT] 쿠키가 서버 clock의 지정 시각에 정확히 소멸한다고 의존하지 않는다 — *"Servers MUST NOT depend on cookies being evicted exactly at the specified date and time of the server's clock."* [6265bis-22 §4.1.2.1]
- **§2.5** [무표기] `domain-value`는 RFC 1034 §3.5 subdomain을 RFC 1123 §2.1로 강화한 것이며, 따라서 USASCII 문자열(A-label 등, RFC 5890 §2.3.2.1)이다 — 선행 `.`은 문법상 불허이며 UA가 무시할 뿐이다(§5.7 step 7: *"a leading %x2E ("."), if present, is ignored even though that character is not permitted"*) [6265bis-22 §4.1.1·§5.7]
- **§2.6** [무표기] `path-value = *av-octet`, `av-octet = %x20-3A / %x3C-7E`(*"any CHAR except CTLs or ";""*) — 선행 `/` 요구는 문법에 없다. Path는 보안 경계가 아니다 — *"the Path attribute cannot be relied upon for security"* [6265bis-22 §4.1.1·§4.1.2.4]
- **§2.7** [무표기] `samesite-value = "Strict" / "Lax" / "None"` 셋뿐이다. 저장 시 미지 값과 속성 부재는 동일하게 same-site-flag "Default"가 된다(§5.7 step 17: *"Otherwise, set the cookie's same-site-flag to "Default""*); retrieval의 cross-site 제외 조건은 "Default"를 "Lax"와 같은 자리에서 취급한다(§5.8.3: *"The same-site-flag is "Lax" or "Default"."*). 미지 값에 대한 기본 강제 모드는 Lax 상당이다(§4.1.2.7: *"a default enforcement mode that is equivalent to "Lax""*). UA가 채택할 수 있는 Lax-allowing-unsafe 강제는 SameSite 속성을 명시하지 않아 Default가 된 쿠키에만 적용되므로(§5.6.7.2: *"only to cookies that did not explicitly specify a SameSite attribute"*) 미지 값 쿠키에는 적용되지 않는다 — 부재와 `SameSite=None`은 다르다 [6265bis-22 §4.1.1·§4.1.2.7·§5.6.7.2·§5.7·§5.8.3]
- **§2.8** [무표기] Domain 부재 = origin server 한정(host-only) — *"If the server omits the Domain attribute, the user agent will return the cookie only to the origin server."* 일부 기존 UA는 부재를 `Domain=현재 host`가 명시된 것처럼 취급해 서브도메인에도 보낸다(*"these user agents will erroneously send the cookie to www.site.example as well"*) [6265bis-22 §4.1.2.3]

## 3. UA 수용 규칙의 미러 (원문 수신 주체: UA)

- **§3.1** [MUST] name+value 합산 4096 octet 이하로 생성한다(UA-파생) — *"If the sum of the lengths of the name string and the value string is more than 4096 octets, abort this algorithm and ignore the set-cookie-string entirely."*(§5.6 step 5; §5.7 step 4는 같은 4096 한도를 cookie-name·cookie-value 합산과 *"ignore the cookie entirely"* 문면으로 규정) — `=`와 속성은 합산에 불포함 [6265bis-22 §5.6·§5.7]
- **§3.2** [MUST NOT] name·value·set-cookie-string에 CTL(%x00-08 / %x0A-1F / %x7F, HTAB 제외)을 넣지 않는다(UA-파생) — set-cookie-string 전체(§5.6 step 1)와 name/value(§5.7 step 3)가 abort 대상이다 [6265bis-22 §5.6·§5.7]
- **§3.3** [MUST] `SameSite=None`에는 `Secure`를 동반한다(UA-파생) — *"If the cookie's "same-site-flag" is "None", abort this algorithm and ignore the cookie entirely unless the cookie's secure-only-flag is true."*(§5.7 step 19) [6265bis-22 §5.7]
- **§3.4** [MUST] `Secure` 속성이 붙은 쿠키는 secure 채널로 전송되는 응답에서만 방출한다(UA-파생) — *"If the request-uri does not denote a "secure" connection (as defined by the user agent), and the cookie's secure-only-flag is true, then abort these steps and ignore the cookie entirely."*(§5.7 step 13) [6265bis-22 §5.7]
- **§3.5** [무표기] Expires 또는 Max-Age로 수명이 지정된 쿠키는 UA가 그 수명을 캡한다(무지정 세션 쿠키는 이 알고리즘 밖) — *"When processing cookies with a specified lifetime, either with the Expires or with the Max-Age attribute, the user agent MUST limit the maximum age of the cookie.  The limit SHOULD NOT be greater than 400 days (34560000 seconds) in the future."* 초과분은 거부가 아니라 축소된다 — *"Expires or Max-Age attributes that specify a lifetime longer than the limit MUST be reduced to the limit."* [6265bis-22 §5.5]
- **§3.6** [SHOULD] 속성 값은 1024 octet 이하로 생성한다(파생) — 1024 초과 attribute-value는 그 속성만 무시되고(§5.6 attribute step 6), Domain·Path는 §5.7 steps 7·11에서 배제되어 쿠키가 다른 범위로 저장된다 [6265bis-22 §5.6·§5.7]
- **§3.7** [무표기] 비보안 채널의 non-Secure 쿠키는 다음 네 조건이 모두 맞는 기존 쿠키가 있으면 무시된다(§5.7 step 16): 이름 일치 · 기존 쿠키의 secure-only-flag true · 도메인이 어느 방향으로든 domain-match · 새 쿠키의 path가 기존 쿠키의 path에 path-match [6265bis-22 §5.7]
- **§3.8** [무표기] 같은 name·domain·host-only-flag·path의 수신은 기존 쿠키를 대체한다(§5.7 step 23). UA는 100-level 응답 또는 cookie policy에 따라 `Set-Cookie`를 무시할 수 있고(MAY), 그 외 응답의 것은 cookie policy로 무시되지 않는 한 처리된다(SHOULD — *"unless ignored according to the user agent's cookie policy"*) [6265bis-22 §5.7·§5.3]

## 4. Cookie name prefix

- **§4.1** [SHOULD] prefix를 사용한다 — *"To maximize compatibility with user agents servers SHOULD use prefixes as described below."* [6265bis-22 §4.1.3]
- **§4.2** [MUST] `__Secure-` 이름에는 `Secure`를 동반한다(UA-파생) — *"If the cookie-name begins with a case-insensitive match for the string "__Secure-", abort this algorithm and ignore the cookie entirely unless the cookie's secure-only-flag is true."*(§5.7 step 20) [6265bis-22 §4.1.3.1·§5.7]
- **§4.3** [MUST] `__Host-` 이름에는 `Secure` + 명시적 `Path=/` + Domain 미방출을 동반한다(UA-파생) — §5.7 step 21은 secure-only-flag true, host-only-flag true, *"The cookie-attribute-list contains an attribute with an attribute-name of "Path", and the cookie's path is /."*를 모두 요구한다 [6265bis-22 §4.1.3.2·§5.7]
- **§4.4** [MUST] prefix 판정은 case-insensitive로 한다(UA-파생) — *"UAs MUST match cookie name prefixes case-insensitively"*(§5.4)이므로 미스캡 이름(`__SECURE-`·`__host-`)도 §4.2·§4.3의 조합 요구를 받는다 [6265bis-22 §5.4·§4.1.3]
- **§4.5** [무표기] 빈 이름에 `__Secure-`/`__Host-`로 case-insensitive하게 시작하는 값 조합은 UA가 무시한다(§5.7 step 22: *"the cookie-value begins with a case-insensitive match"*) [6265bis-22 §5.7]

## 5. 인바운드 Cookie 헤더

- **§5.1** [무표기] `cookie-string = cookie-pair *( ";" SP cookie-pair )` — 속성은 반환되지 않는다: *"the server cannot determine from the Cookie field alone when a cookie will expire, for which hosts the cookie is valid, for which paths the cookie is valid, or whether the cookie was set with the Secure or HttpOnly attributes"* [6265bis-22 §4.2.1·§4.2.2]
- **§5.2** [MUST] 복수의 `Cookie` 헤더를 허용한다 — *"Servers MUST be tolerant of multiple cookie headers."* 형태는 자유다 — *"Servers are free to determine what form this tolerance takes."* [6265bis-22 §4.2.1]
- **§5.3** [SHOULD NOT] cookie-pair의 직렬화 순서에 의존하지 않는다 — *"servers SHOULD NOT rely upon the serialization order"* — 같은 이름의 쿠키가 둘 이상인 경우 포함(*"servers SHOULD NOT rely upon the order in which these cookies appear in the header field"*) [6265bis-22 §4.2.2]
- **§5.4** [무표기] 개별 쿠키의 의미론은 앱 소관이다 — *"Servers are expected to imbue these cookies with application-specific semantics."* [6265bis-22 §4.2.2]
- **§5.5** [무표기] `Cookie` 헤더 파싱의 percent-decode 규정은 정본에 없다 — §5.6의 *"a user agent MUST NOT decode these sequences"*는 UA의 set-cookie-string 파싱 조문이고, 서버측 §4.2에는 디코딩 조문이 없다 [6265bis-22 §5.6·§4.2]

## 6. 전송 계층 결합 (RFC 9110)

- **§6.1** [무표기] `Set-Cookie`는 list 문법을 쓰지 않는 공인 예외다 — *"Since it cannot be combined into a single field value, recipients ought to handle "Set-Cookie" as a special case while processing fields."* — 쿠키마다 별도의 field line으로 방출한다 [RFC 9110 §5.3]
- **§6.2** [MUST NOT] field value에 CR·LF·NUL을 생성하지 않는다(수신자-파생) — *"a recipient of CR, LF, or NUL within a field value MUST either reject the message or replace each of those characters with SP"* [RFC 9110 §5.5]

## 7. 한도·강건성

- **§7.1** [SHOULD] 가능한 한 적고 작은 쿠키를 쓴다 — *"Servers SHOULD use as few and as small cookies as possible to avoid reaching these implementation limits, minimize network bandwidth due to the Cookie header field being included in every request, and to avoid reaching server header field limits"* [6265bis-22 §6.1]
- **§7.2** [SHOULD] 최종 cookie-string이 자신의 헤더 한도를 넘지 않게 한다 — *"Servers SHOULD avoid setting a large number of large cookies such that the final cookie-string would exceed their header field limit."* 많은 구현의 기본 한도가 8192 octet이다(*"many popular implementations have default limits of 8192 octets"*) [6265bis-22 §4.2.1]
- **§7.3** [SHOULD] 쿠키 소실에 우아하게 대응한다 — *"Servers SHOULD gracefully degrade if the user agent fails to return one or more cookies in the Cookie header field because the user agent might evict any cookie at any time."* [6265bis-22 §6.1]
- **§7.4** [무표기] general-use UA에는 최소 도메인당 50개·전체 3000개 이상의 용량 제공이 권고된다(SHOULD — *"General-use user agents SHOULD provide"* / *"At least"*); 초과 제거 우선순위는 ① 만료 쿠키 ② domain field 공유 수가 한도를 넘는 쿠키 중 secure-only-flag false ③ 같은 조건의 쿠키 전반 ④ 모든 쿠키 순이다 [6265bis-22 §6.1·§5.7]
- **§7.5** [SHOULD NOT] UA가 쿠키를 보존한다고 의존하지 않는다 — *"Servers SHOULD NOT rely upon user agents retaining cookies."* [6265bis-22 §8.6]

## 8. 보안·프라이버시

- **§8.1** [SHOULD] 쿠키 내용은 암호화·서명한다 — *"Servers SHOULD encrypt and sign the contents of cookies (using whatever format the server desires) when transmitting them to the user agent (even when sending the cookies over a secure channel)."* 이는 UA 간 이식·재전송은 막지 못한다(*"does not prevent an attacker from transplanting a cookie from one user agent to another or from replaying the cookie at a later time"*) [6265bis-22 §8.3]
- **§8.2** [SHOULD] 높은 보안 수준이 필요한 서버는 `Cookie`/`Set-Cookie`를 secure 채널에서만 쓴다 — *"servers that require a higher level of security SHOULD use the Cookie and Set-Cookie header fields only over a secure channel"* [6265bis-22 §8.3]
- **§8.3** [SHOULD] secure 채널에서 쿠키를 쓸 때는 모든 쿠키에 `Secure`를 단다 — *"When using cookies over a secure channel, servers SHOULD set the Secure attribute (see Section 4.1.2.5) for every cookie."* [6265bis-22 §8.3]
- **§8.4** [SHOULD] 세션 식별자 쿠키는 session fixation을 회피하도록 다룬다 — *"the server SHOULD take care to avoid "session fixation" vulnerabilities"* [6265bis-22 §8.4]
- **§8.5** [SHOULD NOT] 상호 불신 서비스를 같은 host의 다른 port에서 운영하면서 쿠키에 보안 민감 정보를 담지 않는다 — *"servers SHOULD NOT both run mutually distrusting services on different ports of the same host and use cookies to store security-sensitive information"* [6265bis-22 §8.5]
- **§8.6** [SHOULD NOT] 상호 불신 서비스를 같은 host의 다른 path에서 운영하면서 쿠키에 보안 민감 정보를 담지 않는다 — *"servers SHOULD NOT both run mutually distrusting services on different paths of the same host and use cookies to store security-sensitive information"* — *"the Path attribute does not provide any integrity protection"* [6265bis-22 §8.6]
- **§8.7** [SHOULD] 만료 기간은 쿠키의 목적에 맞게 합리적으로 고른다 — *"servers SHOULD promote user privacy by selecting reasonable cookie expiration periods based on the purpose of the cookie"* [6265bis-22 §7.4]
- **§8.8** [무표기] 쿠키는 sibling domain·비보안 채널 주입에 대한 무결성 보증이 없다 — HTTPS 서버는 HTTP 주입 쿠키를 구별할 수 없다(*"will be unable to distinguish these cookies from cookies that it set itself"*); 부분 완화책은 내용 암호화·서명 또는 `__Secure-` prefix다(*"Servers can partially mitigate these attacks by encrypting and signing the contents of their cookies, or by naming the cookie with the __Secure- prefix"*) [6265bis-22 §8.6]

## 9. 확장 속성 (6265bis 밖)

- **§9.1** [무표기] `Partitioned`·`Priority`는 6265bis-22의 core 속성이 아니다 — draft-22 전문에 두 이름이 부재하며, 문법상 `extension-av = 1*av-octet`로 방출된다. 정본: Partitioned는 CHIPS(draft-cutler-httpbis-partitioned-cookies, 2022 만료 개인 draft — 저장 모델 추가 단계를 제안 문면으로 기술), Priority는 draft-west-cookie-priority-00(2016 만료)의 Chromium 구현 관행 [6265bis-22 §4.1.1; CHIPS; draft-west-cookie-priority]
- **§9.2** [MUST] `Partitioned`에는 `Secure`를 동반한다(UA-파생) — *"If the cookie-attribute-list does contain an attribute with an attribute-name of "Partitioned" and the secure-only-flag is false, abort these steps and ignore the cookie entirely."* [CHIPS §2.3]
- **§9.3** [무표기] 확장 속성 값도 `1*av-octet`이어야 §1.1을 통과한다 — `Partitioned`(무값)·`Priority=Low|Medium|High`는 유효한 extension-av다 [6265bis-22 §4.1.1]

## 10. 코덱 확장 (서명·암호화)

- **§10.1** [무표기] HKDF는 extract-then-expand 2단계다 — *"HKDF follows the "extract-then-expand" paradigm"*(§1; 두 단계는 §2.2 Extract·§2.3 Expand) — salt는 강도를 유의미하게 높인다(*"the use of salt adds significantly to the strength of HKDF"*, §3.1) [RFC 5869 §1·§2·§3.1]
- **§10.2** [무표기] AES-GCM의 IV는 96-bit 사용이 권고된다 — *"For IVs, it is recommended that implementations restrict support to the length of 96 bits, to promote interoperability, efficiency, and simplicity of design."*(§5.2.1.1). RBG(무작위) 기반 IV 구성을 쓰는 구현은 단일 키에 대한 인증 암호화 호출 총수가 2^32를 넘지 않아야 한다(결정론적 96-bit IV 전용 구현은 제외) — *"The total number of invocations of the authenticated encryption function shall not exceed 2^32, including all IV lengths and all instances of the authenticated encryption function with the given key."*(§8.3, "global" 요건) [NIST SP 800-38D §5.2.1.1·§8.3]
- **§10.3** [무표기] HMAC 구성은 FIPS 198-1을 따른다 [FIPS 198-1]
- **§10.4** [무표기] base64url은 RFC 4648 §5(*"Base 64 Encoding with URL and Filename Safe Alphabet"*)다 [RFC 4648 §5]

## 11. 범위 밖 (UA 소관)

- **§11.1** [무표기] domain-match·path-match(§5.1), 요청의 same-site 계산(§5.2), 송신 시 SameSite·Secure·HttpOnly 강제와 retrieval 정렬(§5.8), 저장·축출·public suffix 거부(§5.7)는 UA 알고리즘 소관이다 — 서버는 이를 관측·검증할 수 없다(§4.2.2 속성 비반환) [6265bis-22 §5]
