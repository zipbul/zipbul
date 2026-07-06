# Compression Test Plan

**목적**: `STANDARDS.md`(규칙 60개)의 전 규칙을 테스트로 커버하고, 각 행위에 대해 HP(해피)·NE(네거티브)·ED(엣지)·EX(예외)·SE(사이드이펙트) 케이스를 빠짐없이 정의한다. TDD의 Red 목록이 곧 이 문서다.

**계층 정의**
- **유닛** (`src/*.spec.ts`) — 순수 함수·모듈 단위. mock은 서비스·상태만 (unit-test 스킬 규칙).
- **통합** (`test/integration/*.test.ts`) — mock AdapterContext로 미들웨어 핸들러 전 경로.
- **e2e** (`test/e2e/*.test.ts`) — `@zipbul/tck`로 실제 zipbul 앱 부팅, real pipeline + wire 검증. **e2e로만 검증 가능한 것**(serialize 선행 계약, wire 헤더 실측, 실클라이언트 해제, phase 공존)에 집중.

**표기**: 규칙 검증 케이스는 테스트 이름에 `[§x.y.z]` 태깅(외부 툴 grep 대상). 정책 케이스는 `[§9.x.x]` 또는 무태그.

**케이스 유형**: HP 해피 / NE 네거티브(거부·미적용) / ED 엣지(경계·이상 입력) / EX 예외(throw·자원 실패) / SE 사이드이펙트(불변성·결정성·상태 격리·순서).

---

## 1. 통합 테스트

### 1.1 `test/integration/negotiation.test.ts` — 협상 (§1)

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| NEG-01 | HP | `AE: gzip` → gzip 압축 적용 | §1.1.3 |
| NEG-02 | HP | `deflate;q=0.9, gzip;q=0.5` → 최고 non-zero q인 deflate 선택 | §1.1.6 |
| NEG-03 | HP | 서버 zstd 지원 + `AE: *` → wildcard 매칭으로 zstd | §1.1.5 |
| NEG-04 | HP | q 무지정 코딩의 기본 weight 1 (`gzip, br;q=0.5` → gzip) | §1.2.3 |
| NEG-05 | HP | `gzip;Q=0.7` 대문자 Q 인식 | §1.2.2 |
| NEG-06 | HP | `x-gzip` → gzip으로 처리, 응답 CE는 `gzip` | §1.3.1 |
| NEG-07 | HP | `x-compress` → compress 동등 취급(서버 미지원 → 무압축, 파서가 별칭 정규화) | §1.3.2 |
| NEG-08 | HP | 동일 qvalue 다수 매칭 → 서버 선호 순서 tie-break | §9.2.2 |
| NEG-09 | NE | `AE:` 빈 값 → 무압축 | §1.1.2 |
| NEG-10 | NE | `gzip;q=0` → gzip 배제, 무압축 | §1.1.3 |
| NEG-11 | NE | `*;q=0` (identity 미명시) → 전 코딩+identity 배제 → 압축 불가 + identity 응답 회피 신호 | §1.1.4·§1.1.7 |
| NEG-12 | NE | `identity;q=0, br` + 서버 gzip만 → identity로 응답하지 않음 (**Red: 현행 위반**) | §1.1.7·§1.1.8 |
| NEG-13 | NE | `AE: br` + 서버 gzip만 → 무압축(identity 허용이므로 원본 송출) | §1.1.7 |
| NEG-14 | NE | `identity`만 수락 → 무압축 | §1.1.4 |
| NEG-15 | ED | `q=0.001` 최소 양수 → 선택됨 | §1.2.1 |
| NEG-16 | ED | 문법 밖 q (`q=abc`, `q=`, `q=1.5`, `q=-1`) → 관용 처리(기본 1 또는 무시)·크래시 없음 | §1.2.1 |
| NEG-17 | ED | 소수 4자리 `q=0.1234` → 관용 파싱 | §1.2.1 |
| NEG-18 | ED | 빈 list 요소 `gzip,,br` · 단독 `,` → 무시 | §1.1.3 |
| NEG-19 | ED | 중복 코딩 `gzip;q=0.8, gzip;q=0.2` → 결정적 처리 | §1.1.3 |
| NEG-20 | ED | 공백 변형 `gzip ; q = 0.6` | §1.2.1 |
| NEG-21 | ED | 코딩명 대소문자 `GZIP` → gzip | §1.4.1 |
| NEG-22 | ED | `*`와 명시 코딩 공존 시 명시가 우선 (`*, gzip;q=0` → gzip 배제, 타 코딩 wildcard) | §1.1.5 |
| NEG-23 | EX | 수천 항목의 초장문 AE → 선형 처리·크래시 없음 | §1.1.3 |
| NEG-24 | EX | 제어문자·비ASCII octet 포함 AE → 크래시 없이 무시/무압축 | §1.1.3 |
| NEG-25 | SE | 협상 실패 경로에서 body·CE·CL·ETag 완전 불변 | §1.1.7 |
| NEG-26 | SE | AE 부재 → 무압축(정책) + Vary 처리 방침 일관성 | §1.1.1·§9.1.2 |
| NEG-27 | SE | 동일 요청 2회 → 동일 협상 결과 (결정성) | §1.1.6 |
| NEG-28 | ED | 중복 코딩 상충 q + 경쟁 코덱 (`gzip;q=0.8, br;q=0.5, gzip;q=0.2`) → 중복 우선순위 고정(맵 덮어쓰기로 gzip 강등되지 않음) | §1.1.3·§1.1.6 |

