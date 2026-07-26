# @zipbul/cookie — STANDARDS 작성 핸드오프

이 문서는 이번 작업 트랙(브랜치 `worktree-cookie`)에서 **무엇을 왜 만들었고, 무엇이 검증됐고, 무엇이 아직 확정 불가인지**를 다음 담당자가 이어받을 수 있게 산문으로 남긴 인수인계서다. 구현 지시서가 아니다 — 코드와 규칙은 직접 읽어라. 패키지 내부의 구현 결정 핸드오프는 별도 문서(`packages/middlewares/cookie/VERIFICATION-HANDOFF.md`)에 있고, 이 문서는 **그 위에 이번에 추가된 `STANDARDS.md`(규칙 정본)** 를 대상으로 한다.

작업 디렉터리: 이 워크트리 루트. 대상 산출물: `packages/middlewares/cookie/STANDARDS.md`(신규, 107줄). 그 외 소스는 이번 트랙에서 손대지 않았다(`git status`상 STANDARDS.md만 untracked).

---

## 0. 한 줄 요약

`@zipbul/cookie` 패키지는 이미 구현·테스트가 완료된 상태였고, 없던 것은 **규칙 정본(STANDARDS.md)** 하나였다. 이번 트랙은 그 파일을 RFC 6265bis-22 원문에서 규칙 단위로 추출해 작성하고, 3엔진(페이블·codex·grok) 적대리뷰로 다듬었다. **최대 정직한 주장치는 "알려진 결함 0, 깔끔함"이며 "완벽"이 아니다**(6절).

---

## 1. STANDARDS.md — 무엇을 담았나

`packages/middlewares/cookie/STANDARDS.md`는 이 저장소의 다른 미들웨어 STANDARDS(cors·helmet·compression·conditional-request)와 **동일한 규칙 문법**을 따른다:

```
- **§N.M** [수준] 단일 규범 문장 — 근거(원문 영어 인용) [출처 §]
```

- **수준 6종**: `MUST` / `MUST NOT` / `SHOULD` / `SHOULD NOT` / `MAY` / `무표기`.
- **주체 프레이밍**: 이 문서의 주체는 6265bis-22 §3.2.1의 **cookie producing implementation(서버·프레임워크)** 이다. 1차 규범은 §4(Server Requirements)이고, §5(User Agent Requirements)의 UA 알고리즘은 **"방출한 쿠키가 실제로 저장·반송되게 하기 위한 파생 의무"** 로만 미러링한다. UA 하드 실패(`abort ... ignore the cookie entirely`)에서 파생된 MUST는 본문에 **UA-파생**으로, RFC 9110 §5.5 recipient MUST에서 파생된 것은 **수신자-파생**으로 표기한다.
- **수준 규약의 핵심 결정**: 서버(방출자) 대상 BCP14 키워드만 수준 태그를 받고, **UA를 수신 주체로 하는 BCP14 키워드는 무표기**로 둔다(codex 라운드 6 지적 반영). 그래서 §3.5(UA MUST 수명 캡)·§7.4(UA SHOULD 용량)는 무표기다.

섹션 구성(11장):
1. Set-Cookie 생성 문법(§4.1.1 ABNF)
2. 속성 생성(Expires·Max-Age·Domain·Path·SameSite·Secure·HttpOnly)
3. UA 수용 규칙의 미러(4096·CTL·SameSite=None⇒Secure·Secure 채널·수명 캡·1024·cookie-fixing·교체)
4. Cookie name prefix(`__Secure-`·`__Host-`·case-insensitive)
5. 인바운드 Cookie 헤더(복수 헤더 허용·순서 비의존·속성 비반환)
6. 전송 계층 결합(RFC 9110 §5.3 Set-Cookie 예외·§5.5 CR/LF/NUL)
7. 한도·강건성(§6.1·§4.2.1 8192·용량·graceful degrade)
8. 보안·프라이버시(§7·§8의 서버 SHOULD들)
9. 확장 속성(Partitioned=CHIPS·Priority — 6265bis 밖)
10. 코덱 확장(HKDF·AES-GCM·HMAC·base64url — 서명/암호화)
11. 범위 밖(UA 소관 명시)

