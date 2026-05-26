import type {
  ApplicationContext,
  ProviderToken,
  AdapterClass,
  ZipbulContainer,
  ZipbulValue,
  ModuleMarker,
} from '@zipbul/common';
import { seal } from '@zipbul/baker';
import { ClusterStrategy } from '@zipbul/common';
import { Logger } from '@zipbul/logger';

import { ClusterManager } from '../cluster/cluster-manager';
import type { ClusterBaseWorker } from '../cluster/cluster-base-worker';
import type { RpcCallable } from '../cluster/types';
import { Container } from '../injector/container';
import { runInitHooks, runDestroyHooks } from '../injector/lifecycle-runner';
import { formatToken } from '../injector/token-resolver';
import { getBootstrapState, clearMetadataRegistry } from '../runtime/bootstrap-state';
import type { AdapterEntry, AttachOptions, CreateApplicationOptions } from './interfaces';

export class AppContext implements ApplicationContext {
  readonly container: ZipbulContainer;

  constructor(container: ZipbulContainer) {
    this.container = container;
  }
}

type TestWorkerRpc = ClusterBaseWorker & Record<string, RpcCallable>;

export class Application {
  private readonly container: Container;
  private readonly logger = new Logger(Application.name);
  private readonly adapters: AdapterEntry[] = [];
  private readonly clusterManagers: Array<ClusterManager<TestWorkerRpc>> = [];
  private readonly options: CreateApplicationOptions;
  private startOrder: AdapterEntry[] = [];
  private started = false;
  private stopped = false;
  private startPromise: Promise<void> | undefined;

