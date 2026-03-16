import type { ZipbulRecord, ZipbulContainer, CompiledHandlerEntry } from '@zipbul/common';
import { MiddlewareHook } from '@zipbul/common';
import type { RpcArgs, RpcCallable } from '@zipbul/core/src/cluster/types';

import { ClusterBaseWorker, Container, type ClusterWorkerId, expose, getRuntimeContext } from '@zipbul/core';
import { Logger } from '@zipbul/logger';

import type { HttpServerBootOptions, HttpWorkerInitParams } from './interfaces';

import { HttpAdapter } from './http-adapter';
import { HttpServer } from './http-server';

class HttpWorker extends ClusterBaseWorker {
  private readonly logger = new Logger('HttpAdapter');
  private httpServer: HttpServer;

  constructor() {
    super();
  }

  getId() {
    return this.id;
  }

  override async init(workerId: ClusterWorkerId, params: Parameters<ClusterBaseWorker['init']>[1]) {
    await super.init(workerId, params);
    await Logger.runScoped(this.logger, () => this.initInternal(workerId, params));
  }

  private async initInternal(_workerId: ClusterWorkerId, params: Parameters<ClusterBaseWorker['init']>[1]): Promise<void> {
    this.logger.info(`Zipbul HTTP Worker #${_workerId} is initializing...`);

    if (!this.isHttpWorkerInitParams(params)) {
      throw new Error('Invalid worker init params for HttpWorker.');
    }

    const { options, entryModule } = params;
    const manifestPath = entryModule.manifestPath;

    // Step 1: Load AOT manifest module (triggers registerRuntimeContext as side effect)
    if (typeof manifestPath === 'string' && manifestPath.length > 0) {
      this.logger.info(`AOT Worker Load: ${manifestPath}`);
      await import(manifestPath);
    }

    const runtimeCtx = getRuntimeContext();
    const container: ZipbulContainer = runtimeCtx.container ?? new Container();

    // Step 2: Create HttpAdapter instance
    const adapter = new HttpAdapter(options);

    // Step 3: Wire pipeline from adapterConfig
    const configKey = adapter.constructor.name;
    const config = runtimeCtx.adapterConfig?.[configKey];

    if (config?.middlewares !== undefined) {
      for (const hook of Object.values(MiddlewareHook)) {
        const middlewares = config.middlewares[hook];

        if (middlewares !== undefined && middlewares.length > 0) {
          adapter.addMiddlewares(hook, middlewares);
        }
      }
    }

    if (config?.exceptionFilters !== undefined && config.exceptionFilters.length > 0) {
      adapter.addExceptionFilters(config.exceptionFilters);
    }

    if (config?.guards !== undefined && config.guards.length > 0) {
      adapter.addGuards(config.guards);
    }

    adapter.initializePipeline(container);

    // Step 4: Build controllerInstances from handlerIndex
    const handlerIndex = runtimeCtx.handlerIndex ?? [];
    const controllerInstances = runtimeCtx.controllerInstances ?? this.buildControllerInstances(handlerIndex, container);

    // Step 5: Boot HttpServer with adapter
    this.httpServer = new HttpServer();

    const bootOptions: HttpServerBootOptions = {
      ...options,
      ...(handlerIndex.length > 0 ? { handlerIndex } : {}),
      ...(controllerInstances.size > 0 ? { controllerInstances } : {}),
    };

    await this.httpServer.boot(container, bootOptions, adapter);
  }

  bootstrap() {
    this.logger.info(`Zipbul HTTP Worker #${this.id} is bootstrapping...`);
  }

  destroy() {
    this.logger.info(`Worker #${this.id} is destroying...`);
  }

  private buildControllerInstances(handlerIndex: readonly CompiledHandlerEntry[], container: ZipbulContainer): Map<string, unknown> {
    const instances = new Map<string, unknown>();

    for (const entry of handlerIndex) {
      if (instances.has(entry.controllerKey)) {
        continue;
      }

      try {
        instances.set(entry.controllerKey, container.get(entry.controllerKey));
      } catch (error) {
        this.logger.warn(`Failed to resolve controller: ${entry.controllerKey}`, error instanceof Error ? error : undefined);
      }
    }

    return instances;
  }

  private isHttpWorkerInitParams(value: unknown): value is HttpWorkerInitParams {
    if (!this.isRecord(value)) {
      return false;
    }

    const entryModule = value.entryModule;
    const options = value.options;

    if (!this.isRecord(entryModule)) {
      return false;
    }

    if (typeof entryModule.className !== 'string') {
      return false;
    }

    return this.isRecord(options);
  }

  private isRecord(value: unknown): value is ZipbulRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

const worker = new HttpWorker();

const initWorker: RpcCallable = async (...args: RpcArgs) => {
  const workerId = typeof args[0] === 'number' ? args[0] : 0;
  const params = args.length > 1 && isZipbulRecord(args[1]) ? args[1] : undefined;

  await worker.init(workerId, params);

  return null;
};

const bootstrapWorker: RpcCallable = () => {
  worker.bootstrap();

  return null;
};

const destroyWorker: RpcCallable = () => {
  worker.destroy();

  return null;
};

const getWorkerStats: RpcCallable = () => {
  const stats = worker.getStats();

  return { cpu: stats.cpu, memory: stats.memory };
};

expose({
  init: initWorker,
  bootstrap: bootstrapWorker,
  destroy: destroyWorker,
  getStats: getWorkerStats,
});

function isZipbulRecord(value: unknown): value is ZipbulRecord {
  return typeof value === 'object' && value !== null;
}

export { HttpWorker };
