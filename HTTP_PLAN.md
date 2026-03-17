# Remaining Work

## E2E Verification

| Item | Reason |
|------|--------|
| Cluster mode (`workers: 2+`) | Requires real multi-process environment |
| Request scope isolation | No request-scoped provider usage in examples |

## Design Decision Log

| Decision | Rationale |
|----------|-----------|
| Keep `runInInjectionContext` | Property initializer `inject()` calls exist in user source. Performance negligible |
| Factory + closure for pipeline | One-time setup in injection context, zero per-request overhead. Consistent API across guard/middleware/exception filter |
| Two init paths (global + route-level) | Global pipeline initialized in `initializePipeline()`. Route-level initialized in `route-handler.ts` during registration. Both use same `runInInjectionContext` mechanism |
| `catchTypes` on definition object | `defineExceptionFilter([ExceptionClass], factory)` — catch types are a first-class parameter, not a decorator. Cannot be omitted. Type-safe |
| Route-level exception filter no longer DI-managed | Exception filters are values (like guards/middleware). No `@Injectable`, no module providers registration. Simplifies AOT |
| `Error` vs `Exception` terminology | `Error` = Result pattern failure (`Err<E>`). `Exception` = thrown exceptions caught by pipeline (`ExceptionFilter`) |

## Known Limitations

| Item | Details |
|------|---------|
| Bun `mock.module` pollution | 5 failures when running full test suite combined. All pass per-file. Bun test runner limitation |