  constructor(container?: Container, options?: CreateApplicationOptions) {
    this.container = container ?? new Container();
    this.options = options ?? {};
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
   * Attaches an adapter to the application.
   *
   * Accepts the adapter class and its constructor options merged with
   * framework-level registration options (`name`, `dependsOn`).
   * When registering multiple instances of the same class, a unique
   * `name` is required on each to distinguish them.
   *
   * @param adapterClass - The adapter class to instantiate and attach.
   * @param options - Adapter constructor options merged with attach options.
   *
   * @public
   */
  public attach<TAdapter extends AdapterClass>(
    adapterClass: TAdapter,
    options?: AttachOptions<TAdapter>,
  ): InstanceType<TAdapter> {
    if (this.started) {
      throw new Error('Cannot attach adapter after application has started');
    }

    const { name, dependsOn: dependsOnRaw, ...adapterOptions } = options ?? {} as AttachOptions<TAdapter>;
    const dependsOn = dependsOnRaw ?? [];
    const adapter = new adapterClass(Object.keys(adapterOptions).length > 0 ? adapterOptions : undefined);

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

    return adapter as InstanceType<TAdapter>;
  }

  public async start(): Promise<void> {
    if (this.started) {
      throw new Error('Application has already started');
    }

    this.started = true;
    this.startPromise = this.executeStart({ testMode: false });

    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  /**
   * Test-mode start. Runs the full lifecycle — topo sort, init hooks,
   * adapter config application, pipeline init — but invokes
   * `adapter.startTest(ctx)` instead of `adapter.start(ctx)`. Adapters
   * that do not implement `startTest` are skipped (their providers
   * stay registered, their test surface — if any — remains callable;
   * no transport binds).
   *
   * Cluster mode (`workers > 1`) is rejected here: tests run in a
   * single process and cannot drive Bun Worker children through the
   * in-process inject path.
   *
   * @public
   */
  public async startTest(): Promise<void> {
    if (this.started) {
      throw new Error('Application has already started');
    }

    const workers = this.options.workers;
    if (workers !== undefined && workers > 1) {
      throw new Error(
        `Cannot use Application.startTest() with workers: ${workers}. ` +
        `Cluster mode spawns Bun Workers that bind real ports — incompatible ` +
        `with the in-process test path. Test cluster behavior separately ` +
        `(see packages/framework/core/test/e2e/cluster.e2e.test.ts).`,
      );
    }

    this.started = true;
    this.startPromise = this.executeStart({ testMode: true });

    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  /**
   * Retrieves an attached adapter instance by class. When the same class
   * is attached multiple times (each with a unique `name`), pass `name`
   * to disambiguate.
   *
   * @public
   */
  public getAdapter<T extends AdapterClass>(
    adapterClass: T,
    options?: { name?: string },
  ): InstanceType<T> {
    const matches = this.adapters.filter((e) => e.adapterClass === adapterClass);

    if (matches.length === 0) {
      throw new Error(`Adapter "${adapterClass.name}" is not attached to this application.`);
    }

    const wantName = options?.name;

    if (wantName === undefined) {
      if (matches.length > 1) {
        throw new Error(
          `Adapter "${adapterClass.name}" has ${matches.length} instances. ` +
          `Pass { name } to disambiguate.`,
        );
      }
      return matches[0]!.adapter as InstanceType<T>;
    }

    const named = matches.find((e) => e.name === wantName);
    if (named === undefined) {
      throw new Error(
        `Adapter "${adapterClass.name}" with name "${wantName}" is not attached.`,
      );
    }
    return named.adapter as InstanceType<T>;
  }

  private async executeStart(opts: { testMode: boolean }): Promise<void> {
    const context = new AppContext(this.container);
    this.startOrder = this.topologicalSort();

    // In worker mode, filter adapters to only those assigned to this group
    const adapterFilter = this.resolveAdapterFilter();

    if (adapterFilter !== undefined) {
      this.startOrder = this.startOrder.filter(
        (entry) => adapterFilter.has(entry.adapterClass.name),
      );
    }

    // Cluster mode: master process spawns workers instead of starting adapters directly
    const isWorker = getBootstrapState().workerId !== undefined;
    const workers = this.options.workers;
    const isClusterMode = !isWorker && workers !== undefined && workers > 1;

    if (isClusterMode) {
      await this.startClusterMode(workers);

      return;
    }

    await runInitHooks(this.container);

    const bootstrapState = getBootstrapState();

    for (const entry of this.startOrder) {
      const configKey = this.resolveAdapterConfigKey(entry);
      const config = bootstrapState.adapterConfig?.[configKey];

      if (config?.middlewares !== undefined) {
        entry.adapter.applyMiddlewareConfig(config.middlewares);
      }

      if (config?.exceptionFilters !== undefined && config.exceptionFilters.length > 0) {
        entry.adapter.addExceptionFilters(config.exceptionFilters);
      }

      if (config?.guards !== undefined && config.guards.length > 0) {
        entry.adapter.addGuards(config.guards);
      }
    }

    for (const entry of this.startOrder) {
      entry.adapter.initializePipeline(this.container);
    }

    seal();

    const started: AdapterEntry[] = [];

    try {
      for (const entry of this.startOrder) {
        if (opts.testMode === true) {
          // Adapters without startTest are silently skipped in test mode:
          // they remain attached (providers registered, surface callable),
          // but no transport binds and no start hook fires. This matches
          // the toolkit's policy of letting a test target one adapter
          // (e.g., HttpAdapter) without forcing every other attached
          // adapter (e.g., TickAdapter) to implement test support.
          if (typeof entry.adapter.startTest === 'function') {
            await entry.adapter.startTest(context);
            started.push(entry);
          }
          continue;
        }
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

      try {
        await runDestroyHooks(this.container);
      } catch {
        // best-effort cleanup — suppress to preserve original error
      }

      this.stopped = true;
      throw error;
    }

    // INVARIANTS §4 — Metadata Volatility: 부트스트랩 완료 후 설계도 소거
    clearMetadataRegistry();
  }

  // ── Cluster Mode ──────────────────────────────────────────

  private async startClusterMode(workerCount: number): Promise<void> {
    if (process.platform !== 'linux') {
      throw new Error(
        `Cluster mode (workers: ${workerCount}) requires Linux. ` +
        `${process.platform} does not support SO_REUSEPORT load balancing.`,
      );
    }

    const groups = this.resolveWorkerGroups(workerCount);
    const workerScript = this.resolveWorkerScript();
    const bootstrapState = getBootstrapState();
    const manifestPath = bootstrapState.isAotRuntime === true ? this.resolveManifestPath() : undefined;
    const preload = manifestPath !== undefined ? [manifestPath] : [];

    for (const group of groups) {
      const manager = new ClusterManager<TestWorkerRpc>(
        { script: workerScript, size: group.workers },
        {
          adapterFilter: group.adapterNames,
          preload,
          smol: false,
        },
      );

      this.clusterManagers.push(manager);

      await manager.init();
      await manager.bootstrap();
      manager.startHealthCheck();
    }

    this.logger.info(`Cluster started: ${groups.length} group(s), ${groups.reduce((sum, g) => sum + g.workers, 0)} total workers`);
  }

  private resolveWorkerGroups(workerCount: number): ReadonlyArray<{ adapterNames: string[]; workers: number }> {
    const explicitGroups = this.options.cluster;

    if (explicitGroups !== undefined && explicitGroups.length > 0) {
      return explicitGroups.map((group) => ({
        adapterNames: group.adapters.map((cls) => cls.name),
        workers: group.workers ?? 1,
      }));
    }

    // Auto-grouping: Shared adapters → main group, Exclusive → exclusive group
    const sharedAdapters: string[] = [];
    const exclusiveAdapters: string[] = [];

    for (const entry of this.adapters) {
      if (entry.adapter.clusterStrategy === ClusterStrategy.Exclusive) {
        exclusiveAdapters.push(entry.adapterClass.name);
      } else {
        sharedAdapters.push(entry.adapterClass.name);
      }
    }

    const groups: Array<{ adapterNames: string[]; workers: number }> = [];

    if (sharedAdapters.length > 0) {
      groups.push({ adapterNames: sharedAdapters, workers: workerCount });
    }

    if (exclusiveAdapters.length > 0) {
      groups.push({ adapterNames: exclusiveAdapters, workers: 1 });
    }

    return groups;
  }

  private resolveWorkerScript(): URL {
    const bootstrapState = getBootstrapState();

    if (bootstrapState.isAotRuntime === true) {
      const entryPath = Bun.argv[1] ?? '';
      const entryDir = entryPath.lastIndexOf('/') >= 0 ? entryPath.slice(0, entryPath.lastIndexOf('/')) : '.';

      return new URL(`file://${entryDir}/worker.js`);
    }

    return new URL('../cluster/application-worker.ts', import.meta.url);
  }

  private resolveManifestPath(): string {
    const entryPath = Bun.argv[1] ?? '';
    const entryDir = entryPath.lastIndexOf('/') >= 0 ? entryPath.slice(0, entryPath.lastIndexOf('/')) : '.';
    const ext = entryPath.endsWith('.ts') ? '.ts' : '.js';

    return `${entryDir}/runtime${ext}`;
  }

  /**
   * In worker mode, reads adapter filter from BootstrapState
   * to determine which adapters this worker should start.
   *
   * @returns Set of adapter class names, or undefined if not in worker mode.
   */
  private resolveAdapterFilter(): Set<string> | undefined {
    const bootstrapState = getBootstrapState();

    if (bootstrapState.workerId === undefined) {
      return undefined;
    }

    const filter = bootstrapState.adapterFilter;

    if (filter === undefined || filter.length === 0) {
      return undefined; // No filter = start all adapters
    }

    return new Set(filter);
  }

  /**
   * Gracefully stops the application.
   * Idempotent — safe to call multiple times or before start.
   * Never throws — all errors are logged and swallowed.
   *
   * @public
   */
  public async stop(): Promise<void> {
    if (!this.started || this.stopped) {
      return;
    }

    if (this.startPromise !== undefined) {
      try {
        await this.startPromise;
      } catch {
        // start failed — cleanup already happened in executeStart
      }
    }

    if (this.stopped) {
      return;
    }

    this.stopped = true;

    // Cluster mode: destroy all ClusterManagers
    for (const manager of this.clusterManagers) {
      try {
        await manager.destroy();
      } catch (error) {
        this.logger.error('ClusterManager destroy failed', error instanceof Error ? error : undefined);
      }
    }

    this.clusterManagers.length = 0;

    // Single-process mode: stop adapters directly
    const entries = [...this.startOrder].reverse();

    for (const entry of entries) {
      try {
        await entry.adapter.stop();
      } catch (error) {
        this.logger.error(`Adapter stop failed: ${entry.adapterClass.name}`, error instanceof Error ? error : undefined);
      }
    }

    try {
      await runDestroyHooks(this.container);
    } catch (error) {
      this.logger.error('Destroy hooks failed', error instanceof Error ? error : undefined);
    }
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
  options?: CreateApplicationOptions,
): Application {
  const ctx = getBootstrapState();

  return new Application(ctx.container, options);
}

export { createApplication };
