# Compression Standards

**HTTP 응답 압축(content coding 적용자)이 지켜야 할 규칙의 정본.** 각 항목은 규범 수준(MUST / MUST NOT / SHOULD / SHOULD NOT / MAY)과 1차 출처를 갖는 순수 규칙이다. 규범 키워드 없이 서술된 항목은 규칙이 아니라 사실·정의(무표기)다.

## 적용 범위 · 주체 선언

이 미들웨어는 **origin server 내부의 응답 content coding 적용자**다. intermediary(proxy)가 아니므로, 1차 출처에서 intermediary를 수신 주체로 하는 규범 문장은 origin 내부 미들웨어의 파생 요건으로 수용하며(무표기), 원 조문의 대상을 규칙 문장에 밝힌다.

**대조 기준일 2026-07-10** — 전 규범 문장을 rfc-editor.org 원문(verified errata 포함)·IANA HTTP Content Coding Registry(2025-10-02 갱신판)와 전수 대조 완료.

인용 정본:
- **행동** — RFC 9110(HTTP Semantics, STD 97)·RFC 9111(HTTP Caching, STD 98)·RFC 9530(Digest Fields).
- **바이트 포맷** — RFC 1950(zlib)·RFC 1951(deflate)·RFC 1952(gzip)·RFC 7932(brotli)·RFC 8878(zstd)·RFC 9659(zstd HTTP window).
- **코딩 이름** — IANA HTTP Content Coding Registry.

포맷 RFC 중 넷은 규범 키워드가 소문자다 — RFC 1950·1952(1996, pre-BCP14)와 RFC 7932·8878(BCP14 선언이 없는 Informational; 8878은 대문자 규범 키워드 0회). RFC 9110 §8.4.1.2·§8.4.1.3이 1950·1952를 각각 규범 인용하므로 포맷 준수는 사실상 강제이나, 이 문서에서는 원문 표기를 따라 이들 네 출처의 요건을 무표기로 둔다. 반면 RFC 9659는 같은 Informational이어도 BCP14 선언(§2)이 있으므로 그 MUST NOT은 수준으로 표기한다(§5.4).

---

## 1. 협상 (Accept-Encoding 해석)

