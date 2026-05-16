import type {
  AdapterClass,
  ProviderToken,
  ZipbulValue,
  ModuleMarker,
  GuardDefinition,
  ExceptionFilterDefinition,
  MiddlewareDefinition,
} from '@zipbul/common';
import {
  Application,
  Container,
  getBootstrapState,
  resetBootstrapState,
  TEST_SURFACE,
} from '@zipbul/core';
import { compile, isManifestFresh } from '@zipbul/cli/compiler';

import type { ProviderOverrideRecord } from './overrides';
import { makeProviderOverrideBuilder, type ProviderOverrideBuilder } from './overrides';

/**
 * Conditional extractor for an adapter's test surface return type. When
 * an adapter implements `[Symbol.for('@zipbul/testing/surface')]()`,
 * `SurfaceOf<typeof X>` resolves to that method's return type. When it
 * does not, the type is `unknown` and the runtime call throws.
 *
 * @public
 */
export type SurfaceOf<T extends AdapterClass> =
  InstanceType<T> extends { [TEST_SURFACE](): infer S } ? S : unknown;

/**
 * Loose class reference accepted by route-bound overrides — only `.name`
 * is consulted to query the AOT-emitted handler index.
 *
 * @public
 */
export type ControllerClassRef = { readonly name: string; new (...args: never[]): unknown };

interface AdapterWithTestSurface {
  [TEST_SURFACE]?(): unknown;
}

interface AttachedRecord {
  readonly adapterClass: AdapterClass;
  readonly name: string | undefined;
}

/**
 * Recorder passed to the `attach` callback. Returns the live adapter
 * instance so users can chain `.addMiddlewares(...)` exactly as they
 * would in production `main.ts`.
 *
 * @public
 */
export interface AttachRecorder {
  attach<T extends AdapterClass>(
    adapterClass: T,
    options?: ConstructorParameters<T>[0] & { name?: string },
  ): InstanceType<T>;
}

interface RouteOverrideRecord {
  readonly kind: 'guard' | 'exceptionFilter' | 'middleware';
  readonly controller: ControllerClassRef;
  readonly method: string;
  readonly definition: GuardDefinition | ExceptionFilterDefinition | MiddlewareDefinition;
}

/**
 * Override callback registry passed to `override:`. Exposes one method
 * per override kind; each returns a fluent builder.
 *
 * @public
 */
export interface DiOverrideRegistry {
  provider<T extends ZipbulValue = ZipbulValue>(token: ProviderToken): ProviderOverrideBuilder<T>;
  requestProvider<T extends ZipbulValue = ZipbulValue>(token: ProviderToken): ProviderOverrideBuilder<T>;
  guard(controller: ControllerClassRef, method: string): RouteOverrideRegistration<GuardDefinition>;
  filter(controller: ControllerClassRef, method: string): RouteOverrideRegistration<ExceptionFilterDefinition>;
  middleware(controller: ControllerClassRef, method: string): RouteOverrideRegistration<MiddlewareDefinition>;
}

/**
 * `.use(def)` accepts the `defineGuard / defineFilter / defineMiddleware`
 * return value verbatim.
 *
 * @public
 */
export interface RouteOverrideRegistration<D> {
  use(definition: D): void;
}

/**
 * Options for {@link create}.
 *
 * @public
 */
export interface TestCreateOptions {
  /**
   * Attach + wire adapters. Runs after the AOT runtime is installed and
   * before any overrides apply. Same shape as a production `main.ts`:
   *
   *   ```ts
   *   attach: r => {
   *     const http = r.attach(HttpAdapter, { port: 0 });
   *     http.addMiddlewares(HttpAdapterPhase.OnRequest, [corsMiddleware({...})]);
   *   }
   *   ```
   */
  attach: (recorder: AttachRecorder) => void;
  /**
   * Declarative override callback. Runs after `attach` and before
   * `Application.startTest()`. The callback's side effects
   * (`.useValue` / `.useFactory` / `.useClass` / `.use(...)`) are
   * collected and applied to the container + handler index.
   */
  override?: (di: DiOverrideRegistry) => void;
  /**
   * Absolute path to the project root. Defaults to `process.cwd()`.
   * The toolkit invokes the AOT compiler against this directory if
   * `.zipbul/manifest.json` is missing or stale.
   */
  projectRoot?: string;
  /**
   * Force the compiler to rebuild even when the manifest looks fresh.
   * Default: `false`.
   */
  forceCompile?: boolean;
}

/**
 * Compiled, started test application returned by {@link create}.
 *
 * @public
 */
export class TestApplication {
  constructor(
    private readonly application: Application,
    private readonly attached: ReadonlyArray<AttachedRecord>,
  ) {}