### 1.2 `test/integration/exclusions.test.ts` — 적용 제외 (§3)

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| EXC-01 | HP | 100·101 → 무압축·무Vary | §3.1.1 |
| EXC-02 | HP | 204 → 무압축·무Vary | §3.1.1 |
| EXC-03 | HP | 304 → 무압축·무Vary | §3.1.1 |
| EXC-04 | HP | 205 → 무압축 | §3.1.2 |
| EXC-05 | HP | HEAD 요청 → body·헤더 불간섭 | §3.2.1·§3.2.2 |
| EXC-06 | HP | 206 + `Content-Range` → 무압축 (**Red: 현행 위반**) | §3.3.2 |
| EXC-07 | HP | `Cache-Control: no-transform` → 무압축 | §3.4.1 |
| EXC-08 | HP | 기존 `Content-Encoding: gzip` → 불간섭 | §2.4.1 |
| EXC-09 | NE | 200 → 압축 (대조군) | §3 |
| EXC-10 | NE | 201·207 등 기타 2xx → 압축 허용 | §3 |
| EXC-11 | NE | `public, no-transform, max-age=3600` 다중 지시어 → 스킵 | §3.4.1 |
| EXC-12 | NE | 유사 토큰 `no-transformable` → 스킵 아님(오탐 방지) | §3.4.1 |
| EXC-13 | ED | 상태코드 경계: 199 → 스킵, 200 → 압축, 0(미설정) → 스킵 | §3.1.1 |
| EXC-14 | ED | 기존 `Content-Encoding: identity` → 불간섭(중복 적용 금지) | §2.4.1 |
| EXC-15 | ED | `NO-TRANSFORM` 대소문자 변형 → 스킵 | §3.4.1 |
| EXC-16 | ED | GET·POST·PUT 등 비HEAD 메서드 → 압축 정상 | §3.2.1 |
| EXC-17 | SE | 모든 스킵 경로에서 body·ETag·CL·CT 완전 불변 | §3 |
| EXC-18 | SE | 스킵 경로별 Vary 정책 일관(협상 도달 전 스킵=무Vary, 도달 후=Vary) | §4.1.1 |

