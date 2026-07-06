# compression 벤치마크 계획 (v2 — 삼자 리뷰 반영: grok·claude·codex)

## 목적 (정직하게 재작성)
성능 서술을 **숫자로** 뒷받침하되 **"업계 최고"는 주장하지 않는다.** 지배 비용인 코덱 압축은 Bun/`node:zlib` **라이브러리** 성능이지 우리 코드가 아니다(삼자 만장). 벤치가 정직하게 뒷받침할 수 있는 것만 주장한다.

- **증명 가능 (우리 코드):**
  - wrapper 무오버헤드 — `BUFFER_COMPRESSORS[gzip]` vs **`Bun.gzipSync`**(동일 런타임·옵션) ≈ 0.
  - Accept-Encoding 협상 비용 (sub-µs 급).
  - 오케스트레이션 오버헤드 — `full − codec` **델타**.
  - BREACH 패딩 비용 (CSPRNG draw 포함) — bounded.
- **범위 밖 (라이브러리, 우리 공로 아님):** 코덱 raw throughput, 크로스프레임워크(express) 비교.

## 도구 · 배치
- **mitata** (`bench`·`summary`·`boxplot`·`do_not_optimize`·`run`), house 패턴(query-parser) 준수.
- `bench/compression.bench.ts`; `package.json`: `"bench": "bun run bench/compression.bench.ts"` + `mitata: catalog:` devDep. **express `compression` devDep 추가 안 함**(비교 drop).

## 측정 그룹 (깨끗이 분해 — 삼자 요구)

1. **Factory** (boxplot, `.gc('inner')`) — `compressionMiddleware()` 기본/전체옵션/breach. **측정 전 throwaway 1회 호출**로 baker `seal()` one-time 비용 소진(steady-state `validateSync`만).
2. **협상 유닛** (summary) — `parseAcceptEncoding`+`negotiateEncoding`: 단순/멀티+q/wildcard/브라우저 실헤더/미매칭. **우리 코드.**
3. **serialize-only** (summary) — `serializeBody`: string / Uint8Array(passthrough) / JSON object / nested JSON, 동일 10KB 논리내용. **우리 코드.** 산출 바이트는 그룹4에 재사용.
4. **codec-only** (summary, **⚠라이브러리 flag**) — gzip/br/deflate/zstd × {1KB,10KB,100KB} realistic payload. 각 행에 **ratio(bytes_in/out)** 보고. 코덱 간 순위를 우리 공로로 서술 금지.
5. **wrapper 오버헤드** (summary) — `BUFFER_COMPRESSORS[gzip]` vs **`Bun.gzipSync(data,{level})`**(정확한 baseline); `BUFFER_COMPRESSORS[deflate]` vs `node:zlib.deflateSync`. 목적: 래퍼 ≈ 0 확인.
6. **오케스트레이션 hot path** (summary) — mock context + **매 iteration mock response 리셋**(핸들러가 Vary/CE/body/ETag를 변형 → 재사용 시 2회차부터 "이미-CE skip" 오측정). 측정:
   - `no-op baseline`(빈 미들웨어) — mock harness 비용.
   - `skip-only`(no-AE / filter reject / 이미-CE) — 분기만.
   - `full pipeline` × {1KB,10KB,100KB}.
   - **보고값 = full − codec(그룹4) − harness baseline = 순수 오케스트레이션 델타.**
   - `do_not_optimize(response.getHeader('content-encoding'))` + body length(핸들러 void라 DCE 방지).
7. **inflation guard** (summary) — threshold/filter/AE 통과하나 **압축이 이득 없는 low-compressibility payload**(pre-gzip 바이트 등) → compress-then-discard 경로 비용.
8. **BREACH 패딩** (summary) — pre-compress를 **루프 밖**에서 1회; 루프 안은 고정 compressed 복사본에 `injectGzipPadding`/`injectZstdPadding`만, maxPadding {16,256,4096}. 전체경로 BREACH on/off 델타 별도.
9. **streaming** (summary, 별도) — pre-built `ReadableStream` 페이로드(10KB/100KB) per encoding: `compressStream` setup + **drain(전체 소비)**; no-compression stream baseline; BREACH-on+stream→early-return 정책비용. 결과는 "stream orchestration"으로 라벨(코덱은 런타임 `CompressionStream`).

## 방법론 원칙
- 입력/인스턴스 pre-build; **가변 response는 iteration마다 리셋**(불변 입력만 pre-build).
- realistic compressible corpus(JSON/HTML/산문) — **`'a'.repeat` degenerate 금지**(helper `largeBody`/`LARGE_JSON` 재사용 금지).
- 모든 측정 `do_not_optimize`(side-effect 경로는 관측가능 출력 wrap).
- 코덱 레벨 `DEFAULT_LEVELS` 고정; ratio 병기.
- 환경 메타 기록(Bun 버전, CPU, run counts) — 재현성.

## 정직하게 가능한 주장 (벤치 후)
- "wrapper는 `Bun.gzipSync` 대비 무오버헤드(≈0)."
- "Accept-Encoding 협상 X ns/req."
- "오케스트레이션 오버헤드 Y µs / Z% atop codec(10KB JSON)."
- "BREACH 패딩 W µs at maxPadding N(CSPRNG 포함)."
- **주장 금지:** "업계 최고 압축 성능"(코덱=라이브러리, 공정 경쟁자 없음, 스트리밍 별개).

## 산출물
`bench/compression.bench.ts` + 이 PLAN + package.json bench script. 실행 수치를 캡처해 위 정직한 문장으로 성능 서술 대체.
