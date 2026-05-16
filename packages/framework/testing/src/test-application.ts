import type { AdapterClass, ProviderToken, ZipbulValue, ModuleMarker } from '@zipbul/common';
import { TEST_SURFACE } from '@zipbul/common';
import { Application, Container, getBootstrapState, resetBootstrapState, registerBootstrapState } from '@zipbul/core';

import type { OverrideRecord } from './overrides';
import { OverrideRegistry, makeProviderOverrideBuilder, type ProviderOverrideBuilder } from './overrides';

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
