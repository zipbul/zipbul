import type { Result, ResultAsync } from '@zipbul/result';
import type { AdapterClass } from './adapter/types';
import type { AdapterContext } from './interfaces';

/**
 * Handler function for a guard definition.
 * Receives the current execution context and returns a {@link Result}
 * indicating whether to allow (`void`) or deny (`Err<unknown>`).
 *
 * @param ctx - The execution context for the current request.
 * @returns `void` to allow, `Err<unknown>` to deny and halt the pipeline.
 *
 * @public
 */
export type GuardHandlerFn = (
  ctx: AdapterContext,
) => Result<void, unknown> | ResultAsync<void, unknown>;

/**
 * Immutable guard definition produced by {@link defineGuard}.
 *
 * When `adapters` is provided, the guard is only compatible with
 * the listed adapter classes. When omitted, the guard is universal
 * (compatible with all adapters).
 *
 * @public
 */
/**
 * Factory function that creates a guard handler.
 * Called once during pipeline assembly to produce the handler instance.
 *
 * @public
 */
export type GuardFactory = () => GuardHandlerFn;

export interface GuardDefinition {
  readonly factory: GuardFactory;
  readonly adapters?: readonly AdapterClass[];
}

/**
 * Declares a guard. This is an identity wrapper — it freezes
 * the definition into an immutable object. Its purpose is to serve
 * as a static marker for the AOT compiler and to provide a
 * type-safe, immutable guard reference.
 *
 * @param factory - The guard factory function (universal guard).
 * @returns A frozen {@link GuardDefinition}.
 *
 * @example
 * ```ts
 * // Universal guard (all adapters)
 * export const authGuard = defineGuard(() => (ctx) => {
 *   const authService = inject(AuthService);
 *   if (!authService.verify(ctx)) return err({ status: 401 });
 * });
 *
 * // Adapter-specific guard
 * export const httpAuthGuard = defineGuard([HttpAdapter], () => (ctx) => {
 *   const http = ctx.to(HttpContext);
 *   const token = http.request.headers.get('authorization');
 *   if (!token) return err({ status: 401, message: 'Unauthorized' });
 * });
 * ```
 *
 * @public
 */
export function defineGuard(factory: GuardFactory): GuardDefinition;
export function defineGuard(adapters: readonly AdapterClass[], factory: GuardFactory): GuardDefinition;
export function defineGuard(
  adaptersOrFactory: readonly AdapterClass[] | GuardFactory,
  maybeFactory?: GuardFactory,
): GuardDefinition {
  if (typeof adaptersOrFactory === 'function') {
    return Object.freeze({ factory: adaptersOrFactory });
  }

  if (maybeFactory === undefined) {
    throw new Error('Factory function is required when adapters are specified.');
  }

  return Object.freeze({
    factory: maybeFactory,
    adapters: Object.freeze([...adaptersOrFactory]),
  });
}
