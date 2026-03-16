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

### Phase 2: Delete Legacy

- [ ] Delete `packages/common/src/exception-filter.ts` (abstract class)
- [ ] Delete `@Catch` decorator from `packages/common/src/decorators/exception.decorator.ts`
- [ ] Remove `ExceptionFilterToken` type from `packages/common/src/interfaces.ts`
- [ ] Remove `ExceptionFilterEntry` interface from `packages/common/src/interfaces.ts`
- [ ] Update `@UseExceptionFilters` parameter type: `Array<ExceptionFilterDefinition>`
- [ ] Remove old exports from index.ts (`ExceptionFilter`, `Catch`, `ExceptionFilterToken`, `ExceptionFilterEntry`)
- [ ] Remove `ErrorToken` type from `packages/common/src/types.ts` (catch types move to `ErrorConstructorLike[]`)

### Phase 3: Adapter Runtime

- [ ] Update `Adapter` base class (`packages/common/src/adapter/adapter.ts`)
  - Add `initializePipeline(container)` — calls all factories in injection context, caches handlers
  - Replace `exceptionFilters: ExceptionFilterEntry[]` → resolved handlers
  - Update `runMiddlewares()`, `runGuards()`, `runExceptionFilters()`
  - Add `addExceptionFilters(filters: readonly ExceptionFilterDefinition[])` (replaces `addExceptionFilterEntries`)
- [ ] Update `RouteHandlerEntry` in `packages/http-adapter/src/interfaces.ts`
- [ ] Update `route-handler.ts` type guards

### Phase 4: AOT Compiler

- [ ] Update `adapter-definition-resolver.ts`
  - Delete `extractErrorFilterRefKeys` — filters are now value refs, use `extractDecoratorRefKeys`
  - Delete `findCatchDecoratorArgs` — @Catch is gone
  - Remove `kind: 'filter'` from `RouteRegistration`
- [ ] Update `manifest-generator.ts`
  - Filter registrations become `() => filterRef` (same as guard/middleware)
  - Remove filter DI provider validation
- [ ] Update `CompiledHandlerEntry` if needed

### Phase 5: Application Bootstrap

- [ ] Call `adapter.initializePipeline(container)` in `Application.executeStart()` after `runInitHooks`
- [ ] Update `HttpWorker` initialization

### Phase 6: Examples

- [ ] Rewrite `examples/src/billing/payment-error.filter.ts` → `defineExceptionFilter`
- [ ] Rewrite `examples/src/guards/auth.guard.ts` → factory pattern
- [ ] Rewrite all middleware definitions → factory pattern
- [ ] Update `@UseExceptionFilters(PaymentErrorFilter)` → `@UseExceptionFilters(paymentErrorFilter)` (value ref)
- [ ] Remove `PaymentErrorFilter` from module providers

### Phase 7: Tests

- [ ] Rewrite `define-guard.spec.ts`, `define-middleware.spec.ts` for factory pattern
- [ ] Create `define-exception-filter.spec.ts`
- [ ] Update `adapter.spec.ts`, `route-handler.spec.ts`
- [ ] Update `adapter-definition-resolver.spec.ts` — remove @Catch tests
- [ ] Update `manifest-generator.spec.ts`
- [ ] E2E: `zb build` + `zb dev` + production server + route responses

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
| Keep `runInInjectionContext` | Property initializer `inject()` calls exist in user source. Performance negligible |
| scopedKeys class reference mapping | `app.get(UsersService)` passes class references. Name-string fallback removed |
| Route-handler resolve failure → throw | Unregistered pipeline components are config errors |
| `RequestScopeContainer.set()` throws | Cross-request contamination prevention |
| Factory + closure for all pipeline components | One-time setup in injection context, zero per-request DI overhead. Consistent API |

## 5. Known Limitations

| Item | Details |
|------|---------|
| `isMiddlewareDefinition` ≡ `isGuardDefinition` | Structurally identical. Compiler key mapping is the only guarantee |
| Bun `mock.module` pollution | 5 failures combined. All pass per-file. Bun test runner limitation |
