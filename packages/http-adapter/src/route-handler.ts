import type { ZipbulContainer, ZipbulValue, ProviderToken, MiddlewareDefinition, ExceptionFilterEntry, ErrorConstructorLike, CompiledHandlerEntry } from '@zipbul/common';

import { ExceptionFilter } from '@zipbul/common';
import { Logger } from '@zipbul/logger';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';
import type { RouteHandlerEntry } from './interfaces';
import type { MatchOutput, RouterOptions } from '@zipbul/router';
import type { HttpMethod } from '@zipbul/shared';
import type {
  ClassMetadata,
  ContainerInstance,
  ControllerInstance,
  ControllerConstructor,
  DecoratorArgument,
  DecoratorMetadata,
  InternalRouteDefinition,
  MetadataRegistryKey,
  MethodMetadata,
  RouteHandlerArgument,
  RouteHandlerFunction,
  RouteHandlerResult,
  RouteParamValue,
  TokenCarrier,
  TokenRecord,
} from './types';

import { Router } from '@zipbul/router';
import { ParamResolver } from './param-resolver';

export class RouteHandler {
  private readonly container: ZipbulContainer;
  private readonly metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>;
  private readonly scopedKeys: Map<ProviderToken, string>;
  private readonly router: Router<RouteHandlerEntry>;
  private readonly paramResolver: ParamResolver;
  private readonly logger = Logger.inherit();

  constructor(
    container: ZipbulContainer,
    metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>,
    scopedKeys: Map<ProviderToken, string> = new Map(),
    routerOptions?: RouterOptions,
  ) {
    this.container = container;
    this.metadataRegistry = metadataRegistry;
    this.scopedKeys = scopedKeys;
    this.paramResolver = new ParamResolver(metadataRegistry);
    this.router = new Router<RouteHandlerEntry>({
      ignoreTrailingSlash: true,
      enableCache: true,
      ...routerOptions,
    });
  }

  match(method: string, path: string): MatchOutput<RouteHandlerEntry> | undefined {
    const normalized = method.toUpperCase() as HttpMethod;

    if (!this.isHttpMethod(normalized)) {
      return undefined;
    }

    return this.router.match(normalized, path) ?? undefined;
  }

  register() {
    let routeCount = 0;

    for (const [targetClass, meta] of this.metadataRegistry.entries()) {
      if (!this.isControllerConstructor(targetClass)) {
        continue;
      }

      const controllerDec = (meta.decorators ?? []).find(
        d => d.name === 'RestController',
      );

      if (controllerDec) {
        routeCount += this.registerController(targetClass, meta, controllerDec);
      }
    }

    if (routeCount > 0) {
      this.router.build();
      this.logger.info(`${routeCount} routes registered`);
    }
  }

  /**
   * Registers routes from AOT-compiled handler index.
   * Bypasses metadata scanning entirely.
   *
   * @param entries - Compiled handler entries from AOT.
   * @public
   */
  registerFromHandlerIndex(entries: readonly CompiledHandlerEntry[]): void {
    let routeCount = 0;

    for (const entry of entries) {
      if (entry.adapterId !== 'HttpAdapter') {
        continue;
      }

      const httpMethod = entry.handlerDecorator.toUpperCase();

      if (!this.isHttpMethod(httpMethod)) {
        continue;
      }

      const instance = this.container.get(entry.controllerKey);

      if (instance === undefined || instance === null) {
        this.logger.warn(`Cannot resolve controller: ${entry.controllerKey}`);

        continue;
      }

      const handler = this.resolveHandler(instance as ControllerInstance, entry.methodName);
      const paramFactory = this.paramResolver.buildParamFactory(
        entry.params.map((param, index) => ({
          index,
          name: param.name,
          type: param.metatypeKey,
          decorators: param.decoratorName !== undefined
            ? [{ name: param.decoratorName, arguments: [...(param.decoratorArgs ?? [])] }]
            : [],
        })),
      );

      const rawPath = typeof entry.handlerDecoratorArgs[0] === 'string' ? entry.handlerDecoratorArgs[0] : '';
      const controllerPrefix = this.getControllerPrefix(entry.controllerKey);
      const fullPath = '/' + [controllerPrefix, rawPath].filter(Boolean).join('/').replace(/\/+/g, '/');

      const routeEntry: RouteHandlerEntry = {
        handler,
        methodName: entry.methodName,
        middlewares: [],
        errorFilters: [],
        paramFactory,
      };

      this.router.add(httpMethod as HttpMethod, fullPath, routeEntry);
      this.logger.debug(`${httpMethod} ${fullPath} → ${entry.controllerKey}.${entry.methodName} (AOT)`);
      routeCount++;
    }

    if (routeCount > 0) {
      this.router.build();
      this.logger.info(`${routeCount} routes registered (AOT)`);
    }
  }

