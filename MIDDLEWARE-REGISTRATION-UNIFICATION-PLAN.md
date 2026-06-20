# Middleware / Guard / ExceptionFilter Registration Unification

**Goal:** Remove the runtime `add*` registration family and make **two declarative paths the only ways** to register a middleware/guard/exception-filter:

1. **`@UseMiddlewares` / `@UseGuards` / `@UseExceptionFilters`** — controller/handler-scoped (per-route).
2. **Module config** — `defineModule({ adapters: [{ adapter, name?, middlewares, guards, exceptionFilters }] })` — adapter/global-scoped (per-instance via `name`).

Runtime ad-hoc registration is the antithesis of the framework's AOT model (`defineMiddleware` is a "static marker for the AOT compiler"; `@UseMiddlewares` is a no-op resolved at build; the compiled registry serializes refs to NAME strings). Declarative-only matches the AOT norm (Angular/Nest/Spring-AOT reject runtime interceptor/guard registration).

**Review status:** grounded in (a) 3-lens edge-case review (multi-instance/ordering, runtime/conditional/dynamic, const-ref/tests/library) and (b) 2 of 3 plan-document reviews (completeness, phase-ordering). **The 3rd plan review (feasibility / cost-benefit / right-sizing) did NOT complete — a cost/benefit verdict on the whole 7-phase project is still OUTSTANDING and should be obtained before committing to full execution.**

The runtime methods to delete live at: `HttpAdapter.addMiddlewares` (`http-adapter.ts:111`), `TickAdapter.addMiddlewares` (`tick.ts:190` + lifecycle guard `:192`), base `Adapter.addGuards` (`adapter.ts:237`), `Adapter.addExceptionFilters` (`adapter.ts:226`), and the `AdapterContract.addGuards`/`addExceptionFilters` declarations (`common/src/adapter/types.ts:133,141`). `addErrorFilters` is NOT a runtime method — only a build-time DSL name (see Phase 5). `registerInternalRoute(s)` is a separate concern (internal HTTP routes) and is **out of scope**.

---

## 1. What the review proved is SAFE (no blocker — declarative covers it)

- **Multiple named adapter instances** (public:5000 / admin:5001): keyed `name ?? className` at build (`injector-generator.ts:390`) and runtime (`application.ts:513`). (Per-instance *handler* pipelines for the *same class* are identical under both module-config and `add*` — a pre-existing class-keyed-compile limit, out of scope.)
- **Custom/3rd-party adapters** (TickAdapter): `applyMiddlewareConfig` is on the base `Adapter` (`adapter.ts:185`), inherited for free.
- **Ordering / merging** across global/controller/handler and across modules: deterministic via `reindexBindings` scope-rank + file-path sort. Post-route phases use compiled merged keys and bypass the runtime registry anyway. No interleaving `add*` produces that declarative cannot.
- **Conditional registration**: pushed into the middleware (no-op on condition) or env-specific refs — Angular's approach.
- **Dynamic modules / plugins**: contribute *providers only* (`container.ts:199`); middleware was never addable by them.
- **Async/runtime-resolved config** (KMS/remote secret): a provider fetches it in `onInit()` (awaited at `application.ts:266`, before pipeline init `:294`); the middleware factory reads it via `inject()` — the `APP_INITIALIZER`/`forRootAsync` equivalent.
- **Post-start registration**: `seal()` snapshots the registry pre-start (`application.ts:291`); no post-start need.

**Caveat (corrected from a prior draft): guards / exception filters are MODELED declaratively but NOT yet APPLIED by a config-only path.** `AdapterModuleConfig.guards/exceptionFilters` exist (`common/interfaces.ts:196-197`), but at runtime the module config is applied by **calling `addGuards`/`addExceptionFilters` themselves** (`application.ts:279,283`) — there is no `applyGuardConfig`/`applyExceptionFilterConfig` analogous to `applyMiddlewareConfig`. So those two methods are the *declarative apply mechanism*, not ad-hoc-only. This makes Phase 2b (below) mandatory.

---

## 2. Real BLOCKERS (must be built before removal)

### B1 — ref serializer can't emit member/local refs (linchpin) — but SMALLER than first scoped
`serializeValue` (`value-serializer.ts:164`) emits a real symbol only when a ref carries `ZIPBUL_IMPORT_SOURCE`; else it emits a dead `{__zipbul_ref}` object. Member ref `cm.onRequest` is passed whole to `getAlias`, emitting the **illegal `import { cm.onRequest }`** (`import-registry.ts:151`).
**Refinement (from review):** the IR ALREADY carries member structure (`expression-value-to-zipbul-ir.ts:109-120` emits `{ZIPBUL_REF:'cm.onRequest', ZIPBUL_IMPORT_SOURCE:<root source>}` via `resolveObjectSource`) — **no gildash/IR change needed.** The `ZIPBUL_CALL` branch (`value-serializer.ts:168-192`) and `injector-generator.ts:503-526` ALREADY split a dotted ref on `.`, import only the head, and emit `alias.method`. So the **member-ref fix = reuse that pattern in the `ZIPBUL_REF` branch** (easy). The **genuinely hard sub-case** is a *local same-file const* (`const mw = factory(); [mw]`) which legitimately has no import source and silently dies — fix = resolve to the app module binding OR throw a build diagnostic (mirror `provider-resolver.ts:192` / `middleware-pipeline-processor.ts:483`).