### 1.3 `test/integration/headers.test.ts` — 헤더 효과 (§2·§4)

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| HDR-01 | HP | 압축 후 `Content-Encoding` = 협상 코딩 | §2.1.1 |
| HDR-02 | HP | 압축 후 비인코딩 기준 기존 CL 제거 | §2.3.2 |
| HDR-03 | HP | 압축 후 `Content-Length` = 압축 바이트 수 재설정 (**Red: 미구현**) | §2.3.3 |
| HDR-04 | HP | 압축 후 `Vary: Accept-Encoding` 존재 | §4.1.1 |
| HDR-05 | HP | strong ETag `"abc"` → `W/"abc"` | §4.2.1·§4.2.2 |
| HDR-06 | NE | 어떤 경로에서도 `Content-Encoding: identity` 미생성 | §2.1.2 |
| HDR-07 | NE | 압축 스킵 시 기존 CL 유지 | §2.3.2 |
| HDR-08 | NE | 압축 스킵 시 ETag 불변 | §4.2.2 |
| HDR-09 | ED | 기존 `Vary: Origin` → `Origin, Accept-Encoding` append | §4.1.1 |
| HDR-10 | ED | 기존 `Vary: accept-encoding`(소문자) → 중복 append 없음 | §4.1.1 |
| HDR-11 | ED | 기존 `Vary: *` → append 안 함 (**Red: 미구현**) | §4.1.2 |
| HDR-12 | ED | ETag 부재 → 미생성 | §4.2.2 |
| HDR-13 | ED | 기존 weak `W/"abc"` → 그대로 유지 | §4.2.2 |
| HDR-14 | ED | 특수 ETag: `""`·`W/""` → 안전 처리 | §4.2.2 |
| HDR-15 | ED | BREACH 패딩 적용 시에도 CL = 최종(패딩 포함) 바이트 수 | §2.3.3 |
| HDR-16 | SE | 헤더 조작이 CT·Cache-Control 등 무관 헤더 불변 | §2 |
| HDR-17 | SE | 압축 후 모든 표현 metadata가 coded form 기준으로 일관(CL·CE 동시 검증) | §2.3.1 |
| HDR-18 | SE | 동일 응답 이중 통과(재진입) → CE 중복 적용 없음 | §2.4.1 |
| HDR-19 | ED | 기형 ETag (`abc` 무인용, `w/"x"` 소문자, `"a", "b"` 목록형) → 무효한 weak tag를 새로 만들지 않음 | §4.2.2 |
| HDR-20 | ED | 다중 `Vary` field line(append로 분리 저장, `*` 포함 케이스) → comma-join 의미론과 동일 판정 — **실제 Headers.append 시맨틱이 필요해 e2e로 이관: E2E-WH-07** | §4.1.1·§4.1.2 |

### 1.4 `test/integration/codecs.test.ts` — 코딩 포맷 (§5)

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| COD-01 | HP | gzip 라운드트립(압축→gunzip→원문) | §5.1.1 |
| COD-02 | HP | br 라운드트립 | §5.3.1 |
| COD-03 | HP | deflate 라운드트립(inflateSync = zlib-wrapped 해제) | §5.2.1 |
| COD-04 | HP | zstd 라운드트립 | §5.4.1 |
| COD-05 | HP | gzip 출력: 헤더 ID1=0x1f·ID2=0x8b·CM=8 + trailer CRC32·ISIZE가 원문과 일치 | §5.1.2 |
| COD-06 | HP | deflate 출력 CMF 하위 4비트=8 (zlib wrapper 존재, raw 아님) | §5.2.1 |
| COD-07 | HP | 레벨 반영: gzip level 1 vs 9 출력 크기 차등 | §9.2.1 |
| COD-08 | ED | 정확히 threshold 크기 body → 압축(경계 포함) | §9.2.1 |
| COD-09 | ED | 멀티바이트 유니코드 body 라운드트립 | §5.1.1 |
| COD-10 | ED | Uint8Array·ArrayBuffer body 라운드트립 | §5.1.1 |
| COD-11 | ED | 대형 body(수 MB) zstd → Frame_Header의 Window_Size ≤ 8MB 검증 | §5.4.2·§5.4.3 |
| COD-12 | ED | zstd 출력이 유효한 단일/다중 프레임 시퀀스 | §5.4.4 |
| COD-13 | EX | 압축기 throw(mock) → 원본 body·헤더 유지, 응답 유효 | §9.2.3 |
| COD-14 | SE | 동일 입력·레벨 반복 압축 → 결정적 출력 | §5 |

