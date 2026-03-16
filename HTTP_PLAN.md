# Pipeline Factory Pattern Refactor + Remaining Work

## 1. Pipeline Factory Pattern (Breaking Change)

Unify guard, middleware, and exception filter into a single **factory + closure** pattern.
Eliminates class-based ExceptionFilter, @Catch, @Injectable for filters, and all cross-file AST extraction.

### 1.1 New API Design

```typescript
// Guard (factory runs once in injection context, handler runs per-request)
export const authGuard = defineGuard(() => {
  const authService = inject(AuthService);
  return (ctx) => {
    if (!authService.verify(ctx)) return err({ status: 401 });
  };
});

// Middleware (same pattern)
export const auditMiddleware = defineMiddleware(() => {
  const logger = new Logger('Audit');
  return (ctx) => {
    logger.info(`[AUDIT] ${ctx.getType()}`);
  };
});

// Exception Filter (new — replaces class-based pattern)
export const paymentErrorFilter = defineExceptionFilter(
  [PaymentFailedError],
  () => {
    const logger = new Logger('PaymentErrorFilter');
    const alertService = inject(AlertService);
    return (error: PaymentFailedError, ctx) => {
      logger.error(`[BILLING ERROR] ${error.message}`);
      alertService.notify(error);
      return err({ status: 402, message: 'PAYMENT_REQUIRED' });
    };
  },
);

// Adapter-specific variant (all three support this)
export const httpGuard = defineGuard([HttpAdapter], () => {
  return (ctx) => { /* ... */ };
});
```

### 1.2 Type Definitions

```typescript
// Guard
type GuardFactory = () => GuardHandlerFn;
type GuardHandlerFn = (ctx: Context) => Result<void, unknown> | ResultAsync<void, unknown>;
interface GuardDefinition {
  readonly factory: GuardFactory;
  readonly adapters?: readonly AdapterClass[];
}

// Middleware
type MiddlewareFactory = () => MiddlewareHandlerFn;
type MiddlewareHandlerFn = (ctx: Context) => Result<void, unknown> | ResultAsync<void, unknown>;
interface MiddlewareDefinition {
  readonly factory: MiddlewareFactory;
  readonly adapters?: readonly AdapterClass[];
}

// Exception Filter
type ExceptionFilterFactory<TError = unknown> = () => ExceptionFilterHandlerFn<TError>;
type ExceptionFilterHandlerFn<TError = unknown> = (error: TError, ctx: Context) => Err<unknown> | Promise<Err<unknown>>;
interface ExceptionFilterDefinition {
  readonly factory: ExceptionFilterFactory;
  readonly catchTypes: readonly ErrorConstructorLike[];
  readonly adapters?: readonly AdapterClass[];
}
```

### 1.3 Runtime: Factory Initialization

Adapter `start()` calls each factory once inside `runInInjectionContext` to produce cached handlers:

```typescript
// In adapter initialization (before accepting requests)
const resolvedGuards = guardDefinitions.map(def => ({
  handler: runInInjectionContext(container, def.factory),
  adapters: def.adapters,
}));
```

Per-request: only calls `handler(ctx)` — no factory, no inject(), no stack overhead.

---

## 2. Implementation Tasks

### Phase 1: Core Types & Functions

- [ ] Create `defineExceptionFilter()` in `packages/common/src/define-exception-filter.ts`
  - Signature: `defineExceptionFilter(catchTypes, factory)` and `defineExceptionFilter(catchTypes, adapters, factory)`
  - Returns frozen `ExceptionFilterDefinition`
- [ ] Change `GuardDefinition.handler` → `GuardDefinition.factory` in `packages/common/src/define-guard.ts`
  - Update `defineGuard()` to accept factory `() => handler` instead of direct handler
- [ ] Change `MiddlewareDefinition.handler` → `MiddlewareDefinition.factory` in `packages/common/src/define-middleware.ts`
  - Update `defineMiddleware()` to accept factory `() => handler` instead of direct handler
- [ ] Export new types from `packages/common/src/index.ts`
  - `ExceptionFilterDefinition`, `ExceptionFilterFactory`, `ExceptionFilterHandlerFn`
  - `defineExceptionFilter`

### Phase 2: Delete Legacy

- [ ] Delete `packages/common/src/exception-filter.ts` (abstract class)
- [ ] Delete `@Catch` decorator from `packages/common/src/decorators/exception.decorator.ts`
- [ ] Remove `ExceptionFilterToken` type from `packages/common/src/interfaces.ts` (replace with `ExceptionFilterDefinition`)
- [ ] Remove `ExceptionFilterEntry` interface from `packages/common/src/interfaces.ts`
- [ ] Update `@UseExceptionFilters` parameter type: `Array<ExceptionFilterDefinition>`
- [ ] Remove `ExceptionFilter`, `Catch`, `ExceptionFilterToken`, `ExceptionFilterEntry` exports from index.ts
- [ ] Remove `ErrorToken` type from `packages/common/src/types.ts` (catch types are now `ErrorConstructorLike[]`)

### Phase 3: Adapter Runtime

- [ ] Update `Adapter` base class (`packages/common/src/adapter/adapter.ts`)
  - Change `exceptionFilters: ExceptionFilterEntry[]` → `exceptionFilters: ResolvedExceptionFilter[]`
  - Change `guardDefinitions: GuardDefinition[]` → `resolvedGuards: ResolvedGuard[]`
  - Change `middlewareRegistry` values from `MiddlewareDefinition[]` → `ResolvedMiddleware[]`
  - Add `initializePipeline(container)` method that calls all factories in injection context
  - Update `runMiddlewares()` to call `resolved.handler(ctx)` instead of `def.handler(ctx)`
  - Update `runGuards()` same
  - Update `runExceptionFilters()` to use `resolved.handler(error, ctx)` + `resolved.catchTypes`
  - Update `matchesExceptionFilter()` to use `ResolvedExceptionFilter`
  - Update `addMiddlewares()`, `addGuards()` to accept definitions, resolve in `initializePipeline()`
  - Add `addExceptionFilters(filters: readonly ExceptionFilterDefinition[])` (replaces `addExceptionFilterEntries`)
