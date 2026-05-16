import type {
  AdapterClass,
  ProviderToken,
  ZipbulValue,
  ModuleMarker,
  GuardDefinition,
  ExceptionFilterDefinition,
  MiddlewareDefinition,
} from '@zipbul/common';

/**
 * Loose class shape accepted by route-bound overrides. The toolkit only
 * needs `.name` to query the AOT-emitted handler index; constructor
 * signatures vary widely across user controllers so we don't constrain
 * them here.
 */
type ControllerClassRef = { readonly name: string; new (...args: never[]): unknown };
import { Application, Container, getBootstrapState, resetBootstrapState, registerBootstrapState, TEST_SURFACE } from '@zipbul/core';

import type { OverrideRecord } from './overrides';
import { OverrideRegistry, makeProviderOverrideBuilder, type ProviderOverrideBuilder } from './overrides';

/**
 * Recorded route-bound override applied during `compile()` by walking
 * `bootstrapState.handlerIndex`. Testing intentionally does NOT compute
 * route-key strings itself — the AOT-emitted `merged*Keys` arrays on
 * each handler entry are the source of truth, and the toolkit just
 * replaces each existing container registration in place.
 */
interface RouteOverrideRecord {
  readonly kind: 'guard' | 'exceptionFilter' | 'middleware';
  readonly controller: ControllerClassRef;
  readonly method: string;
  readonly definition: GuardDefinition | ExceptionFilterDefinition | MiddlewareDefinition;
}

export { TEST_SURFACE };

interface AdapterWithTestSurface {
  [TEST_SURFACE]?(): unknown;
}

/**
 * Conditional helper that extracts the test surface return type from an
 * adapter class. Returns `unknown` for adapters that do not implement
 * `[TEST_SURFACE]()` — the runtime call will throw, but the type stays
 * permissive so users get a meaningful inference for compliant adapters
 * and a clear runtime error for non-compliant ones.
 *
 * @public
 */
export type SurfaceOf<T extends AdapterClass> =
  InstanceType<T> extends { [TEST_SURFACE](): infer S } ? S : unknown;

interface AttachedRecord {
  readonly adapterClass: AdapterClass;
  readonly name: string | undefined;
}

interface AttachRecorder {
  attach<T extends AdapterClass>(
    adapterClass: T,
    options?: ConstructorParameters<T>[0] & { name?: string },
  ): InstanceType<T>;
}

/**
 * Configuration accepted by {@link createApplication}.
 *
 * @public
 */
export interface CreateTestApplicationConfig {
  module: ModuleMarker;
  attach: (recorder: AttachRecorder) => void;
  /**
   * Optional callback that runs before bootstrap state is consulted.
   *
   * Typical use: `preload: () => import('../.zipbul-temp/runtime.ts')` —
   * the AOT runtime artifact populates `bootstrapState.container` with the
   * production-wired controllers / services / handler index. When
   * `preload` is provided, the toolkit reuses that container; otherwise
   * a fresh, empty container is created (useful for unit-style tests).
   */
  preload?: () => Promise<unknown>;
}

export class TestApplicationBuilder {
  private readonly overrides = new OverrideRegistry();
  private readonly routeOverrides: RouteOverrideRecord[] = [];

  constructor(private readonly config: CreateTestApplicationConfig) {}

  overrideRootProvider(token: ProviderToken): ProviderOverrideBuilder<TestApplicationBuilder> {
    return makeProviderOverrideBuilder(
      this,
      (rec: OverrideRecord) => this.overrides.addRoot(rec),
      token,
    );
  }

  overrideRequestProvider(token: ProviderToken): ProviderOverrideBuilder<TestApplicationBuilder> {
    return makeProviderOverrideBuilder(
      this,
      (rec: OverrideRecord) => this.overrides.addRequest(rec),
      token,
      'request',
    );
  }

  /**
   * Replaces every guard registered for the given controller method via
   * `@UseGuards(...)`. The AOT compiler emits one container key per
   * registered guard; this method walks `handlerIndex.mergedGuardKeys`
   * for the matching handler and calls `container.replace(key, ...)` on
   * each. The route-key string format stays an internal AOT contract —
   * the toolkit consumes the emitted data, never reconstructs the format.
   *
   * @public
   */
  overrideGuard(controller: ControllerClassRef, method: string, definition: GuardDefinition): this {
    this.routeOverrides.push({ kind: 'guard', controller, method, definition });
    return this;
  }

  /**
   * Replaces every exception filter registered for the given controller
   * method via `@UseExceptionFilters(...)`. See {@link overrideGuard}.
   *
   * @public
   */
  overrideExceptionFilter(controller: ControllerClassRef, method: string, definition: ExceptionFilterDefinition): this {
    this.routeOverrides.push({ kind: 'exceptionFilter', controller, method, definition });
    return this;
  }

  /**
   * Replaces every middleware registered for the given controller method
   * via `@UseMiddlewares(...)`. Phase-keyed bindings are flattened — the
   * override applies to ALL phases the method declared. See
   * {@link overrideGuard}.
   *
   * @public
   */
  overrideMiddleware(controller: ControllerClassRef, method: string, definition: MiddlewareDefinition): this {
    this.routeOverrides.push({ kind: 'middleware', controller, method, definition });
    return this;
  }

  /**
   * Read-only snapshot of recorded overrides. Useful for debugging
   * unexpected override interactions.
   *
   * @public
   */
  getOverrides(): {
    root: ReadonlyArray<OverrideRecord>;
    request: ReadonlyArray<OverrideRecord>;
    route: ReadonlyArray<RouteOverrideRecord>;
  } {
    return {
      root: this.overrides.root,
      request: this.overrides.request,
      route: this.routeOverrides,
    };
  }

