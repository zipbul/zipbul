import type {
  CompiledHandlerEntry,
  ZipbulContainer,
  MiddlewareDefinition,
  ExceptionFilterDefinition,
  GuardDefinition,
  GuardHandlerFn,
} from '@zipbul/common';
import type { ResolvedMiddleware, ResolvedExceptionFilter, ResolvedValidationEntry } from '@zipbul/core';
import { runInInjectionContext } from '@zipbul/core';

import { Logger } from '@zipbul/logger';

import type { MatchedRouteMetadata, MatchRouteOutput } from './types';
import type { RouterOptions } from '@zipbul/router';
import { isHttpMethod } from './http-method';
import type {
  ClassMetadata,
  ControllerInstance,
  InternalRouteDefinition,
  MetadataRegistryKey,
  RouteHandlerFunction,
  RouteHandlerResult,
} from './types';

import type { HttpContext } from './http-context';
import { Router } from '@zipbul/router';

type HttpCompiledHandlerEntry = CompiledHandlerEntry;

interface RouteHandlerDecoratorConfig {
  readonly adapterId: string;
  readonly controllerDecoratorName: string;
  readonly handlerDecoratorNames: readonly string[];
}

export class RouteHandler {
  private readonly metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>;
  private readonly metatypeIndex: Map<string, new (...args: readonly unknown[]) => unknown>;
  private readonly decoratorConfig: RouteHandlerDecoratorConfig;
  private readonly container: ZipbulContainer | undefined;
  private readonly router: Router<MatchedRouteMetadata>;
  private readonly logger = Logger.inherit();
  private readonly registeredMethods = new Set<string>();

  constructor(
    metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>,
    decoratorConfig: RouteHandlerDecoratorConfig,
    routerOptions?: RouterOptions,
    container?: ZipbulContainer,
  ) {
    this.metadataRegistry = metadataRegistry;
    this.metatypeIndex = buildMetatypeIndex(metadataRegistry);
    this.decoratorConfig = decoratorConfig;
    this.container = container;
    this.router = new Router<MatchedRouteMetadata>({
      ignoreTrailingSlash: true,
      enableCache: true,
      ...routerOptions,
    });
  }

  /**
   * Matches the request method and path against registered routes.
   * Returns a discriminated union distinguishing matched, not-found, and method-not-allowed.
   *
   * @param method - HTTP method string.
   * @param path - Request path.
   * @returns `MatchRouteOutput` discriminated union.
   * @public
   */
  matchRoute(method: string, path: string): MatchRouteOutput {
    const result = this.router.match(method, path);
    // Router.match()는 MatchOutput<T> | null을 반환한다 (미매칭 시 null).
    if (result !== null) {
      return {
        kind: 'matched',
        route: result.value,
        params: result.params,
      };
    }

    // 동일 경로에 다른 메서드가 등록되어 있는지 확인
    const allowedMethods = this.getAllowedMethods(path);
    if (allowedMethods.length > 0) {
      return { kind: 'method-not-allowed', allowedMethods };
    }

    return { kind: 'not-found' };
  }

