# probe — Bun wire 동작 계측기 (테스트 아님)

이 디렉토리는 `test/`가 아니다. 여기 있는 건 **계측기(instrument)**다 — Bun.serve가
*실제로* wire-level에서 무엇을 하는지 raw TCP로 관찰해 **사실 기록**을 만든다.
SPEC.md가 어댑터에게 "재구현하지 말라"(§1.1)·"통과를 전제로 결정하라"(§1.2)고 정한
규칙이 의존하는 *런타임 동작 사실*을, 기억·가정이 아니라 이 측정으로 보증한다.

> 인식론: 테스트는 *우리가 정한 기대값*을 코드에 강제한다(출처=우리). 프로브는
> *Bun이 하는 것*을 관찰해 받아적는다(출처=Bun). 그래서 같은 디렉토리·접미사를
> 쓰면 안 된다.

## 구성

| 파일 | 정체 | 테스트? |
|---|---|---|
| `bun-wire-probe.ts` | 계측기 — raw TCP로 Bun 동작 측정, baseline 생성 | ❌ |
| `bun-wire.baseline.json` | 사실 기록 — `{bunVersion, platform, cases:[{id,label,verdict,signal}]}` | ❌ (데이터) |
| `bun-wire-drift.test.ts` | drift guard — "현재 Bun == baseline" characterization test | ✅ 유일 |

판정(verdict): `BUN_REJECTED` / `REACHED_RAW` / `INCONCLUSIVE`.
라벨(=내 기대): `bun-should-reject` / `known-passthrough`(§1.2 양성대조) / `behavior`.
라벨과 verdict가 어긋나면(예: `bun-should-reject` → `REACHED_RAW`) 그 자체가 발견이다.

## 측정 범위와 경계 (정직 고지)

- 프로브는 **"Bun이 핸들러 dispatch 전·시점에 무엇을 하는가"**만 측정한다. 핸들러는
  **body를 읽지 않는다** — body 스트림 abort-on-read는 타이밍 의존이라 결정적
  측정 밖이며 별도 대상이다(그래서 `incomplete-body`는 "dispatch 전 abort 여부"만 본다).
- 도달 판정 = 핸들러가 per-case nonce(`X-Probe-Case`)를 기록했는가(응답 부산물 아님).
  핸들러는 동기 반환이라 pending async·공유 가변 상태·hang이 없다.
- 응답 헤더 CRLF injection(response splitting)은 **출력측 관심사**(SPEC §3.A/어댑터)지
  요청 wire 파싱이 아니다 — 이 입력 프로브 범위 밖. (wire에서 `\r\n`은 정상 헤더 구분자다.)
- drift guard는 `(label, verdict, signal)` 3-tuple을 케이스 *집합* 전체로 비교한다
  (추가·삭제·변경 모두 탐지). signal은 버전 내 **결정적** 사실 문자열이며, 도달
  케이스엔 `req.url`의 authority(`host:`)도 박는다 — absolute-form/다중 Host의 신뢰
  경계 회귀를 drift가 잡도록.
- 결정성 주의: 측정은 결정적이나(반복 실행 동일), WSL2 등 일부 파일시스템에서 `--write`
  직후 즉시 읽기에 드물게 동기 지연이 있을 수 있다 — drift가 일회성 실패하면 재실행.

## 실행

```bash
bun probe/bun-wire-probe.ts          # 측정 결과 출력
bun probe/bun-wire-probe.ts --write  # baseline.json 스냅샷 갱신(의도적)
bun test probe/bun-wire-drift.test.ts  # drift guard
```

## Bun 업그레이드 시 절차

1. Bun 버전 올린다.
2. `bun test probe/` → drift guard가 동일 Bun·플랫폼에서 `(label,verdict,signal)` 변동을
   빨갛게 잡는다(버전/플랫폼이 다르면 loud-skip — 재측정하라고 알린다).
3. `bun probe/bun-wire-probe.ts` 로 델타 확인.
4. 델타 해석:
   - `REACHED_RAW → BUN_REJECTED` (Bun이 이제 막음): 어댑터의 해당 방어를 **걷어낸다**.
   - `BUN_REJECTED → REACHED_RAW` (Bun이 이제 안 막음, 회귀): 어댑터가 **떠안는다**.
