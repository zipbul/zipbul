import type {
  ProviderToken,
  Adapter,
  Context,
  ZipbulContainer,
  ZipbulValue,
  ClassToken,
  ModuleMarker,
} from '@zipbul/common';

import { seal } from '@zipbul/baker';

import { Container } from '../injector/container';
import { runInitHooks, runDestroyHooks } from '../injector/lifecycle-runner';
import { formatToken } from '../injector/token-resolver';
import { getRuntimeContext } from '../runtime/runtime-context';
import type { AdapterEntry, AddAdapterConfig, CreateApplicationOptions } from './interfaces';

export class AppContext implements Context {
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
  private readonly adapters: Map<string, AdapterEntry> = new Map();
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

  public addAdapter(adapter: Adapter, config: AddAdapterConfig): void {
    if (!config.name) {
      throw new Error('Adapter name must not be empty');
    }

    if (this.started) {
      throw new Error('Cannot add adapter after application has started');
    }

    if (this.adapters.has(config.name)) {
      throw new Error(`Adapter "${config.name}" is already registered`);
    }

    this.adapters.set(config.name, {
      adapter,
      name: config.name,
      protocol: config.protocol,
      dependsOn: config.dependsOn ?? 'standalone',
    });
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error('Application has already started');
    }

    this.started = true;
    const context = new AppContext();
    this.startOrder = this.topologicalSort();
    seal();
    await runInitHooks(this.container);
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
   * Topological sort of adapters based on dependsOn DAG (Kahn's algorithm).
   * Returns adapters in dependency-first order.
   * Throws if a cycle is detected (defensive — build-time should catch this).
   */
  private topologicalSort(): AdapterEntry[] {
    const entries = Array.from(this.adapters.values());
    if (entries.length === 0) return [];

    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const entry of entries) {
      inDegree.set(entry.name, 0);
      dependents.set(entry.name, []);
    }

    for (const entry of entries) {
      const deps =
        entry.dependsOn === 'standalone' || !entry.dependsOn
          ? []
          : entry.dependsOn;
      for (const dep of deps) {
        dependents.get(dep)!.push(entry.name);
        inDegree.set(entry.name, (inDegree.get(entry.name) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const entry of entries) {
      if (inDegree.get(entry.name) === 0) {
        queue.push(entry.name);
      }
    }

    const sorted: AdapterEntry[] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      sorted.push(this.adapters.get(name)!);
      for (const neighbor of dependents.get(name)!) {
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
