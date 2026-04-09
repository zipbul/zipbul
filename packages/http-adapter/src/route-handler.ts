import type {
  CompiledHandlerEntry,
  ContextKey,
} from '@zipbul/common';
import type { ResolvedExceptionFilter, ResolvedValidationEntry, PipelineStepFn } from '@zipbul/core';

import { Logger } from '@zipbul/logger';

import type { MatchedRouteMetadata, MatchRouteOutput } from './types';
import type { RouterOptions } from '@zipbul/router';
import type {
  ClassMetadata,
  ControllerInstance,
  InternalRouteDefinition,
  MetadataRegistryKey,
  RouteHandlerFunction,
  RouteHandlerResult,
} from './types';

import type { HttpContext } from './http-context';
import type { HttpResponse } from './http-response';
import { Router } from '@zipbul/router';

type HttpCompiledHandlerEntry = CompiledHandlerEntry;

interface RouteHandlerDecoratorConfig {
  readonly adapterId: string;
  readonly controllerDecoratorName: string;
  readonly handlerDecoratorNames: readonly string[];
}

/**
 * Resolved pipeline for a single route.
 *
 * @public
 */
export interface ResolvedRoutePipeline {
  readonly pre: readonly PipelineStepFn[];
  readonly post: readonly PipelineStepFn[];
  readonly filters: readonly ResolvedExceptionFilter[];
}

/**
 * Callback provided by the adapter to resolve AOT compiled data into
 * ready-to-call pipeline at boot time.
 *
 * @public
 */
export type PipelineBuildFn = (
  entry: CompiledHandlerEntry,
  validations: readonly ResolvedValidationEntry[],
  handler: RouteHandlerFunction,
  applyResponseDefaults?: (response: HttpResponse) => void,
) => ResolvedRoutePipeline;

const EMPTY_PIPELINE: ResolvedRoutePipeline = {
  pre: [],
  post: [],
  filters: [],
};

export class RouteHandler {
  private readonly metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>;
  private readonly metatypeIndex: Map<string, new (...args: readonly unknown[]) => unknown>;
  private readonly decoratorConfig: RouteHandlerDecoratorConfig;
  private readonly router: Router<MatchedRouteMetadata>;
  private readonly logger = Logger.inherit();
  private readonly registeredMethods = new Set<string>();

  constructor(
    metadataRegistry: Map<MetadataRegistryKey, ClassMetadata>,
    decoratorConfig: RouteHandlerDecoratorConfig,
    routerOptions?: RouterOptions,
  ) {
    this.metadataRegistry = metadataRegistry;
    this.metatypeIndex = buildMetatypeIndex(metadataRegistry);
    this.decoratorConfig = decoratorConfig;
    this.router = new Router<MatchedRouteMetadata>({
      ignoreTrailingSlash: true,
      enableCache: true,
      ...routerOptions,
    });
  }

