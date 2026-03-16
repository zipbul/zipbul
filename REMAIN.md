# REMAIN.md — 수정 완료 보고

전항목 RED → GREEN 검증 완료 (2026-03-16)

## 수정 완료 항목

### TODO 1: `@UseExceptionFilters(Class)` 필터 DI 미등록 → 500 [DONE]

- `examples/src/billing/payment-error.filter.ts` — `@Injectable()` 추가, `Err<unknown>` 반환
- `packages/cli/src/compiler/generator/manifest-generator.ts` — filter 팩토리에 스코프 키 문자열 생성 `c.get('billing::PaymentErrorFilter')`
- RED: `POST /billing/charge {"amount":1500}` → 500
- GREEN: → **402** + `{"status":402,"message":"PAYMENT_REQUIRED"}`

### TODO 2: `route-handler` resolve 실패 시 silent swallow → throw [DONE]

- `packages/http-adapter/src/route-handler.ts` — `resolveErrorFilterKeys`, `resolveMiddlewareKeys`, `resolveGuardKeys` 3개 메서드에서 try/catch 제거, 실패 시 throw
- RED: 앱이 미등록 필터에도 정상 부팅
- GREEN: resolve 실패 시 부팅 중단

### TODO 3: `HttpServer.stop()` + `HttpAdapter.stop()` 단일 프로세스 shutdown [DONE]

- `packages/http-adapter/src/http-server.ts` — `stop()` 메서드 추가: `this.server.stop()`
- `packages/http-adapter/src/http-adapter.ts` — 단일 프로세스 분기: `this.httpServer.stop()`
- `examples/src/main.ts` — SIGTERM 핸들러 추가
- RED: `kill` 후 `curl localhost:5000` → 200
- GREEN: → **000** (connection refused)

### TODO 4: route-level pipeline — 스코프 키 문자열로 통일 [DONE]

- `packages/cli/src/compiler/generator/manifest-generator.ts` — `generateRouteRegistrations()`에 graph 참조 추가, `resolveScopedKey()` 메서드로 filter ref를 스코프 키로 변환
- RED: `c.get(PaymentErrorFilter_1)` (클래스 참조)
- GREEN: `c.get('billing::PaymentErrorFilter')` (스코프 키 문자열)

### TODO 5: `resolveToken()` 이름 문자열 폴백 제거 [DONE]

- `packages/core/src/injector/container.ts` — `token.name` 문자열 재시도 블록 삭제 (6줄)
- RED: 동명 AuditService에서 billing 요청 시 `[USERS]` 로그 (잘못된 인스턴스)
- GREEN: billing 요청 시 `[BILLING]` 로그 (올바른 인스턴스)

### TODO 6: `scopedKeys` 맵 이름 문자열 엔트리 + 동명 클래스 alias 충돌 수정 [DONE]

- `packages/cli/src/compiler/generator/manifest-generator.ts` — `map.set('${token}', ...)` 이름 문자열 엔트리 삭제
- scopedKeys provider alias 생성 시 `graph.classDefinitions.get(token)` 대신 `node.providers.get(token).filePath` 사용 (동명 클래스 시 올바른 파일 경로)
- RED: `map.set(AuditService_1, 'billing::AuditService')` (잘못된 alias, users 클래스가 billing에 매핑)
- GREEN: `map.set(AuditService, 'billing::AuditService')` + `map.set(AuditService_1, 'users::AuditService')`

### TODO 7: `RequestScopeContainer.set()` — 에러 throw [DONE]

- `packages/core/src/injector/request-scope-container.ts` — `throw new Error('Cannot register providers on a request-scoped container')`

### TODO 8: `Scanner.resolveDepsFor()` — `console.warn` → `this.logger.warn` [DONE]

- `packages/core/src/injector/scanner.ts` — 2개소 `console.warn` → `this.logger.warn`

### TODO 9: `Container.set()` 불필요한 팩토리 래핑 제거 [DONE]

- `packages/core/src/injector/container.ts` — `const wrapped: FactoryFn = c => factory(c)` 삭제, `factory as FactoryFn` 직접 사용

### TODO 10: 동명 클래스 추가 (Bug #5/#6 재현) [DONE]

- `examples/src/billing/audit.service.ts` — `@Injectable()` class `AuditService` (billing)
- `examples/src/users/audit.service.ts` — `@Injectable()` class `AuditService` (users)
- 각 컨트롤러에서 `inject(AuditService)` 사용

### TODO 11: Guard 예제 추가 [DONE]

- `examples/src/guards/auth.guard.ts` — `defineGuard()` 기반 인증 가드
- `UsersController.delete()` 에 `@UseGuards(authGuard)` 적용
- RED: `DELETE /users/:id` (no auth) → 204
- GREEN: → **403** (인증 헤더 없음), **204** (인증 헤더 있음)

### TODO 13: 데드코드 제거 [DONE]

- `examples/src/billing/payment-error.handler.ts` 삭제
- `examples/src/filters/http-error.handler.ts` 삭제
- `examples/src/core/config/config.service.ts` 삭제
- `examples/src/core/config/some-config.ts` 삭제

---

## E2E 검증 결과

```
TODO1 PaymentErrorFilter: 402 ✓
TODO11 Guard no_auth: 403 ✓
TODO11 Guard with_auth: 204 ✓
TODO3 Stop: 000 (refused) ✓
TODO10 AuditService: [BILLING] ✓
Sanity: posts=200 users=200 charge=200 ✓
```

## 미완료

### TODO 12: 글로벌 exception filter 등록

- `examples/src/main.ts` — `httpAdapter.addExceptionFilterEntries([...])` 로 `HttpErrorFilter` 등록
- `HttpErrorFilter`에 `@Injectable()` 추가 필요
- 현재 파일은 존재하지만 어디에도 등록되지 않음
