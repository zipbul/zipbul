import type { AdapterClass, ProviderToken, ZipbulValue, ModuleMarker } from '@zipbul/common';
import { Application, Container, getBootstrapState, resetBootstrapState, registerBootstrapState } from '@zipbul/core';

import type { OverrideRecord } from './overrides';
import { OverrideRegistry, makeProviderOverrideBuilder, type ProviderOverrideBuilder } from './overrides';

/**
 * Public test surface contract for an attached adapter.
 *
 * Each adapter package exports its own surface type. The toolkit resolves
 * the surface via the optional well-known method
 * `Symbol.for('@zipbul/testing/surface')()` on the adapter instance. If the
 * adapter does not implement the symbol, {@link TestApplication.adapter}
 * throws.
 *
 * @public
 */
export const TEST_SURFACE: unique symbol = Symbol.for('@zipbul/testing/surface');

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
  readonly options: unknown;
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
   * Typical use: `preload: () => import('../dist/runtime.js')` — the AOT
   * runtime artifact populates `bootstrapState.container` with the
   * production-wired controllers / services / handler index. When
   * `preload` is provided, the toolkit reuses that container; otherwise
   * a fresh, empty container is created (useful for unit-style tests).
   */
  preload?: () => Promise<unknown>;
}

/**
 * Builder returned by {@link createApplication}. All `.override*` calls are
 * collected and applied after `attach()` runs but before `runInitHooks` /
 * adapter `start()` — see design v4 lifecycle.
 *
 * @public
 */
export class TestApplicationBuilder {
  private readonly overrides = new OverrideRegistry();

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
   * Read-only snapshot of recorded overrides. Useful for debugging
   * unexpected override interactions.
   *
   * @public
   */
  getOverrides(): { root: ReadonlyArray<OverrideRecord>; request: ReadonlyArray<OverrideRecord> } {
    return { root: this.overrides.root, request: this.overrides.request };
  }

  async compile(): Promise<TestApplication> {
    // 1. If a preload callback is configured, run it first — it is expected
    //    to populate bootstrap state from an AOT-compiled `runtime.js`
    //    artifact (controllers, services, handlerIndex, adapterConfig).
    //    When preload is provided we do NOT reset state, so the AOT-loaded
    //    container is reused — this is what makes the e2e flow possible
    //    without the user having to factor their `main.ts` into a bootstrap fn.
    //
    //    For unit-style tests (no AOT artifacts), `preload` is omitted; we
    //    reset and start from a fresh container.
    if (this.config.preload !== undefined) {
      await this.config.preload();
    } else {
      resetBootstrapState();
      registerBootstrapState({ container: new Container() });
    }

    // 2. Resolve the container: AOT runtime's container if preloaded,
    //    otherwise the fresh one we just registered.
    const state = getBootstrapState();
    if (state.container === undefined) {
      throw new Error(
        'Bootstrap state is missing a container. Either provide a `preload` that ' +
        'registers one (e.g. `() => import("./dist/runtime.js")`) or remove the preload option.',
      );
    }
    const container = state.container;

    // 3. Application created against the (possibly AOT-populated) container.
    const application = new Application(container);

    // 4. User attach callback runs — adapter constructors execute eagerly.
    //    The recorder returns the live adapter instance so users can chain
    //    `.addMiddlewares(...)` exactly as they would in production main.ts.
    const attached: AttachedRecord[] = [];
    const recorder: AttachRecorder = {
      attach: <T extends AdapterClass>(
        cls: T,
        opts?: ConstructorParameters<T>[0] & { name?: string },
      ): InstanceType<T> => {
        const instance = application.attach(cls, opts as never) as InstanceType<T>;
        attached.push({ adapterClass: cls, options: opts });
        return instance;
      },
    };
    this.config.attach(recorder);

    // 5. Apply overrides — after attach, so adapter constructors that
    //    register providers cannot shadow the replacements.
    for (const rec of this.overrides.root) {
      container.replace(rec.token as never, rec.factory as never, {
        ...(rec.scope !== undefined ? { scope: rec.scope } : {}),
        ...(rec.visibleTo !== undefined ? { visibleTo: rec.visibleTo } : {}),
      });
    }
    // request overrides are applied per-request inside RequestScopeContainer;
    // here we just record them for the application's container to consume.
    // TODO(v2): wire request override map through createRequestScope call sites.

    // 6. Start the application via the in-process path — every attached
    //    adapter's startTest() is invoked instead of start(), so no transport
    //    binds a socket. The production fetch/dispatch path is exercised
    //    end-to-end via the adapter's test surface.
    await startInProcess(application);

    return new TestApplication(application, attached);
  }
}