  /**
   * Matches the request method and path against registered routes.
   *
   * @param method - HTTP method string.
   * @param path - Request path.
   * @returns `MatchRouteOutput` discriminated union.
   * @public
   */
  matchRoute(method: string, path: string): MatchRouteOutput {
    const result = this.router.match(method, path);

    if (result !== null) {
      return {
        kind: 'matched',
        route: result.value,
        params: result.params,
      };
    }

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
   * @param controllerInstances - Map of controller keys to instantiated controllers.
   * @param buildPipeline - Adapter-provided callback to resolve compiled pipeline data.
   * @param contextKeyIndex - Boot-time resolved index mapping keyRef strings to ContextKey symbols.
   * @public
   */
  registerFromHandlerIndex(
    entries: readonly HttpCompiledHandlerEntry[],
    controllerInstances?: Map<string, unknown>,
    buildPipeline?: PipelineBuildFn,
    contextKeyIndex?: ReadonlyMap<string, ContextKey<unknown>>,
  ): void {
    let routeCount = 0;

    for (const entry of entries) {
      if (entry.adapterId !== this.decoratorConfig.adapterId) {
        continue;
      }

      const isCustomMethod = entry.handlerDecorator === 'Method';
      const httpMethod = isCustomMethod
        ? (typeof entry.handlerDecoratorArgs[0] === 'string' ? entry.handlerDecoratorArgs[0].toUpperCase() : '')
        : entry.handlerDecorator.toUpperCase();

      if (httpMethod.length === 0) {
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
      const validations = this.resolveValidations(entry, contextKeyIndex);

      const pathArgIndex = isCustomMethod ? 1 : 0;
      const rawPath = typeof entry.handlerDecoratorArgs[pathArgIndex] === 'string' ? entry.handlerDecoratorArgs[pathArgIndex] as string : '';
      const controllerPrefix = this.getControllerPrefix(entry.controllerKey);
      const fullPath = '/' + [controllerPrefix, rawPath].filter(Boolean).join('/').replace(/\/+/g, '/');

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

      const responseDefaultsApplier = buildResponseDefaultsApplier(
        typeof statusValue === 'number' ? statusValue : undefined,
        typeof contentTypeValue === 'string' ? contentTypeValue : undefined,
        headers,
        redirectOption !== undefined && typeof redirectOption.arguments?.[0] === 'string'
          ? { url: redirectOption.arguments[0] as string, ...(redirectOption.arguments?.[1] !== undefined ? { status: redirectOption.arguments[1] as 301 | 302 | 303 | 307 | 308 } : {}) }
          : undefined,
      );

      const pipeline = buildPipeline !== undefined
        ? buildPipeline(entry, validations, handler, responseDefaultsApplier)
        : EMPTY_PIPELINE;

      const routeEntry: MatchedRouteMetadata = {
        handler,
        rawBody: hasRawBody,
        sse: hasSse,
        bodyLimit: typeof bodyLimitValue === 'number' ? bodyLimitValue : undefined,
        status: typeof statusValue === 'number' ? statusValue : undefined,
        redirect: redirectOption !== undefined && typeof redirectOption.arguments?.[0] === 'string'
          ? { url: redirectOption.arguments[0] as string, ...(redirectOption.arguments?.[1] !== undefined ? { status: redirectOption.arguments[1] as 301 | 302 | 303 | 307 | 308 } : {}) }
          : undefined,
        contentType: typeof contentTypeValue === 'string' ? contentTypeValue : undefined,
        headers,
        ...(responseDefaultsApplier !== undefined ? { applyResponseDefaults: responseDefaultsApplier } : {}),
        validations,
        pre: pipeline.pre,
        post: pipeline.post,
        filters: pipeline.filters,
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
        validations: [],
        pre: [],
        post: [],
        filters: [],
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
   * @param contextKeyIndex - Boot-time resolved index mapping keyRef strings to ContextKey symbols.
   * @returns Resolved validation entries.
   */
  private resolveValidations(
    entry: CompiledHandlerEntry,
    contextKeyIndex?: ReadonlyMap<string, ContextKey<unknown>>,
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

      const key = contextKeyIndex?.get(validation.keyRef);

      if (key === undefined) {
        throw new Error(`[RouteHandler] Cannot resolve ContextKey for keyRef '${validation.keyRef}'. Ensure the AOT-generated injector registers context keys.`);
      }

      resolved.push({ key, metatype });
    }

    return resolved;
  }

  private isControllerInstance(value: unknown): value is ControllerInstance {
    return typeof value === 'object' && value !== null;
  }

  private getControllerPrefix(controllerKey: string): string {
    const className = controllerKey.includes('::') ? controllerKey.split('::')[1]! : controllerKey;

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
      isControllerInstance: this.isControllerInstance.bind(this),
    };
  }

}

/**
 * Builds a reverse index from className → constructor for O(1) metatype resolution.
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

function buildResponseDefaultsApplier(
  status: number | undefined,
  contentType: string | undefined,
  headers: readonly (readonly [string, string])[],
  redirect: { readonly url: string; readonly status?: 301 | 302 | 303 | 307 | 308 } | undefined,
): ((response: HttpResponse) => void) | undefined {
  if (status === undefined && contentType === undefined && headers.length === 0 && redirect === undefined) {
    return undefined;
  }

  return (response: HttpResponse): void => {
    if (status !== undefined) {
      response.setStatus(status);
    }

    if (contentType !== undefined) {
      response.setContentType(contentType);
    }

    for (const [name, value] of headers) {
      response.setHeader(name, value);
    }

    if (redirect !== undefined) {
      response.redirect(redirect.url, redirect.status);
    }
  };
}