### 1.5 `test/integration/breach.test.ts` — HTB 패딩 (§6)

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| BRC-01 | HP | gzip 패딩: FEXTRA 플래그 set + `ZP` 서브필드 + 라운드트립 무손상 | §6.1.1 |
| BRC-02 | HP | zstd 패딩: skippable magic 0x184D2A50(LE) + 라운드트립 무손상 | §6.2.1·§6.2.2 |
| BRC-03 | HP | 30회 반복 → 출력 크기 분산 존재 | §9.3.1 |
| BRC-04 | NE | breach 설정 + br 협상 요청 → BREACH-safe 코딩으로 폴백 | §9.3.1 |
| BRC-05 | NE | breach 미설정 → 패딩 없음(FEXTRA 미설정) | §9.3.1 |
| BRC-06 | ED | maxPadding=1 → 정확히 1바이트 패딩 | §6.1.1 |
| BRC-07 | ED | maxPadding=4096 상한 | §6.1.1 |
| BRC-08 | ED | 기존 FEXTRA 있는 gzip 입력 + XLEN 오버플로 임계 → 원본 무변조 반환 — **오버플로 단언은 통합 경로 도달 불가(Bun.gzipSync 출력에 FEXTRA 없음)라 유닛 htb.spec이 소유, 통합은 무손상만 검증** | §6.1.2 |
| BRC-09 | ED | Frame_Size 리틀엔디언 인코딩 정확성 | §6.2.1 |
| BRC-10 | SE | 패딩 적용 후에도 CL = 최종 바이트 수(HDR-15와 교차) | §2.3.3 |
| BRC-11 | SE | 패딩 데이터가 zero-fill(정보 누출 없음) | §9.3.1 |

### 1.6 `test/integration/streaming.test.ts` — 스트리밍 (§7, Phase 4)

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| STR-01 | HP | ReadableStream body + AE: gzip → 압축 스트림 + CE 설정 | §7.1.1 |
| STR-02 | HP | Blob body → 스트림 경로 압축 | §7.1.1 |
| STR-03 | HP | deflate 스트림 → zlib-wrapped(`deflate` 포맷, raw 아님) | §7.2.1 |
| STR-04 | HP | brotli 스트림(WHATWG 표준 포맷) | §7.1.1 |
| STR-05 | HP | zstd 스트림(런타임 확장 경로) | §7.1.2 |
| STR-06 | NE | 스트림 + 비압축성 CT → 원스트림 불간섭 | §9.2.1 |
| STR-07 | NE | 스트림 + AE 무매칭 → 원스트림 유지 | §1.1.7 |
| STR-08 | ED | 빈 스트림·단일 청크·다수 청크 각각 라운드트립 | §7.1.1 |
| STR-09 | EX | 원 스트림 mid-stream error → 자원 누수 없이 전파/종료 | §7 |
| STR-10 | SE | 스트림 경로에서 CL 미설정(길이 미지) | §2.3.3 |
| STR-11 | SE | 원 스트림이 소비/취소되어 잠금 상태 오류 없음 | §7 |

### 1.7 `test/integration/policy.test.ts` — 정책 (§9)

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| POL-01 | HP | threshold 미달 body → 무압축 | §9.2.1 |
| POL-02 | HP | threshold=0 → 소형 body도 압축 | §9.2.1 |
| POL-03 | HP | 커스텀 filter 함수 적용 | §9.2.1 |
| POL-04 | HP | 기본 filter: text/html·application/json·image/svg+xml 허용 | §9.2.1 |
| POL-05 | NE | 기본 filter: image/png·application/octet-stream·video/mp4 거부 | §9.2.1 |
| POL-06 | NE | text/event-stream(SSE) 거부 — 변형·대소문자 포함 | §9.2.1 |
| POL-07 | NE | 팽창 가드: 압축 결과 ≥ 원본 → 무압축·원본 송출 (**Red: 미구현**) | §9.2.3 |
| POL-08 | ED | threshold 경계 -1바이트 → 무압축 | §9.2.1 |
| POL-09 | ED | CT 부재 body → 정책 명시 결과(현행: 압축 시도)의 고정 | §9.2.1 |
| POL-10 | EX | 직렬화 불가 body(순환 참조) → throw 없이 스킵 (**Red: 현행 throw**) | §9 |
| POL-11 | EX | filter 함수가 throw → 안전 처리 | §9.2.1 |
| POL-12 | SE | 미들웨어 인스턴스 재사용: 연속 상이 요청 간 상태 격리 | §9 |
| POL-13 | SE | 옵션 객체 사후 변조(`encodings` 배열 push 포함) → 동작 불변(생성 시점 고정) (**Red: 현행 참조 공유**) | §9 |
| POL-14 | ED | object/array body의 직렬화 후 바이트 수가 threshold를 넘나드는 케이스(직렬화 전후 크기 상이) | §9.2.1 |
| POL-15 | ED | 원시·공백 body: number·boolean·`""`·zero-length Uint8Array (threshold=0) → 각각 정의된 동작 | §9.2.1 |
| POL-16 | ED | 파라미터 있는 CT: `application/json; charset=utf-8` 허용, `text/event-stream; charset=utf-8` 거부 | §9.2.1 |
| POL-17 | SE | 동시(async interleaved) 상이 AE 요청이 동일 인스턴스 통과 → 교차 오염 없음 | §9 |

