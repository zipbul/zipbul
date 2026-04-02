/**
 * Core pipeline steps shared by all adapters.
 *
 * The AOT compiler uses these to determine which steps can be eliminated
 * when no corresponding registrations exist for a given handler.
 *
 * @public
 */
export enum CoreStep {
  /** Global guard execution. Removed when no guards are registered. */
  Guard = 'Guard',
  /** Handler-scoped middleware execution. Removed when the handler has none. */
  ScopedMiddleware = 'ScopedMiddleware',
  /** Handler-scoped guard execution. Removed when the handler has none. */
  ScopedGuard = 'ScopedGuard',
  /** Handler input validation (baker DTO). Removed when the handler has no validations. */
  Validation = 'Validation',
  /** Handler invocation. Always retained. */
  Handler = 'Handler',
}
