import type { MiddlewareDefinition } from '../define-middleware';
import type { AdapterEntryDecorators, AdapterDependsOn, MiddlewareRegistry } from './types';
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
  abstract readonly name: string;
  abstract readonly decorators: AdapterEntryDecorators;
  readonly dependsOn?: AdapterDependsOn | undefined;

  protected middlewareRegistry: MiddlewareRegistry = {};
  protected errorFilterTokens: ExceptionFilterToken[] = [];
  middlewareWired = false;

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
    const current = this.middlewareRegistry[hook];
    this.middlewareRegistry[hook] = current ? [...current, ...middlewares] : [...middlewares];
    return this;
  }

  /**
   * Marks that AOT has completed adapter-level middleware wiring.
   * Once marked, runtime DI bridge should skip redundant registration.
   *
   * @public
   */
  markMiddlewareWired(): void {
    this.middlewareWired = true;
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
   * Executes middlewares registered for a given hook.
   *
   * @param hook - The pipeline hook to execute.
   * @param context - The current execution context.
   * @returns `true` to continue the pipeline, `false` to abort.
   *
   * @public
   */
  async runMiddlewares(hook: MiddlewareHook, context: Context): Promise<boolean> {
    const list = this.middlewareRegistry[hook] ?? [];

    for (const def of list) {
      const result = await def.handler(context);

      if (result === false) {
        return false;
      }
    }

    return true;
  }

  abstract start(context: Context): Promise<void>;
  abstract stop(): Promise<void>;
}
