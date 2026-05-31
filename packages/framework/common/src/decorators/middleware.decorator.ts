import type { MiddlewareDefinition } from '../define-middleware';

/**
 * Attaches middleware definitions to a controller class or handler method
 * for a specific pipeline phase.
 *
 * This is a no-op decorator — actual middleware resolution happens at
 * AOT build time via static analysis.
 *
 * @param _phase - The pipeline phase to attach middlewares to (e.g. `'BeforeHandle'`).
 * @param _middlewares - One or more {@link MiddlewareDefinition} references.
 * @returns A combined class and method decorator.
 *
 * @example
 * ```ts
 * @RestController('billing')
 * @UseMiddlewares('BeforeHandle', [auditMiddleware])
 * export class BillingController {
 *   @Post('charge')
 *   @UseMiddlewares('BeforeHandle', [chargeAuditMiddleware])
 *   charge() { ... }
 * }
 * ```
 *
 * @public
 */
export function UseMiddlewares(
  _phase: string,
  _middlewares: readonly MiddlewareDefinition[],
): (value: unknown, context: DecoratorContext) => void;

/**
 * Attaches middleware definitions using a phase-keyed map.
 *
 * @param _phaseMap - Object mapping phase names to middleware definition arrays.
 * @returns A combined class and method decorator.
 *
 * @example
 * ```ts
 * @UseMiddlewares({ BeforeHandle: [authMiddleware], BeforeResponse: [compressionMiddleware] })
 * ```
 *
 * @public
 */
export function UseMiddlewares(
  _phaseMap: Readonly<Record<string, readonly MiddlewareDefinition[]>>,
): (value: unknown, context: DecoratorContext) => void;

export function UseMiddlewares(
  ..._args: unknown[]
): (value: unknown, context: DecoratorContext) => void {
  return () => {};
}
