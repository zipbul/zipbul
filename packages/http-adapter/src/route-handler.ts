import type {
  CompiledHandlerEntry,
  AdapterContext,
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

import { HttpContext } from './http-context';
import type { HttpResponse } from './http-response';
import { Router } from '@zipbul/router';
import { parseDecoratorOptions, buildResponseDefaultsApplier } from './route-options';
import { addWithHeadAlias } from './pipeline/router-register';
import { FORBIDDEN_HTTP_METHODS, HTTP_STANDARD_METHODS } from './http-method';

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
  private readonly allowedMethods = new Set<string>(HTTP_STANDARD_METHODS);

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
    // @zipbul/router 는 미등록 메서드에 대해 RouterError('method-not-found') 를 throw 한다.
    // 프레임워크는 이를 404/501 결정 로직으로 흘려보내야 하므로 여기서 not-found 로 정규화한다.
    let result: ReturnType<typeof this.router.match>;
    try {
      result = this.router.match(method as Parameters<typeof this.router.match>[0], path);
    } catch {
      result = null;
    }

    if (result !== null) {
      return {
        kind: 'matched',
        route: result.value,
        params: result.params,
      };
    }

    const allowedMethods = this.getAllowedMethodsForPath(path);

    if (allowedMethods.length > 0) {
      return { kind: 'method-not-allowed', allowedMethods };
    }

    return { kind: 'not-found' };
  }

  /**
   * Returns the server-wide set of allowed HTTP methods.
   * Seeded with the standard 7 (RFC 9110 §9.1) and extended at boot time
   * by `registerFromHandlerIndex` with any additional `@Method('X', …)` tokens
   * declared by the user. TRACE/CONNECT are permanently excluded.
   *
   * @public
   */
  getServerAllowedMethods(): ReadonlySet<string> {
    return this.allowedMethods;
  }

  /**
   * Registers routes from AOT-compiled handler index.
   *
   * @param entries - Compiled handler entries from AOT.
   * @param controllerInstances - Map of controller keys to instantiated controllers.
   * @param buildPipeline - Adapter-provided callback to resolve compiled pipeline data.
   * @public
   */
  registerFromHandlerIndex(
    entries: readonly HttpCompiledHandlerEntry[],
    controllerInstances?: Map<string, unknown>,
    buildPipeline?: PipelineBuildFn,
  ): void {
    // Phase 1: 모든 entry 의 메서드를 검증한다 (원자성 — 한 entry 라도 거부되면 등록 0 건).
    for (const entry of entries) {
      if (entry.adapterId !== this.decoratorConfig.adapterId) continue;

      const httpMethod = extractHttpMethod(entry);

      if (httpMethod === null) {
        throw new Error(
          `[RouteHandler] Cannot register handler at ${entry.controllerKey}.${entry.methodName}: ` +
          `method token is missing or empty (RFC 9110 §5.1).`,
        );
      }

      if (!isValidMethodToken(httpMethod)) {
        throw new Error(
          `[RouteHandler] Cannot register handler at ${entry.controllerKey}.${entry.methodName}: ` +
          `method '${httpMethod}' is not a valid HTTP token (RFC 9110 §5.1 — tchar only, no whitespace).`,
        );
      }

      if (FORBIDDEN_HTTP_METHODS.has(httpMethod)) {
        throw new Error(
          `[RouteHandler] @Method('${httpMethod}', ...) at ${entry.controllerKey}.${entry.methodName} ` +
          `is permanently rejected. ` +
          `${httpMethod === 'TRACE'
            ? 'TRACE carries XST risk (OWASP); RFC 9110 §9.3.8 echo rules cannot be statically enforced for user handlers.'
            : 'CONNECT is for forward proxies (RFC 9110 §9.3.6); origin servers cannot meaningfully handle it.'}`,
        );
      }

      this.allowedMethods.add(httpMethod);
    }

    // Phase 2: 검증 통과 후 실제 등록.
    let routeCount = 0;

    for (const entry of entries) {
      if (entry.adapterId !== this.decoratorConfig.adapterId) {
        continue;
      }

      const isCustomMethod = entry.handlerDecorator === 'Method';
      const httpMethod = extractHttpMethod(entry)!;

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
      const validations = this.resolveValidations(entry);

      const pathArgIndex = isCustomMethod ? 1 : 0;
      const rawPath = typeof entry.handlerDecoratorArgs[pathArgIndex] === 'string' ? entry.handlerDecoratorArgs[pathArgIndex] as string : '';
      const controllerPrefix = this.getControllerPrefix(entry.controllerKey);
      const fullPath = '/' + [controllerPrefix, rawPath].filter(Boolean).join('/').replace(/\/+/g, '/');

      const parsed = parseDecoratorOptions(entry.options);

      const responseDefaultsApplier = buildResponseDefaultsApplier(
        parsed.status,
        parsed.contentType,
        parsed.headers,
        parsed.redirect,
      );

      const pipeline = buildPipeline !== undefined
        ? buildPipeline(entry, validations, handler, responseDefaultsApplier)
        : EMPTY_PIPELINE;

      const routeEntry: MatchedRouteMetadata = {
        handler,
        rawBody: parsed.rawBody,
        sse: parsed.sse,
        bodyLimit: parsed.bodyLimit,
        status: parsed.status,
        redirect: parsed.redirect,
        contentType: parsed.contentType,
        headers: parsed.headers,
        ...(responseDefaultsApplier !== undefined ? { applyResponseDefaults: responseDefaultsApplier } : {}),
        validations,
        pre: pipeline.pre,
        post: pipeline.post,
        filters: pipeline.filters,
      };

      addWithHeadAlias({
        router: this.router,
        method: httpMethod,
        path: fullPath,
        entry: routeEntry,
        registeredMethods: this.registeredMethods,
        logger: this.logger,
        sourceLabel: ` → ${entry.controllerKey}.${entry.methodName} (AOT)`,
      });
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

      addWithHeadAlias({
        router: this.router,
        method,
        path: fullPath,
        entry,
        registeredMethods: this.registeredMethods,
        logger: this.logger,
        sourceLabel: ' (internal)',
      });
    }

    this.router.build();
  }

  private getAllowedMethodsForPath(path: string): string[] {
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
   * Resolves AOT-compiled validation entries into runtime entries with read/write closures.
   *
   * Maps each compiled accessor path to adapter-specific read/write operations
   * on the HttpRequest internal slots. Unknown accessors are silently skipped
   * (the adapter only handles accessor paths it recognizes).
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

      const lastSegment = validation.accessor[validation.accessor.length - 1];
      const io = resolveAccessorIO(lastSegment);

      if (io === undefined) {
        continue;
      }

      resolved.push({
        accessor: validation.accessor,
        metatype,
        readInput: io.readInput,
        writeOutput: io.writeOutput,
      });
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

// RFC 9110 §5.1 token 문자 (tchar). 빈 문자열 / 공백 / CTL / non-ASCII 거부.
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * RFC 9110 §5.1 token 검증. HTTP 메서드는 token 형태여야 한다.
 */
export function isValidMethodToken(method: string): boolean {
  return HTTP_TOKEN_PATTERN.test(method);
}

/**
 * AOT 컴파일된 핸들러 entry 에서 HTTP 메서드 토큰 추출.
 * 빈 문자열 / 비-string 인자는 `null` 반환.
 */
function extractHttpMethod(entry: CompiledHandlerEntry): string | null {
  const isCustomMethod = entry.handlerDecorator === 'Method';

  const raw = isCustomMethod
    ? entry.handlerDecoratorArgs[0]
    : entry.handlerDecorator;

  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  return trimmed.toUpperCase();
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

interface AccessorIO {
  readonly readInput: (context: AdapterContext) => unknown;
  readonly writeOutput: (context: AdapterContext, value: unknown) => void;
}

/**
 * Maps an accessor method name to read/write closures operating on HttpRequest slots.
 * Returns `undefined` for unrecognized accessors.
 */
function resolveAccessorIO(accessor: string | undefined): AccessorIO | undefined {
  switch (accessor) {
    case 'getBody':
      return {
        readInput: (ctx) => ctx.to(HttpContext).request.body,
        writeOutput: (ctx, value) => { ctx.to(HttpContext).request.setValidatedBody(value); },
      };
    case 'getParams':
      return {
        readInput: (ctx) => ctx.to(HttpContext).request.params,
        writeOutput: (ctx, value) => { ctx.to(HttpContext).request.setValidatedParams(value); },
      };
    default:
      return undefined;
  }
}