  /**
   * Returns the test surface for an attached adapter. When the same
   * adapter class is attached multiple times, pass `{ name }`.
   *
   * For HTTP, prefer the shorter `app.adapter(HttpAdapter)` and wrap with
   * `createHttpClient(...)` from `@zipbul/http-adapter/testing` when
   * verb-style sugar (`http.get('/users')`) is desired — `@zipbul/testing`
   * stays adapter-agnostic.
   *
   * @public
   */
  adapter<T extends AdapterClass>(
    adapterClass: T,
    options?: { name?: string },
  ): SurfaceOf<T> {
    if (this.attached.find((r) => r.adapterClass === adapterClass) === undefined) {
      throw new Error(`Adapter "${adapterClass.name}" was not attached to this test application.`);
    }
    const inst = options?.name !== undefined
      ? this.application.getAdapter(adapterClass, { name: options.name })
      : this.application.getAdapter(adapterClass);
    const surface = (inst as AdapterWithTestSurface)[TEST_SURFACE];
    if (typeof surface !== 'function') {
      throw new Error(
        `Adapter "${adapterClass.name}" does not implement [Symbol.for('@zipbul/testing/surface')](). ` +
        `Add the method to make the adapter testable via @zipbul/testing.`,
      );
    }
    return surface.call(inst) as SurfaceOf<T>;
  }

  /**
   * Singleton DI lookup. Mirrors {@link Application.get}'s
   * `singleton + visibleTo='all'` restriction.
   *
   * @public
   */
  get(token: ProviderToken): ZipbulValue {
    return this.application.get(token);
  }

  /**
   * Gracefully stops the test application and runs `onDestroy` hooks.
   *
   * @public
   */
  async close(): Promise<void> {
    await this.application.stop();
  }
}

/**
 * Boots a `TestApplication` against the user's AOT-compiled app.
 *
 * Zero ceremony — single await, no `.compile()` step:
 *
 * ```ts
 * const app = await Test.create(appModule, {
 *   attach: r => { r.attach(HttpAdapter, { port: 0 }); },
 *   override: di => di.provider(UsersRepository).useValue(fakeRepo),
 * });
 * const res = await app.adapter(HttpAdapter).inject({ method: 'GET', url: '/users' });
 * expect(res.status).toBe(200);
 * await app.close();
 * ```
 *
 * What happens internally:
 *   1. `compile()` runs the AOT compiler against `projectRoot` (cached
 *      via mtime check; first cold run ~ 800ms on the examples project).
 *   2. The generated `runtime.ts` is dynamic-imported. Its module-level
 *      `installRuntime()` call populates bootstrap state on first load.
 *   3. On subsequent `Test.create` invocations in the same process the
 *      module is cached, so the toolkit explicitly calls
 *      `resetBootstrapState()` + the runtime's `installRuntime()` — every
 *      test gets a fresh container + controller-factory map.
 *   4. The user's `attach` callback runs against a fresh `Application`.
 *   5. Provider overrides materialize into `container.replace(...)` and
 *      route overrides walk `handlerIndex.merged*Keys` to replace every
 *      AOT-emitted binding key for the named controller/method.
 *   6. `Application.startTest()` runs the full executeStart pipeline but
 *      dispatches `adapter.startTest(ctx)` instead of `start(ctx)`, so
 *      no transport binds.
 *
 * @public
 */
