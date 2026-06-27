# @zipbul/cookie — 검증 핸드오프

이 문서는 다른 에이전트가 이 패키지의 "완벽성"을 독립 검증하기 위한 인수인계서다.
구현 지시서가 아니라, **무엇이 어떤 근거로 이렇게 결정됐는지**와 **무엇을 어떻게 검증해야 하는지**를
산문으로 남긴다. 코드 라인 나열은 의도적으로 피했다 — 코드는 직접 읽어라.

---

## 0. 이 패키지가 무엇인가 (정의 — 합의된 단 한 문장)

> 쿠키 미들웨어는 HTTP 요청/응답 파이프라인의 한 단계로서, 와이어 표현인 인바운드 `Cookie` 헤더
> 및/또는 아웃바운드 `Set-Cookie` 헤더를 애플리케이션 계층의 쿠키 표현으로(또는 그로부터)
> 변환하는 미들웨어다.

이게 전부다. genus(미들웨어) + differentia(와이어↔앱 표현 변환). 방향성(인바운드/아웃바운드)은
본질이 아니라 범위다. codec·crypto·packaging은 "정의"가 아니라 제공 기능/편의성이다 —
검증 시 이 둘을 혼동하지 마라. 정의는 `CLAUDE.md`에 1문장으로만 박혀 있다. 규칙 목록은
어떤 문서에도 남기지 않기로 결정했다(아래 1절은 검증 기준으로만 사용, 문서화 대상 아님).

---

## 1. 무엇을 준수하는가 (검증 기준선)

이 코드가 맞춰진 표준 항목들. 이 리스트 자체는 합의 끝에 수렴된 것이며, "과/부족 없는" 최소
정확 집합이라는 점이 검증 대상이다.

- **RFC 6265bis-22** (draft-ietf-httpbis-rfc6265bis-22, 2025-12-01 — 현재 최신 draft).
  주의: 이건 **draft**다. 따라서 "표준 완전 준수"는 원리적으로 확정 불가(아래 6절).
- **RFC 9110**: token/tchar(§5.6.2), IMF-fixdate(§5.6.7), no line folding(§5.3),
  field-value의 CR/LF/NUL 금지(§5.5), BWS(§5.6.3).

구체 준수 포인트(코드에서 확인할 것):
- 쿠키 name은 tchar(token)만. `INVALID_TOKEN_CHARS`로 거른다. **`%`는 일부러 token에서 제외**
  하지 않고 금지 문자 집합에서 빼놨다 — 이유는 4절(라운드트립) 참고.
- 쿠키 value는 cookie-octet 규칙. CTL/CR/LF/NUL/세미콜론/공백 등 금지.
- `Expires`는 항상 IMF-fixdate로 **재출력**한다(`new Date(target.expires).toUTCString()`).
  입력을 그대로 흘리지 않으므로 출력은 항상 conform. (과거 "Date.parse가 느슨해서 결함"이라는
  주장은 멀티에이전트 검증에서 **오판으로 철회**됐다. 재검증 시 출력 경로를 봐라, 입력 파싱 아님.)
- `Max-Age`는 ≤0 거부. 삭제는 `Max-Age=0`이 아니라 `Expires=Thu, 01 Jan 1970 00:00:00 GMT` 사용.
- `__Host-`/`__Secure-` prefix 규칙. `secure:'auto'`가 아닌 한 set() 시점 정적 cross-field 검증
  (None⇒Secure, Partitioned⇒Secure).
- 4096바이트 한도 검사는 **와이어 production 합산** 기준. 현재 구현은 spec보다 **더 엄격**할 수
  있음(raw under-count 회피). 이건 의도된 stricter-than-spec이지 버그 아님.

---

## 2. 에러 모델 (가장 비자명한 결정 — 반드시 검증)

zipbul 프레임워크의 실제 에러 처리(`adapter.ts`/`http-error.ts`/`http-adapter.ts`를 직접 분석해서
도출)에 맞춰 다음 3분기를 확정했다:

