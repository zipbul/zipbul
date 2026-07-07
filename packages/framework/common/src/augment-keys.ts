import type { ContextKey } from './context-key';

/**
 * Deterministic per-request context-store keys for middleware augments.
 *
 * `Symbol.for` (not `Symbol()`) so keys are identical across in-process
 * re-boots (@zipbul/testing boots many apps per process) and derivable by
 * every party (supply step, installed accessor, tests) without sharing a
 * module instance.
 *
 * The package segment is intentionally absent: ns.prop uniqueness is
 * guaranteed by the boot/compile collision rules (two packages may never
 * claim the same ns.prop), so pkg would add no discrimination — and the
 * supply step composed from a bare MiddlewareDefinition has no package
 * identity at runtime.
 *
 * @public
 */
export function augmentRawKey(namespace: string, prop: string): ContextKey<unknown> {
  return Symbol.for(`zipbul.augment.${namespace}.${prop}.raw`) as ContextKey<unknown>;
}

/**
 * Key holding the baker-validated DTO instance for a validated accessor.
 *
 * @public
 */
export function augmentValidatedKey(namespace: string, prop: string): ContextKey<unknown> {
  return Symbol.for(`zipbul.augment.${namespace}.${prop}.validated`) as ContextKey<unknown>;
}

