# Compression Standards

**HTTP 응답 압축(content coding 적용자)이 지켜야 할 규칙의 정본.** 각 항목은 규범 수준(MUST / MUST NOT / SHOULD / SHOULD NOT / MAY)과 1차 출처를 갖는 순수 규칙이다. 규범 키워드 없이 서술된 항목은 규칙이 아니라 사실·정의(무표기)다.

이 문서는 **규칙만** 담는다. 구현 분담은 `CLAUDE.md`, 런타임 동작은 테스트의 소관이다.

## 적용 범위 · 주체 선언

이 미들웨어는 **origin server 내부의 응답 content coding 적용자**다. intermediary(proxy)가 아니므로, 1차 출처에서 intermediary를 수신 주체로 하는 규범 문장은 origin 내부 미들웨어의 파생 요건으로 수용하며(무표기), 원 조문의 대상을 규칙 문장에 밝힌다.

Content-Encoding은 representation 계층의 특성이므로 이 문서의 규칙은 HTTP 버전(1.1/2/3)에 독립이다. 메시지 framing·`Transfer-Encoding`·`Content-Length` 전송 규칙은 representation을 감싸는 메시징 계층의 소관이며 이 미들웨어는 생성하지 않는다(§8).

**대조 기준일 2026-07-02** — 전 규범 문장을 rfc-editor.org 원문(verified errata 포함), IANA HTTP Content Coding Registry(2025-10-02 갱신판), WHATWG Compression Standard(living standard, 2026-04-20 스냅숏)와 전수 대조 완료. RFC 인용은 불변이나, WHATWG Compression(§7)과 IANA 레지스트리(§2)는 재대조 시 이 기준일 이후 변경분만 보면 된다.

인용 정본:
- **행동** — RFC 9110(HTTP Semantics, STD 97)·RFC 9111(HTTP Caching, STD 98).
- **바이트 포맷** — RFC 1950(zlib)·RFC 1951(deflate)·RFC 1952(gzip)·RFC 7932(brotli)·RFC 8878(zstd)·RFC 9659(zstd HTTP window).
- **코딩 이름** — IANA HTTP Content Coding Registry.
- **스트리밍 API** — WHATWG Compression Standard.

RFC 1950·1952는 Informational(1996, pre-BCP14)이라 규범 키워드가 소문자다. RFC 9110 §8.4.1.2·§8.4.1.3이 이를 규범 인용하므로 포맷 준수는 사실상 강제이나, 이 문서에서는 원문 표기를 따라 무표기로 둔다. RFC 8878의 skippable frame 처리 문장에도 BCP14 키워드가 없다.

---

## 1. 협상 (Accept-Encoding 해석)

- **§1.1** `Accept-Encoding` 헤더 필드가 요청에 없으면 모든 content coding이 acceptable하다 [RFC 9110 §12.5.3]. field value가 빈 `Accept-Encoding`은 어떤 content coding도 원하지 않음을 의미한다 [RFC 9110 §12.5.3]. field에 나열된 content coding은 qvalue 0을 동반하지 않는 한 acceptable하다(qvalue 0은 "not acceptable") [RFC 9110 §12.5.3·§12.4.2]. content coding이 없는 representation은 `identity;q=0` 또는 (identity의 더 구체적 항목 없이) `*;q=0`으로 명시 배제되지 않는 한 acceptable하다 [RFC 9110 §12.5.3]. wildcard `*`는 field에 명시적으로 나열되지 않은 모든 가용 content coding에 매칭된다 [RFC 9110 §12.5.3]. 같은 목적의 다수 content coding 중에서는 non-zero qvalue가 가장 높은 acceptable coding이 선호된다 [RFC 9110 §12.5.3]. [SHOULD] non-empty `Accept-Encoding`이 있고 가용 표현 중 acceptable로 나열된 content coding이 없으면, identity coding이 unacceptable로 표시되지 않은 한 content coding 없는 응답을 보낸다 [RFC 9110 §12.5.3]. identity가 unacceptable이고 acceptable한 content coding의 표현도 만들 수 없는 상황은 406 (Not Acceptable)의 정의에 대응한다(406 생성 자체를 명하는 규범 문장은 없다) [RFC 9110 §15.5.7·§12.1].
- **§1.2** qvalue는 0~1 범위이며 문법은 `( "0" [ "." 0*3DIGIT ] ) / ( "1" [ "." 0*3("0") ] )`이다 [RFC 9110 §12.4.2]. `q` 파라미터 이름은 case-insensitive하게 인식한다 [RFC 9110 §12.4.2]. `q` 파라미터가 없으면 기본 weight는 1이다 [RFC 9110 §12.4.2].
- **§1.3** [SHOULD] `x-gzip`을 `gzip`과 동등하게 취급한다 [RFC 9110 §8.4.1.3]. [SHOULD] `x-compress`를 `compress`와 동등하게 취급한다 [RFC 9110 §8.4.1.1].
- **§1.4** content coding 이름은 case-insensitive하다 [RFC 9110 §8.4.1].