---

## 2. 표준 baseline 결정 (다음 담당자가 반드시 알 것)

- **스펙 핀 = draft-ietf-httpbis-rfc6265bis-22 (2025-12-01)**. 이건 **아직 RFC가 아니다** — IESG 승인 후 RFC Ed Queue 상태다. 발행 시 RFC 6265(2011, 현재까지 obsolete 안 됨)를 대체한다. 따라서 "확정 표준 완전 준수"는 원리적으로 확정 불가(6절).
- **후속 리스크**: `draft-ietf-httpbis-layered-cookies`(httpbis WG, -02 2026-05-21)가 6265와 6265bis를 **통째로 재구성·대체**할 예정이다. 재대조 시 이 draft의 진행을 먼저 확인하라. 스냅샷·대조 기준일을 STANDARDS 서두에 박아둔 이유가 이것이다.
- **확장 속성 분류**: `Partitioned`·`Priority`는 bis-22 전문에 **단어 자체가 없다**(문법상 `extension-av`). Partitioned의 정본은 CHIPS(draft-cutler-httpbis-partitioned-cookies, **2022 만료 개인 draft** — Secure 요구는 "추가될 수 있다"는 제안 문면), Priority는 draft-west-cookie-priority-00(2016 만료)의 Chromium 관행. STANDARDS에서 이들을 6265bis 규범인 것처럼 쓰면 안 된다 — §9에 확장으로 격리했다.
- **`__Http-` prefix는 없다**: bis-22 전문에 부재. 과거 changeset에 언급이 남아 있으나 현재 코드·표준 모두에 없다(4절 오탐 주의).

---

## 3. 코드와의 정합 (STANDARDS ↔ 구현)

STANDARDS의 규칙은 현재 구현(`src/`)과 정합한다. 특히 논쟁이 됐던 지점:
- **`%`를 cookie-name에서 제외**: `%`는 RFC 9110 tchar에 포함되므로 STANDARDS §1.2는 "token 관점에서 유효"로 무표기 서술한다. 반면 구현은 Bun.CookieMap이 인바운드 name을 percent-decode하는 런타임 특성 때문에 `%`를 **의도적으로 더 엄격히** 배제한다(라운드트립 안전). 이건 표준 위반이 아니라 stricter-than-spec이며, 그 근거는 패키지 `VERIFICATION-HANDOFF.md` §4에 있다. **STANDARDS는 표준을, VERIFICATION-HANDOFF는 구현 편차를 담는다 — 둘을 섞지 마라.**
- **Max-Age 삭제**: STANDARDS §2.2는 `non-zero-digit` 문법상 0·음수 도출 불가, 삭제는 과거 Expires로 표현. 구현의 `delete()`가 `Max-Age=0` 대신 `Expires=new Date(0)`을 쓰는 것과 일치.
- **Expires 재출력**: §2.1은 IMF-fixdate 생성 MUST. 구현이 `toUTCString()`으로 재출력해 Bun의 비준수 `-0000` 출력을 우회하는 것과 일치.
- **크로스필드**: §3.3(None⇒Secure)·§9.2(Partitioned⇒Secure)·§4.2/§4.3(prefix)는 구현의 `checkCrossField`/`validatePrefix`와 일치.

---

## 4. ⚠️ 오탐 주의 — 근거로 쓰면 안 되는 소스

- **`.changeset/cookie-rfc-conformance-and-hardening.md`**: 누적 릴리스 히스토리라서 **이후 제거된 기능을 현행처럼 기술**한다. 실측으로 부재 확인된 것: 400일 상한(현재 상한은 ECMAScript Date 범위뿐), `__Http-`/`__Host-Http-` prefix, publicSuffixCheck·단일 라벨 도메인 거부(현재 `localhost` 허용), `onEncrypt` 훅·GCM 카운터, 시크릿 ≥32자·엔트로피 검증(현재 non-blank만). **이 체인지셋을 STANDARDS 근거로 인용하지 마라.**
- **삭제된 `STANDARDS-AUDIT.md`**: `git show 5e0ef7dc:STANDARDS-AUDIT.md`로 복원 가능한 과거 감사 문서. bis-22 ABNF 3중 대조·server-vs-UA 분류표가 있어 참고 가치가 높으나 정본은 아니다. 지적된 결함(D1 Max-Age 등)은 이미 코드에 반영됨.

