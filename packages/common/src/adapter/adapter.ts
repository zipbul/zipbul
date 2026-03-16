import { err, isErr } from '@zipbul/result';
import type { Err, Result, ResultAsync } from '@zipbul/result';
import type { MiddlewareDefinition, MiddlewareHandlerFn } from '../define-middleware';
import type { GuardDefinition, GuardHandlerFn } from '../define-guard';
import type { ExceptionFilterDefinition, ExceptionFilterHandlerFn, ExceptionConstructorLike } from '../define-exception-filter';
import type { AdapterClass, AdapterEntryDecorators, MiddlewareRegistry } from './types';
import { MiddlewareHook } from './types';
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
 * Provides framework-level pipeline orchestration, middleware registration,
 * exception filter dispatch, and guard execution.
 * Subclasses implement protocol-specific hooks via abstract methods.
 *
 * @public
 */
export abstract class Adapter {
  abstract readonly decorators: AdapterEntryDecorators;

  protected middlewareRegistry: MiddlewareRegistry = {};
  protected exceptionFilterDefs: ExceptionFilterDefinition[] = [];
  protected guardDefs: GuardDefinition[] = [];

  protected resolvedMiddlewareRegistry: Partial<Record<MiddlewareHook, ResolvedMiddleware[]>> = {};
  protected resolvedExceptionFilters: ResolvedExceptionFilter[] = [];
  protected resolvedGuards: ResolvedGuard[] = [];

  // ── Abstract hooks (subclass implements) ────────────────────

  /** Protocol-specific input parsing (e.g. HTTP body/query). */
  abstract parseInput(context: Context): Promise<void> | void;

  /** Route resolution + handler invocation. Returns the handler result. */
  abstract resolveHandler(context: Context): Promise<Result<unknown, unknown>> | Result<unknown, unknown>;

  /** Converts a `Result` into a protocol-specific response. */
  abstract handleResult(result: Result<unknown, unknown>, context: Context): Promise<void> | void;

  /** Emergency connection teardown when `handleResult` itself throws. */
  abstract forceCloseConnection(context: Context, error?: unknown): void;

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

  // ── Registration ────────────────────────────────────────────

  /**
   * Registers middlewares for a given pipeline hook.
   *
   * @param hook - The pipeline hook to attach middlewares to.
   * @param middlewares - Ordered list of middleware definitions to append.
   * @returns `this` for chaining.
   *
   * @public
   */
  addMiddlewares(hook: MiddlewareHook, middlewares: readonly MiddlewareDefinition[]): this {
    this.validateAdapterCompatibility(middlewares, 'Middleware');

    const current = this.middlewareRegistry[hook];
    this.middlewareRegistry[hook] = current ? [...current, ...middlewares] : [...middlewares];
    return this;
  }

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
   * Resolves all registered definition factories within the given DI container,
   * producing ready-to-call handler functions for middlewares, guards, and
   * exception filters.
   *
   * Must be called once after all definitions have been registered and
   * the container is fully assembled.
   *
   * @param container - The application DI container.
   *
   * @public
   */
  initializePipeline(container: ZipbulContainer): void {
    for (const [hook, defs] of Object.entries(this.middlewareRegistry)) {
      if (defs === undefined) {
        continue;
      }

      this.resolvedMiddlewareRegistry[hook as MiddlewareHook] = defs.map((def) => ({
        handler: runInInjectionContext(container, def.factory),
      }));
    }

    this.resolvedGuards = this.guardDefs.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
    }));

    this.resolvedExceptionFilters = this.exceptionFilterDefs.map((def) => ({
      handler: runInInjectionContext(container, def.factory),
      catchTypes: def.catchTypes,
    }));
  }

  // ── Pipeline orchestration ──────────────────────────────────

  /**
   * Template Method: drives the full request pipeline.
   *
   * ```
   * OnReceive → [parseInput] → PostParseData → [runGuards] → PreHandle
   *   → [resolveHandler] → [handleResult] → OnComplete
   * ```
   *
   * Throws are routed through `runExceptionFilters` → `handleResult`.
   * `OnComplete` errors are swallowed (response already sent).
   *
   * @param context - The current execution context.
   * @public
   */
  async dispatchRequest(context: Context): Promise<void> {
    try {
      const pipelineResult = await this.executePipeline(context);
      await this.handleResult(pipelineResult, context);
    } catch (pipelineError) {
      let filterResult: Err<unknown>;

      try {
        filterResult = await this.runExceptionFilters(pipelineError, context);
      } catch (filterError) {
        filterResult = err({ message: 'Unhandled error', cause: pipelineError, filterError });
      }

      try {
        await this.handleResult(filterResult, context);
      } catch (handleError) {
        this.forceCloseConnection(context, handleError);
      }
    } finally {
      try {
        await this.runMiddlewares(MiddlewareHook.OnComplete, context);
      } catch {
        // OnComplete errors are swallowed — response already sent.
      }
    }
  }

  // ── Middleware execution ─────────────────────────────────────

  /**
   * Executes resolved middlewares for a given hook or from a direct list.
   *
   * @param hookOrList - A pipeline hook to look up, or a direct array of resolved middlewares.
   * @param context - The current execution context.
   * @returns `void` on success, `Err<unknown>` when a middleware halts the pipeline.
   *
   * @public
   */
  async runMiddlewares(
    hookOrList: MiddlewareHook | readonly ResolvedMiddleware[],
    context: Context,
  ): ResultAsync<void, unknown> {
    const list = typeof hookOrList === 'string'
      ? (this.resolvedMiddlewareRegistry[hookOrList] ?? [])
      : hookOrList;

    for (const mw of list) {
      const result = await mw.handler(context);

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

      return await entry.handler(error, context);
    }

    return err({ message: 'Unhandled error', cause: error });
  }

  // ── Internal ────────────────────────────────────────────────

  private async executePipeline(context: Context): Promise<Result<unknown, unknown>> {
    const onReceiveResult = await this.runMiddlewares(MiddlewareHook.OnReceive, context);

    if (isErr(onReceiveResult)) {
      return onReceiveResult;
    }

    await this.parseInput(context);

    const postParseResult = await this.runMiddlewares(MiddlewareHook.PostParseData, context);

    if (isErr(postParseResult)) {
      return postParseResult;
    }

    const guardResult = await this.runGuards(context);

    if (isErr(guardResult)) {
      return guardResult;
    }

    const preHandleResult = await this.runMiddlewares(MiddlewareHook.PreHandle, context);

    if (isErr(preHandleResult)) {
      return preHandleResult;
    }

    return await this.resolveHandler(context);
  }

  private async runGuards(context: Context): ResultAsync<void, unknown> {
    for (const guard of this.resolvedGuards) {
      const result = await guard.handler(context);

      if (isErr(result)) {
        return result;
      }
    }

    return undefined;
  }

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
  private validateAdapterCompatibility(
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
}