### 1.8 `test/integration/factory.test.ts` — 생성 검증

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| FAC-01 | HP | 옵션 없음/부분 옵션 → 정상 정의 반환 | — |
| FAC-02 | NE | `encodings: []` → Err(EmptyEncodings) | — |
| FAC-03 | NE | 미지 인코딩 `lz4` → Err(InvalidEncodings) | §2.2.1 |
| FAC-04 | NE | threshold 음수·NaN·Infinity → Err(InvalidThreshold) | — |
| FAC-05 | NE | 레벨 범위 밖(gzip 0/10, br 12, zstd 0/20)·소수 → Err(InvalidLevel) | §5.4.3 |
| FAC-06 | NE | breach maxPadding 0·-1·1.5·4097·NaN → Err(InvalidBreach) | — |
| FAC-07 | NE | breach + BREACH-safe 인코딩 전무 → Err(InvalidBreach) | — |
| FAC-08 | ED | 각 코덱 레벨 min/max 경계 정확 수용 | — |
| FAC-09 | SE | Err 반환 시 어떤 전역 상태·부수 효과도 없음 | — |

## 2. e2e 테스트 (`@zipbul/tck` — real pipeline + wire)

### 2.1 `test/e2e/helpers.ts`
`bootCompressionApp(opts, extras)` — cors helpers 패턴 이식. raw wire 검증용 `fetchRaw`(자동 해제 우회: `Bun.connect` raw 소켓 또는 fetch `decompress:false`) 포함.

### 2.2 `test/e2e/roundtrip.test.ts`

| ID | 유형 | 케이스 |
|---|---|---|
| E2E-RT-01~04 | HP | 4코덱 각: 실서버 압축 → 실클라이언트 자동 해제 → 원문 정합 |
| E2E-RT-05 | HP | JSON object 핸들러 반환 → 해제 후 JSON.parse 정합 |
| E2E-RT-06 | ED | 대형 body(1MB+) 라운드트립 |
| E2E-RT-07 | ED | 멀티바이트 유니코드 라운드트립 |

### 2.3 `test/e2e/wire-headers.test.ts` — raw 실측

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| E2E-WH-01 | HP | wire상 `Content-Encoding: gzip` 실존 | §2.1.1 |
| E2E-WH-02 | HP | wire상 CL = 실제 전송 압축 바이트 수 | §2.3.3 |
| E2E-WH-03 | HP | wire상 `Vary: Accept-Encoding` 실존 | §4.1.1 |
| E2E-WH-04 | NE | 무압축 응답에 CE 부재·원본 CL 정확 | §2.3.2 |
| E2E-WH-05 | ED | 압축 응답의 wire CL 존재·값 정확(전송 framing 방식 자체는 §8.2.1 범위 밖 — 단언하지 않음) | §2.3.3 |
| E2E-WH-06 | HP | ETag 설정 핸들러 → wire상 `W/` 접두 실존 | §4.2.2 |
| E2E-WH-07 | ED | 다중 `Vary` field line(Origin·`*` 분리 append) → accept-encoding 추가 없음 (HDR-20 이관분) | §4.1.1·§4.1.2 |

### 2.4 `test/e2e/pipeline.test.ts` — 파이프라인 계약