---

## 5. 적대리뷰 이력 (정직하게)

3엔진(페이블=이 세션 직접, codex=codex-companion, grok=grok CLI) 적대리뷰를 라운드 반복했다. 리뷰 기준은 QUOTE(문자 단위 원문 일치)·CITATION·LEVEL·COVERAGE·CORRECTNESS. 각 라운드는 STANDARDS.md + 로컬 원문 발췌 번들(bis-22 txt·RFC 9110·5869·4648·CHIPS·NIST SP 800-38D PDF 추출)만으로 self-contained하게 돌렸다.

| 라운드 | codex | grok | 페이블 |
|---|---|---|---|
| R1 | 18 | 12 | 6 + 커버리지(§7·§8 서버 SHOULD 9규칙 추가) |
| R2 | **PASS** | 8 | 4 |
| R3 | **PASS** | 7(유효 2) | — |
| R4 | (텍스트 교체로 폐기) | 5(유효 3) | 2 |
| R5 | 1 | 5 | **인용 71개 기계 대조 0-fail** + 1 |
| R6 | 1(수준 규약 명료화) | 5(정밀화) | — |
| R7 | **PASS**(구버전) | 2(§2.7 자기모순·§3.5 범위) | — |
| R8 | **PASS**(현행 텍스트) | 인프라 실패(아래) | — |

- **반영 원칙**: 모든 지적을 원문 재대조로 판정 후 반영/기각. 기각한 대표 예: grok이 반복 제기한 "`Max-Age=0`도 extension-av로 문법 통과" 논증 — 명명 속성은 이름 기준으로 구속받는다는 독해로 기각(단, 이 방어 논리를 문서 본문에 넣었다가 "규칙 정본에 메타 서술" 지적을 받아 **순수 규칙본으로 재작성**하며 제거함).
- **오실레이션 1건**: §2.7의 Lax-allowing-unsafe 처리가 R5(grok 요청으로 추가)→R7(자기모순으로 철회)로 오갔다. 최종 확정은 **§5.6.7.2 원문 기준**: LAU는 "명시적 SameSite 속성이 없는 쿠키"에만 적용되므로 미지 값 쿠키는 대상이 아니다. 리뷰어 말을 원문 재확인 없이 반영한 판단 착오였고, 메모리에 교훈으로 기록함.
- **인용 충실도**: R1 codex 18건 중 9건이 초안의 큰따옴표→작은따옴표 치환·`...` 접합 등 표기 부주의였다. R5에서 **문서의 영어 인용 전수(71개)를 스크립트로 공백 정규화·하이픈 재결합 후 로컬 원문과 문자 대조 → 0-fail** 확인. 이후 편집마다 재검증했다.

**grok 라운드 8 상태(중요·미확정)**: grok CLI가 R8에서 `max_tokens_truncation` 인프라 오류로 **5회 연속 판정 미완**했다(R3·R6도 같은 플레이크가 있었고 재시도로 통과했었다). R8 재시도 산출물은 임시 scratchpad 정리로 **유실**되어 회수 불가하다. 따라서 **grok의 마지막 유효 완료 판정은 R7(2건, 둘 다 반영)** 이고, 그 2건 반영 후의 현행 텍스트에 대한 grok 독립 통과는 **아직 확보하지 못했다.** codex는 현행 텍스트를 R8에서 PASS 했다. → **다음 담당자 할 일: 현행 STANDARDS.md에 grok 클린 라운드 1회를 다시 돌려 codex-PASS와 짝을 맞춰라.**

---

## 6. "완벽"이라 단정할 수 없는 것 (검증자에게)