### B2 — cookie's two-definition object factory needs member refs
`cookieMiddleware(opts)` returns `{onRequest, beforeResponse}` (`cookie/src/middleware.ts:99`) — two definitions at two phases. Declarative reference needs `cookies.onRequest`/`cookies.beforeResponse` → B1. Cookie genuinely needs two phases (OnRequest parse + BeforeResponse flush for dedupe / `secure:'auto'`), so cannot collapse to one definition. (Phase is set by the config KEY not the ref, so no phase-misregistration bug — author error is possible but equally so under `add*` today.)

### B3 — guards/exception-filter declarative APPLY mechanism (NEW — biggest correctness gap)
Deleting `Adapter.addGuards`/`addExceptionFilters` **breaks `application.ts:279,283`**, the only path that applies module-config guards/filters. Must first add `applyGuardConfig`/`applyExceptionFilterConfig` (or rewrite `application.ts:278-284` to set the registries directly) and update `AdapterContract` (`types.ts:133,141`).

### B4 — test harnesses need runtime / per-test dynamic middleware
`Tck.createApplication` is runtime-only (`tck/test-application.ts:18-34`: empty `defineModule()`, `adapterConfig:{}`, no compiler) and backs cookie/cors/query-parser e2e via `register:(app)=>http.addMiddlewares(...)`. `@zipbul/testing` `Test.create` compiles but its `attach` callback also uses runtime `addMiddlewares`, and per-test spy/echo middleware (`extras.onRequest`, cors `priorMiddlewares`, qp `echoQuery`) can't be expressed declaratively. **Prior art for the fix:** `@zipbul/testing` already has a route-scoped override `middleware(controller,method).use(def)` via `DiOverrideRegistry` (`testing/test-application.ts:82`) — a per-instance test-injection hook can extend this.

### B5 — library-side registration has no declarative hook
No `applyTo(app)`/plugin mechanism for a library to register middleware without the app editing its module source. Today only runtime `add*`. **Review confirms this is UNEXERCISED** — no library self-registers; `examples/main.ts` global cors/timing is *app-authored* and migrates cleanly to module config. So this is a capability DECISION, not a current blocker.