  /**
   * Undocumented/internal route registration channel.
   * This is intentionally untyped at the package boundary.
   */
  registerInternalRoutes(routes: ReadonlyArray<InternalRouteDefinition>): void {
    for (const route of routes) {
      const method = String(route.method || '').toUpperCase();

      if (!this.isHttpMethod(method)) {
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

  private registerController(targetClass: ControllerConstructor, meta: ClassMetadata, controllerDec: DecoratorMetadata): number {
    const rawPrefix = controllerDec.arguments?.[0];
    const prefix = typeof rawPrefix === 'string' ? rawPrefix : '';
    const scopedKey = this.scopedKeys.get(targetClass);
    let instance: ContainerInstance = undefined;

    try {
      if (typeof scopedKey === 'string' && scopedKey.length > 0) {
        instance = this.container.get(scopedKey);
      } else {
        instance = this.container.get(targetClass);
      }
    } catch {
      instance = undefined;
    }

    instance ??= this.tryCreateControllerInstance(targetClass);

    if (instance === undefined || instance === null) {
      const keyLabel = typeof scopedKey === 'string' && scopedKey.length > 0 ? scopedKey : targetClass.name;

      this.logger.warn(`Cannot resolve controller instance: ${meta.className} (Key: ${keyLabel})`);

      return 0;
    }

    let count = 0;

    (meta.methods ?? []).forEach(method => {
      const routeDec = (method.decorators ?? []).find(d =>
        ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head'].includes(d.name),
      );

      if (routeDec) {
        const httpMethodCandidate = routeDec.name.toUpperCase();

        if (!this.isHttpMethod(httpMethodCandidate)) {
          return;
        }

        const httpMethod = httpMethodCandidate;
        const rawSubPath = routeDec.arguments?.[0];
        const subPath = typeof rawSubPath === 'string' ? rawSubPath : '';
        const fullPath = '/' + [prefix, subPath].filter(Boolean).join('/').replace(/\/+/g, '/');

        const paramFactory = this.paramResolver.buildParamFactory(method.parameters ?? []);
        const middlewares = this.resolveMiddlewares(targetClass, method, meta);
        const errorFilters = this.resolveErrorFilterEntries(targetClass, method, meta);
        const handler = this.resolveHandler(instance, method.name);
        const entry: RouteHandlerEntry = {
          handler,
          methodName: method.name,
          middlewares,
          errorFilters,
          paramFactory,
        };

        this.router.add(httpMethod as HttpMethod, fullPath, entry);

        this.logger.debug(`${httpMethod} ${fullPath} → ${targetClass.name}.${method.name}`);
        count++;
      }
    });

    return count;
  }

  private isControllerInstance(value: ContainerInstance): value is ControllerInstance {
    return typeof value === 'object' && value !== null;
  }

  private isControllerConstructor(value: DecoratorArgument | MetadataRegistryKey): value is ControllerConstructor {
    return typeof value === 'function' && !this.isErrorConstructor(value);
  }

  private resolveHandler(instance: ContainerInstance, methodName: string): RouteHandlerFunction {
    if (!this.isControllerInstance(instance)) {
      throw new Error(`[RouteHandler] Invalid controller instance for method ${methodName}`);
    }

    const candidate = instance[methodName];

    if (typeof candidate !== 'function') {
      throw new Error(`[RouteHandler] Controller method not found: ${methodName}`);
    }

    const handler = candidate;

    return (...args: readonly RouteHandlerArgument[]): RouteHandlerResult | Promise<RouteHandlerResult> =>
      handler.apply(instance, [...args]);
  }

  private isTokenCarrier(value: DecoratorArgument): value is TokenCarrier {
    return typeof value === 'object' && value !== null && 'token' in value;
  }

  private isTokenRecord(value: DecoratorArgument): value is TokenRecord {
    return (
      typeof value === 'object' &&
      value !== null &&
      ('__zipbul_ref' in value || '__zipbul_lazy_ref' in value || 'name' in value)
    );
  }

  private extractZipbulTokenRef(token: DecoratorArgument): string | undefined {
    if (!this.isTokenRecord(token)) {
      return undefined;
    }

    const ref = token.__zipbul_ref;

    if (typeof ref === 'string' && ref.length > 0) {
      return ref;
    }

    const lazyRef = token.__zipbul_lazy_ref;

    if (typeof lazyRef === 'string' && lazyRef.length > 0) {
      return lazyRef;
    }

    return undefined;
  }

  private resolveProviderToken(token: DecoratorArgument): ProviderToken | undefined {
    if (token === null || token === undefined) {
      return undefined;
    }

    if (this.isTokenCarrier(token)) {
      return token.token;
    }

    if (typeof token === 'string' || typeof token === 'symbol') {
      return token;
    }

    if (typeof token === 'function' && !this.isErrorConstructor(token)) {
      return token;
    }

    const extracted = this.extractZipbulTokenRef(token);

    if (typeof extracted === 'string' && extracted.length > 0) {
      return extracted;
    }

    if (this.isTokenRecord(token) && typeof token.name === 'string' && token.name.length > 0) {
      return token.name;
    }

    return undefined;
  }

  private resolveControllerConstructor(token: DecoratorArgument): ControllerConstructor | undefined {
    if (this.isControllerConstructor(token)) {
      return token;
    }

    const resolved = this.resolveProviderToken(token);

    if (resolved !== undefined && typeof resolved === 'function' && this.isControllerConstructor(resolved)) {
      return resolved;
    }

    return undefined;
  }

  private tryCreateControllerInstance(targetClass: DecoratorArgument): ContainerInstance {
    const constructor = this.resolveControllerConstructor(targetClass);

    if (!constructor) {
      return undefined;
    }

    const meta = this.metadataRegistry.get(constructor);

    if (!meta) {
      return undefined;
    }

    const constructorParams = meta.constructorParams ?? [];
    const deps = constructorParams.map(param => {
      let token: DecoratorArgument = param.type;
      const extracted = this.extractZipbulTokenRef(token);

      if (typeof extracted === 'string' && extracted.length > 0) {
        token = extracted;
      }

      const decorators = param.decorators ?? [];
      const injectDec = decorators.find((decorator: DecoratorMetadata) => decorator.name === 'Inject');
      const injected = injectDec?.arguments?.[0];
      const injectedRef = this.extractZipbulTokenRef(injected);

      if (typeof injected !== 'undefined') {
        token = injected;

        if (typeof injectedRef === 'string' && injectedRef.length > 0) {
          token = injectedRef;
        }
      }

      return this.tryGetFromContainer(token);
    });
    try {
      return new constructor(...(deps as readonly ZipbulValue[]));
    } catch {
      return undefined;
    }
  }

  private isErrorConstructor(value: DecoratorArgument): value is ErrorConstructor {
    if (typeof value !== 'function') {
      return false;
    }

    if (!('prototype' in value)) {
      return false;
    }

    return value.prototype instanceof Error;
  }

  private tryGetFromContainer(token: DecoratorArgument): ContainerInstance {
    const resolvedToken = this.resolveProviderToken(token);

    if (resolvedToken === undefined) {
      return undefined;
    }

    const scopedKey = this.scopedKeys.get(resolvedToken);

    if (typeof scopedKey === 'string' && scopedKey.length > 0) {
      try {
        return this.container.get(scopedKey);
      } catch {
        return undefined;
      }
    }

    try {
      return this.container.get(resolvedToken);
    } catch {
      return this.tryGetFromContainerBySuffix(resolvedToken);
    }
  }

  private tryGetFromContainerBySuffix(token: ProviderToken): ContainerInstance {
    const tokenName = this.normalizeToken(token);

    if (tokenName === undefined || tokenName.length === 0) {
      return undefined;
    }

    const suffix = `::${tokenName}`;

    for (const key of this.container.keys()) {
      if (typeof key !== 'string') {
        continue;
      }

      if (!key.endsWith(suffix)) {
        continue;
      }

      try {
        return this.container.get(key);
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private normalizeToken(token: ProviderToken): string | undefined {
    if (typeof token === 'string') {
      return token;
    }

    if (typeof token === 'symbol') {
      return token.description ?? token.toString();
    }

    if (typeof token === 'function' && token.name) {
      return token.name;
    }

    return undefined;
  }

  private formatTokenLabel(token: DecoratorArgument): string {
    if (token === null || token === undefined) {
      return 'undefined';
    }

    if (typeof token === 'string') {
      return token;
    }

    if (typeof token === 'symbol') {
      return token.description ?? 'symbol';
    }

    if (typeof token === 'function') {
      return token.name || 'anonymous';
    }

    if (this.isTokenCarrier(token)) {
      return this.formatTokenLabel(token.token);
    }

    const ref = this.extractZipbulTokenRef(token);

    if (typeof ref === 'string' && ref.length > 0) {
      return ref;
    }

    if (this.isTokenRecord(token) && typeof token.name === 'string' && token.name.length > 0) {
      return token.name;
    }

    return 'unknown-token';
  }

  private isMiddlewareDefinition(value: DecoratorArgument): value is MiddlewareDefinition {
    return typeof value === 'object' && value !== null && 'handler' in value && typeof value.handler === 'function';
  }

  private isExceptionFilter(value: ContainerInstance): value is ExceptionFilter {
    return value instanceof ExceptionFilter;
  }

  private getControllerPrefix(controllerKey: string): string {
    const className = controllerKey.includes('::') ? controllerKey.split('::')[1] : controllerKey;

    for (const meta of this.metadataRegistry.values()) {
      if (meta.className !== className) {
        continue;
      }

      const controllerDec = (meta.decorators ?? []).find(d => d.name === 'RestController');
      const rawPrefix = controllerDec?.arguments?.[0];

      return typeof rawPrefix === 'string' ? rawPrefix : '';
    }

    return '';
  }

  private isHttpMethod(value: string): value is HttpMethod {
    return (
      value === 'GET' ||
      value === 'POST' ||
      value === 'PUT' ||
      value === 'PATCH' ||
      value === 'DELETE' ||
      value === 'OPTIONS' ||
      value === 'HEAD'
    );
  }

  private resolveMiddlewares(
    _targetClass: ControllerConstructor,
    method: MethodMetadata,
    classMeta: ClassMetadata,
  ): MiddlewareDefinition[] {
    const middlewares: MiddlewareDefinition[] = [];

    // Controller Level first (outer scope)
    if (classMeta !== undefined) {
      const controllerDecs = (classMeta.decorators ?? []).filter(
        (decorator: DecoratorMetadata) => decorator.name === 'UseMiddlewares',
      );

      controllerDecs.forEach(decorator => {
        (decorator.arguments ?? []).forEach(arg => {
          if (this.isMiddlewareDefinition(arg)) {
            middlewares.push(arg);
          }
        });
      });
    }

    // Method Level (inner scope)
    const decs = (method.decorators ?? []).filter((decorator: DecoratorMetadata) => decorator.name === 'UseMiddlewares');

    decs.forEach(decorator => {
      (decorator.arguments ?? []).forEach(arg => {
        if (this.isMiddlewareDefinition(arg)) {
          middlewares.push(arg);
        }
      });
    });

    return middlewares;
  }

  private resolveErrorFilterEntries(
    targetClass: ControllerConstructor,
    method: MethodMetadata,
    classMeta: ClassMetadata,
  ): ExceptionFilterEntry[] {
    const tokens: DecoratorArgument[] = [];
    const methodDecs = (method.decorators ?? []).filter((decorator: DecoratorMetadata) => decorator.name === 'UseExceptionFilters');

    methodDecs.forEach(decorator => {
      (decorator.arguments ?? []).forEach(arg => {
        tokens.push(arg);
      });
    });

    if (classMeta !== undefined) {
      const classDecs = (classMeta.decorators ?? []).filter(
        (decorator: DecoratorMetadata) => decorator.name === 'UseExceptionFilters',
      );

      classDecs.forEach(decorator => {
        (decorator.arguments ?? []).forEach(arg => {
          tokens.push(arg);
        });
      });
    }

    const seen = new Set<DecoratorArgument>();
    const dedupedTokens = tokens.filter(token => {
      if (seen.has(token)) {
        return false;
      }

      seen.add(token);

      return true;
    });
    const entries: ExceptionFilterEntry[] = [];

    for (const token of dedupedTokens) {
      if (token === null || token === undefined) {
        continue;
      }

      const instance = this.tryGetFromContainer(token);

      if (instance !== undefined && instance !== null && this.isExceptionFilter(instance)) {
        entries.push({ filter: instance, catchTypes: this.resolveCatchTypes(instance) });

        continue;
      }

      const created = this.tryCreateControllerInstance(token);

      if (created === undefined || created === null || !this.isExceptionFilter(created)) {
        throw new Error(
          `Cannot resolve ErrorFilter token for ${targetClass.name}.${method.name}: ${this.formatTokenLabel(token)}`,
        );
      }

      entries.push({ filter: created, catchTypes: this.resolveCatchTypes(created) });
    }

    return entries;
  }

  private resolveCatchTypes(filter: ExceptionFilter): readonly ErrorConstructorLike[] {
    const meta = this.findMetadataByClassName(filter.constructor?.name);
    const catchDec = (meta?.decorators ?? []).find((decorator: DecoratorMetadata) => decorator.name === 'Catch');

    if (!catchDec || !catchDec.arguments || catchDec.arguments.length === 0) {
      return [];
    }

    const catchTypes: ErrorConstructorLike[] = [];

    for (const arg of catchDec.arguments) {
      if (typeof arg === 'function' && 'prototype' in arg && arg.prototype instanceof Error) {
        catchTypes.push(arg as ErrorConstructorLike);
      }
    }

    return catchTypes;
  }

  private findMetadataByClassName(name: string | undefined): ClassMetadata | undefined {
    if (typeof name !== 'string' || name.length === 0) {
      return undefined;
    }

    for (const meta of this.metadataRegistry.values()) {
      if (meta.className === name) {
        return meta;
      }
    }

    return undefined;
  }

}
