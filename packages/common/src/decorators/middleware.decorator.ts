import type { MiddlewareDefinition } from '../define-middleware';

/**
 * Attaches middleware definitions to a controller class or handler method.
 * This is a no-op decorator — actual middleware resolution happens at
 * AOT build time via static analysis.
 *
 * @param _middlewares - One or more {@link MiddlewareDefinition} references.
 * @returns A combined class and method decorator.
 *
 * @example
 * ```ts
 * @RestController('billing')
 * @UseMiddlewares(auditMiddleware)
 * export class BillingController {
 *   @Post('charge')
 *   @UseMiddlewares(chargeAuditMiddleware)
 *   charge() { ... }
 * }
 * ```
 *
 * @public
 */
export function UseMiddlewares(
  ..._middlewares: MiddlewareDefinition[]
): MethodDecorator & ClassDecorator {
  return () => {};
}