  /**
   * Registers routes from AOT-compiled handler index.
   *
   * @param entries - Compiled handler entries from AOT.
   * @public
   */
  registerFromHandlerIndex(entries: readonly HttpCompiledHandlerEntry[], controllerInstances?: Map<string, unknown>): void {
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

      const rawPath = typeof entry.handlerDecoratorArgs[0] === 'string' ? entry.handlerDecoratorArgs[0] : '';
      const controllerPrefix = this.getControllerPrefix(entry.controllerKey);
      const fullPath = '/' + [controllerPrefix, rawPath].filter(Boolean).join('/').replace(/\/+/g, '/');

      const middlewares = this.resolveMiddlewareKeys(entry.middlewareKeys ?? []);
      const exceptionFilters = this.resolveExceptionFilterKeys(entry.exceptionFilterKeys ?? []);
      const guards = this.resolveGuardKeys(entry.guardKeys ?? []);
      const validations = this.resolveValidations(entry);

      const hasRawBody = entry.options?.some(option => option.name === 'RawBody') === true;
      const hasSse = entry.options?.some(option => option.name === 'Sse') === true;
      const bodyLimitOption = entry.options?.find(option => option.name === 'BodyLimit');
      const bodyLimitValue = bodyLimitOption?.arguments?.[0];
      const statusOption = entry.options?.find(option => option.name === 'Status');
      const statusValue = statusOption?.arguments?.[0];
      const redirectOption = entry.options?.find(option => option.name === 'Redirect');
      const contentTypeOption = entry.options?.find(option => option.name === 'ContentType');
      const contentTypeValue = contentTypeOption?.arguments?.[0];
      const headerOptions = entry.options?.filter(option => option.name === 'Header') ?? [];
      const headers: Array<readonly [string, string]> = headerOptions
        .filter(option => typeof option.arguments?.[0] === 'string' && typeof option.arguments?.[1] === 'string')
        .map(option => [option.arguments![0] as string, option.arguments![1] as string] as const);

      const routeEntry: MatchedRouteMetadata = {
        handler,
        rawBody: hasRawBody,
        sse: hasSse,
        bodyLimit: typeof bodyLimitValue === 'number' ? bodyLimitValue : undefined,
        status: typeof statusValue === 'number' ? statusValue : undefined,
        redirect: redirectOption !== undefined && typeof redirectOption.arguments?.[0] === 'string'
          ? { url: redirectOption.arguments[0] as string, status: redirectOption.arguments?.[1] as 301 | 302 | 303 | 307 | 308 | undefined }
          : undefined,
        contentType: typeof contentTypeValue === 'string' ? contentTypeValue : undefined,
        headers,
        middlewares,
        exceptionFilters,
        guards,
        validations,
      };

      this.router.add(httpMethod, fullPath, routeEntry);
      this.registeredMethods.add(httpMethod);
      this.logger.debug(`${httpMethod} ${fullPath} → ${entry.controllerKey}.${entry.methodName} (AOT)`);

      if (httpMethod === 'GET') {
        this.router.add('HEAD', fullPath, routeEntry);
        this.registeredMethods.add('HEAD');
        this.logger.debug(`HEAD ${fullPath} → ${entry.controllerKey}.${entry.methodName} (auto from GET)`);
      }
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
      const entry: MatchedRouteMetadata = {
        handler: route.handler,
        rawBody: false,
        sse: false,
        bodyLimit: undefined,
        status: undefined,
        redirect: undefined,
        contentType: undefined,
        headers: [],
        middlewares: [],
        exceptionFilters: [],
        guards: [],
        validations: [],
      };

      this.router.add(method, fullPath, entry);
      this.registeredMethods.add(method);
      this.logger.debug(`${method} ${fullPath} (internal)`);

      if (method === 'GET') {
        this.router.add('HEAD', fullPath, entry);
        this.registeredMethods.add('HEAD');
        this.logger.debug(`HEAD ${fullPath} (internal, auto from GET)`);
      }
    }

