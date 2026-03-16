# HTTP Adapter + Core + AOT 수정 완료 보고

## Phase 1~7 실행 완료 (2026-03-16)

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

---

## AOT 컴파일러 + Core DI 심층 감사 수정 완료 (2026-03-16)

코드베이스 전체 심층 분석에서 발견된 9건의 시스템 결함 + examples 4건 수정.

### 수정된 시스템 결함

#### 1. `@UseExceptionFilters(Class)` — 필터 DI 미등록 시 조용히 탈락

- **현상**: `PaymentErrorFilter`가 `@Injectable()` 아니고 모듈 providers에 없음. AOT가 `c.get(PaymentErrorFilter_1)` 생성 → 런타임 throw → `resolveErrorFilterKeys` catch에서 조용히 탈락 → 500
- **수정**: `PaymentErrorFilter`에 `@Injectable()` 추가. `ExceptionFilter.catch()` 반환값을 `Err<unknown>`으로 수정
- **검증**: `POST /billing/charge {"amount":1500}` → 500 → **402**

#### 2. `route-handler` resolve 실패 시 silent swallow

- **현상**: `resolveErrorFilterKeys`, `resolveMiddlewareKeys`, `resolveGuardKeys` 모두 `catch { warn }` 처리. pipeline 구성요소가 조용히 탈락
- **수정**: 3개 메서드에서 try/catch 제거. 실패 시 throw로 부팅 중단
- **대상**: `packages/http-adapter/src/route-handler.ts`

#### 3. `HttpServer.stop()` + `HttpAdapter.stop()` 단일 프로세스 graceful shutdown

- **현상**: `app.stop()` → 클러스터 모드만 처리. 단일 프로세스에서 Bun 서버 계속 listening
- **수정**: `HttpServer.stop()` 메서드 추가 (`this.server.stop()`). `HttpAdapter.stop()`에 단일 프로세스 분기 추가
- **검증**: `kill` 후 `curl` → 200 → **000** (connection refused)

#### 4. AOT route-level pipeline — 클래스 참조 대신 스코프 키 문자열

- **현상**: 생성 코드가 `c.get(PaymentErrorFilter_1)` (클래스 참조) 사용
- **수정**: `generateRouteRegistrations()`에서 `resolveScopedKey()` 메서드로 filter ref를 스코프 키 문자열로 변환
- **검증**: 생성 코드 `c.get('billing::PaymentErrorFilter')`

#### 5. `resolveToken()` 이름 문자열 폴백 제거

- **현상**: 클래스 참조 직접 조회 실패 시 `token.name` 문자열로 재시도. 동명 클래스 간 silent wrong resolution
- **수정**: `container.ts`에서 이름 폴백 블록 삭제 (6줄)
- **검증**: 동명 `AuditService` (billing/users) — billing 요청 시 `[USERS]` 로그 → **`[BILLING]` 로그**

#### 6. `scopedKeys` 맵 이름 문자열 엔트리 + 동명 클래스 alias 충돌

- **현상**: `map.set('AuditService', ...)` 이름 문자열 엔트리 last-write-wins. 동명 클래스 시 `providerRef.filePath` 대신 `classDefinitions` 사용으로 잘못된 import alias 생성
- **수정**: 이름 문자열 엔트리 삭제. scopedKeys provider alias 생성 시 `node.providers.get(token).filePath` 우선 참조
- **검증**: `map.set(AuditService, 'billing::...')` + `map.set(AuditService_1, 'users::...')` (올바른 분리)

#### 7. `RequestScopeContainer.set()` — 루트 컨테이너 오염

- **현상**: `this.parent.set(token, factory)` — request scope에서 set 호출 시 루트 컨테이너에 등록
- **수정**: `throw new Error('Cannot register providers on a request-scoped container')`

#### 8. `Scanner.resolveDepsFor()` — `console.warn`

- **현상**: JSON 로깅 모드에서 구조화된 로거 우회
- **수정**: 2개소 `console.warn` → `this.logger.warn`

#### 9. `Container.set()` 불필요한 팩토리 래핑

- **현상**: `const wrapped: FactoryFn = c => factory(c)` — 모든 팩토리에 의미 없는 래퍼
- **수정**: 래퍼 제거, `factory as FactoryFn` 직접 사용

### Examples 보강

