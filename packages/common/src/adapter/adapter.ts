import { err, isErr } from '@zipbul/result';
import type { Err, Result, ResultAsync } from '@zipbul/result';
import type { MiddlewareDefinition, MiddlewareHandlerFn } from '../define-middleware';
import type { GuardDefinition, GuardHandlerFn } from '../define-guard';
import type { ExceptionFilterDefinition, ExceptionFilterHandlerFn, ExceptionConstructorLike } from '../define-exception-filter';
import type { AdapterClass, AdapterEntryDecorators } from './types';
import { ClusterStrategy } from './types';
import type { Context, ZipbulContainer } from '../interfaces';
import { runInInjectionContext } from '../injection-context';

/**
 * Resolved middleware: factory has been called, handler is ready.
 *
 * @public
 */
export interface ResolvedMiddleware {
  readonly handler: MiddlewareHandlerFn;
}

/**
 * Resolved guard: factory has been called, handler is ready.
 *
 * @public
 */
export interface ResolvedGuard {
  readonly handler: GuardHandlerFn;
}

/**
 * Resolved exception filter: factory has been called, handler is ready.
 *
 * @public
 */
export interface ResolvedExceptionFilter {
  readonly handler: ExceptionFilterHandlerFn;
  readonly catchTypes: readonly ExceptionConstructorLike[];
}

/**
 * Base class for all Zipbul adapters.
 *
 * Provides framework-level pipeline orchestration (3-Phase error boundary),
 * middleware/guard/exception-filter execution primitives, and DI resolution.
 * Subclasses own their pipeline assembly via `executePipeline` and declare
 * protocol-specific phases via `static readonly validPhases`.
 *
 * @public
 */
export abstract class Adapter {
  abstract readonly decorators: AdapterEntryDecorators;

  /**
   * Set of valid middleware phase identifiers for this adapter.
   * AOT compiler extracts this statically for build-time phase validation.
   * Every adapter subclass must declare this as a static readonly property.
   *
   * @public
   */
  static readonly validPhases: ReadonlySet<string>;

  /**
   * Clustering strategy for this adapter.
   * Shared = N workers with reusePort. Exclusive = exactly 1 worker.
   * Subclasses override to declare their strategy.
   *
   * @public
   */
  readonly clusterStrategy: ClusterStrategy = ClusterStrategy.Shared;

  protected exceptionFilterDefs: ExceptionFilterDefinition[] = [];
  protected guardDefs: GuardDefinition[] = [];

  protected resolvedExceptionFilters: ResolvedExceptionFilter[] = [];
  protected resolvedGuards: ResolvedGuard[] = [];

  // ── Abstract hooks (subclass implements) ────────────────────

  /**
   * Assembles and executes the adapter-specific pipeline.
   * The adapter controls step ordering, phase hooks, and protocol-specific
   * logic (parsing, routing, handler invocation).
   *
   * @param context - The current execution context.
   * @returns `Result<unknown, unknown>` — domain `Err` or handler success value.
   *
   * @public
   */
  protected abstract executePipeline(context: Context): Promise<Result<unknown, unknown>>;

  /** Converts a `Result` into a protocol-specific response. */
  protected abstract handleResult(result: Result<unknown, unknown>, context: Context): Promise<void> | void;

  /**
   * Emergency teardown when `handleResult` itself throws.
   * Replaces `forceCloseConnection` — async is allowed for protocols
   * that need I/O (e.g. MQ nack).
   *
   * @param context - The current execution context.
   * @param error - The error thrown by `handleResult`.
   *
   * @public
   */
  protected abstract emergencyTeardown(context: Context, error?: unknown): Promise<void> | void;

  /**
   * Boots the adapter and begins accepting requests.
   *
   * @param context - The application startup context.
   * @public
   */
  abstract start(context: Context): Promise<void>;

  /**
   * Gracefully shuts down the adapter.
   *
   * @public
   */
  abstract stop(): Promise<void>;

