/**
 * Core pipeline steps shared by all adapters.
 *
 * The AOT compiler uses these to determine which steps can be eliminated
 * when no corresponding registrations exist for a given handler.
 *
 * @public
 */
export enum CoreStep {
  /** Guard execution. Removed when no merged guards registered. */
  Guard = 'Guard',
  /** Handler input validation (baker DTO). Removed when the handler has no validations. */
  Validation = 'Validation',
  /** Handler invocation. Always retained. */
  Handler = 'Handler',
}
