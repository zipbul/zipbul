# HTTP Adapter + Core 수정 완료 보고

## 실행 완료 (2026-03-16)

HTTP adapter 감사에서 발견된 전체 이슈를 7개 Phase로 나누어 수정 완료.

### 변경 요약

| Phase | 내용 | 커밋 |
|-------|------|------|
| 1 | Dead code 제거, 옵션 override 순서, `as` 단언 제거, status 로깅, TSDoc | `04473bb` |
| 2 | `ZipbulContainer.createRequestScope()`, request scope 통합 | `1bb4629` |
| 3 | `errorFilterTokens` 레거시 경로 제거 (catch-all 미사용, 명시성 원칙) | `9ee77ac` |
| 4 | `ClusterManager.wrap()` destroy/getStats 프록시 확장 | `9ee77ac` |
| 5 | 클러스터 worker manifest import 재설계 (`HttpWorkerManifest` IPC 불가 설계 제거) | `8fd515d` |
| 6 | Route-level pipeline: 컴파일러 데코레이터 키 추출 + 컨테이너 등록 + RouteHandler resolve | `b113a81`, `7b99ecc` |
| 7 | Guard AOT 와이어링: module/route 양방향 | `8e346cf`, `7b99ecc` |

### 추가 수정

| 내용 | 커밋 |
|------|------|
| `HttpServer.fetch()` finally dispose throw → 응답 유실 방지 | `d1aed24` |
| `RequestScopeContainer.dispose()` onDestroy throw → 나머지 정리 계속 | `0e563e6` |
| `@Middlewares` phase-aware route-level 추출 | `0e563e6` |
| `@Catch` catchTypes cross-file AST 추출 | `c13b542` |
| `CompiledHandlerEntry` pipeline 필드 optional 정정 + `?? []` 방어 | `c13b542` |

### 테스트

- 신규 176건 (기존 551 → 총 758건)
- 패키지별 개별 실행: 전부 0 fail
- 전체 스위트 combined: 5 fail (Bun `mock.module` 전역 오염, 격리 시 통과)

### E2E 검증 (examples)

- `zb build` → 성공 (14 handlers, 4 modules)
- `bun dist/entry.js` → 성공
- `@UseMiddlewares` class/method 레벨 → auditMiddleware, loggerMiddleware 실행
- `@UseExceptionFilters` + `@Catch(PaymentFailedError)` → 402 응답
- 일반 CRUD + validation + 404 → 정상

---

## 미검증 / 미해결

### E2E 미검증

| 항목 | 이유 |
|------|------|
| 클러스터 모드 (`workers: 2+`) | 실제 multi-process 환경 필요 |
| Request scope 격리 | request-scoped provider 사용 예제 없음 |
| `@UseGuards` route-level | 예제에 사용 사례 없음 |
| `@Middlewares` phase-aware route-level | 예제에 사용 사례 없음 |

### 알려진 제한

| 항목 | 상세 |
|------|------|
| `isMiddlewareDefinition` ≡ `isGuardDefinition` | 구조적으로 동일 (`{ handler: fn }`). 런타임 구별 불가. 컴파일러 키 매핑이 유일한 보장 |
| Bun `mock.module` 오염 | 전체 스위트 combined 실행 시 5건 fail. 파일별 격리 시 전부 pass. Bun 테스트 러너 한계 |

### 프레임워크 전체 미감사 영역

- WebSocket 등 다른 프로토콜 어댑터
- Scalar/OpenAPI 통합
- DI 컨테이너 전체 (request scope 외)
- AOT 컴파일러 전체 (route-level pipeline 외)
