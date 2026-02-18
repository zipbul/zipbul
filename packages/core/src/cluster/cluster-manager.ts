import { Logger } from '@zipbul/logger';
import { backOff } from 'exponential-backoff'; // Consider removing if complex retry logic handles native restarts differently, but keeping for now.

import type { ClusterBaseWorker } from './cluster-base-worker';
import type { ClusterWorker, ClusterOptions } from './interfaces';
import type { ClusterBootstrapParams, ClusterInitParams, RpcCallable } from './types';

import { wrap } from './ipc';

export class ClusterManager<T extends ClusterBaseWorker & Record<string, RpcCallable>> {
  private readonly script: URL;
  private readonly reviving = new Set<number>();
  private readonly workers: Array<ClusterWorker<T> | undefined>;
  private readonly logger = new Logger(ClusterManager.name);
  private destroying = false;
  private initParams: ClusterInitParams<T>;
  private bootstrapParams: ClusterBootstrapParams<T>;

  constructor(options: ClusterOptions) {
    const size = options?.size ?? navigator.hardwareConcurrency;

    this.script = options.script;
    this.workers = Array.from({ length: size }, (_, id) => this.spawnWorker(id));
  }

  async destroy() {
    this.destroying = true;

    await Promise.all(this.workers.map(async (_, id) => this.destroyWorker(id)));
  }

  // 'call' method removed - no longer needed for native cluster

  async init(params?: ClusterInitParams<T>) {
    this.initParams = params;

    const tasks = this.workers.map(async (worker, id) => {
      if (!worker) {
        return;
      }

      await worker.remote.init(id, params);
    });

    await Promise.all(tasks);
  }

  async bootstrap(params?: ClusterBootstrapParams<T>) {
    this.bootstrapParams = params;

    const tasks = this.workers.map(async worker => {
      if (!worker) {
        return;
      }

      await worker.remote.bootstrap(params);
    });

    await Promise.all(tasks);
  }

  private spawnWorker(id: number): ClusterWorker<T> {
    const native = new Worker(this.script.href, {
      env: {
        ...Bun.env,
        ZIPBUL_WORKER_ID: id.toString(),
      },
      smol: true, // Optional: memory optimization
    });

    native.addEventListener('error', (event: ErrorEvent) => {
      void this.handleCrash('error', id, event);
    });
    native.addEventListener('messageerror', (event: MessageEvent) => {
      void this.handleCrash('messageerror', id, event);
    });
    native.addEventListener('close', (event: Event) => {
      void this.handleCrash('close', id, event);
    });

    return { remote: wrap<T>(native, ['init', 'bootstrap']), native };
  }

  private async handleCrash(event: 'error' | 'messageerror' | 'close', id: number, error: Event) {
    if (this.destroying) {
      return;
    }

    const meta = error instanceof Error ? error : { error: error instanceof Event ? error.type : 'unknown' };

    this.logger.error(`💥 Worker #${id} ${event}: `, meta);

    try {
      await this.destroyWorker(id);
    } catch {}

    this.workers[id] = undefined;

    this.reviveWorker(id);
  }

  private reviveWorker(id: number) {
    if (this.destroying || this.reviving.has(id)) {
      return;
    }

    this.reviving.add(id);

    let attempt = 0;

    void (async () => {
      try {
        await backOff(
          async () => {
            if (this.destroying) {
              this.reviving.delete(id);

              throw new Error();
            }

            ++attempt;

            this.logger.info(`🩺 Revive attempt ${attempt} for worker #${id}`);

            const worker = this.spawnWorker(id);

            await worker.remote.init(id, this.initParams);
            await worker.remote.bootstrap(this.bootstrapParams);

            this.workers[id] = worker;

            this.reviving.delete(id);
          },
          {
            numOfAttempts: 50,
            startingDelay: 300,
            maxDelay: 30_000,
            timeMultiple: 2,
            jitter: 'full',
            delayFirstAttempt: true,
            retry: () => !this.destroying,
          },
        );
      } catch {
        this.reviving.delete(id);
      }
    })();
  }

  private async destroyWorker(id: number) {
    const worker = this.workers[id];

    if (!worker) {
      return;
    }

    this.reviving.delete(id);

    try {
      await worker.remote.destroy();
    } catch {} // Optional: if worker process kills itself, this might fail/timeout

    worker.native.terminate();
    // worker.remote[releaseProxy](); // No longer needed for native wrapper
  }
}
