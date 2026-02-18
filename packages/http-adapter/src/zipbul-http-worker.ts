import type { ZipbulRecord, ZipbulValue, ProviderToken } from '@zipbul/common';
import type { RpcArgs, RpcCallable } from '@zipbul/core/src/cluster/types';

import { ClusterBaseWorker, Container, type ClusterWorkerId, expose } from '@zipbul/core';
import { Logger } from '@zipbul/logger';

import type { ZipbulHttpServerBootOptions, HttpWorkerInitParams, HttpWorkerManifest } from './interfaces';
import type { ClassMetadata, ControllerConstructor } from './types';

import { ZipbulHttpServer } from './zipbul-http-server';

class ZipbulHttpWorker extends ClusterBaseWorker {
  private logger = new Logger(ZipbulHttpWorker.name);
  private httpServer: ZipbulHttpServer;

  constructor() {
    super();
  }

  getId() {
    return this.id;
  }

  override async init(workerId: ClusterWorkerId, params: Parameters<ClusterBaseWorker['init']>[1]) {
    await super.init(workerId, params);

    this.logger.info(`🔧 Zipbul HTTP Worker #${workerId} is initializing...`);

    if (!this.isHttpWorkerInitParams(params)) {
      throw new Error('Invalid worker init params for ZipbulHttpWorker.');
    }

    const { options, entryModule } = params;
    const manifestPath = entryModule.manifestPath;
    const manifest = entryModule.manifest;

    if (this.isHttpWorkerManifest(manifest)) {
      if (typeof manifestPath === 'string' && manifestPath.length > 0) {
        this.logger.info(`⚡ AOT Worker Load: ${manifestPath}`);
      }

      const container = manifest.createContainer();
      const metadataRegistry = manifest.createMetadataRegistry?.() ?? new Map<ControllerConstructor, ClassMetadata>();
      const scopedKeysMap = manifest.createScopedKeysMap?.() ?? new Map<ProviderToken, string>();

      if (typeof manifest.registerDynamicModules === 'function') {
        this.logger.info('⚡ Loading Dynamic Modules...');

        await manifest.registerDynamicModules(container);
      }

      this.httpServer = new ZipbulHttpServer();

      // Pass combined options including metadata for Runtime to use
      const bootOptions: ZipbulHttpServerBootOptions = {
        ...options,
        metadata: metadataRegistry,
        scopedKeys: scopedKeysMap,
      };

      await this.httpServer.boot(container, bootOptions);
    } else {
      if (typeof manifestPath === 'string' && manifestPath.length > 0) {
        this.logger.warn('⚠️ AOT manifest path provided but manifest module is missing. Falling back to JIT.');
      }

      this.logger.warn('⚠️ Standard Mode (JIT) - Booting without AOT Manifest');

      // Basic JIT Container Setup
      const container = new Container();

      this.httpServer = new ZipbulHttpServer();

      // Boot without pre-compiled metadata - Runtime will rely on what's available
      await this.httpServer.boot(container, options);
    }
  }

  bootstrap() {
    this.logger.info(`🚀 Zipbul HTTP Worker #${this.id} is bootstrapping...`);
  }

  destroy() {
    this.logger.info(`🛑 Worker #${this.id} is destroying...`);
  }

  private isHttpWorkerManifest(value: ZipbulValue | undefined): value is HttpWorkerManifest {
    if (!this.isRecord(value)) {
      return false;
    }

    const createContainer = value.createContainer;

    return typeof createContainer === 'function';
  }

  private isHttpWorkerInitParams(value: ZipbulValue): value is HttpWorkerInitParams {
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

  private isRecord(value: ZipbulValue | undefined): value is ZipbulRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

const worker = new ZipbulHttpWorker();

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

function isZipbulRecord(value: ZipbulValue): value is ZipbulRecord {
  return typeof value === 'object' && value !== null;
}

export { ZipbulHttpWorker };