  async compile(): Promise<TestApplication> {
    if (this.config.preload !== undefined) {
      await this.config.preload();
    } else {
      resetBootstrapState();
      registerBootstrapState({ container: new Container() });
    }

    const state = getBootstrapState();
    if (state.container === undefined) {
      throw new Error(
        'Bootstrap state is missing a container. Either provide a `preload` that ' +
        'registers one (e.g. `() => import("../.zipbul-temp/runtime.ts")`) or remove the preload option.',
      );
    }
    const container = state.container;

    const application = new Application(container);

    const attached: AttachedRecord[] = [];
    const recorder: AttachRecorder = {
      attach: <T extends AdapterClass>(
        cls: T,
        opts?: ConstructorParameters<T>[0] & { name?: string },
      ): InstanceType<T> => {
        const instance = application.attach(cls, opts as never) as InstanceType<T>;
        const name = typeof opts === 'object' && opts !== null && 'name' in opts && typeof opts.name === 'string'
          ? opts.name
          : undefined;
        attached.push({ adapterClass: cls, name });
        return instance;
      },
    };
    this.config.attach(recorder);

    for (const rec of this.overrides.root) {
      container.replace(rec.token as never, rec.factory as never, {
        ...(rec.scope !== undefined ? { scope: rec.scope } : {}),
        ...(rec.visibleTo !== undefined ? { visibleTo: rec.visibleTo } : {}),
      });
    }

    if (this.routeOverrides.length > 0) {
      applyRouteOverrides(this.routeOverrides, container, state.handlerIndex);
    }

    await application.startTest();

    return new TestApplication(application, attached);
  }
}

export class TestApplication {
  constructor(
    private readonly application: Application,
    private readonly attached: ReadonlyArray<AttachedRecord>,
  ) {}

  /**
   * Look up an attached adapter's test surface.
   *
   * For multiple instances of the same class, pass `{ name }` to disambiguate.
   *
   * @public
   */
  adapter<T extends AdapterClass>(
    adapterClass: T,
    options?: { name?: string },
  ): SurfaceOf<T> {
    const matching = this.attached.filter((r) => r.adapterClass === adapterClass);
    if (matching.length === 0) {
      throw new Error(`Adapter "${adapterClass.name}" was not attached to this test application.`);
    }
    const inst = options?.name !== undefined
      ? this.application.getAdapter(adapterClass, { name: options.name })
      : this.application.getAdapter(adapterClass);
    const surface = (inst as AdapterWithTestSurface)[TEST_SURFACE];
    if (typeof surface !== 'function') {
      throw new Error(
        `Adapter "${adapterClass.name}" does not implement [Symbol.for('@zipbul/testing/surface')](). ` +
        `Implement the test surface on the adapter to make it testable via @zipbul/testing.`,
      );
    }
    return surface.call(inst) as SurfaceOf<T>;
  }

  /**
   * DI lookup helper. Restricted to providers with
   * `scope='singleton'` and `visibleTo='all'`, mirroring `Application.get`.
   *
   * @public
   */
  get(token: ProviderToken): ZipbulValue {
    return this.application.get(token);
  }

  async close(): Promise<void> {
    await this.application.stop();
  }
}

/**
 * Walks `bootstrapState.handlerIndex`, finds the handler entry matching
 * each recorded route override, and calls `container.replace(key, factory)`
 * for every container key the AOT compiler emitted for that handler.
 *
 * The toolkit reads the keys verbatim from `merged*Keys` — it does not
 * reconstruct the `__route_${kind}__:Cls.method:scope:order` format. The
 * format remains an internal CLI / runtime contract.
 */
function applyRouteOverrides(
  overrides: ReadonlyArray<RouteOverrideRecord>,
  container: Container,
  handlerIndex: ReturnType<typeof getBootstrapState>['handlerIndex'],
): void {
  if (handlerIndex === undefined || handlerIndex.length === 0) {
    throw new Error(
      'Route-bound overrides (.overrideGuard / .overrideExceptionFilter / .overrideMiddleware) ' +
      'require a compiled handlerIndex in bootstrapState. Provide a `preload` that registers ' +
      'an AOT-compiled runtime.ts before calling .compile().',
    );
  }

  for (const ov of overrides) {
    const entry = handlerIndex.find(
      (h) => h.className === ov.controller.name && h.methodName === ov.method,
    );
    if (entry === undefined) {
      throw new Error(
        `Cannot apply ${ov.kind} override: handler "${ov.controller.name}.${ov.method}" not ` +
        `found in handlerIndex. Verify the controller class name matches the AOT-compiled entry ` +
        `(e.g. that the controller is registered in a module under your project's sourceDir).`,
      );
    }

    const keys = collectKeysFor(entry, ov.kind);
    if (keys.length === 0) {
      throw new Error(
        `Cannot apply ${ov.kind} override for "${ov.controller.name}.${ov.method}": no existing ` +
        `${ov.kind} is registered on this handler. Add @Use${capitalize(ov.kind)}(...) at the ` +
        `controller or method before overriding, or attach the ${ov.kind} via the module's ` +
        `adapter config so AOT emits the binding key.`,
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
  // middleware — flatten across all phases
  const phaseMap = entry.mergedPhaseMiddlewareKeys;
  if (phaseMap !== undefined) {
    return Object.values(phaseMap).flat();
  }
  return entry.middlewareKeys ?? [];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Entry point — builder factory for a test application.
 *
 * @public
 */
export function createApplication(config: CreateTestApplicationConfig): TestApplicationBuilder {
  return new TestApplicationBuilder(config);
}

/**
 * Re-exported under the canonical `Test` namespace to mirror
 * `@nestjs/testing`'s `Test.createTestingModule` ergonomics.
 *
 * @public
 */
export const Test = { createApplication };
