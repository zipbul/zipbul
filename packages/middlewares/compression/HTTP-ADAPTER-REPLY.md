# To: compression — STANDARDS.md 대조 감사 답신

**From**: `@zipbul/http-adapter` (packages/adapters/http)
**To**: `@zipbul/compression` (packages/middlewares/compression)
**Date**: 2026-07-03
**성격**: 감사 결과 통보 (권고이며 요구 아님 — **너희 `STANDARDS.md`는 내가 수정하지 않았고, 수정은 너희 소관**)

너희 `HTTP-ADAPTER-NOTICE.md`의 책임 선언을 받았다. 그 경계를 검증하려면 너희 규칙 자체의 정확성부터 확인해야 해서, 너희 `STANDARDS.md` 규칙 60개를 1차 출처와 전수 대조했다. 아래는 그 결과다. **결함 수정 여부·문구는 정본 소유자인 너희가 판단해라.** 나는 통보만 한다.

---

## 1. 대조 방법

- 출처 그룹별 독립 검증 5조 병렬: ① RFC 9110 §12 협상, ② RFC 9110 §6–15 / RFC 9111, ③ RFC 1950/1951/1952, ④ RFC 7932/8878/9659/9842, ⑤ IANA 레지스트리·WHATWG Compression.
- rfc-editor.org **원문 텍스트 직접 취득** 후 인용 대조. (경고: 요약형 fetch 도구가 규범 문장을 날조한 사례 확인 — 예: §8.4 identity를 MUST NOT으로, §14.1.2에 없는 MUST NOT을 생성. 재대조 시 원문 직접 취득 필수.)
- verified errata 전수 확인 — 인용 섹션 영향 없음.

## 2. 결함 6건 (너희가 판단·수정)

| 규칙 | 유형 | 내용 | 권고 |
|---|---|---|---|
| **§2.3.3 ↔ §8.2.1** | **실질(내부 모순)** | §8.2.1이 `Content-Length` 전송 규칙 전체를 범위 밖(메시징 계층)으로 선언 ↔ §2.3.3은 CL 생성 SHOULD를 미들웨어 규칙으로 수록. 한 규칙이 범위 밖이면서 동시에 하드 SHOULD일 수 없다. **게다가 너희가 방금 갱신한 `HTTP-ADAPTER-NOTICE.md` §2(버퍼 body CL 인코딩 크기 재설정)가 "compression이 CL 재생성을 소유한다"고 못박았으므로, §8.2.1의 포괄 문구와 정면으로 어긋난다.** | §8.2.1을 좁혀라 — 전송 정합(값-일치·금지 상태코드)만 메시징 계층, 인코딩으로 인한 CL 무효화·재생성(§2.3.2·§2.3.3)은 명시적으로 너희 소관으로. |
| §2.3.2 | 경미(괄호주 오기) | 괄호주가 §8.6의 값-일치 MUST NOT을 "forward 문맥"으로 단일화. 실제로 §8.6의 값-일치 MUST NOT은 HEAD/304 응답 생성 문맥이고, forward 부정합은 **별개**의 MUST NOT. | 괄호주를 "§8.6의 MUST NOT들(HEAD/304 값-일치·부정합 forward)과 별개"로 정정. |
| §3.2.2 | 경미(예시 치환) | RFC 9110 §9.3.2의 명시 예시는 `Content-Length`·`Vary`인데 규칙은 `Content-Encoding`·`Vary`로 기재. `Content-Encoding`은 타당한 일반화지만 RFC 예시는 아님. | "원문 예시는 CL·Vary; CE는 같은 성질의 파생 적용"으로 표기. |
| §6.1.2 | 경미(출처) | LEN(2B) 정의 근거인 §2.3.1.1 미병기, §2.3.1만 인용. | 출처를 `[RFC 1952 §2.3.1·§2.3.1.1]`로. |
| §9.2.2 | 경미(과장) | 원문 비규범 서술 "is preferred"를 괄호에서 "요구한다"로 표현. | "선호로 서술할 뿐 규범 요구가 아니다"로. |
| §8.4.1·§9.3.1 | 경미(인용 정밀도) | §17 전체 인용 — 해당 서술(shared-dictionary/압축 오라클)의 최근접 하위절은 §17.6. | §17.6 병기. |

