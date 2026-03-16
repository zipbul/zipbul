# Pipeline Factory Pattern Refactor

## 1. Design

Unify guard, middleware, and exception filter into a single **factory + closure** pattern.
Factory runs once in injection context at boot. Handler is cached. Per-request calls the cached handler only.

### 1.1 User API

```typescript
// Guard
export const authGuard = defineGuard(() => {
  const authService = inject(AuthService);
  return (ctx) => {
    if (!authService.verify(ctx)) return err({ status: 401 });
  };
});

// Middleware
export const auditMiddleware = defineMiddleware(() => {
  const logger = new Logger('Audit');
  return (ctx) => { logger.info(`[AUDIT] ${ctx.getType()}`); };
});

// Exception Filter (replaces class-based @Catch + ExceptionFilter)
export const paymentErrorFilter = defineExceptionFilter(
  [PaymentFailedError],
  () => {
    const logger = new Logger('PaymentErrorFilter');
    return (exception: PaymentFailedError, ctx) => {
      logger.error(`[BILLING ERROR] ${exception.message}`);
      return err({ status: 402, message: 'PAYMENT_REQUIRED' });
    };
  },
);

// Adapter-specific (all three support)
export const httpGuard = defineGuard([HttpAdapter], () => (ctx) => { /* ... */ });
```

### 1.2 Types

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
type ExceptionFilterFactory<TException = unknown> = () => ExceptionFilterHandlerFn<TException>;
type ExceptionFilterHandlerFn<TException = unknown> = (exception: TException, ctx: Context) => Err<unknown> | Promise<Err<unknown>>;
type ExceptionConstructorLike = abstract new (...args: readonly unknown[]) => Error;
interface ExceptionFilterDefinition {
  readonly factory: ExceptionFilterFactory;
  readonly catchTypes: readonly ExceptionConstructorLike[];
  readonly adapters?: readonly AdapterClass[];
}
```

### 1.3 Runtime: Two Initialization Paths

#### Path A: Global pipeline (module-level `defineModule({ adapters })` + `app.attach()` runtime registration)

```
Application.executeStart()
  → runInitHooks(container)
  → for each adapter:
      adapter.addMiddlewares(hook, middlewareDefinitions)
      adapter.addExceptionFilters(filterDefinitions)
      adapter.addGuards(guardDefinitions)
      adapter.initializePipeline(container)  ← NEW: calls all factories in injection context
  → adapter.start(context)
```

`initializePipeline(container)`:
- Iterates all registered definitions
- Calls `runInInjectionContext(container, def.factory)` for each → produces handler
- Stores resolved handlers in internal arrays (e.g. `resolvedGuards`, `resolvedMiddlewares`, `resolvedFilters`)
- After this point, definitions are discarded — only cached handlers remain

#### Path B: Route-level pipeline (`@UseGuards`, `@UseMiddlewares`, `@UseExceptionFilters`)

Current AOT generates:
```typescript
// Guard/Middleware (value ref — unchanged)
__container__.set('__route_gd__:Controller.method:mtd:0', () => authGuard);

// Exception filter (class ref — CHANGES)
// Before: __container__.set('key', (c) => ({ filter: c.get('billing::PaymentErrorFilter'), catchTypes: [PaymentFailedError] }));
// After:  __container__.set('key', () => paymentErrorFilter);
```

`route-handler.ts` resolves these keys during `registerFromHandlerIndex()`.
After resolve, handlers are NOT yet initialized (still `{ factory: fn }`).

**Factory initialization for route-level**: `route-handler.ts` must call factories during registration, NOT per-request:
```typescript
// In registerFromHandlerIndex, after resolving from container:
const guardDef = container.get(key) as GuardDefinition;
const resolvedHandler = runInInjectionContext(container, guardDef.factory);
// Store resolvedHandler in RouteHandlerEntry, not the definition
```

For exception filters, `catchTypes` comes from the definition object itself (`def.catchTypes`).
No more AOT-generated `catchTypes` arrays in container registration code.

### 1.4 Per-Request Execution (No Change in Structure)

```
dispatchRequest(context)
  → runMiddlewares(OnReceive)       → resolvedHandler(ctx)
  → parseInput
  → runMiddlewares(PostParseData)   → resolvedHandler(ctx)
  → runGuards                       → resolvedHandler(ctx)
  → runMiddlewares(PreHandle)       → resolvedHandler(ctx)
  → resolveHandler → handler result
  → handleResult
  → runMiddlewares(OnComplete)      → resolvedHandler(ctx)