| 항목 | 내용 |
|------|------|
| 동명 클래스 | `billing/audit.service.ts` + `users/audit.service.ts` — 동명 `AuditService` 재현 |
| Guard | `guards/auth.guard.ts` + `@UseGuards(authGuard)` on `UsersController.delete()` |
| Filter 수정 | `PaymentErrorFilter` — `@Injectable()` + `Err<unknown>` 반환 |
| Shutdown | `main.ts` SIGTERM 핸들러 추가 |
| 데드코드 삭제 | `payment-error.handler.ts`, `http-error.handler.ts`, `config.service.ts`, `some-config.ts` |

### 테스트

- 기존 758 → **783건** (신규 25건: route-handler throw, request-scope throw 등)
- 패키지별 개별 실행: 전부 0 fail
- 전체 스위트 combined: 5 fail (기존 Bun `mock.module` 전역 오염, 격리 시 통과)

### E2E 검증 (dev + production)

| 항목 | dev | prod |
|------|-----|------|
| `@UseExceptionFilters` + `@Catch(PaymentFailedError)` → 402 | **PASS** | **PASS** |
| `@UseGuards(authGuard)` no auth → 403 | **PASS** | **PASS** |
| `@UseGuards(authGuard)` with auth → 204 | **PASS** | **PASS** |
| `@UseMiddlewares` class/method → auditMiddleware, loggerMiddleware | **PASS** | **PASS** |
| 동명 `AuditService` 모듈 격리 → `[BILLING]` / `[USERS]` | **PASS** | **PASS** |
| 일반 CRUD + validation + 404 | **PASS** | **PASS** |
| Graceful shutdown → connection refused | **PASS** | **PASS** |
| `zb build` → 프로덕션 번들 | **PASS** (5 modules, 9 providers, 14 handlers) | — |

---

## 미검증 / 미해결

### E2E 미검증

| 항목 | 이유 |
|------|------|
| 클러스터 모드 (`workers: 2+`) | 실제 multi-process 환경 필요 |
| Request scope 격리 | request-scoped provider 사용 예제 없음 |
| `@Middlewares` phase-aware route-level | 예제에 사용 사례 없음 |

### 미구현

| 항목 | 상세 |
|------|------|
| `@UseExceptionFilters(Class)` 빌드 타임 검증 | 미등록 filter 클래스를 `DiagnosticError`로 잡는 기능. 현재는 부팅 시 throw로 감지 |
| `inject()` 타겟 빌드 타임 검증 | 미등록 프로바이더를 `DiagnosticError`로 잡는 기능 |
| 글로벌 exception filter 사용자 API | `addExceptionFilterEntries`는 내부 API. 사용자 facing `addExceptionFilters` 미구현. 모듈 레벨 `defineModule({ adapters: [...] })` 경로는 존재 |

### 알려진 제한

| 항목 | 상세 |
|------|------|
| `isMiddlewareDefinition` ≡ `isGuardDefinition` | 구조적으로 동일 (`{ handler: fn }`). 런타임 구별 불가. 컴파일러 키 매핑이 유일한 보장 |
| Bun `mock.module` 오염 | 전체 스위트 combined 실행 시 5건 fail. 파일별 격리 시 전부 pass. Bun 테스트 러너 한계 |

---

## 설계 결정 기록

| 결정 | 근거 |
|------|------|
| `runInInjectionContext` 유지 | 프로퍼티 이니셜라이저의 `inject()` 호출은 사용자 원본 소스에 존재하며, 소스 재작성 없이는 런타임에 실행될 수밖에 없다. 성능 영향 무시 가능 (AsyncLocalStorage O(1), <1μs) |
| scopedKeys 클래스 참조 직접 매핑 유지 | `app.get(UsersService)` 같은 사용자 API가 클래스 참조를 전달한다. 이름 문자열 폴백만 제거 |
| scopedKeys 이름 문자열 엔트리 제거 | 동명 클래스 시 last-write-wins 충돌. 클래스 참조 엔트리만으로 충분 |
| route-handler resolve 실패 시 throw | 미등록 pipeline 구성요소는 설정 오류. 조용히 탈락보다 부팅 실패가 올바름 |
| `RequestScopeContainer.set()` throw | request scope에서 루트 컨테이너 변경은 cross-request 오염. 명시적 거부 |
| route-level filter 스코프 키 문자열 생성 | AOT가 빌드 타임에 모듈 소속을 알고 있으므로 런타임 `resolveToken()` 경유 불필요 |