- **throw** = invariant 위반 / 프로그래머 오류 / boot 시점 치명. 프레임워크가 받아
  `emergencyTeardown` → generic 500. 따라서 throw는 **부팅/설정 오류에만** 써야 한다.
  미들웨어에서 throw 하는 경우: 빈 secret, 빈 secrets 배열, 잘못된 algorithm (생성/부팅 시점).
- **Result<T,E>** (`@zipbul/result`) = 예상 가능한 요청 단위 실패. 서명 불일치, 복호화 실패,
  malformed 쿠키 등 런타임 입력 문제는 전부 Result로 표현한다. throw 하지 않는다.
- **post-phase(BeforeResponse 등) 단계는 반환된 Err를 무시**한다 — throw만 작용한다.
  그래서 아웃바운드 직렬화는 절대 throw 하지 않고(`getSetCookieHeaders`), 쿠키 단위로
  isErr를 필터링해 정상 쿠키만 방출한다(한 쿠키 실패가 다른 쿠키를 오염시키지 않음).

검증 포인트: 미들웨어 내부에서 받은 Err를 "skip"하는 게 규칙에 부합하는지가 한 번 쟁점이었다.
결론은 부합 — post-phase가 Err를 무시하는 계약이라 skip이 곧 계약 준수다. `middleware.ts`의
beforeResponse가 더 이상 try/catch로 삼키지 않는 점(throw 안 나니까)을 확인하라.

---

## 3. crypto는 왜 in-package이고 별도 path가 아닌가