export async function create(
  _module: ModuleMarker,
  options: TestCreateOptions,
): Promise<TestApplication> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const compileForce = options.forceCompile === true || !await isManifestFresh(projectRoot);
  const { runtimePath } = await compile({ projectRoot, force: compileForce });

  // Dynamic import; Bun caches by absolute path. First import runs the
  // module's top-level installRuntime(). Subsequent imports are no-ops —
  // we re-install explicitly below for multi-test isolation.
  const runtimeModule = (await import(runtimePath)) as { installRuntime?: () => void };
  resetBootstrapState();
  if (typeof runtimeModule.installRuntime !== 'function') {
    throw new Error(
      `[Zipbul Testing] Generated runtime at ${runtimePath} does not export installRuntime(). ` +
      `Re-run the compiler — the toolkit requires the post-B6 generator shape.`,
    );
  }
  runtimeModule.installRuntime();

  const state = getBootstrapState();
  if (state.container === undefined) {
    throw new Error(
      `[Zipbul Testing] installRuntime() did not register a container. ` +
      `This is a compiler bug — please report it with a minimal reproduction.`,
    );
  }
  const container = state.container;
  const application = new Application(container);

  // Run the user attach callback against the fresh Application.
  const attached: AttachedRecord[] = [];
  const recorder: AttachRecorder = {
    attach: <T extends AdapterClass>(
      cls: T,
      attachOpts?: ConstructorParameters<T>[0] & { name?: string },
    ): InstanceType<T> => {
      const instance = application.attach(cls, attachOpts as never) as InstanceType<T>;
      const name = typeof attachOpts === 'object' && attachOpts !== null && 'name' in attachOpts && typeof attachOpts.name === 'string'
        ? attachOpts.name
        : undefined;
      attached.push({ adapterClass: cls, name });
      return instance;
    },
  };
  options.attach(recorder);

  // Collect overrides from the user callback.
  const rootOverrides: ProviderOverrideRecord[] = [];
  const requestOverrides: ProviderOverrideRecord[] = [];
  const routeOverrides: RouteOverrideRecord[] = [];

  if (options.override !== undefined) {
    const registry: DiOverrideRegistry = {
      provider: (token) => makeProviderOverrideBuilder((r) => rootOverrides.push(r), token),
      requestProvider: (token) => makeProviderOverrideBuilder((r) => requestOverrides.push(r), token, 'request'),
      guard: (controller, method) => ({
        use: (definition) => routeOverrides.push({ kind: 'guard', controller, method, definition }),
      }),
      filter: (controller, method) => ({
        use: (definition) => routeOverrides.push({ kind: 'exceptionFilter', controller, method, definition }),
      }),
      middleware: (controller, method) => ({
        use: (definition) => routeOverrides.push({ kind: 'middleware', controller, method, definition }),
      }),
    };
    options.override(registry);
  }

  for (const rec of rootOverrides) {
    container.replace(rec.token as never, rec.factory as never, {
      ...(rec.scope !== undefined ? { scope: rec.scope } : {}),
      ...(rec.visibleTo !== undefined ? { visibleTo: rec.visibleTo } : {}),
    });
  }

  // Request-scope override registry is recorded but consumed by adapter
  // inject paths via `runWithRequestOverrides` (ALS frame) per call. We
  // intentionally don't apply them to the root container here — they
  // only make sense per-request.
  void requestOverrides;

  if (routeOverrides.length > 0) {
    applyRouteOverrides(routeOverrides, container, state.handlerIndex);
  }

  await application.startTest();

  return new TestApplication(application, attached);
}

/**
 * Walks `bootstrapState.handlerIndex`, finds the handler entry matching
 * each recorded route override, and calls `container.replace(key, factory)`
 * for every container key the AOT compiler emitted for that handler.
 *
 * The toolkit reads keys verbatim from `merged*Keys` — it does not
 * reconstruct the `__route_${kind}__:Cls.method:scope:order` format.
 * The format remains an internal CLI / runtime contract.
 */
function applyRouteOverrides(
  overrides: ReadonlyArray<RouteOverrideRecord>,
  container: Container,
  handlerIndex: ReturnType<typeof getBootstrapState>['handlerIndex'],
): void {
  if (handlerIndex === undefined || handlerIndex.length === 0) {
    throw new Error(
      'Route-bound overrides (di.guard / di.filter / di.middleware) require a compiled ' +
      'handlerIndex in bootstrapState. Make sure the test runs against a project the ' +
      'AOT compiler can scan.',
    );
  }

  for (const ov of overrides) {
    const entry = handlerIndex.find(
      (h) => h.className === ov.controller.name && h.methodName === ov.method,
    );
    if (entry === undefined) {
      throw new Error(
        `Cannot apply ${ov.kind} override: handler "${ov.controller.name}.${ov.method}" not ` +
        `found in handlerIndex. Verify the class name matches the AOT-compiled entry.`,
      );
    }

    const keys = collectKeysFor(entry, ov.kind);
    if (keys.length === 0) {
      throw new Error(
        `Cannot apply ${ov.kind} override for "${ov.controller.name}.${ov.method}": no existing ` +
        `${ov.kind} is registered on this handler. Add the binding via @Use* or module config ` +
        `so the AOT compiler emits a container key.`,
      );
    }

    for (const key of keys) {
      container.replace(key as never, () => ov.definition as never);
    }
  }
}

function collectKeysFor(
  entry: NonNullable<ReturnType<typeof getBootstrapState>['handlerIndex']>[number],
  kind: RouteOverrideRecord['kind'],
): readonly string[] {
  if (kind === 'guard') return entry.mergedGuardKeys ?? entry.guardKeys ?? [];
  if (kind === 'exceptionFilter') {
    return entry.mergedExceptionFilterKeys ?? entry.exceptionFilterKeys ?? [];
  }
  // middleware — flatten phases
  const phaseMap = entry.mergedPhaseMiddlewareKeys;
  if (phaseMap !== undefined) {
    return Object.values(phaseMap).flat();
  }
  return entry.middlewareKeys ?? [];
}

/**
 * Canonical entry point — `Test.create(module, options)`.
 *
 * @public
 */
export const Test = { create };