## 2. 인코딩 적용 (Content-Encoding 생성)

- **§2.1** [MUST] 인코딩을 적용한 sender는 적용한 순서대로 content coding을 나열한 `Content-Encoding` 헤더 필드를 생성한다 [RFC 9110 §8.4]. [SHOULD NOT] `identity`를 `Content-Encoding`에 포함하지 않는다(Accept-Encoding에서의 특수 역할 전용으로 예약) [RFC 9110 §8.4]. 생성하는 content coding 이름은 IANA HTTP Content Coding Registry의 등록 이름(현행 13종: aes128gcm·br·compress·dcb·dcz·deflate·exi·gzip·identity·pack200-gzip·x-compress·x-gzip·zstd)을 사용한다 [RFC 9110 §8.4.1·§16.6.1; IANA]. `Content-Encoding`은 representation의 특성이며, 적용 후의 모든 representation metadata는 별도 명시가 없는 한 coded form 기준이다 [RFC 9110 §8.4].
- **§2.2** `Content-Length`는 동봉된 데이터의 octet 수를 가리키므로, 인코딩 적용 후 비인코딩 기준의 기존 값은 무효이며 유지하지 않는다 [RFC 9110 §8.6]. [SHOULD] `Transfer-Encoding`이 없고 인코딩된 content의 크기를 완전한 header section 송신 전에 알 수 있으면 `Content-Length`를 생성한다 [RFC 9110 §8.6]. 인코딩 적용 전 데이터 기준으로 생성된 representation-integrity 필드(`Content-Digest`·`Repr-Digest`)도 같은 이유로 coded form과 불일치하여 유효하지 않으며, 그 재계산은 이 미들웨어의 소관이 아니다(§8) [RFC 9530 §1.2·§2·§3].
- **§2.3** 이미 `Content-Encoding`이 있는 응답에 같은 목적(압축)의 coding을 중복 적용하지 않는다(대부분의 content coding은 동일 목적의 대안이다) [RFC 9110 §8.4·§12.5.3].

## 3. 적용 제외 (압축해서는 안 되는 응답)

- **§3.1** 1xx·204·304 응답은 content를 포함하지 않으므로 적용할 representation data가 없다 [RFC 9110 §6.4.1]. [MUST NOT] 205 응답에 content를 생성하지 않으므로 압축을 적용하지 않는다 [RFC 9110 §15.3.6]. HEAD 응답은 content를 보내지 않으므로(원 조문 MUST NOT) 적용할 content가 없다 [RFC 9110 §9.3.2]. [MAY] HEAD 응답에서 content 생성 시점에만 정해지는 필드는 생략할 수 있다(원문 예시는 `Content-Length`·`Vary`; `Content-Encoding`은 같은 성질의 파생 적용) [RFC 9110 §9.3.2].
- **§3.2** byte range는 representation data에 content coding이 적용된 경우 인코딩된 바이트 시퀀스 기준으로 계산되며, 디코딩 후 바이트 기준이 아니다 [RFC 9110 §14.1.2]. [MUST] 비인코딩 표현 기준으로 `Content-Range`가 이미 계산된 206 응답의 content에 사후 content coding을 적용하지 않는다(적용하면 `Content-Range`가 동봉된 range를 서술한다는 요건이 깨진다) [RFC 9110 §15.3.7.1·§14.1.2].
- **§3.3** `no-transform` 응답 지시어가 있는 content는 변환하지 않는다(원 조문의 MUST NOT은 intermediary 대상이며, origin 내부 미들웨어는 파생 요건으로 수용) [RFC 9111 §5.2.2.6; RFC 9110 §7.7].

## 4. 캐시 · 검증자 상호작용

