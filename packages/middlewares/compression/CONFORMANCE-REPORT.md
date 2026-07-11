# 업계 compression 미들웨어 × STANDARDS.md 준수 감사 보고서

**감사일 2026-07-10.** 업계 대표 응답 압축 미들웨어 8종의 **실제 소스**(GitHub raw, 버전·커밋 고정)를 받아 `STANDARDS.md`(2026-07-10 확정판, §1–§6)의 규칙별로 준수/부분/위반/미해당을 판정했다. 판정마다 코드 근거(파일:라인 또는 스니펫)를 확보했고, 각 미들웨어가 우리 규칙 밖에 갖는 규칙·기능도 조사했다. 감사 주체: 미들웨어당 독립 에이전트 1개(병렬 8).

## 1. 종합 준수율

| 순위 | 미들웨어 | 버전 | 생태계 | 적용 | 준수/부분/위반 | 완전준수율 |
|---|---|---|---|---|---|---|
| 1 | **koa-compress** | 5.2.2 | Node/Koa | 30 | 26 / 3 / 3 | **86.7%** |
| 2 | **Caddy encode** | v2.10+ master | Go 서버 | 25 | 19 / 2 / 4 | 76.0% |
| 3 | **tower-http** | main(0.7.0-dev) | Rust/axum | 29 | 22 / 3 / 4 | 75.9% |
| 4 | **express compression** | 1.8.1 | Node/Express | 31 | 23 / 2 / 6 | 74.2% |
| 5 | **gzhttp** | 1.19.0 | Go(klauspost) | 15 | 11 / 1 / 3 | 73.3% |
| 6 | **@fastify/compress** | 9.0.0 | Node/Fastify | 19그룹 | 11 / 4 / 4 | 57.9% |
| 7 | **hono compress** | 4.12.29 | Edge/Bun/Workers | 14 | 8 / 3 / 3 | 57.1% |
| 8 | **Starlette GZip** | 1.3.1 | Python/ASGI | 13 | 3 / 4 / 6 | 23.1% |

- 적용 수가 다른 이유: 지원 코딩 폭(§5)·패딩 기능(§6) 유무로 미해당(N-A)이 갈린다. tower-http는 미출시 main 기준(출시 0.6.x는 Vary 미생성 등 더 낮음).
- **어떤 미들웨어도 STANDARDS.md를 100% 준수하지 않는다.**

## 2. 규칙별 업계 위반 매트릭스 (✖=위반, △=부분, ✔=준수, ―=N-A)

| 규칙 | koa | Caddy | tower | express | gzhttp | fastify | hono | starlette |
|---|---|---|---|---|---|---|---|---|
| §1.1 wildcard `*` 의미 | △¹ | ✖² | ✔ | ✔ | ✔ | ✖³ | ✔ | ✖ |
| §1.1 q=0 배제 | ✔ | ✔ | ✔ | ✔ | ✔ | ✖³ | ✔ | ✖ |
| §1.2 `q` 이름 case-insens | △ | ✔ | ✔ | ✖ | ✔ | ✔ | △ | ✖ |
| §1.3 x-gzip 별칭 [SHOULD] | ✖ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ | △ |
| §1.5 빈 list 요소 [MUST] | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| §2.1 CE 생성·identity 금지 | ✔ | ✔ | ✔ | ✔ | ✔ | ✖⁴ | ✔ | ✔ |
| §2.2 CL 무효화 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| §2.2 integrity 필드 제거 | ✖ | ✖ | ✖ | ✖ | △ | ✖ | △ | △ |
| §3.1 무본문 status/HEAD | ✔ | ✔ | △ | △ | ✔ | △ | ✔ | △ |
| §3.2 206 사후 인코딩 금지 [MUST] | ✔ | ✔ | ✔ | ✖ | ✔ | ✔ | ✖ | ✖ |
| §3.3 no-transform | ✔ | ✔ | ✖ | ✔ | ✖ | ✖ | ✔ | ✖ |
| §4.1 Vary(압축 응답) [SHOULD] | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✖ | ✔ |
| §4.1 Vary(identity 응답) [SHOULD] | ✔ | ✖ | ✖ | ✔ | ✔ | ✖ | ✖ | △ |
| §4.2 ETag weak/구별 [MUST] | ✖ | ✔⁵ | ✖ | ✖ | ✖⁶ | ✖ | ✔ | ✖ |
| §5.2 deflate=zlib-wrapped | ✔ | ― | ✔ | ✔ | ― | ✔ | ✔ | ― |
| §5.4 zstd 8MB window [MUST NOT] | △⁷ | ✔(128KB) | ✔(2²³) | ― | ✔(128KB) | △⁷ | ― | ― |
| §6.2 zstd skippable frame | ― | ― | ― | ― | ✔ | ― | ― | ― |

