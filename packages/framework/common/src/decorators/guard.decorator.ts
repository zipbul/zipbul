import type { GuardDefinition } from '../define-guard';

/**
 * Binds guard definitions to a controller class or handler method.
 * This is a no-op at runtime — the AOT compiler extracts the
 * guard references from the AST.
 *
 * @param _guards - Guard definitions to apply.
 * @returns A class or method decorator (no-op).
 *
 * @example
 * ```ts
 * @UseGuards(authGuard)
 * class UsersController { ... }
 *
 * @UseGuards(adminGuard)
 * findAll() { ... }
 * ```
 *
 * @public
 */
export function UseGuards(..._guards: readonly GuardDefinition[]): (value: unknown, context: DecoratorContext) => void {
  return () => {};
}