- [ ] Update `RouteHandlerEntry` in `packages/http-adapter/src/interfaces.ts`
  - `middlewares` → resolved handler functions
  - `errorFilters` → resolved filter entries
  - `guards` → resolved handler functions
- [ ] Update `route-handler.ts` type guards (`isMiddlewareDefinition`, `isExceptionFilterEntry`, `isGuardDefinition`)

### Phase 4: AOT Compiler

- [ ] Update `adapter-definition-resolver.ts`
  - `extractDecoratorRefKeys` — no change needed (still extracts identifier refs)
  - Delete `extractErrorFilterRefKeys` — filters are now value refs like guards, use `extractDecoratorRefKeys`
  - Delete `findCatchDecoratorArgs` — no longer needed (@Catch is gone)
  - Remove filter-specific `kind: 'filter'` from `RouteRegistration` — all pipeline refs are `kind: 'ref'`
- [ ] Update `manifest-generator.ts`
  - `generateRouteRegistrations` — filter registrations use `() => filterRef` (same as guard/middleware), not `(c) => ({ filter: c.get(...), catchTypes: [...] })`
  - Remove filter DI provider validation (C-1) — filters are values, not DI-managed
  - Remove `resolveScopedKey` for filters
- [ ] Update `injector-generator.ts` — remove any filter-specific DI wiring
- [ ] Update `CompiledHandlerEntry` (`packages/common/src/adapter/compiled-handler.ts`)
  - `errorFilterKeys` behavior unchanged (still container keys for route-level definitions)

### Phase 5: Application Bootstrap

- [ ] Update `Application.executeStart()` in `packages/core/src/application/application.ts`
  - After `runInitHooks`, call `adapter.initializePipeline(container)` for each adapter
  - This resolves all factories in injection context before accepting requests
- [ ] Update `HttpWorker` initialization to call `initializePipeline`
- [ ] Update runtime context wiring

### Phase 6: Examples

- [ ] Rewrite `examples/src/billing/payment-error.filter.ts`
  - From: `@Injectable() @Catch(PaymentFailedError) class extends ExceptionFilter`
  - To: `defineExceptionFilter([PaymentFailedError], () => { ... })`
- [ ] Rewrite `examples/src/guards/auth.guard.ts`
  - From: `defineGuard((ctx) => { ... })`
  - To: `defineGuard(() => (ctx) => { ... })`
- [ ] Rewrite all middleware definitions
  - `logger.middleware.ts`, `request-timing.middleware.ts`, `audit.middleware.ts`
  - From: `defineMiddleware((ctx) => { ... })`
  - To: `defineMiddleware(() => (ctx) => { ... })`
- [ ] Update `@UseExceptionFilters(PaymentErrorFilter)` → `@UseExceptionFilters(paymentErrorFilter)` (value ref)
- [ ] Remove `PaymentErrorFilter` from module providers (no longer DI-managed)

### Phase 7: Tests

- [ ] Rewrite `packages/common/src/define-guard.spec.ts` for factory pattern
- [ ] Rewrite `packages/common/src/define-middleware.spec.ts` for factory pattern
- [ ] Create `packages/common/src/define-exception-filter.spec.ts`
- [ ] Update `packages/common/src/adapter/adapter.spec.ts` for resolved handlers
- [ ] Update `packages/http-adapter/src/route-handler.spec.ts`
- [ ] Update `packages/cli/src/compiler/analyzer/adapter-definition-resolver.spec.ts`
  - Remove @Catch-related tests
  - Update filter extraction tests
- [ ] Update `packages/cli/src/compiler/generator/manifest-generator.spec.ts`
- [ ] E2E: `zb build` + `zb dev` + production server + route responses

### Phase 8: Cleanup

- [ ] Delete `BUILD_TIME_VALIDATION.md` (all items implemented, tracked in git)
- [ ] Delete `REMAIN.md` (all TODOs done, replaced by this plan)
- [ ] Delete `RULE_REPORT.md` if fully superseded by CLAUDE.md
- [ ] Update `HTTP_PLAN.md` → remove completed items, keep only active plan

---

## 3. E2E Verification (Carried Over)

| Item | Reason |
|------|--------|
| Cluster mode (`workers: 2+`) | Requires real multi-process environment |
| Request scope isolation | No request-scoped provider usage in examples |
| `@Middlewares` phase-aware route-level | No usage examples |

## 4. Design Decision Log

| Decision | Rationale |
|----------|-----------|
| Keep `runInInjectionContext` | Property initializer `inject()` calls exist in user source. Performance negligible (AsyncLocalStorage O(1), <1μs) |
| scopedKeys class reference mapping | `app.get(UsersService)` passes class references. Name-string fallback removed |
| Route-handler resolve failure → throw | Unregistered pipeline components are config errors. Boot failure over silent omission |
| `RequestScopeContainer.set()` throws | Cross-request contamination prevention |
| Factory + closure for all pipeline components | One-time setup in injection context, zero per-request DI overhead. Consistent API across guard/middleware/filter |

## 5. Known Limitations

| Item | Details |
|------|---------|
| `isMiddlewareDefinition` ≡ `isGuardDefinition` | Structurally identical. Compiler key mapping is the only guarantee |
| Bun `mock.module` pollution | 5 failures combined. All pass per-file. Bun test runner limitation |