논의 결론: 서명/암호화는 쿠키 미들웨어가 **제공할 만한** 기능(다른 프레임워크들도 통합 제공).
별도 패키지로 분리하지 않고 **Bun 내장만으로** 내포하기로 결정("crypto codec 모두 별도 path로
하지 말고"). 외부 의존성 0.

- 서명: `Bun.CryptoHasher`로 HMAC(동기). name+`\x00`+value 바인딩. KID 4바이트 로테이션.
  상수시간 비교. **HMAC 키는 생성자에서 1회 derive 후 캐싱**(`this.hmacKeys`) — 핫패스에서
  매번 derive 안 함. 벤치의 "cached key" 항목이 이걸 가리킨다.
- 암호화: `crypto.subtle` AES-256-GCM, AAD=쿠키 이름. HKDF 키 유도.
- base64url: 인코딩은 `Buffer`(unpadded), 디코딩은 `Uint8Array.fromBase64(s,{alphabet:'base64url'})`
  (strict decode).

검증: 제거된 over-design을 되살리지 마라 — `GCM_MAX_INVOCATIONS`/`encryptCounters`/`onEncrypt`/
Shannon 엔트로피 검사/`MIN_SECRET_BYTES`/`MIN_KDF_SALT_BYTES`는 의도적으로 삭제됐다.
secret의 강도는 사용자 책임이고, 미들웨어는 "조합이 맞는지/값이 형식상 유효한지"만 본다
(현재 `validateSecret`은 non-blank만 검사). 이걸 "검증 부족"으로 오판하지 마라 — 의도된 범위다.

---

## 4. Bun 런타임 의존 동작 (핀 테스트의 존재 이유)

`Bun.CookieMap`은 인바운드 쿠키 **name과 value를 모두 percent-decode** 한다.
- name `n%41` → 키 `nA`로 디코딩됨. 그래서 우리가 방출하는 name은 `%`-free여야 라운드트립이
  성립한다(1절에서 `%`를 token 금지에서 뺀 이유와 연결됨).
- value `%C3%A9` → `é`.

이 동작이 깨지면 패키지 정합성이 무너지므로 `src/cookie-jar.spec.ts`의
**"Bun runtime behavior pins — inbound percent-decode"** describe가 이를 고정한다.
Bun 업그레이드 후 이 테스트가 깨지면 = 라운드트립 가정 재검토 신호. 지우지 마라.

malformed percent(`%XX`, `%ff`)는 해당 쿠키만 드롭하고 형제 쿠키는 보존. 같은 이름 중복은
first-occurrence-wins(`Bun.CookieMap.get` 패리티) + 손상 가드.

---

## 5. enum 결정

`sameSite` / `priority` / `algorithm`은 문자열 리터럴 유니온 → **TS string enum**으로 전환
(`SameSite`/`CookiePriority`/`SigningAlgorithm`, `src/enums.ts`). **`secure`는 enum화 안 함**
(boolean | 'auto'이라 enum 부적합 — 이 구분이 의도다). enum은 index.ts에서 export됨.

---

## 6. 정직하게 — "완벽"이라 단정할 수 없는 것 (검증자에게)

다음은 검증으로 **증명 불가**한 항목이니, 검증 결과를 "완벽 보증"으로 쓰지 마라:
- 결함 부재는 원리적으로 증명 불가(없음을 증명할 수 없다). 최대 주장 가능치는
  **"알려진 결함 0, 깔끔함"**이다.
- 6265bis-22는 **draft**다. draft 준수는 "확정 표준 준수"가 아니다.
- Bun 내장 동작 의존 → **Bun 버전 의존적**. 핀 테스트가 방어선이다.
- 성능은 측정한 범위에서만 사실이다(7절 수치). 측정 안 한 환경/입력에 대한 성능 주장 금지.

---

## 7. 현재 검증 상태 + 재현 명령

작업 디렉토리: 이 워크트리(`feat/cookie-middleware`), 패키지 경로
`packages/middlewares/cookie`. 모든 명령은 패키지 디렉토리에서 실행.

- 타입체크: `bunx tsc --noEmit -p tsconfig.json` → **0 errors**
- 테스트: `bun test` → **414 pass / 0 fail** (11 파일)
- 커버리지: `bun test --coverage` → 모든 `src/*` **100% line/func**
  - 주의: bun --coverage가 암묵적 생성자를 미커버로 세는 전역 특성 있음(메모리
    `project_bun_coverage_implicit_ctor_cap` 참조). 이 패키지는 현재 100%지만, 향후 func%
    하락 시 이 특성부터 의심하라.
- 벤치: `bun run bench` (mitata). 실측(i7-13700K / bun 1.3.14):
  serialize(no expires) ~432ns, serialize(expires) ~1.28µs, parse 5-cookie ~1.25µs,
  sign(HMAC cached) ~1.88µs, encrypt(AES-256-GCM) ~56.8µs. **이 수치는 이 머신에서만 사실.**

테스트 레이어 구조: unit(`src/*.spec.ts` colocated), integration(`test/integration`),
e2e(`test/e2e`, 실제 tck boot), conformance/security/fuzz(전용 디렉토리).
**e2e 한계**: 아웃바운드 writer는 wire로 테스트 불가 — tck에 런타임 라우트가 없어
BeforeResponse 전에 404가 난다. 이 갭은 알려진 것이며 integration 레이어가 라운드트립을 커버한다.

---

## 8. 검증 에이전트가 할 일 (제안 체크리스트)

1. 7절 3종(typecheck/test/coverage) 재현 — green 확인.
2. 1·2절 기준선이 코드에 실제로 구현됐는지 대조(특히 Expires 재출력, Max-Age≤0 거부,
   prefix cross-field, token 규칙에서 `%` 처리).
3. 2절 에러 모델이 일관되는지: 런타임 입력 실패가 throw 아닌 Result인지, boot 오류만 throw인지.
4. 3절 over-design이 다시 끼어들지 않았는지(삭제 목록 확인), secret 검증 범위가 non-blank만인지.
5. 4절 핀 테스트가 살아있고 의미 있는지.
6. 6절 한계를 결과 보고에 반영 — "완벽 보증" 표현 쓰지 말 것.
7. 독립 전수조사 + 크로스체킹 권장(이 패키지는 단독 요약 검증이 여러 번 부정확했다).

## 부록: 정리 대상 스크래치 파일

워크트리 루트의 `.baker-feature-*.md`, `STANDARDS-AUDIT.md`는 논의 과정의 스크래치다.
`STANDARDS-AUDIT.md`는 D2 철회/D3 reframe 등 정정 이력을 담고 있어 참고는 되나 정본 아님.
이 핸드오프 문서와 `CLAUDE.md`(정의)가 정본이다.