  /**
   * Stops accepting new connections and waits for in-flight work to complete.
   * Each adapter implements protocol-specific drain logic.
   *
   * @param timeoutMs - Maximum time to wait for drain completion.
   *                     After timeout, force-close remaining connections.
   * @public
   */
  async drain(timeoutMs: number): Promise<void> {
    // Default: delegate to stop(). Subclasses override with protocol-specific drain.
    void timeoutMs;
    await this.stop();
  }

  // ── Registration ────────────────────────────────────────────

  /**
   * Receives AOT-generated middleware configuration.
   * The adapter validates phase keys against its own enum and stores them
   * in its own registry.
   *
   * @param config - Phase-keyed middleware definitions (string keys from AOT serialization).
   *
   * @public
   */
  abstract applyMiddlewareConfig(
    config: Readonly<Record<string, readonly MiddlewareDefinition[]>>,
  ): void;

  /**
   * Registers exception filter definitions.
   *
   * @param definitions - Exception filter definitions to append.
   * @returns `this` for chaining.
   *
   * @public
   */
  addExceptionFilters(definitions: readonly ExceptionFilterDefinition[]): this {
    this.exceptionFilterDefs = [...this.exceptionFilterDefs, ...definitions];
    return this;
  }

  /**
   * Registers guard definitions.
   *
   * @param guards - Guard definitions to append.
   * @returns `this` for chaining.
   *
   * @public
   */
  addGuards(guards: readonly GuardDefinition[]): this {
    this.validateAdapterCompatibility(guards, 'Guard');
    this.guardDefs = [...this.guardDefs, ...guards];
    return this;
  }

  // ── Pipeline initialization ────────────────────────────────