| ID | 유형 | 케이스 |
|---|---|---|
| E2E-PL-01 | HP | 핸들러 object 반환 → serialize 선행으로 CT=application/json 추론 → filter 통과 → 압축 (NOTICE 전제 3-1 증명) |
| E2E-PL-02 | HP | 핸들러 string+CT 명시 → 압축 |
| E2E-PL-03 | HP | 타 미들웨어(cors류 헤더 조작) 선행 공존 → 상호 간섭 없음 |
| E2E-PL-04 | NE | 미들웨어 미장착 앱 → 무압축·표준 적합 응답 (NOTICE §2 증명) |
| E2E-PL-05 | SE | 동일 앱 연속 상이 AE 요청 → 각각 독립 협상(캐시 오염 없음) |
| E2E-PL-06 | EX | 핸들러 throw → 오류 응답 경로에서 압축 미들웨어 무해 통과 |
| E2E-PL-07 | ED | 302/303 redirect(+body) → 어댑터의 body 처리 이후 wire에 고아 `Content-Encoding`·coded metadata가 남지 않음 |

### 2.5 `test/e2e/exclusions.test.ts` — real server 제외 경로

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| E2E-EX-01 | HP | real HEAD 요청 → content 없음·압축 부작용 없음 | §3.2.1 |
| E2E-EX-02 | HP | real 204 핸들러 → 무압축·무Vary | §3.1.1 |
| E2E-EX-03 | HP | no-transform 응답 → wire 무압축 | §3.4.1 |
| E2E-EX-04 | HP | 사전 인코딩된 응답(핸들러가 CE 설정) → 이중 압축 없음 | §2.4.1 |
| E2E-EX-05 | ED | 어댑터가 206을 생성하는 경우 wire 무압축 (어댑터 range 지원 여부에 따라 skip 가능) | §3.3.2 |

### 2.6 `test/e2e/negotiation.test.ts`

| ID | 유형 | 케이스 | 규칙 |
|---|---|---|---|
| E2E-NG-01 | HP | 실 AE 헤더 서버 순서 협상(`gzip, br` → 서버 선호) | §1.1.6 |
| E2E-NG-02 | NE | `identity;q=0` + 무매칭 → identity 미송출(최종 응답 형태 확정 후) | §1.1.7 |
| E2E-NG-03 | NE | AE 없는 실요청 → 무압축 | §9.1.2 |
| E2E-NG-04 | ED | 브라우저 실전 AE 문자열(`gzip, deflate, br, zstd`) 정상 협상 | §1 |
| E2E-NG-05 | ED | raw 소켓으로 다중 `Accept-Encoding` field line 전송 → 단일 comma-join field와 동일 협상 | §1.1.3·§1.1.6 |

### 2.7 `test/e2e/streaming.test.ts` (Phase 4)

| ID | 유형 | 케이스 |
|---|---|---|
| E2E-ST-01 | HP | 핸들러 ReadableStream 반환 → wire 압축 스트림 → 클라이언트 해제 정합 |
| E2E-ST-02 | HP | SSE(text/event-stream) → 무압축 실측 |
| E2E-ST-03 | ED | 대형 스트림 chunked 전송 실측 |
| E2E-ST-04 | EX | 클라이언트 조기 연결 종료 → 서버 자원 정리 |

## 3. 규칙 커버리지 매트릭스 (60규칙 전수)