- **§4.1** [SHOULD] selecting header field(`Accept-Encoding`)에 따라 선택적으로 재사용될 cacheable 응답에는 `Vary`를 생성한다 [RFC 9110 §12.5.5]. 기존 `Vary`가 `*`이면 variance가 무제한이므로 `Accept-Encoding` 추가는 불필요하다 [RFC 9110 §12.5.5·§12.4.3]. [SHOULD] `Accept-Encoding`으로 협상되는 리소스는 압축을 적용하지 않은(identity) 응답에도 `Vary: Accept-Encoding`을 생성한다 — 그러지 않으면 shared cache가 이 응답을 `Accept-Encoding`과 무관하게 재사용하여 표현 선택이 깨진다 [RFC 9110 §12.5.5; RFC 9111 §4.1]. 같은 요청의 200 응답이 `Vary`를 생성했을 304 응답의 `Vary` 재생성은 304 생성자(§8.2)의 소관이나, 그 selecting 조건은 이 미들웨어가 만든다 [RFC 9110 §15.4.5].
- **§4.2** content coding이 적용된 표현과 미적용 표현이 같은 validator를 공유하면 그 validator는 weak이다 [RFC 9110 §8.8.1]. [MUST] strong validator의 특성을 만족하지 못하는 entity tag는 opaque 값 앞에 `W/`(case-sensitive)를 붙여 weak으로 표기한다 — 압축 적용 후 비인코딩 표현과 공유되는 tag가 이에 해당한다 [RFC 9110 §8.8.3·§8.8.1]. weak validator는 partial content range 검증에 사용할 수 없다(strong validator만 모든 conditional request에 사용 가능) [RFC 9110 §8.8.1]. content coding이 적용된 표현의 strong entity tag는 캐시 갱신·range 요청 충돌 방지를 위해 비인코딩 표현의 entity tag와 구별되어야 한다(예시 섹션의 Note, BCP14 키워드 없음) [RFC 9110 §8.8.3.3].

## 5. 코딩 포맷 (바이트 규격)

- **§5.1** `gzip` coding은 32-bit CRC를 가진 LZ77 coding으로, RFC 1952의 gzip 파일 포맷이다 [RFC 9110 §8.4.1.3; RFC 1952]. gzip compressor는 올바른 ID1·ID2·CM(deflate이므로 8)·CRC32·ISIZE를 생성한다(그 외 고정 헤더 필드는 기본값 허용) [RFC 1952 §2.3.1·§2.3.1.2]. gzip compressor는 모든 reserved bit(FLG의 bit 5–7)를 0으로 둔다 [RFC 1952 §2.3.1·§2.3.1.2].
- **§5.2** `deflate` coding은 RFC 1950 "zlib" 포맷 안에 RFC 1951 deflate 압축 스트림을 담은 것이며, zlib wrapper 없는 raw deflate로 생성하지 않는다 [RFC 9110 §8.4.1.2; RFC 1950; RFC 1951]. HTTP `deflate`는 preset dictionary를 정의하지 않으므로 compressor는 FDICT flag를 설정하지 않으며, 올바른 CMF·FLG(FCHECK를 포함해 CMF·FLG를 16-bit로 본 값이 31의 배수)·ADLER32를 생성한다 [RFC 1950 §2.2·§2.3; RFC 9110 §8.4.1.2].
- **§5.3** `br` coding은 RFC 7932 Brotli Compressed Data Format이다 [IANA; RFC 7932]. br compressor는 RFC 7932 명세에 부합하는 데이터를 생성한다 [RFC 7932 §1.4].
- **§5.4** `zstd` coding은 RFC 8878 Zstandard 포맷이며 HTTP에서는 RFC 9659의 window 제한을 받는다 [IANA; RFC 8878; RFC 9659]. [MUST NOT] `zstd` content coding 사용 시 8 MB를 초과하는 Window_Size를 요구하는 프레임을 생성하지 않는다 [RFC 9659 §3]. zstd 압축 레벨 ≤ 19 유지는 이 window 제한의 구현 파생이다(레벨-윈도우 대응은 zstd 라이브러리의 사실이지 RFC 규정이 아니다) [RFC 9659 §3]. zstd 압축 데이터는 하나 이상의 프레임 연결로 구성될 수 있으며, 연결된 프레임들의 복원 내용은 각 프레임 복원 내용의 연결이다 [RFC 8878 §3.1].

## 6. 포맷 확장 필드 (패딩 주입의 합법성 근거)

