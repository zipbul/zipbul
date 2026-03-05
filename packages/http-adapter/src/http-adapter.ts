import type { ZipbulRecord, Class, Context, AdapterEntryDecorators } from '@zipbul/common';
import { Adapter, MiddlewareHook } from '@zipbul/common';

import {
  ClusterManager,
  getRuntimeContext,
  type ClusterBaseWorker,
  type ClassMetadata as CoreClassMetadata,
  type ConstructorParamMetadata as CoreConstructorParamMetadata,
  type DecoratorMetadata as CoreDecoratorMetadata,
} from '@zipbul/core';
import type {
  HttpInternalChannel,
  HttpServerBootOptions,
  HttpServerOptions,
  HttpAdapterStartContext,
  InternalRouteHandler,
  InternalRouteEntry,
} from './interfaces';
import type { ClassMetadata, HttpWorkerRpc, MetadataRegistryKey, ParamTypeReference } from './types';

import { HttpServer } from './http-server';
import { RestController } from './decorators/class.decorator';
import { Get, Post, Put, Delete, Patch, Options, Head } from './decorators/method.decorator';

const HTTP_INTERNAL = Symbol.for('zipbul:http:internal');

export class HttpAdapter extends Adapter {
  readonly name = 'http';

  readonly decorators: AdapterEntryDecorators = {
    controller: RestController,
    handler: [Get, Post, Put, Delete, Patch, Options, Head],
  };

  private options: HttpServerOptions;
  private clusterManager: ClusterManager<ClusterBaseWorker & HttpWorkerRpc> | undefined;
  private httpServer: HttpServer | undefined;

  private [HTTP_INTERNAL]?: HttpInternalChannel;

  private internalRoutes: InternalRouteEntry[] = [];

  constructor(options: HttpServerOptions = {}) {
    super();

    const normalizedOptions: HttpServerOptions = {
      port: 5000,
      bodyLimit: 10 * 1024 * 1024,
      trustProxy: false,
      ...options,
      name: 'zipbul-http',
      logLevel: 'debug',
    };

    this.options = normalizedOptions;

    this[HTTP_INTERNAL] = {
      get: (path: string, handler: InternalRouteHandler) => {
        this.internalRoutes.push({ method: 'GET', path, handler });
      },
    };
  }

  async start(context: Context): Promise<void> {
    const startContext = this.toStartContext(context);
    const workers = this.options.workers;
    const isSingleProcess = workers === undefined || workers === 1;

    if (isSingleProcess) {
      this.httpServer = new HttpServer();

      const runtimeContext = getRuntimeContext();
      const metadata = this.normalizeMetadataRegistry(runtimeContext.metadataRegistry);
      const scopedKeys = runtimeContext.scopedKeys;
      const bootOptions: HttpServerBootOptions = {
        ...this.options,
        ...(metadata !== undefined ? { metadata } : {}),
        ...(scopedKeys !== undefined ? { scopedKeys } : {}),
        errorFilters: this.errorFilterTokens,
        internalRoutes: this.internalRoutes,
      };

      await this.httpServer.boot(startContext.container, bootOptions, this);

      return;
    }

    // === Multi Process Mode (Cluster) ===
    const entryModule = startContext.entryModule;

    if (!entryModule) {
      throw new Error('Entry Module not found in context. Cannot start Cluster Mode.');
    }

    const script = this.resolveWorkerScript();

    this.clusterManager = new ClusterManager<ClusterBaseWorker & HttpWorkerRpc>({
      script,
      size: workers,
    });

    const sanitizedEntryModule = {
      path: 'unknown',
      className: entryModule.name,
    };
    const initParams: ZipbulRecord = {
      entryModule: {
        path: sanitizedEntryModule.path,
        className: sanitizedEntryModule.className,
      },
      options: {
        ...this.options,
        errorFilters: this.errorFilterTokens,
      },
    };

    await this.clusterManager.init(initParams);
    await this.clusterManager.bootstrap();
  }

  async stop(): Promise<void> {
    if (this.clusterManager !== undefined) {
      await this.clusterManager.destroy();
    }
  }

  public getInternalChannel(): HttpInternalChannel | undefined {
    return this[HTTP_INTERNAL];
  }

  protected resolveWorkerScript(): URL {
    const isAotRuntime = getRuntimeContext().isAotRuntime === true;

    if (isAotRuntime) {
      return new URL('./http-worker.ts', import.meta.url);
    }

    return new URL(Bun.argv[1] ?? '', 'file://');
  }

  private toStartContext(context: Context): HttpAdapterStartContext {
    if (!this.isStartContext(context)) {
      throw new Error('Adapter context missing container.');
    }

    return context;
  }

  private isStartContext(value: Context): value is HttpAdapterStartContext {
    return typeof value === 'object' && value !== null && 'container' in value;
  }

  private normalizeMetadataRegistry(
    registry:
      | Map<MetadataRegistryKey, ClassMetadata | CoreClassMetadata>
      | Map<Class, ClassMetadata | CoreClassMetadata>
      | undefined,
  ): Map<MetadataRegistryKey, ClassMetadata> | undefined {
    if (!registry) {
      return undefined;
    }

    const normalized = new Map<MetadataRegistryKey, ClassMetadata>();

    for (const [key, value] of registry.entries()) {
      if (this.isClassToken(key)) {
        normalized.set(key, this.toHttpClassMetadata(value));
      }
    }

    return normalized;
  }

  private toHttpClassMetadata(value: ClassMetadata | CoreClassMetadata): ClassMetadata {
    if (this.isHttpClassMetadata(value)) {
      return value;
    }

    const decorators = value.decorators ? this.normalizeCoreDecorators(value.decorators) : undefined;
    const constructorParams = value.constructorParams ? this.normalizeCoreConstructorParams(value.constructorParams) : undefined;

    return {
      ...(decorators !== undefined ? { decorators } : {}),
      ...(constructorParams !== undefined ? { constructorParams } : {}),
    };
  }

  private isHttpClassMetadata(value: ClassMetadata | CoreClassMetadata): value is ClassMetadata {
    return 'methods' in value || 'className' in value;
  }

  private normalizeCoreDecorators(decorators: readonly CoreDecoratorMetadata[]): ClassMetadata['decorators'] {
    return decorators.map(decorator => ({ name: decorator.name }));
  }

  private normalizeCoreConstructorParams(params: readonly CoreConstructorParamMetadata[]): ClassMetadata['constructorParams'] {
    return params.map(param => {
      const type = this.isProviderToken(param.type) ? param.type : undefined;
      const decorators = param.decorators ? this.normalizeCoreDecorators(param.decorators) : undefined;

      return {
        ...(type !== undefined ? { type } : {}),
        ...(decorators !== undefined ? { decorators } : {}),
      };
    });
  }

  private isProviderToken(value: CoreConstructorParamMetadata['type']): value is ParamTypeReference {
    return typeof value === 'string' || typeof value === 'symbol' || typeof value === 'function';
  }

  private isClassToken(value: MetadataRegistryKey | Class): value is MetadataRegistryKey {
    return typeof value === 'function' && value.length === 0;
  }
}