- **결함 부재는 원리적으로 증명 불가.** 최대 주장치는 "알려진 결함 0". "완벽 보증" 표현을 쓰지 마라.
- **bis-22는 draft다.** draft 준수는 확정 표준 준수가 아니다(2절).
- **grok R7↔현행 텍스트 간 독립 통과 미확보**(5절). codex는 통과.
- **NIST SP 800-38D 인용**은 공개 PDF의 압축 스트림을 풀어 §5.2.1.1·§8.3 문장을 직접 대조했다(이 세션에서 1차 검증). 그 외 bis-22·RFC 9110/5869/4648·CHIPS는 로컬 txt 원문 직접 대조.
- **인용 71개 0-fail은 재현 가능**하나, 재현하려면 원문 소스를 다시 받아야 한다(scratchpad 유실). 재현 절차는 7절.

---

## 7. 재현 절차 (다음 담당자용)

원문 소스 재취득:
```
curl -sfL https://www.ietf.org/archive/id/draft-ietf-httpbis-rfc6265bis-22.txt -o bis22.txt
curl -sfL https://www.rfc-editor.org/rfc/rfc9110.txt -o rfc9110.txt
curl -sfL https://www.rfc-editor.org/rfc/rfc5869.txt -o rfc5869.txt
curl -sfL https://www.rfc-editor.org/rfc/rfc4648.txt -o rfc4648.txt
curl -sfL https://explainers-by-googlers.github.io/CHIPS-spec/draft-cutler-httpbis-partitioned-cookies.txt -o chips.txt
# NIST SP 800-38D: PDF 스트림을 zlib decompress 후 (Tj) 문자열 추출해 대조
```

인용 전수 대조(요지): STANDARDS.md에서 `\*"(.+?)"\*` 정규식으로 영어 인용을 뽑아, 각 소스를 공백 정규화(`\s+`→` `)·줄바꿈 하이픈 재결합·인용 거터(`^\s*\|`) 제거한 뒤 부분 문자열 포함 여부로 대조한다. 최종 확인 시 71개 0-fail이었다.

패키지 자체 검증(패키지 디렉터리에서):
```
bunx tsc --noEmit -p tsconfig.json      # 타입체크
bun test                                # 유닛/통합/e2e/conformance/security/fuzz
bun test --coverage                     # 커버리지
```
(테스트/커버리지 수치는 이번 트랙에서 재확인하지 않았다 — 패키지 `VERIFICATION-HANDOFF.md` §7의 기록과 위 명령으로 대조하라.)

적대리뷰 재실행:
```
grok -p "$(cat <review-prompt>)" --disable-web-search --output-format plain
# review-prompt = 리뷰 지침 + STANDARDS.md + 원문 발췌 번들 (self-contained)
# grok이 max_tokens_truncation으로 실패하면 그대로 재시도 (내용 문제 아님, 인프라 플레이크)
```
codex 리뷰는 codex-companion(`codex:rescue`)로 동일 지침·파일 경로를 전달.

---

## 8. 다음 담당자 체크리스트

1. **grok 클린 라운드 1회** — 현행 STANDARDS.md + 재취득한 원문 번들로. codex R8 PASS와 짝 맞추기(5·6절).
2. bis-22 → **layered-cookies** 진행 확인. RFC 발행/재구성 시 스냅샷·대조 기준일 갱신(2절).
3. STANDARDS와 코드가 계속 정합하는지 — 특히 §2.1 Expires 재출력, §2.2 Max-Age, §4.3 `__Host-` Path=/, §3.3/§9.2 크로스필드(3절).
4. changeset을 근거로 STANDARDS를 수정하지 말 것(4절 오탐 목록).
5. 결과 보고에 6절 한계를 반영 — "완벽" 금지, "알려진 결함 0"까지만.

## 부록: 정본/참고 문서 지도

- **정본**: `packages/middlewares/cookie/STANDARDS.md`(표준 규칙), `CLAUDE.md`(정의 1문장), `VERIFICATION-HANDOFF.md`(구현 결정·Bun 편차·에러 모델).
- **참고**: `README.md`(사용법·공개 API), `.changeset/cookie-*.md`(릴리스 히스토리 — 오탐 주의), `git show 5e0ef7dc:STANDARDS-AUDIT.md`(과거 감사, 정본 아님).