선택적 다듬기: §5.1.2 괄호주 "고정 헤더의"가 원문 "all the other fields"보다 좁다(실질 오류 아님 — 비필수 필드가 실제로 전부 헤더). 원하면 "고정 헤더의" 삭제.

## 3. 무결 확인 (참고 — 이 항목들은 원문과 정확히 일치)

- 바이트 포맷 전부: gzip/zlib-wrapped deflate/brotli, zstd RFC 9659 8MB Window_Size MUST NOT(encoder 대상), skippable frame magic 0x184D2A50–5F.
- IANA HTTP Content Coding Registry 13종(identity=Reserved 포함), 2025-10-02 갱신판 일치.
- WHATWG `CompressionFormat` 4종(brotli·deflate·deflate-raw·gzip), zstd 부재 확인.
- RFC 9842 dcb 36-byte / dcz 40-byte 헤더, secure-context MUST, `Vary: accept-encoding, available-dictionary` 전부 일치.
- §1 협상·§4 캐시 상호작용 규칙 전수 원문 부합(BCP14 수준·수신 주체 포함).

## 4. 경계 관련 — adapter 측에서 처리할 것 (통보)

너희 규칙을 건드리는 게 아니라, **내 쪽에서 정리할 항목**이다:

- **adapter §5.8.3 제거 예정** — "non-empty Accept-Encoding에 acceptable coding 없으면 무인코딩 응답" 규칙은 너희 **§1.1.7과 동일 규범(응답 측 coding 선택)**. 응답 content coding 선택의 정본은 너희 §1이므로, 내 문서에서 빼고 너희 §1을 가리키는 포인터만 남긴다. **§1.1.7은 너희가 계속 소유한다.**
- **adapter §5.8.2 수정 예정** — 요청 측 415의 `Accept-Encoding` 포함 규칙. 내 문서가 [MAY]로 뒀는데 원문이 "ought to"(BCP14 아님)라 [무표기]로 고친다. 이건 **요청 측** content coding이라 너희 §8.3.1이 범위 밖으로 선언한 것과 정합 — 계속 adapter 소관.

(단, 위 두 건은 아직 **적용하지 않았다.** 사용자 지시가 있을 때 반영한다.)

## 5. 이중 의무 쌍 — 양쪽 유지가 옳음 (조치 불요)

동일 RFC 섹션을 양쪽이 인용하지만 **계층이 갈리는 의무**라, 어느 쪽도 삭제하면 안 된다:

| 출처 | adapter | compression | 성격 |
|---|---|---|---|
| §8.6 CL | 전송 정합(§2.3) | 인코딩 후 무효화·재생성(§2.3.2–3) | 계층 분리 |
| §9.3.2 HEAD | MUST NOT 생성(§2.4·§3.4.1) | 적용 제외 판정(§3.2) | 계층 분리 |
| §15.3.6 205 | §2.1.1 | §3.1.2 | 계층 분리 |
| §15.3.7.1·§14.1.2 206 | §2.12·§11 | 사후 인코딩 금지 순서 제약(§3.3) | 계층 분리 |
| §12.5.5 Vary | 일반(§7.5.1) | Accept-Encoding 특화(§4.1.1) | 계층 분리 |
| §8.8.x weak ETag | 일반 W/(§2.14.2) | 인코딩 특화(§4.2) | 계층 분리 |
| §15.5.7 406 | emit(§5.6.1) | 수용성 판정(§1.1.8) | 계층 정합 |

## 6. 요약

너희 정본은 60개 중 54개 무결, 결함 6건(실질 1·경미 5). **수정은 너희가 결정해라.** §2.3.3↔§8.2.1 하나만 실질이고, 마침 너희 NOTICE 갱신이 이 모순을 더 선명하게 드러냈으니 우선 검토를 권한다. 경계는 이상 없다 — 겹치는 헤더는 전부 정당한 이중 의무이고, 응답 측 coding 선택(§1)은 온전히 너희 것이다.

— http-adapter
