import { err, isErr } from '@zipbul/result';
import type { Err, Result, ResultAsync } from '@zipbul/result';
import type { MiddlewareDefinition } from '../define-middleware';
import type { GuardDefinition } from '../define-guard';
import type { AdapterClass, AdapterEntryDecorators, MiddlewareRegistry } from './types';
import { MiddlewareHook } from './types';
import type { Context, ExceptionFilterToken, ExceptionFilterEntry } from '../interfaces';

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
  protected errorFilterTokens: ExceptionFilterToken[] = [];
  protected exceptionFilters: ExceptionFilterEntry[] = [];
  protected guardDefinitions: GuardDefinition[] = [];

  // ── Abstract hooks (subclass implements) ────────────────────

  /** Protocol-specific input parsing (e.g. HTTP body/query). */
  abstract parseInput(context: Context): Promise<void> | void;

  /** Route resolution + handler invocation. Returns the handler result. */
  abstract resolveHandler(context: Context): Promise<Result<unknown, unknown>> | Result<unknown, unknown>;

  /** Converts a `Result` into a protocol-specific response. */
  abstract handleResult(result: Result<unknown, unknown>, context: Context): Promise<void> | void;

  /** Emergency connection teardown when `handleResult` itself throws. */
  abstract forceCloseConnection(context: Context): void;

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
   * Registers error filter tokens (legacy — used by HttpServer boot).
   *
   * @param filters - Error filter tokens to append.
   * @returns `this` for chaining.
   *
   * @public
   */
  addErrorFilters(filters: readonly ExceptionFilterToken[]): this {
    this.errorFilterTokens = [...this.errorFilterTokens, ...filters];
    return this;
  }

  /**
   * Registers typed exception filter entries.
   *
   * @param entries - Exception filter entries to append.
   * @returns `this` for chaining.
   *
   * @public
   */
  addExceptionFilterEntries(entries: readonly ExceptionFilterEntry[]): this {
    this.exceptionFilters = [...this.exceptionFilters, ...entries];
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
    this.guardDefinitions = [...this.guardDefinitions, ...guards];
    return this;
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
      } catch {
        this.forceCloseConnection(context);
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
   * Executes middlewares registered for a given hook or from a direct list.
   *
   * @param hookOrList - A pipeline hook to look up, or a direct array of middleware definitions.
   * @param context - The current execution context.
   * @returns `void` on success, `Err<unknown>` when a middleware halts the pipeline.
   *
   * @public
   */
  async runMiddlewares(
    hookOrList: MiddlewareHook | MiddlewareDefinition[],
    context: Context,
  ): ResultAsync<void, unknown> {
    const list = Array.isArray(hookOrList)
      ? hookOrList
      : (this.middlewareRegistry[hookOrList] ?? []);

    for (const def of list) {
      const result = await def.handler(context);

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
    for (const entry of this.exceptionFilters) {
      if (!this.matchesExceptionFilter(error, entry)) {
        continue;
      }

      return await entry.filter.catch(error, context);
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
    for (const guard of this.guardDefinitions) {
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

  protected matchesExceptionFilter(error: unknown, entry: ExceptionFilterEntry): boolean {
    if (entry.catchTypes.length === 0) {
      return true;
    }

    for (const errorType of entry.catchTypes) {
      if (error instanceof errorType) {
        return true;
      }
    }

    return false;
  }
}