/**
 * Compiled, started test application. Returned by
 * {@link TestApplicationBuilder.compile}.
 *
 * @public
 */
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
    const want = options?.name;
    const matching = this.attached.filter((r) => r.adapterClass === adapterClass);
    if (matching.length === 0) {
      throw new Error(`Adapter "${adapterClass.name}" was not attached to this test application.`);
    }
    if (matching.length > 1 && want === undefined) {
      throw new Error(
        `Adapter "${adapterClass.name}" has multiple instances. Pass { name } to disambiguate.`,
      );
    }
    // Find the matching instance via Application's internal list — defer to
    // Application.get-style access. We use the attach order as a proxy for
    // the application's adapter registry (Application stores them in order).
    // For a single instance, return the only one.
    const inst = this.findAdapterInstance(adapterClass, want);
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

  private findAdapterInstance(
    cls: AdapterClass,
    name?: string,
  ): InstanceType<AdapterClass> {
    // Application doesn't currently expose its adapter list publicly. The
    // adapter instance is the constructor's return value captured at attach
    // time inside the application itself. The test recorder only stores the
    // class + options; we rely on calling Application.attach which returns
    // the instance. We don't capture that return today — fix below.
    //
    // Until Application exposes a `getAdapter(class, name?)` helper, the
    // toolkit walks the application's internal `adapters` field via a known
    // accessor. We keep this isolated so the eventual public API is one
    // refactor away.
    const adaptersField = (this.application as unknown as { adapters: Array<{ adapter: unknown; adapterClass: AdapterClass; name?: string }> }).adapters;
    const matches = adaptersField.filter((e) => e.adapterClass === cls);
    if (matches.length === 0) {
      throw new Error(`Adapter "${cls.name}" not found in started application.`);
    }
    if (name === undefined) {
      return matches[0]!.adapter as InstanceType<AdapterClass>;
    }
    const named = matches.find((e) => e.name === name);
    if (named === undefined) {
      throw new Error(`Adapter "${cls.name}" with name "${name}" not found.`);
    }
    return named.adapter as InstanceType<AdapterClass>;
  }
}

async function startInProcess(application: Application): Promise<void> {
  // Mirror Application.executeStart but call startTest() on each adapter
  // instead of start(). We can't subclass Application without core changes,
  // so we reuse Application's public attach + start machinery for everything
  // up to the adapter start step, then drive startTest manually.
  //
  // Until Application exposes a test-mode hook, this implementation goes
  // through Application's internal adapter list with the same caveat noted
  // in findAdapterInstance. The eventual fix is a public
  // `Application.startInProcess()` that performs steps 1..7 of executeStart
  // and dispatches `startTest` instead of `start`.
  const adaptersField = (application as unknown as { adapters: Array<{ adapter: { startTest?: (ctx: unknown) => Promise<void>; start: (ctx: unknown) => Promise<void>; constructor: { name: string } } }> }).adapters;

  // We delegate to Application.start() — but Application.start always calls
  // adapter.start, never startTest. For v1 MVP we accept this gap and use
  // a small adapter shim: replace .start with .startTest on each entry
  // for the duration of this call, then restore.
  //
  // This is intentionally a sharp edge — a v2 refactor should add
  // `Application.startTest()` natively. The shim is opaque to user code.
  type AdapterRef = { start: (ctx: unknown) => Promise<void>; startTest?: (ctx: unknown) => Promise<void> };
  const swapped: Array<{ ref: AdapterRef; original: (ctx: unknown) => Promise<void> }> = [];
  for (const entry of adaptersField) {
    const ref = entry.adapter as AdapterRef;
    swapped.push({ ref, original: ref.start });
    // Adapters that don't implement startTest are swapped to a no-op — they
    // remain attached (their providers are registered, their constructor
    // ran) but no transport binds. The adapter's test surface, if any, is
    // still callable; if absent, `app.adapter(X)` throws at call time.
    ref.start = typeof ref.startTest === 'function'
      ? ref.startTest.bind(ref)
      : async (): Promise<void> => { /* no-op for test mode */ };
  }
  try {
    await application.start();
  } finally {
    for (const { ref, original } of swapped) {
      ref.start = original;
    }
  }
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