  /**
   * Resolves guard and exception filter definition factories within the given
   * DI container, producing ready-to-call handler functions.
   *
   * Middleware resolution is delegated to each adapter — override this method,
   * call `super.initializePipeline(container)`, then resolve your own
   * middleware registry via `resolveMiddlewareDefs()`.
   *
   * @param container - The application DI container.
   *
   * @public
   */
  initializePipeline(container: ZipbulContainer): void {
    this.resolvedGuards = this.guardDefs.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
    }));

    this.resolvedExceptionFilters = this.exceptionFilterDefs.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
      catchTypes: def.catchTypes,
    }));
  }

  // ── Pipeline orchestration: 3-Phase error boundary ─────────

  /**
   * Drives the full request pipeline with a 3-Phase error boundary.
   *
   * Phase 1: Execute pipeline → obtain `Result`. Panics go through exception filters.
   * Phase 2: `handleResult` — exactly once. If it throws → `emergencyTeardown`.
   * Phase 3: Finalize middlewares — always runs. Errors are swallowed.
   *
   * @param context - The current execution context.
   * @public
   */
  async dispatchRequest(context: Context): Promise<void> {
    // ── Phase 1: Pipeline execution → Result ──
    let result: Result<unknown, unknown>;

    try {
      result = await this.executePipeline(context);
    } catch (thrown) {
      try {
        result = await this.runExceptionFilters(thrown, context);
      } catch (filterError) {
        result = err({ message: 'Unhandled error', cause: thrown, filterError });
      }
    }

    // ── Phase 2: Result handling (exactly once) ──
    try {
      await this.handleResult(result, context);
    } catch (handleThrown) {
      try {
        await this.emergencyTeardown(context, handleThrown);
      } catch { /* swallow — last resort */ }
    }

    // ── Phase 3: Finalize (always runs) ──
    try {
      const finalizeList = this.getFinalizeMiddlewares();

      if (finalizeList.length > 0) {
        await this.runMiddlewares(finalizeList, context);
      }
    } catch { /* swallow — response already sent */ }
  }

  // ── Building blocks: adapters call these inside executePipeline ──

  /**
   * Executes an ordered list of resolved middlewares.
   *
   * @param list - Resolved middlewares to execute in order.
   * @param context - The current execution context.
   * @returns `void` on success, `Err<unknown>` when a middleware halts the pipeline.
   *
   * @public
   */
  protected async runMiddlewares(
    list: readonly ResolvedMiddleware[],
    context: Context,
  ): ResultAsync<void, unknown> {
    for (const mw of list) {
      const result = await mw.handler(context);

      if (isErr(result)) {
        return result;
      }
    }

    return undefined;
  }

  /**
   * Executes all registered guards in order.
   *
   * @param context - The current execution context.
   * @returns `void` on success, `Err<unknown>` when a guard denies access.
   *
   * @public
   */
  protected async runGuards(context: Context): ResultAsync<void, unknown> {
    for (const guard of this.resolvedGuards) {
      const result = await guard.handler(context);

      if (isErr(result)) {
        return result;
      }
    }

    return undefined;
  }

  // ── Exception filter dispatch ───────────────────────────────

  /**
   * Iterates registered exception filters, returning `Err<unknown>`
   * from the first matching filter. Falls back to a generic error
   * if no filter matches.
   *
   * Filter return values are validated: must be `Err`. If a filter returns
   * a non-Err value, a synthetic `Err` wrapping the original error is returned.
   *
   * @param error - The thrown error.
   * @param context - The current execution context.
   * @returns `Err<unknown>` to feed into `handleResult`.
   *
   * @public
   */
  async runExceptionFilters(error: unknown, context: Context): Promise<Err<unknown>> {
    for (const entry of this.resolvedExceptionFilters) {
      if (!this.matchesExceptionFilter(error, entry)) {
        continue;
      }

      const filterResult = await entry.handler(error, context);

      if (!isErr(filterResult)) {
        return err({ message: 'Exception filter must return Err', cause: error });
      }

      return filterResult;
    }

    return err({ message: 'Unhandled error', cause: error });
  }

  // ── Middleware definition resolution utility ─────────────────

  /**
   * Resolves middleware definitions into ready-to-call handlers using
   * the DI container. Adapters call this in their `initializePipeline`
   * override for each phase in their registry.
   *
   * @param definitions - Middleware definitions with factory functions.
   * @param container - The DI container for injection context.
   * @returns Array of resolved middlewares with callable handlers.
   *
   * @public
   */
  protected resolveMiddlewareDefs(
    definitions: readonly MiddlewareDefinition[],
    container: ZipbulContainer,
  ): ResolvedMiddleware[] {
    return definitions.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
    }));
  }

  // ── Finalize middlewares ─────────────────────────────────────

  /**
   * Returns the finalize middleware list for Phase 3 of `dispatchRequest`.
   * Override in adapters to provide protocol-specific finalize middlewares
   * (e.g. `OnComplete` for HTTP).
   *
   * @returns Resolved middlewares to run after response. Default: empty.
   *
   * @public
   */
  protected getFinalizeMiddlewares(): readonly ResolvedMiddleware[] {
    return [];
  }

  // ── Internal ────────────────────────────────────────────────

  /**
   * Checks whether an error matches a given exception filter entry.
   * Empty `catchTypes` acts as a catch-all.
   *
   * @param error - The thrown error.
   * @param entry - The exception filter entry to test against.
   * @returns `true` if the filter should handle this error.
   *
   * @public
   */
  protected matchesExceptionFilter(error: unknown, entry: ResolvedExceptionFilter): boolean {
    if (entry.catchTypes.length === 0) {
      return true;
    }

    for (const exceptionType of entry.catchTypes) {
      if (error instanceof exceptionType) {
        return true;
      }
    }

    return false;
  }

  protected validateAdapterCompatibility(
    definitions: readonly { readonly adapters?: readonly AdapterClass[] }[],
    label: string,
  ): void {
    for (const def of definitions) {
      if (def.adapters !== undefined && def.adapters.length > 0) {
        const compatible = def.adapters.some((adapterClass) => this instanceof adapterClass);

        if (!compatible) {
          const adapterNames = def.adapters.map((cls) => cls.name).join(', ');
          const thisName = this.constructor.name;

          throw new Error(
            `${label} is declared for [${adapterNames}] but was registered on ${thisName}. ` +
            `Check the adapter compatibility of your ${label.toLowerCase()} definition.`,
          );
        }
      }
    }
  }
}