- **§1.1** `Accept-Encoding` 헤더 필드가 요청에 없으면 모든 content coding이 acceptable하다 [RFC 9110 §12.5.3]. field value가 빈 `Accept-Encoding`은 어떤 content coding도 원하지 않음을 의미한다 [RFC 9110 §12.5.3]. field에 나열된 content coding은 qvalue 0을 동반하지 않는 한 acceptable하다(qvalue 0은 "not acceptable") [RFC 9110 §12.5.3·§12.4.2]. content coding이 없는 representation은 `identity;q=0` 또는 (identity의 더 구체적 항목 없이) `*;q=0`으로 명시 배제되지 않는 한 acceptable하다 [RFC 9110 §12.5.3]. wildcard `*`는 field에 명시적으로 나열되지 않은 모든 가용 content coding에 매칭된다 [RFC 9110 §12.5.3]. wildcard가 없으면 field에 명시되지 않은 값은 unacceptable로 간주된다(identity의 기본 수용은 별도 규칙) [RFC 9110 §12.4.3]. 같은 목적의 다수 content coding 중에서는 non-zero qvalue가 가장 높은 acceptable coding이 선호된다 [RFC 9110 §12.5.3]. [SHOULD] non-empty `Accept-Encoding`이 있고 가용 표현 중 acceptable로 나열된 content coding이 없으면, identity coding이 unacceptable로 표시되지 않은 한 content coding 없는 응답을 보낸다 [RFC 9110 §12.5.3]. identity가 unacceptable이고 acceptable한 content coding의 표현도 만들 수 없는 상황은 406 (Not Acceptable)의 정의에 대응한다(406 생성 자체를 명하는 규범 문장은 없다) [RFC 9110 §15.5.7·§12.1].
- **§1.2** qvalue는 0~1 범위이며 문법은 `( "0" [ "." 0*3DIGIT ] ) / ( "1" [ "." 0*3("0") ] )`이다 [RFC 9110 §12.4.2]. `q` 파라미터 이름은 case-insensitive하게 인식한다 [RFC 9110 §12.4.2]. `q` 파라미터가 없으면 기본 weight는 1이다 [RFC 9110 §12.4.2].
- **§1.3** [SHOULD] `x-gzip`을 `gzip`과 동등하게 취급한다 [RFC 9110 §8.4.1.3]. [SHOULD] `x-compress`를 `compress`와 동등하게 취급한다 [RFC 9110 §8.4.1.1].
- **§1.4** content coding 이름은 case-insensitive하다 [RFC 9110 §8.4.1].
- **§1.5** [MUST] `Accept-Encoding` field value의 list(#)를 파싱할 때 합리적 개수의 빈 list 요소를 파싱하고 무시한다(예: `gzip,,br` — sender의 값 병합 실수를 수용하되 DoS 수단이 되지 않을 만큼) — 원 조문 수신 주체는 recipient이며, 이 field value의 파서는 이 미들웨어다 [RFC 9110 §5.6.1.2].

## 2. 인코딩 적용 (Content-Encoding 생성)

- **§2.1** [MUST] 인코딩을 적용한 sender는 적용한 순서대로 content coding을 나열한 `Content-Encoding` 헤더 필드를 생성한다 [RFC 9110 §8.4]. [SHOULD NOT] `identity`를 `Content-Encoding`에 포함하지 않는다(Accept-Encoding에서의 특수 역할 전용으로 예약) [RFC 9110 §8.4]. 생성하는 content coding 이름은 IANA HTTP Content Coding Registry의 등록 이름을 사용한다(원문 "ought to be registered" — BCP14 키워드 아님) [RFC 9110 §8.4.1·§16.6.1; IANA]. `Content-Encoding`은 representation의 특성이며, 적용 후의 모든 representation metadata는 별도 명시가 없는 한 coded form 기준이다 [RFC 9110 §8.4].
- **§2.2** `Content-Length`는 동봉된 데이터의 octet 수를 가리키므로, 인코딩 적용 후 비인코딩 기준의 기존 값은 무효이며 유지하지 않는다 [RFC 9110 §8.6]. [SHOULD] `Transfer-Encoding`이 없고 인코딩된 content의 크기를 완전한 header section 송신 전에 알 수 있으면 `Content-Length`를 생성한다 [RFC 9110 §8.6]. 인코딩 적용 전 데이터 기준으로 생성된 integrity 필드(RFC 9530의 총칭 "Integrity fields" — `Content-Digest`는 content, `Repr-Digest`는 representation 스코프)도 같은 이유로 coded form과 불일치하여 무효이며 유지하지 않는다(거짓이 된 값을 남기면 RFC 9530 §2·§3의 정의와 모순) [RFC 9530 §1.2·§2·§3].
## 3. 적용 제외 (압축해서는 안 되는 응답)

- **§3.1** 1xx·204·304 응답은 content를 포함하지 않으므로 coding을 적용할 content가 없다 [RFC 9110 §6.4.1]. 205 응답은 content 생성이 금지되므로(원 조문 MUST NOT의 대상은 본문 생성자) 적용할 content가 없다 [RFC 9110 §15.3.6]. HEAD 응답은 content를 보내지 않으므로(원 조문 MUST NOT) 적용할 content가 없다 [RFC 9110 §9.3.2]. [MAY] HEAD 응답에서 content 생성 시점에만 정해지는 필드는 생략할 수 있다(원문 예시는 `Content-Length`·`Vary`; `Content-Encoding`은 같은 성질의 파생 적용) [RFC 9110 §9.3.2].
- **§3.2** byte range는 representation data에 content coding이 적용된 경우 인코딩된 바이트 시퀀스 기준으로 계산되며, 디코딩 후 바이트 기준이 아니다 [RFC 9110 §14.1.2]. [MUST] 비인코딩 표현 기준으로 `Content-Range`가 이미 계산된 206 응답의 content에 사후 content coding을 적용하지 않는다(적용하면 `Content-Range`가 동봉된 range를 서술한다는 요건이 깨진다) [RFC 9110 §15.3.7.1·§14.1.2].
- **§3.3** `no-transform` 응답 지시어가 있는 content는 변환하지 않는다(원 조문의 MUST NOT은 intermediary 대상이며, origin 내부 미들웨어는 파생 요건으로 수용) [RFC 9111 §5.2.2.6; RFC 9110 §7.7].

## 4. 캐시 · 검증자 상호작용

- **§4.1** [SHOULD] selecting header field(`Accept-Encoding`)에 따라 선택적으로 재사용될 cacheable 응답에는 `Vary`를 생성한다 [RFC 9110 §12.5.5]. 기존 `Vary`가 `*`이면 variance가 무제한이므로 `Accept-Encoding` 추가는 불필요하다 [RFC 9110 §12.5.5·§12.4.3]. [SHOULD] `Accept-Encoding`으로 협상되는 리소스는 압축을 적용하지 않은(identity) 응답에도 `Vary: Accept-Encoding`을 생성한다 — 그러지 않으면 shared cache가 이 응답을 `Accept-Encoding`과 무관하게 재사용하여 표현 선택이 깨진다 [RFC 9110 §12.5.5; RFC 9111 §4.1].
- **§4.2** content coding이 적용된 표현과 미적용 표현이 같은 validator를 공유하면 그 validator는 weak이다 [RFC 9110 §8.8.1]. [MUST] strong validator의 특성을 만족하지 못하는 entity tag는 opaque 값 앞에 `W/`(case-sensitive)를 붙여 weak으로 표기한다 — 압축 적용 후 비인코딩 표현과 공유되는 tag가 이에 해당한다 [RFC 9110 §8.8.3·§8.8.1]. content coding이 적용된 표현의 strong entity tag는 캐시 갱신·range 요청 충돌 방지를 위해 비인코딩 표현의 entity tag와 구별되어야 한다(예시 섹션의 Note, BCP14 키워드 없음) [RFC 9110 §8.8.3.3].

## 5. 코딩 포맷 (바이트 규격)

- **§5.1** `gzip` coding은 32-bit CRC를 가진 LZ77 coding으로, RFC 1952의 gzip 파일 포맷이다 [RFC 9110 §8.4.1.3; RFC 1952]. gzip compressor는 올바른 ID1·ID2·CM(deflate이므로 8)·CRC32·ISIZE를 생성한다(그 외 고정 헤더 필드는 기본값 허용) [RFC 1952 §2.3.1·§2.3.1.2]. gzip compressor는 모든 reserved bit(FLG의 bit 5–7)를 0으로 둔다 [RFC 1952 §2.3.1·§2.3.1.2].
- **§5.2** `deflate` coding은 RFC 1950 "zlib" 포맷 안에 RFC 1951 deflate 압축 스트림을 담은 것이며, zlib wrapper 없는 raw deflate로 생성하지 않는다 [RFC 9110 §8.4.1.2; RFC 1950; RFC 1951]. HTTP `deflate`는 preset dictionary를 정의하지 않으므로 compressor는 FDICT flag를 설정하지 않으며, 올바른 CMF·FLG(FCHECK를 포함해 CMF·FLG를 16-bit로 본 값이 31의 배수)·ADLER32를 생성한다 [RFC 1950 §2.2·§2.3; RFC 9110 §8.4.1.2].
- **§5.3** `br` coding은 RFC 7932 Brotli Compressed Data Format이다 [IANA; RFC 7932]. br compressor는 RFC 7932 명세에 부합하는 데이터를 생성한다 [RFC 7932 §1.4]. meta-block header의 reserved bit는 0으로 생성하며, 스트림이 byte 경계에서 끝나지 않으면 마지막 byte의 미사용 bit들은 0으로 채운다(원문 소문자 must) [RFC 7932 §9.2·§9.3].
- **§5.4** `zstd` coding은 RFC 8878 Zstandard 포맷이며 HTTP에서는 RFC 9659의 window 제한을 받는다 [IANA; RFC 8878; RFC 9659]. [MUST NOT] `zstd` content coding 사용 시 8 MB를 초과하는 Window_Size를 요구하는 프레임을 생성하지 않는다 [RFC 9659 §3]. zstd frame header의 Unused bit·Reserved bit는 0으로 생성한다(원문 소문자 must — "An encoder compliant with this specification must set this bit to zero"·"Its value must be zero") [RFC 8878 §3.1.1.1.1.3·§3.1.1.1.1.4].

## 6. 포맷 확장 필드 (패딩 적용 시의 출력 유효성)

- **§6.1** gzip extra field는 FLG.FEXTRA 설정 시 존재하며 총길이 XLEN octet이고, 각 서브필드는 SI1·SI2·LEN(2B, LE — multi-byte 수는 least-significant byte 우선)·데이터로 구성된다 [RFC 1952 §2.1·§2.3.1·§2.3.1.1]. XLEN·LEN은 16-bit 필드이므로 extra field 총량은 65535 octet을 초과할 수 없다(XLEN의 2-byte 폭은 §2.3 member format 다이어그램) [RFC 1952 §2.1·§2.3·§2.3.1.1]. SI2=0인 서브필드 ID는 예약이므로 주입하는 서브필드의 ID로 선택하지 않는다(예약 사실의 파생) [RFC 1952 §2.3.1.1].
- **§6.2** zstd Skippable Frame은 Magic_Number(0x184D2A50~0x184D2A5F, LE 4B)·Frame_Size(LE 4B, User_Data 길이)·User_Data로 구성된다 [RFC 8878 §3.1.2]. zstd 압축 데이터는 하나 이상의 프레임 연결로 구성될 수 있고 skippable frame은 준수 디코더가 건너뛰는 프레임이므로, skippable frame을 삽입해도 출력은 유효한 zstd 스트림으로 남는다 [RFC 8878 §3.1·§3.1.2].
