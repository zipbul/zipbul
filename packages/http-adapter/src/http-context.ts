import type { Server } from 'bun';

import { ContextError, type AdapterContext, type ContextKey, type ClassToken, type ZipbulContainer } from '@zipbul/common';
import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';
import type { ErrorResponseData, MatchedRouteMetadata } from './types';

import { HTTP_CONTEXT_TYPE } from './constants';

export class HttpContext implements AdapterContext {
  private _rawRequest: Request | undefined;
  /** Retained reference for `server.timeout()` — not cleared by `consumeRawRequest()`. */
  private readonly _timeoutRequest: Request | undefined;
  private readonly _server: Server<unknown> | undefined;
  private _matchedRoute: MatchedRouteMetadata | undefined;
  private readonly store = new Map<symbol, unknown>();

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
    server?: Server<unknown>,
  ) {
    this._rawRequest = rawRequest;
    this._timeoutRequest = rawRequest;
    this._server = server;
  }

  /**
   * Overrides the idle timeout for this request.
   * Pass `0` to disable the timeout entirely (e.g. long-lived SSE streams).
   *
   * No-op if the context was created without a Bun server reference.
   *
   * @param seconds - Timeout in seconds (`0` = infinite).
   * @public
   */
  setTimeout(seconds: number): void {
    if (this._timeoutRequest !== undefined && this._server !== undefined) {
      this._server.timeout(this._timeoutRequest, seconds);
    }
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

  /**
   * Returns a per-request value, throwing if not set.
   *
   * @param key - A `ContextKey<T>` created via `contextKey()`.
   * @returns The stored value.
   * @throws `ContextError` if the key has not been set.
   * @public
   */
  use<T>(key: ContextKey<T>): T {
    const value = this.store.get(key);
    if (value === undefined && !this.store.has(key)) {
      throw new ContextError(`Context key not set: ${String(key)}`);
    }
    return value as T;
  }

  to<TContext>(ctor: ClassToken<TContext>): TContext {
    if (ctor === HttpContext) {
      return this as unknown as TContext;
    }

    throw new ContextError(`Context cast failed: ${ctor.name || 'UnknownContext'}`);
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

  get matchedRoute(): MatchedRouteMetadata | undefined {
    return this._matchedRoute;
  }

  set matchedRoute(route: MatchedRouteMetadata | undefined) {
    this._matchedRoute = route;
  }
}