¹ `*`를 설정값(기본 gzip)으로 축약 ² `*`를 리터럴로 취급 → **`Accept-Encoding: *`에 압축 자체가 안 됨** ³ `/\*|x-gzip/gu`→`gzip` 치환으로 wildcard·q=0 의미 동시 파괴(`gzip;q=0, *`가 gzip 송신) ⁴ inflateIfDeflated 분기에서 `Content-Encoding: identity` 방출 ⁵ 약화 대신 `-<enc>` 접미 distinct strong tag + If-None-Match 왕복 재작성 ⁶ opt-in `SuffixETag`/`DropETag`로만 해소 ⁷ windowLog 클램프 없음(기본 레벨만 우연히 안전)

## 3. 업계 공통 결함 (우리 STANDARDS가 앞서 있는 지점)

1. **§4.2 ETag [MUST] — 8종 중 6종이 기본값에서 위반.** 압축 후 strong ETag를 약화(`W/`)도 구별도 하지 않는 것이 업계 기본값이다(Apache mod_deflate 시절부터의 고전 결함). 제대로 하는 것은 hono(W/ 약화)와 Caddy(distinct 접미 + 조건부 요청 왕복 처리)뿐.
2. **§2.2 integrity 필드(RFC 9530) — 8종 전원 미처리.** `Content-Digest`/`Repr-Digest`를 무효화하는 구현이 하나도 없다. RFC 9530(2024)이 대부분 구현보다 후행인 탓 — 우리 규칙이 업계 전체보다 앞서 있는 유일 항목.
3. **§1.3 x-gzip 별칭 [SHOULD] — 5/8 위반.** 레거시 별칭은 사실상 사어 취급.
4. **§3.3 no-transform — 4/8 위반.** Rust·Go 고성능 계열(tower·gzhttp)이 오히려 무시하는 경향.
5. **§4.1 identity 응답 Vary [SHOULD] — 4/8 위반.** "압축할 때만 Vary"가 흔한 오구현 — 협상 리소스의 무압축 응답이 캐시 오염 벡터가 된다(우리 §4.1 identity-branch가 정확히 이걸 막는다).
6. **wildcard `*` 처리 — 4/8 결함.** Caddy(무압축)·fastify(gzip 치환)·koa(설정 축약)·starlette(미매칭). 풀 qvalue 협상기를 가진 tower·express·gzhttp만 정확.

**전원 준수 항목**: §1.5 빈 list 요소, §2.2 CL 무효화, §5.1/§5.2 바이트 포맷(전부 검증된 라이브러리 위임 — zlib/klauspost/async-compression).

## 4. 감사 중 발견한 실제 버그 (STANDARDS 밖 덤)

- **koa-compress**: `Accept-Encoding: identity;q=0` → negotiator가 `undefined` 반환 → `TypeError: compress is not a function` → **500 크래시**.
- **@fastify/compress**: 이미 deflate인 payload를 재압축 없이 통과시키면서 협상된 `Content-Encoding: gzip` 라벨을 유지 → **바이트와 라벨 불일치** 가능.
- **express**: 명시적 status 가드 부재로, compressible Content-Type + threshold 초과 CL을 가진 304/205에 빈 gzip framing 방출 가능.

## 5. 우리 규칙 밖의 규칙·기능 (EXTRA — 8종 조사 결과)

**보편 기능 (전원 또는 대다수 보유; 우리 문서는 §8 삭제 전 "정책"으로 분류했던 것들):**
- 크기 임계치(threshold/minimum: 1024B×4종, 512B, 500B, 32B), Content-Type 필터(compressible/mime-db·Cloudflare allowlist·정규식), 인코딩별 압축 레벨 옵션(brotli는 업계 공통으로 기본 quality 4 — zlib 기본 11 회피), 서버 선호 순서/tie-break(Caddy `zstd>br>gzip`, koa `zstd>br>gzip>deflate`, fastify는 zstd 가용 시 최우선).