### B6 — supporting gaps
- `generateAdapterConfigs` (`injector-generator.ts:404-445`) silently drops/mis-serializes conditional/spread/computed `middlewares`/`guards`/`exceptionFilters` arrays (provider & `@UseMiddlewares` paths throw — this doesn't). Harden to throw.
- `DefineModuleOptions` is a stub `{__temp?:true}` (`module/interfaces.ts:1-2`) — authoring `defineModule({adapters:[...]})` doesn't typecheck (real shape is `Module.adapters` in `common/interfaces.ts:184-201`).
- The declarative module-config middleware path is **unexercised end-to-end** — only generator unit tests (static refs).
- `registerMiddleware` (`adapter.ts:202`) is the ONLY registration method calling `validateAdapterCompatibility`; `applyMiddlewareConfig` does NOT. Compiled-key paths (`resolveMiddlewareKeys`:565 etc.) DO validate, so it's not wholesale lost — but removing `registerMiddleware` drops compatibility-checking on the direct `applyMiddlewareConfig` path. Resolve before declaring it dead.

---

## 3. Phased plan (RE-ORDERED per review: harness before declarative e2e)

> Principle (owner): a failed probe is work to do, not a stop sign. Each phase ends GREEN before the next. Each gets its own plan + tri-review + impl + verification.

### Phase 0 — Reference serializer hardening (unblocks declarative refs)
- `value-serializer.ts` + `import-registry.ts`: member ref `obj.prop` → emit `import { obj }; obj.prop` (reuse the existing `ZIPBUL_CALL` split pattern — **no IR change**).
- Local same-file const ref → resolve to the app-module binding, OR throw a build diagnostic (no silent dead-object).
- Harden `generateAdapterConfigs` to throw on unresolvable/spread/computed elements (B6).
- **Exit (self-contained):** generator unit test — `middlewares:{OnRequest:[cm.onRequest]}` (imported configured const) emits valid runtime code; local-const + computed array now throw.

### Phase 1 — Declarative test harness (the true prerequisite for exercising anything)
- Give the compile-capable harness (`@zipbul/testing` `Test.create`) a fixture/convention to boot an app whose module declares `adapters:[{middlewares/guards/exceptionFilters}]`, and add the **per-test middleware injection** override (extend `DiOverrideRegistry`, `testing/test-application.ts:82`) to replace `add*` for spies/echo.
- Decide `Tck`'s fate: gain a compile path OR route its suites through the `Test.create` harness OR keep a documented test-only injection shim. (Reviews: Tck cannot compile in-memory apps trivially; the injection shim is the realistic option — but it is a *test-scoped* API, explicitly NOT a production runtime-registration path.)
- **Exit:** an e2e boots a declarative-module app and asserts a middleware runs; a test registers a per-test spy middleware via the override.

### Phase 2 — Type the module path + cookie reshape
- 2a: give `DefineModuleOptions` the real `adapters?: AdapterModuleConfig[]` shape (`common/interfaces.ts:184-201`); keep `defineModule` a runtime no-op.
- 2b (**mandatory, was missing**): add `applyGuardConfig`/`applyExceptionFilterConfig` (or rewrite `application.ts:278-284` to set registries directly) + update `AdapterContract` (`types.ts:133,141`), so guards/filters have a config-only apply path before `addGuards`/`addExceptionFilters` are deleted.
- 2c: cookie declarative reference (gated on Phase 0 + Phase 1 harness):
  ```ts
  // app/cookies.config.ts
  export const cookies = cookieMiddleware({ secrets: [process.env.COOKIE_SECRET!] });
  // app/module.ts
  defineModule({ adapters:[{ adapter:HttpAdapter, middlewares:{
    OnRequest:[cookies.onRequest], BeforeResponse:[cookies.beforeResponse] } }] });
  ```
  Cookie's existing 445 tests verify the *runtime* path; this phase adds a *declarative* e2e (needs Phase 1 harness). Cookie's bug-fixes (already committed) stay intact.

### Phase 3 — Library injection — DECISION (deferral is SAFE)
Decide whether library-side registration is supported (B5). It is currently UNEXERCISED, so Phase 4 removal can proceed under the **"app-authored-only"** assumption; this phase only blocks removal if library injection is adopted (then a declarative plugin hook is designed first).

### Phase 4 — Migration + removal (COMPLETE inventory)
Migrate every site, then delete the methods + contract decls + dead DSL:
- **Runtime methods:** `http-adapter.ts:111`, `tick.ts:190`(+guard), `adapter.ts:226,237`, `AdapterContract` decls `types.ts:133,141`.
- **Declarative caller rewrite:** `application.ts:279,283` (depends on Phase 2b).
- **Production:** `examples/src/main.ts:17,27` → `examples/src/module.ts` declarative.
- **Test sites:** cookie/cors/query-parser e2e helpers; `http-adapter.spec.ts` (47 sites: 36 mw + 1 guard + 10 filter); `http-adapter.e2e.test.ts` (7, incl. addGuards :362); `core/adapter.spec.ts` (guard/filter suites); `core/application.spec.ts:949-1020` (mocks); `tck/.../create-application.test.ts:24`; `tick.spec.ts:42-79`; `examples/test/e2e/{cors,guard-override,query-parser}.e2e.test.ts`.
- **Build-time DSL:** remove/rename BOTH `extractMiddlewaresFromConfigure` (matches `'addMiddlewares'`) AND `extractExceptionFiltersFromConfigure` (matches `'addErrorFilters'`) in `method-metadata-extractor.ts` + their specs.
- **Docs:** cookie README:64,65 + middleware.ts:40,41; cors middleware.ts:20; request-timing.middleware.ts:18; `@zipbul/testing` JSDoc :52,108; cli CHANGELOG:46; ast-node-locator.ts:26.
- **`registerMiddleware`:** keep or remove per B6 validation analysis.

### Phase 5 — Full verification
`zb build` examples + every unit/e2e/integration suite across framework + all middlewares. Zero `add*` references remain.

---

## 4. Open decisions
1. **Cost/benefit of the whole project** — the 3rd plan review (right-sizing) is outstanding; obtain it before full execution.
2. **`Tck`**: compile path vs `Test.create` reroute vs test-injection shim (Phase 1).
3. **Library injection** supported or not (Phase 3).
4. **`registerMiddleware`** kept or removed — resolve the `validateAdapterCompatibility` coverage question (B6).
5. **Cookie reference**: member-ref (`cookies.onRequest`) vs two derivable bare consts (Phase 0 outcome decides).

## 5. Non-goals
- No change to per-handler pipeline class-keying (pre-existing).
- No collapsing of cookie's two phases (flush is load-bearing).
- `registerInternalRoute(s)` out of scope (internal routes, not the middleware family).