| 규칙 | 케이스 | 비고 |
|---|---|---|
| §1.1.1 | N/A | 규칙은 "AE 부재 = 전 코딩 acceptable" 판정인데 구현은 판정 전 정책 스킵(§9.1.2)이라 경로 도달 불가 — NEG-26은 §9.1.2 커버 |
| §1.1.2 | NEG-09 | |
| §1.1.3 | NEG-01·10·18·19·23·24·28, E2E-NG-05 | |
| §1.1.4 | NEG-11·14 | |
| §1.1.5 | NEG-03·22 | |
| §1.1.6 | NEG-02·27, E2E-NG-01 | |
| §1.1.7 | NEG-11·12·13·25, E2E-NG-02 | Red |
| §1.1.8 | NEG-12 | 대응 정의 확인 |
| §1.2.1 | NEG-15·16·17·20 | |
| §1.2.2 | NEG-05 | |
| §1.2.3 | NEG-04 | |
| §1.3.1 | NEG-06 | |
| §1.3.2 | NEG-07 | |
| §1.4.1 | NEG-21 | |
| §2.1.1 | HDR-01, E2E-WH-01 | |
| §2.1.2 | HDR-06 | |
| §2.2.1 | FAC-03, 유닛 enums.spec(enum 값 = IANA 이름) | |
| §2.3.1 | HDR-17 | |
| §2.3.2 | HDR-02·07, E2E-WH-04 | |
| §2.3.3 | HDR-03·15, BRC-10, STR-10, E2E-WH-02·05 | Red |
| §2.4.1 | EXC-08·14, HDR-18, E2E-EX-04 | |
| §3.1.1 | EXC-01~03·13, E2E-EX-02 | |
| §3.1.2 | EXC-04 | |
| §3.2.1 | EXC-05·16, E2E-EX-01 | |
| §3.2.2 | EXC-05 | MAY 채택 경로 |
| §3.3.1 | N/A | 사실 조문(range는 인코딩 바이트 기준) — §3.3.2 케이스(EXC-06)의 전제이지 독립 검증 대상 아님 |
| §3.3.2 | EXC-06, E2E-EX-05 | Red |
| §3.4.1 | EXC-07·11·12·15, E2E-EX-03 | |
| §4.1.1 | HDR-04·09·10, EXC-18, E2E-WH-03·07 | |
| §4.1.2 | HDR-11, E2E-WH-07 | |
| §4.2.1 | HDR-05 | |
| §4.2.2 | HDR-05·08·12·13·14·19, E2E-WH-06 | |
| §4.2.3 | N/A | 클라이언트/캐시 측 사실 — 서버 테스트 불가, §3.3.2로 간접 담보 |
| §4.2.4 | N/A | 대안 경로(변형별 strong tag) 미채택 — §4.2.2 경로 채택 명시 |
| §5.1.1 | COD-01·05·09·10 | |
| §5.1.2 | COD-05 | |
| §5.2.1 | COD-03·06, STR-03 | |
| §5.3.1 | COD-02 | |
| §5.4.1 | COD-04 | |
| §5.4.2 | COD-11 | |
| §5.4.3 | FAC-05, COD-11 | |
| §5.4.4 | COD-12, BRC-02 | |
| §6.1.1 | BRC-01·06·07 | |
| §6.1.2 | BRC-08 | |
| §6.1.3 | N/A | 레지스트리 사실 — 코드 주석·문서로 담보 |
| §6.2.1 | BRC-02·09 | |
| §6.2.2 | BRC-02 (라운드트립이 곧 skip 증명) | |
| §7.1.1 | STR-01·02·04·08, E2E-ST-01 | Phase 4 |
| §7.1.2 | STR-05 | Phase 4 |
| §7.2.1 | STR-03 | Phase 4 |
| §8.1.1 | N/A | 범위 밖 선언(dcb/dcz 미구현) — export surface에 부재 확인 |
| §8.2.1 | N/A | 범위 밖 선언(메시징 계층 미생성) — Transfer-Encoding 미설정 확인 |
| §8.3.1 | N/A | 범위 밖 선언(요청측 디코딩 없음) |
| §8.4.1 | N/A | 범위 밖 선언(TLS 계층) |
| §9.1.1 | E2E-PL-04 | |
| §9.1.2 | NEG-26, E2E-NG-03 | |
| §9.2.1 | POL-01~06·08·09·11·14·15·16, COD-07·08 | |
| §9.2.2 | NEG-08 | |
| §9.2.3 | POL-07 | Red |
| §9.3.1 | BRC-03·04·05·11 | |

**커버 판정**: 60규칙 = 테스트 매핑 51 + N/A 9 (§1.1.1·§3.3.1·§4.2.3·§4.2.4·§6.1.3·§8.1.1·§8.2.1·§8.3.1·§8.4.1). 각 N/A에 사유 명기.

## 4. Red 목록 (TDD 시작점)