```

Exception filters: `runExceptionFilters(exception, ctx)` iterates resolved exception filters, checks `catchTypes`, calls `resolvedHandler(exception, ctx)`.

---

## 2. Structural Decisions

### Terminology: `Error` vs `Exception`

`Error` in Zipbul refers to the `Result<T, E>` failure value (`Err<E>`).
`Exception` refers to thrown exceptions caught by the pipeline (`ExceptionFilter`).

Current codebase has mixed terminology. Unify during this refactor:

| Current | Fix |
|---------|-----|
| `ErrorToken` | Remove (replaced by `ExceptionConstructorLike` directly) |
| `ErrorConstructorLike` | `ExceptionConstructorLike` |
| `errorFilterKeys` (CompiledHandlerEntry) | `exceptionFilterKeys` |
| `errorFilters` (AdapterModuleConfig, RuntimeContext) | `exceptionFilters` |
| `routeErrorFilters` (HttpContext) | `routeExceptionFilters` |
| `__route_ef__` (AOT key prefix) | Keep as-is (internal, abbreviation) |
| `ExceptionFilter`, `ExceptionFilterDefinition` | Already correct |

### `isMiddlewareDefinition ≡ isGuardDefinition` (Still Unresolved)

Factory pattern changes shape from `{ handler }` to `{ factory }`, but guard and middleware remain structurally identical. After factory resolution, both become bare handler functions.

Options:
1. Add discriminant field: `{ kind: 'guard', factory }` / `{ kind: 'middleware', factory }`
2. Keep as-is — compiler key prefix (`__route_gd__` vs `__route_mw__`) is the only differentiator

Decision needed before implementation.

### `@Middlewares` Phase-Aware Decorator

`@Middlewares({ OnReceive: [mw1] })` and `@Middlewares('OnReceive', [mw1])` use `extractMiddlewaresDecoratorRefKeys` in AOT.
These extract middleware identifiers the same way as `@UseMiddlewares`. Factory pattern does not affect this — the extracted value is still an identifier reference.
AOT code generation: `__container__.set('__route_mw__:...', () => mw1)` — identical to `@UseMiddlewares`.

No additional changes needed.

---

## 3. Implementation Tasks

**All phases are atomic. Intermediate states will not compile.**

### Phase 1: Common Package

#### New
- [ ] `packages/common/src/define-exception-filter.ts` — `defineExceptionFilter(catchTypes, factory)` + `defineExceptionFilter(catchTypes, adapters, factory)` overloads. Returns frozen `ExceptionFilterDefinition`.

#### Modify
- [ ] `packages/common/src/define-guard.ts`
  - `GuardDefinition.handler` → `GuardDefinition.factory`
  - `GuardHandlerFn` stays (it's the handler type, not the factory type)
  - Add `GuardFactory = () => GuardHandlerFn`
  - `defineGuard(factory)` and `defineGuard(adapters, factory)`
- [ ] `packages/common/src/define-middleware.ts` — same changes as guard
- [ ] `packages/common/src/interfaces.ts`
  - Remove `ExceptionFilterToken`
  - Remove `ExceptionFilterEntry`
  - Update `@UseExceptionFilters` param type → `ExceptionFilterDefinition[]`
  - Rename `AdapterModuleConfig.errorFilters` → `exceptionFilters`, type: `ExceptionFilterDefinition[]`
- [ ] `packages/common/src/types.ts`
  - Rename `ErrorConstructorLike` → `ExceptionConstructorLike`
  - Remove `ErrorToken` (replaced by `ExceptionConstructorLike` used directly)
- [ ] `packages/common/src/decorators/exception.decorator.ts`
  - Remove `Catch` decorator entirely
  - Update `UseExceptionFilters` parameter: `...filters: readonly ExceptionFilterDefinition[]`
- [ ] `packages/common/src/decorators/index.ts`
  - Remove `Catch` re-export
- [ ] `packages/common/src/index.ts`
  - Remove: `ExceptionFilter`, `Catch`, `ExceptionFilterToken`, `ExceptionFilterEntry`, `ErrorToken`, `ErrorConstructorLike`
  - Add: `defineExceptionFilter`, `ExceptionFilterDefinition`, `ExceptionFilterFactory`, `ExceptionFilterHandlerFn`, `ExceptionConstructorLike`

#### Delete
- [ ] `packages/common/src/exception-filter.ts`

### Phase 2: Adapter Runtime

- [ ] `packages/common/src/adapter/adapter.ts`
  - Add resolved handler types: `ResolvedGuard`, `ResolvedMiddleware`, `ResolvedExceptionFilter`
  - Change protected fields to store definitions (pre-init) and resolved handlers (post-init)
  - `addMiddlewares(hook, defs)` — stores definitions
  - `addExceptionFilters(filters)` — replaces `addExceptionFilterEntries`. Stores definitions
  - `addGuards(guards)` — stores definitions
  - `initializePipeline(container: ZipbulContainer)` — calls all factories via `runInInjectionContext`, stores resolved handlers
  - `runMiddlewares()` — uses resolved handlers
  - `runGuards()` — uses resolved handlers
  - `runExceptionFilters()` — uses resolved handlers + `catchTypes` from definition
  - `matchesExceptionFilter()` — adapts to new resolved type
- [ ] `packages/http-adapter/src/interfaces.ts`
  - `RouteHandlerEntry.middlewares` → resolved handler functions
  - `RouteHandlerEntry.errorFilters` → rename to `exceptionFilters` + type `{ handler: fn, catchTypes: ExceptionConstructorLike[] }[]`
  - `RouteHandlerEntry.guards` → resolved handler functions
- [ ] `packages/http-adapter/src/route-handler.ts`
  - `resolveMiddlewareKeys()` — resolve from container, call factory, return handler
  - `resolveGuardKeys()` — same
  - `resolveExceptionFilterKeys()` — resolve from container, call factory, extract catchTypes
  - Type guards: `isGuardDefinition` checks `factory` field, `isExceptionFilterDefinition` checks `factory` + `catchTypes`
  - Needs access to container for `runInInjectionContext` in factory calls
- [ ] `packages/http-adapter/src/http-context.ts`
  - Rename `routeErrorFilters` → `routeExceptionFilters`
  - Type: `readonly ExceptionFilterEntry[]` → resolved exception filter type
- [ ] `packages/http-adapter/src/http-adapter.ts`
  - `runExceptionFilters()` override — adapt to resolved exception filter type
- [ ] `packages/http-adapter/src/types.ts`
  - Remove `ExceptionFilter` import if present

### Phase 3: AOT Compiler

- [ ] `packages/cli/src/compiler/analyzer/adapter-definition-resolver.ts`
  - Delete `extractErrorFilterRefKeys()` — replaced by `extractDecoratorRefKeys('UseExceptionFilters', ...)`
  - Delete `findCatchDecoratorArgs()` — @Catch is gone
  - Remove `kind: 'filter'` from `RouteRegistration` interface and all usages
  - `buildHandlerIndex`: exception filter keys now use same extraction as guard/middleware
- [ ] `packages/cli/src/compiler/analyzer/interfaces.ts`
  - Remove `catchTypeValues` from `RouteRegistration`
  - Remove `'filter'` from `kind` union
  - Rename `errorFilters` → `exceptionFilters` in `ClassMetadata` (also `ErrorFilterUsage` type)
  - Rename `errorFilterKeys` → `exceptionFilterKeys` in `HandlerIndexEntry`
- [ ] `packages/cli/src/compiler/analyzer/ast-parser.ts`
  - Rename `errorFilters` variable/field references → `exceptionFilters` (L888, 979, 1157, 1161, 1162, 1216, 1256)
  - Rename `extractErrorFiltersFromConfigure` → `extractExceptionFiltersFromConfigure`
- [ ] `packages/cli/src/compiler/generator/manifest-generator.ts`
  - `generateRouteRegistrations()`: all registrations generate `() => ref` (no more exception filter-specific `(c) => ({ filter: c.get(...), catchTypes: [...] })`)
  - Remove `resolveScopedKey()` for exception filters
  - Remove C-1 exception filter DI provider validation (exception filters are no longer DI-managed)
- [ ] `packages/common/src/adapter/compiled-handler.ts`
  - Rename `errorFilterKeys` → `exceptionFilterKeys`
- [ ] `packages/cli/src/compiler/generator/injector-generator.ts`
  - Rename `errorFilters` → `exceptionFilters` in adapter config serialization (line 492-493)

### Phase 4: Application Bootstrap

- [ ] `packages/core/src/application/application.ts`
  - In `executeStart()`: after registering global pipeline, call `entry.adapter.initializePipeline(this.container)` before `adapter.start()`
  - Rename `config.errorFilters` → `config.exceptionFilters`, type: `ExceptionFilterDefinition[]`
- [ ] `packages/core/src/runtime/interfaces.ts`
  - Rename `AdapterMiddlewareConfig.errorFilters` → `exceptionFilters`, type: `readonly ExceptionFilterDefinition[]`
- [ ] `packages/http-adapter/src/http-worker.ts`
  - Call `initializePipeline(container)` after registering pipeline components
- [ ] `packages/http-adapter/src/http-adapter.ts`
  - Route-level exception filter handling in `resolveHandler` / pipeline execution

### Phase 5: Examples

- [ ] `examples/src/billing/payment-error.filter.ts` → `defineExceptionFilter([PaymentFailedError], () => { ... })`
- [ ] `examples/src/filters/http-error.filter.ts` → `defineExceptionFilter([], () => { ... })` (catch-all, empty catchTypes)
- [ ] `examples/src/guards/auth.guard.ts` → `defineGuard(() => (ctx) => { ... })`
- [ ] `examples/src/middleware/logger.middleware.ts` → `defineMiddleware(() => (ctx) => { ... })`
- [ ] `examples/src/middleware/request-timing.middleware.ts` → factory returns `defineMiddleware([HttpAdapter], () => (ctx) => { ... })`
- [ ] `examples/src/billing/audit.middleware.ts` → `defineMiddleware(() => (ctx) => { ... })`
- [ ] `examples/src/billing/billing.controller.ts` → `@UseExceptionFilters(paymentErrorFilter)` (value ref, lowercase)
- [ ] Remove `PaymentErrorFilter` from module providers (no longer DI-managed)
- [ ] Remove `@Injectable()` import where no longer needed

### Phase 6: Tests

- [ ] Rewrite `packages/common/src/define-guard.spec.ts` — factory pattern
- [ ] Rewrite `packages/common/src/define-middleware.spec.ts` — factory pattern
- [ ] Create `packages/common/src/define-exception-filter.spec.ts`
- [ ] Update `packages/common/src/adapter/adapter.spec.ts` — `initializePipeline`, resolved handlers
- [ ] Update `packages/http-adapter/src/route-handler.spec.ts` — factory resolution
- [ ] Update `packages/cli/src/compiler/analyzer/adapter-definition-resolver.spec.ts` — remove @Catch tests, exception filter uses `extractDecoratorRefKeys`
- [ ] Update `packages/cli/src/compiler/generator/manifest-generator.spec.ts` — unified route registration
- [ ] Update `packages/http-adapter/src/http-adapter.spec.ts` — `errorFilters` → `exceptionFilters` in route entry test data
- [ ] Update `packages/http-adapter/src/http-worker.spec.ts` — `addExceptionFilterEntries` → `addExceptionFilters`, `errorFilters` → `exceptionFilters`
- [ ] Update `packages/core/src/application/application.spec.ts` — `addExceptionFilterEntries` → `addExceptionFilters`, `errorFilters` → `exceptionFilters`
- [ ] Update `docs/30_SPEC/common/declarations.spec.md` — ExceptionFilter → defineExceptionFilter, remove @Catch
- [ ] Update `docs/30_SPEC/module-system/adapter-config.spec.md` — ExceptionFilter references
- [ ] E2E: `zb build` + `zb dev` + production server + all routes

---

## 4. E2E Verification (Carried Over)

| Item | Reason |
|------|--------|
| Cluster mode (`workers: 2+`) | Requires real multi-process environment |
| Request scope isolation | No request-scoped provider usage in examples |
| `@Middlewares` phase-aware route-level | No usage examples |

## 5. Design Decision Log

| Decision | Rationale |
|----------|-----------|
| Keep `runInInjectionContext` | Property initializer `inject()` calls exist in user source. Performance negligible |
| Factory + closure for pipeline | One-time setup in injection context, zero per-request overhead. Consistent API across guard/middleware/exception filter |
| Two init paths (global + route-level) | Global pipeline initialized in `initializePipeline()`. Route-level initialized in `route-handler.ts` during registration. Both use same `runInInjectionContext` mechanism |
| `catchTypes` on definition object | `defineExceptionFilter([ExceptionClass], factory)` — catch types are a first-class parameter, not a decorator. Cannot be omitted. Type-safe |
| Route-level exception filter no longer DI-managed | Exception filters are values (like guards/middleware). No `@Injectable`, no module providers registration. Simplifies AOT |

## 6. Known Limitations

| Item | Details |
|------|---------|
| Guard ≡ Middleware shape | `{ factory, adapters? }` identical. Compiler key prefix is the only differentiator. Consider adding `kind` discriminant |
| Bun `mock.module` pollution | 5 failures combined. All pass per-file. Bun test runner limitation |
