import type { ZipbulAdapter, ZipbulRecord, Class, Context, ExceptionFilterToken } from '@zipbul/common';

import { ClusterManager, getRuntimeContext, type ClusterBaseWorker } from '@zipbul/core';

import type {
  ClassMetadata as CoreClassMetadata,
  ConstructorParamMetadata as CoreConstructorParamMetadata,
  DecoratorMetadata as CoreDecoratorMetadata,
} from '../../core/src/injector/types';
import type {
  ZipbulHttpInternalChannel,
  ZipbulHttpServerBootOptions,
  ZipbulHttpServerOptions,
  HttpAdapterStartContext,
  HttpMiddlewareRegistry,
  InternalRouteHandler,
  InternalRouteEntry,
  MiddlewareRegistrationInput,
} from './interfaces';
import type { ClassMetadata, HttpWorkerRpc, MetadataRegistryKey, ParamTypeReference } from './types';

import { ZipbulHttpServer } from './zipbul-http-server';
import { HttpMiddlewareLifecycle } from './interfaces';

const ZIPBUL_HTTP_INTERNAL = Symbol.for('zipbul:http:internal');

export class ZipbulHttpAdapter implements ZipbulAdapter {
  private options: ZipbulHttpServerOptions;
  private clusterManager: ClusterManager<ClusterBaseWorker & HttpWorkerRpc> | undefined;
  private httpServer: ZipbulHttpServer | undefined;

  private [ZIPBUL_HTTP_INTERNAL]?: ZipbulHttpInternalChannel;

  private internalRoutes: InternalRouteEntry[] = [];

  private middlewareRegistry: HttpMiddlewareRegistry = {};

  private errorFilterTokens: ExceptionFilterToken[] = [];

  constructor(options: ZipbulHttpServerOptions = {}) {
    const normalizedOptions: ZipbulHttpServerOptions = {
      port: 5000,
      bodyLimit: 10 * 1024 * 1024,
      trustProxy: false,
      ...options,
      name: 'zipbul-http',
      logLevel: 'debug',
    };

    this.options = normalizedOptions;

    this[ZIPBUL_HTTP_INTERNAL] = {
      get: (path: string, handler: InternalRouteHandler) => {
        this.internalRoutes.push({ method: 'GET', path, handler });
      },
    };
  }

  public addMiddlewares(lifecycle: HttpMiddlewareLifecycle, middlewares: readonly MiddlewareRegistrationInput[]): this {
    const current = this.middlewareRegistry[lifecycle];
    const updated = current ? [...current, ...middlewares] : [...middlewares];

    this.middlewareRegistry[lifecycle] = updated;

    return this;
  }

  public addErrorFilters(filters: readonly ExceptionFilterToken[]): this {
    this.errorFilterTokens.push(...filters);

    return this;
  }

  async start(context: Context): Promise<void> {
    const startContext = this.toStartContext(context);
    const workers = this.options.workers;
    const isSingleProcess = workers === undefined || workers === 1;

    if (isSingleProcess) {
      this.httpServer = new ZipbulHttpServer();

      const runtimeContext = getRuntimeContext();
      const metadata = this.normalizeMetadataRegistry(runtimeContext.metadataRegistry);
      const scopedKeys = runtimeContext.scopedKeys;
      const bootOptions: ZipbulHttpServerBootOptions = {
        ...this.options,
        ...(metadata !== undefined ? { metadata } : {}),
        ...(scopedKeys !== undefined ? { scopedKeys } : {}),
        middlewares: this.middlewareRegistry,
        errorFilters: this.errorFilterTokens,
        internalRoutes: this.internalRoutes,
      };

      await this.httpServer.boot(startContext.container, bootOptions);

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
        middlewares: this.middlewareRegistry,
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

  public getInternalChannel(): ZipbulHttpInternalChannel | undefined {
    return this[ZIPBUL_HTTP_INTERNAL];
  }

  protected resolveWorkerScript(): URL {
    const isAotRuntime = getRuntimeContext().isAotRuntime === true;

    if (isAotRuntime) {
      return new URL('./zipbul-http-worker.ts', import.meta.url);
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
