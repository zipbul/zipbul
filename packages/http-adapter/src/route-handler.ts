import type { CompiledHandlerEntry, ZipbulContainer, MiddlewareDefinition, ExceptionFilterEntry, GuardDefinition } from '@zipbul/common';

import { Logger } from '@zipbul/logger';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';
import type { RouteHandlerEntry } from './interfaces';
import type { MatchOutput, RouterOptions } from '@zipbul/router';
import { isHttpMethod } from './http-method';
import type {
  ClassMetadata,
  ControllerInstance,
  DecoratorArgument,
  InternalRouteDefinition,
  MetadataRegistryKey,
  RouteHandlerArgument,
  RouteHandlerFunction,
  RouteHandlerResult,
  RouteParamValue,
} from './types';

import { Router } from '@zipbul/router';
import { ParamResolver } from './param-resolver';

interface RouteHandlerDecoratorConfig {
  readonly adapterId: string;
  readonly controllerDecoratorName: string;
  readonly handlerDecoratorNames: readonly string[];
}

export class RouteHandler {
  private readonly metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>;
  private readonly decoratorConfig: RouteHandlerDecoratorConfig;
  private readonly container: ZipbulContainer | undefined;
  private readonly router: Router<RouteHandlerEntry>;
  private readonly paramResolver: ParamResolver;
  private readonly logger = Logger.inherit();

  constructor(
    metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>,
    decoratorConfig: RouteHandlerDecoratorConfig,
    routerOptions?: RouterOptions,
    container?: ZipbulContainer,
  ) {
    this.metadataRegistry = metadataRegistry;
    this.decoratorConfig = decoratorConfig;
    this.container = container;
    this.paramResolver = new ParamResolver(metadataRegistry);
    this.router = new Router<RouteHandlerEntry>({
      ignoreTrailingSlash: true,
      enableCache: true,
      ...routerOptions,
    });
  }

  match(method: string, path: string): MatchOutput<RouteHandlerEntry> | undefined {
    const normalized = method.toUpperCase();

    if (!isHttpMethod(normalized)) {
      return undefined;
    }

    return this.router.match(normalized, path) ?? undefined;
  }

  /**
   * Registers routes from AOT-compiled handler index.
   *
   * @param entries - Compiled handler entries from AOT.
   * @public
   */
  registerFromHandlerIndex(entries: readonly CompiledHandlerEntry[], controllerInstances?: Map<string, unknown>): void {
    let routeCount = 0;

    for (const entry of entries) {
      if (entry.adapterId !== this.decoratorConfig.adapterId) {
        continue;
      }

      const httpMethod = entry.handlerDecorator.toUpperCase();

      if (!isHttpMethod(httpMethod)) {
        continue;
      }

      const instance = controllerInstances?.get(entry.controllerKey);

      if (instance === undefined || instance === null) {
        this.logger.warn(`Cannot resolve controller: ${entry.controllerKey}`);

        continue;
      }

      if (!this.isControllerInstance(instance)) {
        this.logger.warn(`Invalid controller instance: ${entry.controllerKey}`);

        continue;
      }

      const handler = this.resolveHandler(instance, entry.methodName);
      const paramFactory = this.paramResolver.buildParamFactory(
        entry.params.map((param, index) => {
          const decorators = param.decoratorName !== undefined
            ? [{ name: param.decoratorName, arguments: [...(param.decoratorArgs ?? [])] as readonly DecoratorArgument[] }]
            : [];
          const meta: { index: number; name: string; type?: string; decorators: typeof decorators } = {
            index,
            name: param.name,
            decorators,
          };

          if (param.metatypeKey !== undefined) {
            meta.type = param.metatypeKey;
          }

          return meta;
        }),
      );

      const rawPath = typeof entry.handlerDecoratorArgs[0] === 'string' ? entry.handlerDecoratorArgs[0] : '';
      const controllerPrefix = this.getControllerPrefix(entry.controllerKey);
      const fullPath = '/' + [controllerPrefix, rawPath].filter(Boolean).join('/').replace(/\/+/g, '/');

      const middlewares = this.resolveMiddlewareKeys(entry.middlewareKeys ?? []);
      const errorFilters = this.resolveErrorFilterKeys(entry.errorFilterKeys ?? []);
      const guards = this.resolveGuardKeys(entry.guardKeys ?? []);

      const routeEntry: RouteHandlerEntry = {
        handler,
        methodName: entry.methodName,
        middlewares,
        errorFilters,
        guards,
        paramFactory,
      };

      this.router.add(httpMethod, fullPath, routeEntry);
      this.logger.debug(`${httpMethod} ${fullPath} → ${entry.controllerKey}.${entry.methodName} (AOT)`);
      routeCount++;
    }

    if (routeCount > 0) {
      this.router.build();
      this.logger.info(`${routeCount} routes registered (AOT)`);
    }
  }