    this.router.build();
  }

  private getAllowedMethods(path: string): string[] {
    const methods: string[] = [];
    for (const method of this.registeredMethods) {
      if (this.router.match(method, path) !== null) {
        methods.push(method);
      }
    }
    return methods;
  }

  private resolveHandler(instance: ControllerInstance, methodName: string): RouteHandlerFunction {
    const candidate = instance[methodName];

    if (typeof candidate !== 'function') {
      throw new Error(`[RouteHandler] Controller method not found: ${methodName}`);
    }

    const handler = candidate;

    return (ctx: HttpContext): RouteHandlerResult | Promise<RouteHandlerResult> =>
      handler.call(instance, ctx);
  }

  /**
   * Resolves AOT-compiled validation entries into runtime entries with actual class constructors.
   *
   * @param entry - The compiled handler entry from AOT.
   * @returns Resolved validation entries.
   */
  private resolveValidations(
    entry: CompiledHandlerEntry,
  ): readonly ResolvedValidationEntry[] {
    const compiled = entry.validations;
    if (compiled === undefined || compiled.length === 0) {
      return [];
    }

    const resolved: ResolvedValidationEntry[] = [];

    for (const validation of compiled) {
      const metatype = this.metatypeIndex.get(validation.metatypeKey);
      if (metatype === undefined) {
        throw new Error(`[RouteHandler] Cannot resolve DTO class for metatypeKey '${validation.metatypeKey}'`);
      }
      resolved.push({ kind: validation.kind, metatype });
    }

    return resolved;
  }

  private resolveMiddlewareKeys(keys: readonly string[]): ResolvedMiddleware[] {
    if (keys.length === 0 || this.container === undefined) {
      return [];
    }

    const resolved: ResolvedMiddleware[] = [];

    for (const key of keys) {
      const value = this.container.get(key);

      if (this.isMiddlewareDefinition(value)) {
        resolved.push({
          handler: runInInjectionContext(this.container, value.factory),
        });
      } else {
        throw new Error(`[RouteHandler] Container key '${key}' did not resolve to a MiddlewareDefinition`);
      }
    }

    return resolved;
  }

  private resolveExceptionFilterKeys(keys: readonly string[]): ResolvedExceptionFilter[] {
    if (keys.length === 0 || this.container === undefined) {
      return [];
    }

    const resolved: ResolvedExceptionFilter[] = [];

    for (const key of keys) {
      const value = this.container.get(key);

      if (this.isExceptionFilterDefinition(value)) {
        resolved.push({
          handler: runInInjectionContext(this.container, value.factory),
          catchTypes: value.catchTypes,
        });
      } else {
        throw new Error(`[RouteHandler] Container key '${key}' did not resolve to an ExceptionFilterDefinition`);
      }
    }

    return resolved;
  }

  private resolveGuardKeys(keys: readonly string[]): GuardHandlerFn[] {
    if (keys.length === 0 || this.container === undefined) {
      return [];
    }

    const resolved: GuardHandlerFn[] = [];

    for (const key of keys) {
      const value = this.container.get(key);

      if (this.isGuardDefinition(value)) {
        resolved.push(runInInjectionContext(this.container, value.factory));
      } else {
        throw new Error(`[RouteHandler] Container key '${key}' did not resolve to a GuardDefinition`);
      }
    }

    return resolved;
  }

  private isMiddlewareDefinition(value: unknown): value is MiddlewareDefinition {
    return typeof value === 'object' && value !== null && 'factory' in value && typeof (value as Record<string, unknown>).factory === 'function';
  }

  private isExceptionFilterDefinition(value: unknown): value is ExceptionFilterDefinition {
    return typeof value === 'object' && value !== null && 'factory' in value && 'catchTypes' in value;
  }

  private isGuardDefinition(value: unknown): value is GuardDefinition {
    return typeof value === 'object' && value !== null && 'factory' in value && typeof (value as Record<string, unknown>).factory === 'function';
  }

  private isControllerInstance(value: unknown): value is ControllerInstance {
    return typeof value === 'object' && value !== null;
  }

  private getControllerPrefix(controllerKey: string): string {
    const className = controllerKey.includes('::') ? controllerKey.split('::')[1] : controllerKey;

    const ctor = this.metatypeIndex.get(className);
    if (ctor === undefined) return '';

    const meta = this.metadataRegistry.get(ctor);
    if (meta === undefined) return '';

    const controllerDec = (meta.decorators ?? []).find(d => d.name === this.decoratorConfig.controllerDecoratorName);
    const rawPrefix = controllerDec?.arguments?.[0];

    return typeof rawPrefix === 'string' ? rawPrefix : '';
  }

  /** @internal Exposed for unit testing only. */
  get __testing__() {
    return {
      resolveMiddlewareKeys: this.resolveMiddlewareKeys.bind(this),
      resolveExceptionFilterKeys: this.resolveExceptionFilterKeys.bind(this),
      resolveGuardKeys: this.resolveGuardKeys.bind(this),
      isMiddlewareDefinition: this.isMiddlewareDefinition.bind(this),
      isExceptionFilterDefinition: this.isExceptionFilterDefinition.bind(this),
      isGuardDefinition: this.isGuardDefinition.bind(this),
      isControllerInstance: this.isControllerInstance.bind(this),
    };
  }

}

/**
 * Builds a reverse index from className → constructor for O(1) metatype resolution.
 *
 * @param registry - The metadata registry mapping constructors to class metadata.
 * @returns A Map keyed by className string, valued by constructor reference.
 */
function buildMetatypeIndex(
  registry: Map<MetadataRegistryKey, ClassMetadata>,
): Map<string, new (...args: readonly unknown[]) => unknown> {
  const index = new Map<string, new (...args: readonly unknown[]) => unknown>();

  for (const [ctor, meta] of registry.entries()) {
    if (meta.className !== undefined) {
      index.set(meta.className, ctor as new (...args: readonly unknown[]) => unknown);
    }
  }

  return index;
}
