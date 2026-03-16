# HTTP Adapter + Core + AOT Remaining Issues

## E2E Not Yet Verified

| Item | Reason |
|------|--------|
| Cluster mode (`workers: 2+`) | Requires real multi-process environment |
| Request scope isolation | No request-scoped provider usage in examples |
| `@Middlewares` phase-aware route-level | No usage examples |

## Not Yet Implemented

| Item | Details |
|------|---------|
| Global exception filter user API | `addExceptionFilterEntries` is internal API. User-facing `addExceptionFilters` not implemented. Module-level `defineModule({ adapters: [...] })` path exists |

## Known Limitations

| Item | Details |
|------|---------|
| `isMiddlewareDefinition` ≡ `isGuardDefinition` | Structurally identical (`{ handler: fn }`). Cannot distinguish at runtime. Compiler key mapping is the only guarantee |
| Bun `mock.module` pollution | 5 failures when running full suite combined. All pass when run per-file. Bun test runner limitation |

## Design Decision Log

| Decision | Rationale |
|----------|-----------|
| Keep `runInInjectionContext` | Property initializer `inject()` calls exist in user source and must execute at runtime without source rewriting. Performance impact negligible (AsyncLocalStorage O(1), <1μs) |
| Keep scopedKeys direct class reference mapping | User API like `app.get(UsersService)` passes class references. Only removed name-string fallback |
| Remove scopedKeys name-string entries | Same-named classes cause last-write-wins collision. Class reference entries are sufficient |
| Throw on route-handler resolve failure | Unregistered pipeline components are configuration errors. Boot failure is correct over silent omission |
| `RequestScopeContainer.set()` throws | Mutating root container from request scope causes cross-request contamination. Explicit rejection |
| Generate route-level filter scoped key strings | AOT knows module membership at build time, so runtime `resolveToken()` bypass is unnecessary |