  /**
   * Registers internal routes (e.g. Scalar API docs).
   *
   * @param routes - Internal route definitions.
   * @public
   */
  registerInternalRoutes(routes: ReadonlyArray<InternalRouteDefinition>): void {
    for (const route of routes) {
      const method = String(route.method || '').toUpperCase();

      if (!isHttpMethod(method)) {
        continue;
      }

      if (method !== 'GET') {
        continue;
      }

      const fullPath = route.path.startsWith('/') ? route.path : `/${route.path}`;
      const entry: RouteHandlerEntry = {
        handler: route.handler,
        methodName: '__internal__',
        middlewares: [],
        errorFilters: [],
        guards: [],
        paramFactory: async (req: HttpRequest, res: HttpResponse) => {
          const arity = typeof route.handler === 'function' ? route.handler.length : 0;
          const args: readonly RouteParamValue[] = arity >= 2 ? [req, res] : [req];

          return Promise.resolve([...args]);
        },
      };

      this.router.add(method, fullPath, entry);

      this.logger.debug(`${method} ${fullPath} (internal)`);
    }

    this.router.build();
  }

  private resolveHandler(instance: ControllerInstance, methodName: string): RouteHandlerFunction {
    const candidate = instance[methodName];

    if (typeof candidate !== 'function') {
      throw new Error(`[RouteHandler] Controller method not found: ${methodName}`);
    }

    const handler = candidate;

    return (...args: readonly RouteHandlerArgument[]): RouteHandlerResult | Promise<RouteHandlerResult> =>
      handler.apply(instance, [...args]);
  }

  private resolveMiddlewareKeys(keys: readonly string[]): MiddlewareDefinition[] {
    if (keys.length === 0 || this.container === undefined) {
      return [];
    }

    const resolved: MiddlewareDefinition[] = [];

    for (const key of keys) {
      const value = this.container.get(key);

      if (this.isMiddlewareDefinition(value)) {
        resolved.push(value);
      } else {
        throw new Error(`[RouteHandler] Container key '${key}' did not resolve to a MiddlewareDefinition`);
      }
    }

    return resolved;
  }

  private resolveErrorFilterKeys(keys: readonly string[]): ExceptionFilterEntry[] {
    if (keys.length === 0 || this.container === undefined) {
      return [];
    }

    const resolved: ExceptionFilterEntry[] = [];

    for (const key of keys) {
      const value = this.container.get(key);

      if (this.isExceptionFilterEntry(value)) {
        resolved.push(value);
      } else {
        throw new Error(`[RouteHandler] Container key '${key}' did not resolve to an ExceptionFilterEntry`);
      }
    }

    return resolved;
  }

  private resolveGuardKeys(keys: readonly string[]): GuardDefinition[] {
    if (keys.length === 0 || this.container === undefined) {
      return [];
    }

    const resolved: GuardDefinition[] = [];

    for (const key of keys) {
      const value = this.container.get(key);

      if (this.isGuardDefinition(value)) {
        resolved.push(value);
      } else {
        throw new Error(`[RouteHandler] Container key '${key}' did not resolve to a GuardDefinition`);
      }
    }

    return resolved;
  }

  private isMiddlewareDefinition(value: unknown): value is MiddlewareDefinition {
    return typeof value === 'object' && value !== null && 'handler' in value && typeof (value as Record<string, unknown>).handler === 'function';
  }

  private isExceptionFilterEntry(value: unknown): value is ExceptionFilterEntry {
    return typeof value === 'object' && value !== null && 'filter' in value && 'catchTypes' in value;
  }

  private isGuardDefinition(value: unknown): value is GuardDefinition {
    return typeof value === 'object' && value !== null && 'handler' in value && typeof (value as Record<string, unknown>).handler === 'function';
  }

  private isControllerInstance(value: unknown): value is ControllerInstance {
    return typeof value === 'object' && value !== null;
  }

  private getControllerPrefix(controllerKey: string): string {
    const className = controllerKey.includes('::') ? controllerKey.split('::')[1] : controllerKey;

    for (const meta of this.metadataRegistry.values()) {
      if (meta.className !== className) {
        continue;
      }

      const controllerDec = (meta.decorators ?? []).find(d => d.name === this.decoratorConfig.controllerDecoratorName);
      const rawPrefix = controllerDec?.arguments?.[0];

      return typeof rawPrefix === 'string' ? rawPrefix : '';
    }

    return '';
  }

  /** @internal Exposed for unit testing only. */
  get __testing__() {
    return {
      resolveMiddlewareKeys: this.resolveMiddlewareKeys.bind(this),
      resolveErrorFilterKeys: this.resolveErrorFilterKeys.bind(this),
      resolveGuardKeys: this.resolveGuardKeys.bind(this),
      isMiddlewareDefinition: this.isMiddlewareDefinition.bind(this),
      isExceptionFilterEntry: this.isExceptionFilterEntry.bind(this),
      isGuardDefinition: this.isGuardDefinition.bind(this),
      isControllerInstance: this.isControllerInstance.bind(this),
    };
  }

}
