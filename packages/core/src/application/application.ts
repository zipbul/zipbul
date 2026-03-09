import type {
  ProviderToken,
  Adapter,
  AdapterClass,
  Context,
  ZipbulContainer,
  ZipbulValue,
  ClassToken,
  ModuleMarker,
} from '@zipbul/common';
import { MiddlewareHook } from '@zipbul/common';

import { seal } from '@zipbul/baker';

import { Container } from '../injector/container';
import { runInitHooks, runDestroyHooks } from '../injector/lifecycle-runner';
import { formatToken } from '../injector/token-resolver';
import { getRuntimeContext } from '../runtime/runtime-context';
import type { AdapterEntry, AddAdapterConfig, CreateApplicationOptions } from './interfaces';

export class AppContext implements Context {
  readonly container: ZipbulContainer;

  constructor(container: ZipbulContainer) {
    this.container = container;
  }

  getType(): string {
    return 'application';
  }

  get(_key: string): ZipbulValue | undefined {
    return undefined;
  }

  to<TContext extends ZipbulValue>(_ctor: ClassToken<TContext>): TContext {
    throw new Error('Context.to() is not supported in application context');
  }
}

export class Application {
  private readonly container: Container;
  private readonly adapters: AdapterEntry[] = [];
  private startOrder: AdapterEntry[] = [];
  private started = false;
  private stopped = false;

  constructor(container?: Container) {
    this.container = container ?? new Container();
  }

  /**
   * Retrieves a provider instance from the root container.
   * Accepts class references, symbols, or string tokens.
   * Only singleton providers with visibleTo='all' are accessible.
   *
   * @param token - The provider token to look up (e.g. `UsersService` class)
   * @returns The resolved provider instance
   * @throws When the provider is not singleton or not visibleTo='all'
   * @public
   */
  public get(token: ProviderToken): ZipbulValue {
    const registration = this.container.getRegistration(token);

    if (registration) {
      if (registration.scope !== 'singleton') {
        const label = formatToken(token);

        throw new Error(
          `[Zipbul DI] app.get('${label}') is restricted to singleton providers. Provider scope: '${registration.scope}'.`,
        );
      }

      if (registration.visibleTo !== 'all') {
        const label = formatToken(token);
        const visibility = typeof registration.visibleTo === 'string' ? registration.visibleTo : 'allowlist';

        throw new Error(
          `[Zipbul DI] app.get('${label}') is restricted to providers with visibleTo='all'. Current visibility: '${visibility}'.`,
        );
      }
    }

    return this.container.get(token);
  }

  public getContainer(): ZipbulContainer {
    return this.container;
  }

  /**
   * Registers an adapter instance into the application.
   *
   * When registering a single instance of a given adapter class, `config` (and `name`)
   * may be omitted. When registering multiple instances of the same class, a unique
   * `name` is required on each to distinguish them.
   *
   * @param adapter - The adapter instance to register.
   * @param config - Optional configuration (name, dependsOn).
   *
   * @public
   */
  public addAdapter(adapter: Adapter, config?: AddAdapterConfig): void {
    if (this.started) {
      throw new Error('Cannot add adapter after application has started');
    }

    const adapterClass = adapter.constructor as AdapterClass;
    const name = config?.name;
    const dependsOn = config?.dependsOn ?? [];

    const existingWithSameClass = this.adapters.filter(
      (entry) => entry.adapterClass === adapterClass,
    );

    if (existingWithSameClass.length > 0) {
      if (name === undefined) {
        throw new Error(
          `${adapterClass.name} is registered multiple times. Provide a 'name' to distinguish each instance.`,
        );
      }

      const hasUnnamed = existingWithSameClass.some((entry) => entry.name === undefined);

      if (hasUnnamed) {
        throw new Error(
          `${adapterClass.name} is registered multiple times. Provide a 'name' to distinguish each instance.`,
        );
      }

      const hasDuplicateName = existingWithSameClass.some((entry) => entry.name === name);

      if (hasDuplicateName) {
        throw new Error(
          `Adapter "${name}" is already registered for ${adapterClass.name}.`,
        );
      }
    }

    this.adapters.push({
      adapter,
      adapterClass,
      name,
      dependsOn,
    });
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error('Application has already started');
    }

    this.started = true;
    const context = new AppContext(this.container);
    this.startOrder = this.topologicalSort();
    seal();
    await runInitHooks(this.container);

    const runtimeCtx = getRuntimeContext();

    for (const entry of this.startOrder) {
      const configKey = this.resolveAdapterConfigKey(entry);
      const config = runtimeCtx.adapterConfig?.[configKey];

      if (config?.middlewares) {
        for (const hook of Object.values(MiddlewareHook)) {
          const middlewares = config.middlewares[hook];

          if (middlewares !== undefined && middlewares.length > 0) {
            entry.adapter.addMiddlewares(hook, middlewares);
          }
        }
      }
    }

    const started: AdapterEntry[] = [];

    try {
      for (const entry of this.startOrder) {
        await entry.adapter.start(context);
        started.push(entry);
      }
    } catch (error) {
      for (const entry of started.reverse()) {
        try {
          await entry.adapter.stop();
        } catch {
          // best-effort cleanup — suppress to preserve original error
        }
      }
      this.stopped = true;
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      throw new Error('Application has not been started');
    }

    if (this.stopped) {
      throw new Error('Application has already stopped');
    }

    this.stopped = true;
    const entries = [...this.startOrder].reverse();

    for (const entry of entries) {
      await entry.adapter.stop();
    }

    await runDestroyHooks(this.container);
  }

  public attach(): void {
    //
  }

  /**
   * Resolves the adapter config key for runtime context lookup.
   * Uses `name` if provided, otherwise falls back to the class name.
   */
  private resolveAdapterConfigKey(entry: AdapterEntry): string {
    return entry.name ?? entry.adapterClass.name;
  }

  /**
   * Topological sort of adapters based on dependsOn DAG (Kahn's algorithm).
   * Uses adapter class references as node identifiers.
   * Returns adapters in dependency-first order.
   * Throws if a cycle is detected (defensive — build-time should catch this).
   */
  private topologicalSort(): AdapterEntry[] {
    const entries = this.adapters;
    if (entries.length === 0) return [];

    const entryIndex = new Map<AdapterEntry, number>();
    const inDegree = new Map<AdapterEntry, number>();
    const dependents = new Map<AdapterEntry, AdapterEntry[]>();

    for (const [index, entry] of entries.entries()) {
      entryIndex.set(entry, index);
      inDegree.set(entry, 0);
      dependents.set(entry, []);
    }

    for (const entry of entries) {
      for (const dep of entry.dependsOn) {
        const depEntries = typeof dep === 'string'
          ? entries.filter((candidate) => candidate.name === dep)
          : entries.filter((candidate) => candidate.adapterClass === dep);

        for (const depEntry of depEntries) {
          dependents.get(depEntry)!.push(entry);
          inDegree.set(entry, (inDegree.get(entry) ?? 0) + 1);
        }
      }
    }

    const queue: AdapterEntry[] = [];

    for (const entry of entries) {
      if (inDegree.get(entry) === 0) {
        queue.push(entry);
      }
    }

    const sorted: AdapterEntry[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const neighbor of dependents.get(current)!) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);

        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (sorted.length !== entries.length) {
      throw new Error(
        'Cycle detected in adapter dependency graph',
      );
    }

    return sorted;
  }
}

function createApplication(
  _entryModuleMarker: ModuleMarker,
  _options?: CreateApplicationOptions,
): Application {
  const ctx = getRuntimeContext();

  return new Application(ctx.container);
}

export { createApplication };
