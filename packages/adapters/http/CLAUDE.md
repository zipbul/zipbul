# @zipbul/http-adapter

**Bun.serve 위에서 동작하는 HTTP 프로토콜 어댑터.** zipbul 코어의 `Adapter` 계약(`defineAdapter`)을 구현하여 HTTP 요청/응답의 **의미론(semantics)**을 zipbul 파이프라인에 매핑한다.

- **wire-level 메시지 파싱은 Bun에 위임**하고, 어댑터는 그 위의 의미론·응답 정합·요청 해석·라우팅·스트리밍·신뢰 결정·lifecycle을 책임진다. wire 파서를 재구현하지 않는다.
- CORS·보안헤더·압축·쿠키·query·multipart·rate-limit 등 **정책은 별도 미들웨어 패키지**가 담당한다(어댑터 core에 넣지 않는다).

파이프라인 (phase = 미들웨어 슬롯, `[step]` = 어댑터 내장 단계):
```
OnRequest → [ResolveRoute] → BeforeParse → [ParseBody] → BeforeValidate → [Validation/Guard]
  → BeforeHandle → [Handler] → AfterHandle → [WriteResponse] → [Serialize] → BeforeResponse → AfterResponse
```
정확한 이름·순서는 `src/enums/http-adapter-phase.ts`·`http-adapter-step.ts`가 정본이다.

---

HTTP 서버로서 따라야 할 **표준·코어 규칙·책임 경계·결함 판정 기준**은 **`SPEC.md`** 참조.