**차별화 기능 (특정 구현만):**
| 기능 | 보유 | 내용 |
|---|---|---|
| 요청 측 압축해제 | fastify, gzhttp, tower(별도 레이어) | fastify: 미지원 인코딩→**415**, 손상→400, 훅 2종. gzhttp: RFC 7694 opt-in. (우리 아키텍처에선 어댑터 소관 — body/parser.ts의 415와 대응) |
| 406 강제 | tower(기본), fastify(훅 opt-in) | 수용 코딩 없으면 상태를 406으로 재작성. 우리 §1.1은 "406 강제 규범 없음"만 명시 — 정책 여지 |
| `Accept-Ranges` 제거 | tower, gzhttp, Caddy | 압축 시 range 오프셋 무효를 신호. §3.2(206 금지)의 보완 관행 — **우리 문서에 없는 관행이나 정본 규범도 아님** |
| ETag 접미 구별+왕복 | Caddy | `-<enc>` 접미 후 인바운드 If-None-Match에서 역제거 — §4.2 distinctness 경로의 유일한 완전 구현 |
| BREACH 패딩 | gzhttp | gzip은 **FCOMMENT**(우리 §6.1은 FEXTRA — 메커니즘 상이하나 양쪽 다 포맷 유효), zstd는 **skippable frame(우리 §6.2와 정확히 동일 메커니즘)**. 패딩 길이는 난수가 아닌 콘텐츠 체크섬 파생(결정적 지터, CRC32-C/SHA-256) |
| 이미 압축된 payload 해제 | fastify(inflateIfDeflated, maxRecursion=3 zip-bomb 완충) | 우리 범위 밖(응답 재정규화) |
| SSE/스트리밍 제외 | hono·starlette·tower(`text/event-stream`), Caddy(WebSocket/1xx/CONNECT 가드) | 실시간 스트림 버퍼링 방지 |
| Content-Type 스니핑 | Caddy, gzhttp | CT 부재 시 `DetectContentType`으로 필터 판단 |
| 요청별 opt-out | fastify(`x-no-compression` 내장), koa(`ctx.compress` 오버라이드), express(filter 관례) | |
| zstd window 하드캡 | Caddy·gzhttp(128KB), tower(8MB=2²³) | RFC 9659보다 보수적 — 클라이언트 메모리 배려 |

## 6. zipbul compression에 주는 시사점

1. **우리 STANDARDS의 차별 우위 항목이 실증됐다**: ETag 약화(§4.2)·integrity 무효화(§2.2)·identity-Vary(§4.1)·206 가드(§3.2)를 전부 지키면 업계 1위(koa 86.7%)를 넘는 유일한 구현이 된다.
2. **wildcard·q=0 협상 정확성이 상위/하위를 가른다** — 풀 qvalue 파서 없는 구현(fastify·starlette·Caddy의 `*`)이 하드 오배포를 낸다. 우리 §1.1 전체 의미론 구현이 필수.
3. **검토 후보(정본 규범은 아니나 업계 관행)**: 압축 시 `Accept-Ranges` 제거(tower·gzhttp·Caddy 관행), 협상 실패 시 406 훅(tower·fastify), zstd window의 8MB보다 보수적인 캡. 채택 여부는 정책 결정.
4. **BREACH 패딩 설계 참고**: gzhttp의 결정적 지터(콘텐츠 체크섬 파생 길이)는 우리 CSPRNG 방식과 다른 트레이드오프(동일 콘텐츠=동일 길이 → 반복 관측 무력화). zstd skippable frame 메커니즘은 업계와 수렴 확인.

## 부록: 감사 방법·한계

- 소스는 전부 GitHub raw에서 직접 취득(버전·커밋 표기), 요약 도구 미사용. 판정 근거는 각 에이전트 보고서의 코드 인용에 있음.
- 한계: tower-http는 미출시 main 기준(출시판은 더 낮음). 적용 규칙 수가 구현별로 달라 %간 직접 비교는 참고치. 동적 실행 테스트가 아닌 정적 소스 감사(런타임 위임 계층 — zlib 등 — 은 위임 사실만 확인).