5. SPEC §1.1 갱신 + `--write`로 baseline 재스냅샷.

## 측정 발견 (Bun 1.3.14, linux-x64 — 2회 실행 결정적)

| 케이스 | SPEC | verdict | 함의 |
|---|---|---|---|
| bad-method-token (`GE{T`) | §1.1.1 | BUN_REJECTED(400) | ✅ 비-tchar 메서드 거부 |
| dup-CL 동일값(5,5) | §1.1.2 | **REACHED_RAW** (`cl:5, 5`) | ⚠️ Bun이 거부 안 함 — comma-join해 핸들러 통과 |
| dup-CL 상이값(5 vs 6) | §1.1.2 | BUN_REJECTED(400) | ✅ 상이값은 거부 |
| nonnumeric-CL | §1.1.2 | BUN_REJECTED(400) | ✅ |
| negative-CL | §1.1.2 | BUN_REJECTED(400) | ✅ |
| TE+CL smuggling | §1.1.2 | BUN_REJECTED(400) | ✅ |
| bare-CR | §1.1.3 | BUN_REJECTED(400) | ✅ |
| bare-LF | §1.1.3 | BUN_REJECTED(400) | ✅ |
| NUL in header | §1.1.3 | BUN_REJECTED(400) | ✅ |
| obs-fold | §1.1.3 | BUN_REJECTED(400) | ✅ |
| non-tchar field-name | §1.1.3 | BUN_REJECTED(400) | ✅ |
| incomplete-body (CL=100, 5B) | §1.1.4 | **REACHED_RAW** (`cl:100`) | ⚠️ Bun이 dispatch 전 abort 안 함 — 핸들러로 넘김(abort는 body read 시) |
| Expect: 100-continue | §1.1.4 | REACHED_RAW (`100-continue:true`) | ✅ Bun이 100 Continue 자동 응답 |
| oversized-header (100KB) | §1.1.5 | BUN_REJECTED(431) | ✅ (버전/설정 의존 §6) |
| bad-request-target (control char) | §1.1.5 | BUN_REJECTED(505) | ✅ 거부(단 400 아닌 505로 응답 — Bun 특이) |
| Date 자동생성 | §1.1.6 | REACHED_RAW (`date:true`) | ✅ Bun이 Date 생성 |
| absolute-form | §1.2.1 | REACHED_RAW (`urlhost:evil.example hdrhost:probe`) | ✅ 통과(양성대조). `req.url` authority=`evil.example`인데 raw Host=`probe` — 둘 다 signal에 박아 불일치 사실 보존 |
| 다중 Host (a/b) | §1.2.2 | REACHED_RAW (`urlhost:a.example hdrhost:a.example, b.example`) | ⚠️ Bun이 거부 안 함 — raw Host를 **comma-join**(`a.example, b.example`)해 통과, `req.url`은 첫 Host. 어댑터가 comma-join 거부 책임(§3.C). comma-join 사실을 signal에 보존 |

### SPEC-correctness 트랙으로 넘길 발견 (probe는 측정만, SPEC 수정은 별도)

- **§1.1.2 "중복 Content-Length 거부"는 부정확하다.** Bun 1.3.14는 *상이값* 중복만
  거부하고 *동일값* 중복(5,5)은 거부 없이 comma-join해 통과시킨다. SPEC 문구는
  "상이값 CL 거부"로 한정해야 하며, 동일값 dup-CL은 §1.2(어댑터 결정) 후보다.
- **§1.1.4 "incomplete body abort"는 dispatch 시점이 아니다.** Bun은 헤더 완성 시
  핸들러를 dispatch하고, incomplete body의 abort는 body 소비 시점에 일어난다.

## 아직 미커버 (§1.1 중 측정 안 된 것 — 완료로 간주 금지)

- §1.1.1: 메시지 framing / 일반 헤더 ABNF (tchar 메서드만 측정)
- §1.1.4: chunked 디코딩, idle timeout, body 스트림 abort-on-read
- §1.1.5: 헤더 한계 경계값, 복수 request-target 형식