| Red | 케이스 | 수정 대상 | 상태 |
|---|---|---|---|
| R1 | EXC-06 (206) | middleware 상태코드 제외 | ✅ Phase 2 |
| R2 | NEG-11·12, E2E-NG-02 (identity;q=0 → 406) | isIdentityAcceptable + setStatus(406)·body 제거 | ✅ Phase 2 |
| R3 | HDR-03·15, BRC-10 (CL 재설정) | remove→set(압축 바이트 수) | ✅ Phase 2 |
| R4 | HDR-11 (Vary `*`) | varyCoversAcceptEncoding | ✅ Phase 2 |
| R5 | POL-07 (팽창 가드) | 크기 비교 | Phase 3 |
| R6 | POL-10·POL-11 (직렬화·filter 예외) | try 범위 확장 | Phase 3 |
| R7 | STR-* 전체 (스트리밍) | streaming.ts 신규 + middleware 스트림 분기 + 어댑터 peekNativeResponse | ✅ Phase 4 |
| R8 | e2e 전체 (tck 재작성) | helpers + 6파일 | ✅ Phase 1 |
| R9 | POL-13 (옵션 불변성) | resolve 시 encodings 복사·동결 | Phase 3 |
| R10 | NEG-28 (중복 AE 항목 q 강등) | 중복 = 최고 qvalue 대표 규칙 | ✅ Phase 2 |

Phase 2 참고: BeforeResponse phase의 미들웨어 반환 Result는 core `runPipeline`이 무시하므로(adapter.ts post-step 루프), 406은 Err 반환이 아니라 response 직접 변이(setStatus·setBody(null))로 구현했다.

### 삼자리뷰 2차(Phase 2·3 + 스트리밍 RED) 반영 기록

- **채택·수정 완료**: HDR-21 신설(TE 존재 시 CL 미설정 — §2.3.3의 "TE 없이" 전제 구현 누락이었음), NEG-11/12 단언 강화(body null·CL 부재·Vary 유지 정확 단언), NEG-29 신설(전면 명시 배제 3연타 → 406), POL-07 결정화(랜덤 512B → 압축기 팽창 주입 spy), STR-02 강화(CL === null 정확 단언), STR-12/13/14 신설(native Response 자체 CE 이중압축 방지·native 내부 CT의 SSE 보호·이중 통과 재진입 안전 — 스트리밍 GREEN의 설계 계약).
- **정책 결정(기록)**: 406 응답의 content 생성(§15.5.7 SHOULD — 가용 표현 목록)은 미들웨어가 아닌 응답 생성기/앱 소관으로 미이행. 406의 Content-Type 잔존 처리도 어댑터 build() 소관 — 미들웨어 계약은 body null·CL 제거·Vary 유지·CE 부재까지.
- **기각**: "gzip;q=0.8, gzip;q=0 문서화 케이스 부재" — 유닛 encoding.spec의 'should not resurrect a coding excluded by q=0...'가 이미 소유.
- **스트리밍 GREEN 전제**: (a) native Response 자체 헤더(CE·CT)를 읽을 수 있는 어댑터 접근자 필요 — `getNativeResponse()`는 lazy-merge 캐시를 남기므로 skip 경로에서 호출 금지(read-only 접근자 신설 예정), (b) mock의 nativeResponse 주입 경로는 real setNativeResponse와 대응.

## 5. 실행 순서

1. **Phase 1** — 기존 216 테스트 중 **현재 green인 케이스만** 본 계획의 파일 구조·케이스 ID로 이전(Green 유지). Red 케이스(R1~R9 대상)는 `it.todo`로 자리만 확보. e2e는 tck helpers + 현재 통과 가능한 케이스부터 재작성하고 red 의존 케이스는 `todo`.
2. **Phase 2** — R1~R4 (표준 위반·미이행) Red→Green (`todo` 해제).
3. **Phase 3** — R5·R6·R9 (견고성) Red→Green.
4. **Phase 4** — R7 스트리밍: 설계 결정 3건(threshold 전략·스트리밍 BREACH 비활성·레벨 위임) 확정 후 유닛→통합→e2e. ✅ 완료 — 확정된 결정: (a) 스트림은 길이 미지이므로 threshold 미적용·CL 제거, (b) BREACH 활성 시 스트림 압축 전면 스킵(패딩 불가 → 방어 우선), (c) CompressionStream 레벨은 런타임 위임, (d) native Response 자체 CE/CT는 peekNativeResponse로 검사(이중 압축·SSE 보호), (e) 어댑터에 read-only `peekNativeResponse()` 신설(lazy-merge 캐시 비오염 — 회귀 스펙 3건 포함).
5. **Phase 5** — 커버리지 매트릭스 최종 대사(외부 툴 grep 검증 가능 상태 확인), COMPRESSION.md 제거. ✅ 완료.