- **§6.1** gzip extra field는 FLG.FEXTRA 설정 시 존재하며 총길이 XLEN octet이고, 각 서브필드는 SI1·SI2·LEN(2B, LE)·데이터로 구성된다 [RFC 1952 §2.3.1·§2.3.1.1]. XLEN·LEN은 16-bit 필드이므로 extra field 총량은 65535 octet을 초과할 수 없다 [RFC 1952 §2.3.1·§2.3.1.1]. SI2=0인 서브필드 ID는 예약이며, `ZP`(0x5A,0x50)는 등록되지 않은 사설 ID다(RFC 1952의 서브필드 등록처는 개인 이메일 기반으로 사실상 소멸) [RFC 1952 §2.3.1.1].
- **§6.2** zstd Skippable Frame은 Magic_Number(0x184D2A50~0x184D2A5F, LE 4B)·Frame_Size(LE 4B, User_Data 길이)·User_Data로 구성된다 [RFC 8878 §3.1.2]. 준수 디코더 관점에서 skippable frame은 건너뛰고 내용을 무시한 뒤 그 다음부터 디코딩을 재개하면 된다(BCP14 키워드 없음) [RFC 8878 §3.1.2].

## 7. 스트리밍 (CompressionStream)

- **§7.1** WHATWG 표준 포맷은 `gzip`(RFC 1952)·`deflate`(RFC 1950)·`deflate-raw`(RFC 1951)·`brotli`(RFC 7932) 4종이다(2026-04-20 스냅숏) [WHATWG Compression]. `zstd`는 WHATWG 표준 포맷이 아니며 런타임(Bun) 확장이다 [WHATWG Compression].
- **§7.2** HTTP `deflate` content coding에는 `deflate-raw`가 아니라 `deflate` 포맷 문자열을 사용한다(RFC 1950 zlib-wrapped 대응) [WHATWG Compression; RFC 9110 §8.4.1.2].

## 8. 범위 밖 (이 미들웨어가 다루지 않는 것)

- **§8.1** `dcb`/`dcz`(Compression Dictionary Transport)는 구현하지 않는다 — 구현 시 secure context MUST, `Vary: accept-encoding, available-dictionary`, 36/40-byte 스트림 헤더 등 별도 규칙군이 필요하다 [RFC 9842].
- **§8.2** `Transfer-Encoding`·chunked framing·HTTP/2/3 프레이밍과 `Content-Length`의 전송 정합(HEAD/304 값-일치·금지 상태코드·부정합 forward 방지)은 메시징 계층 소관이다 — 단 인코딩으로 인한 `Content-Length` 무효화·재생성은 §2.2로 이 미들웨어가 소유한다. 이 미들웨어는 hop-by-hop 인코딩을 생성하지 않는다 [RFC 9110 §8.4·§8.6].
- **§8.3** 요청 측 content coding 디코딩과 그에 따른 415 응답 생성은 응답 압축 미들웨어의 소관이 아니다 [RFC 9110 §8.4·§12.5.3].
- **§8.4** TLS 계층 압축과 그 side-channel 공격은 전송 계층 소관이다(§17.6은 content coding·TLS 압축을 포함한 여러 압축 벡터를 다루며 BREACH를 명시한다) [RFC 9110 §17.6].

## 9. 규칙이 아닌 것 (하드룰로 강제하지 않음)

- 압축 적용 여부 자체는 항상 서버 재량이다 — 어떤 정본도 압축을 요구하지 않는다 [RFC 9110 §8.4]. `Accept-Encoding` 부재 시 압축하지 않는 선택은 정책이다(§1.1은 모든 coding을 acceptable로 판정할 뿐 압축을 요구하지 않는다) [RFC 9110 §12.5.3].
- 압축 threshold·압축 레벨·content-type 필터는 어떤 정본도 규정하지 않는 순수 정책이다 [RFC 9110 §8.4]. 동일 qvalue 간 tie-break에 서버 선호 순서를 쓰는 것은 재량이다(§1.1은 최고 non-zero qvalue를 "선호"로 서술할 뿐 규범 요구가 아니다) [RFC 9110 §12.5.3]. 압축 결과가 원본보다 커질 때의 처리(팽창 가드)는 효율 정책이다 [RFC 9110 §8.4].
- BREACH류 압축 오라클 공격과 그 완화(길이 패딩)는 표준화되어 있지 않으며, 패딩을 주입하는 방법만 §6의 포맷 규칙을 지키면 된다 [RFC 9110 §17.6].
