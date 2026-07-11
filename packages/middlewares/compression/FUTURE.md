# FUTURE — @zipbul/compression

미구현/미룬 항목과 그 근거. (2026-07 리서치 종합; 인용은 RFC/IANA/브라우저·CDN 실황.)

## 1. Compression Dictionary Transport (dcb / dcz) — deferred

이 미들웨어가 구현하지 않는 항목. content-coding 관점의 **최전선(천장)** 이며, 이것 외에 새 general-purpose content coding은 IETF 파이프라인에 없다.

### 무엇
- **RFC 9842** "Compression Dictionary Transport" (2025-09, Proposed Standard) + **RFC 9841** "Shared Brotli Compressed Data Format".
- 이전 HTTP 응답을 **사전(dictionary)** 으로 삼아 delta 압축 → 유사 페이로드에서 극적 절감(예: 272KB → 2.6KB, gzip 대비 97%↓).
- **dcz**(Dictionary-Compressed Zstandard): 8B magic `5e 2a 4d 18 20 00 00 00` + 32B SHA-256(dict) + zstd 프레임(external raw dict), window ≥ 8MB/1.25×dict, ≤ 128MB.
- **dcb**(Dictionary-Compressed Brotli): 4B magic `ff 44 43 42` + 32B SHA-256(dict) + shared-brotli(raw prefix dict, RFC 9841), window ≤ 16MB (LARGE_WINDOW 금지).
- 협상: `Accept-Encoding: …, dcb, dcz` + `Available-Dictionary`(구조화필드 byte-seq, base64 SHA-256) + `Dictionary-ID`; 응답 `Use-As-Dictionary`. `Vary: accept-encoding, available-dictionary`, secure-context(HTTPS) **MUST**.

### 왜 미뤘나
1. **아직 optional (2026-07):** Chromium 130+ 만(~69%), **Firefox 0 / Safari 0**, CDN GA 없음(Cloudflare 2026-04 passthrough 베타). graceful degradation(미지원 클라이언트는 br/zstd/gzip).
2. **Bun 런타임 미지원(핵심 blocker):** `node:zlib`의 `dictionary` 옵션이 **silently ignored** — Node 호환 경로(`require('node:zlib').zstdCompressSync`)로도 실측 확인(dict로 압축한 걸 dict 없이 풀어도 성공 = 사전 미사용). 추적: oven-sh/bun#28033 — **open, assignee·milestone·PR·maintainer 응답 없음(기약 없음).**
3. delta 압축은 **사전 저장·SHA-256 인덱싱·URL-pattern 매칭·freshness·Vary·secure-context** 등 압축 미들웨어 하나를 넘어서는 시스템 인프라를 요구.

### 언제/어떻게 가능
- **Bun이 #28033 구현하면** → 우리 인코더는 소량(헤더+SHA-256 조립)으로 가능.
- **또는 `bun:ffi`** 로 `libzstd`(`ZSTD_CCtx_loadDictionary`)·`libbrotlienc`(`BrotliEncoderPrepareDictionary` + `BROTLI_SHARED_DICTIONARY_RAW`) 바인딩(각 ~30–60줄) + 시스템 `.so` 의존.
- 참고: **Node는 이미 둘 다 가능** — zstd dict v24.6, brotli/shared-brotli dict v25.7(우리는 Bun-native라 미채택). Node의 brotli dict는 실제 RFC 9841 shared-brotli를 emit(소스 확인).
- 턴키 npm 인코더 라이브러리는 아직 없음(레퍼런스: pmeenan/compression-dictionary-notes CLI).

## 2. CPU-adaptive compression level (선택, 운영 영역)
부하 시 압축 레벨/동시성을 동적으로 낮추는 것은 2026 프론티어의 "운영 차별화"로 거론되나, 압축 미들웨어의 표준 기능이 아니라 서버/런타임 영역이며 필수 아님. 필요 시 옵션(예: `adaptiveLevel`)으로 추가 검토.

## 범위 밖(재확인 — 이 미들웨어가 다룰 영역 아님)
- static-precompress vs dynamic split(정적 파일 빌드타임 사전압축) — 배포 전략.
- streaming-without-reset(SSE/WebSocket 프레임 압축) — SSE는 filter 제외, WebSocket은 별도 어댑터.
- JPEG XL(이미지 포맷), QPACK(헤더 압축) — content-coding 아님.
