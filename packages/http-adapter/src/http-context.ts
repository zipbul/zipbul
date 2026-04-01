import { ContextError, type ContextKey, type ClassToken, type Validated, type ZipbulContainer } from '@zipbul/common';
import type { ResolvedExceptionFilter } from '@zipbul/core';
import type { Logger } from '@zipbul/logger';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';
import type { ErrorResponseData, MatchedRouteMetadata } from './types';

import { HTTP_CONTEXT_TYPE } from './constants';

/**
 * Function signature for a response finalizer.
 * Finalizers modify headers only — body modification is not allowed.
 *
 * @public
 */
export type ResponseFinalizerFn = () => Promise<void> | void;

interface NamedResponseFinalizer {
  readonly name: string;
  readonly fn: ResponseFinalizerFn;
}

export class HttpContext {
  private _rawRequest: Request | undefined;
  private _routeExceptionFilters: readonly ResolvedExceptionFilter[] | undefined;
  private _matchedRoute: MatchedRouteMetadata | undefined;
  private readonly validatedCache = new Map<string, unknown>();
  private readonly store = new Map<symbol, unknown>();
  private readonly responseFinalizers: NamedResponseFinalizer[] = [];

  /**
   * Pre-pipeline error set by `fetch()` when `createHttpRequest` fails
   * with a recoverable error (not-implemented, invalid CL).
   * Checked by `executePipeline` after OnRequest MWs so CORS headers are applied.
   *
   * @internal
   */
  pipelineError: ErrorResponseData | undefined;

  constructor(
    private readonly _request: HttpRequest,
    private readonly _response: HttpResponse,
    rawRequest?: Request,
    private readonly _container?: ZipbulContainer,
  ) {
    this._rawRequest = rawRequest;
  }

  getType(): string {
    return HTTP_CONTEXT_TYPE;
  }

  /**
   * Returns a per-request value stored under the given typed key.
   *
   * @param key - A `ContextKey<T>` created via `contextKey()`.
   * @returns The stored value, or `undefined` if not set.
   * @public
   */
  get<T>(key: ContextKey<T>): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /**
   * Stores a per-request value under the given typed key.
   *
   * @param key - A `ContextKey<T>` created via `contextKey()`.
   * @param value - The value to store.
   * @public
   */
  set<T>(key: ContextKey<T>, value: T): void {
    this.store.set(key, value);
  }

  to<TContext>(ctor: ClassToken<TContext>): TContext {
    if (ctor === HttpContext) {
      return this as unknown as TContext;
    }

    throw new ContextError(`Context cast failed: ${ctor.name || 'UnknownContext'}`);
  }

  // ── Response Finalizer ──────────────────────────────────────

  /**
   * Registers a response finalizer that runs after response writing,
   * in LIFO order. Finalizers modify headers only — body changes are not allowed.
   * Each finalizer is individually try-caught; failures are logged but do not
   * prevent remaining finalizers from executing.
   *
   * @param name - Human-readable name for error logging.
   * @param fn - The finalizer function.
   * @public
   */
  addResponseFinalizer(name: string, fn: ResponseFinalizerFn): void {
    this.responseFinalizers.push({ name, fn });
  }

  /**
   * Executes all registered response finalizers in LIFO order.
   * Each finalizer is individually try-caught — a failing finalizer
   * does not prevent remaining finalizers from executing.
   *
   * @param logger - Logger instance for error reporting.
   * @internal
   */
  async runResponseFinalizers(logger: Logger): Promise<void> {
    for (let i = this.responseFinalizers.length - 1; i >= 0; i--) {
      const finalizer = this.responseFinalizers[i]!;
      try {
        await finalizer.fn();
      } catch (error) {
        logger.error(`Response finalizer '${finalizer.name}' failed`, error instanceof Error ? error : undefined);
      }
    }
  }

  // ── Validated accessors ──────────────────────────────────────

  /**
   * Stores a validated value by kind.
   * Called by the adapter after baker verification.
   *
   * @param kind - The validation kind (e.g. 'body', 'query', 'params').
   * @param value - The validated value.
   * @internal
   */
  setValidated(kind: string, value: unknown): void {
    this.validatedCache.set(kind, value);
  }

  /**
   * Returns the validated value for the given kind.
   * Throws `ContextError` if the kind has not been validated.
   *
   * The generic cast is safe: baker `deserialize()` guarantees
   * the stored value conforms to `T` at runtime.
   *
   * @param kind - The validation kind.
   * @returns The validated value.
   * @public
   */
  getValidated<T = unknown>(kind: string): T {
    const cached = this.validatedCache.get(kind);
    if (cached === undefined && !this.validatedCache.has(kind)) {
      throw new ContextError(`Validated '${kind}' not available. Ensure runValidations executed before handler.`);
    }
    // Safety: baker deserialize() guarantees the value matches T at runtime.
    // The Map stores unknown because different kinds hold different types.
    return cached as T;
  }

  /**
   * Returns the baker-validated request body.
   *
   * @returns The validated body as `T`.
   * @public
   */
  getBody<T extends object = never>(): Validated<T> {
    return this.getValidated<T>('body');
  }

  /**
   * Returns the baker-validated query parameters.
   *
   * @returns The validated query as `T`.
   * @public
   */
  getQuery<T extends object = never>(): Validated<T> {
    return this.getValidated<T>('query');
  }

  /**
   * Returns the baker-validated path parameters.
   *
   * @returns The validated params as `T`.
   * @public
   */
  getParams<T extends object = never>(): Validated<T> {
    return this.getValidated<T>('params');
  }

  // ── Request / Response ───────────────────────────────────────

  get request(): HttpRequest {
    return this._request;
  }

  get response(): HttpResponse {
    return this._response;
  }

  get rawRequest(): Request | undefined {
    return this._rawRequest;
  }

  /**
   * Returns the raw Request and releases the internal reference.
   * After this call, `rawRequest` returns `undefined`.
   * Used by `parseBody` to consume the body and hint GC.
   *
   * @returns The raw Request, or `undefined` if already consumed.
   * @public
   */
  consumeRawRequest(): Request | undefined {
    const raw = this._rawRequest;
    this._rawRequest = undefined;
    return raw;
  }

  get container(): ZipbulContainer | undefined {
    return this._container;
  }

  get routeExceptionFilters(): readonly ResolvedExceptionFilter[] | undefined {
    return this._routeExceptionFilters;
  }

  setRouteExceptionFilters(filters: readonly ResolvedExceptionFilter[]): void {
    this._routeExceptionFilters = filters;
  }

  get matchedRoute(): MatchedRouteMetadata | undefined {
    return this._matchedRoute;
  }

  set matchedRoute(route: MatchedRouteMetadata | undefined) {
    this._matchedRoute = route;
  }
}
