import { isErr } from '@zipbul/result';
import type { ResultAsync } from '@zipbul/result';
import type { MiddlewareDefinition } from '../define-middleware';
import type { MiddlewareHalt } from '../define-middleware';
import type { AdapterEntryDecorators, MiddlewareRegistry } from './types';
import { MiddlewareHook } from './types';
import type { Context, ExceptionFilterToken } from '../interfaces';

/**
 * Base class for all Zipbul adapters.
 *
 * Provides framework-level middleware registration and execution.
 * Subclasses implement protocol-specific `start` / `stop` logic.
 *
 * @public
 */
export abstract class Adapter {
  abstract readonly decorators: AdapterEntryDecorators;

  protected middlewareRegistry: MiddlewareRegistry = {};
  protected errorFilterTokens: ExceptionFilterToken[] = [];

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
    for (const def of middlewares) {
      if (def.adapters !== undefined && def.adapters.length > 0) {
        const compatible = def.adapters.some((adapterClass) => this instanceof adapterClass);

        if (!compatible) {
          const adapterNames = def.adapters.map((cls) => cls.name).join(', ');
          const thisName = this.constructor.name;

          throw new Error(
            `Middleware is declared for [${adapterNames}] but was registered on ${thisName}. ` +
            'Check the adapter compatibility of your middleware definition.',
          );
        }
      }
    }

    const current = this.middlewareRegistry[hook];
    this.middlewareRegistry[hook] = current ? [...current, ...middlewares] : [...middlewares];
    return this;
  }

  /**
   * Registers error filter tokens.
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
   * Executes middlewares registered for a given hook or from a direct list.
   *
   * @param hookOrList - A pipeline hook to look up, or a direct array of middleware definitions.
   * @param context - The current execution context.
   * @returns `void` on success, `Err<MiddlewareHalt>` when a middleware halts the pipeline.
   *
   * @public
   */
  async runMiddlewares(
    hookOrList: MiddlewareHook | readonly MiddlewareDefinition[],
    context: Context,
  ): ResultAsync<void, MiddlewareHalt> {
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

  abstract start(context: Context): Promise<void>;
  abstract stop(): Promise<void>;
}
