import type { HandlerIndexEntry, RouteRegistration } from '../interfaces';
import type { MiddlewareProducerInfo } from './middleware-context-types';
import type { ContextOperation } from '../parser/context-operation-extractor';
import { ZIPBUL_REF } from '@zipbul/common';
import { toRecord } from '../type-guards';

/**
 * AOT-stage producer-consumer dependency violation.
 *
 * Reported when a handler invokes `ctx.use(KEY)` (required consumer) but no
 * middleware in that handler's registered chain calls `ctx.set(KEY, ...)`
 * (producer). This means the call would `throw` at runtime in production —
 * surfacing it at build time gives the operator a clear, file-local error
 * before deployment.
 *
 * Algorithm:
 *   1. Build name→producer-keys map from collected middleware augments
 *      (each augment has `middlewareName` + `contextOps` from its factory body).
 *   2. Build handlerKey→middlewareNames map by translating the handler's
 *      `mergedPhaseMiddlewareKeys` container keys via `routeRegistrations`
 *      (each registration carries `value.ZIPBUL_REF` = the export name).
 *   3. For each handler's `ctx.use(KEY)`, verify some middleware in its
 *      chain produces KEY.
 *
 * Phase ordering (producer must run in earlier-or-same phase as consumer)
 * is not yet enforced — a follow-up will compare phase ranks. The current
 * check is "registered in chain at all", which catches the most common
 * misuse (forgetting to register the producer middleware entirely).
 *
 * @public
 */
export interface ContextDependencyViolation {
  readonly handlerId: string;
  /** The required key identifier (`KEY` in `ctx.use(KEY)`). */
  readonly keyIdentifier: string;
  /** Source byte offset of the `ctx.use(KEY)` call (oxc-parser `start`). */
  readonly start: number | null;
  /**
   * Middleware names in *any* augment that produce this key —
   * used for diagnostic suggestions ("you forgot to register one of: A, B").
   */
  readonly knownProducersForKey: readonly string[];
  /** Middleware names registered for this handler (for diagnostic context). */
  readonly registeredMiddlewares: readonly string[];
}

/**
 * Validates that every handler's `ctx.use(KEY)` consumer has at least one
 * matching `ctx.set(KEY, ...)` producer in its registered middleware chain.
 *
 * @param handlerIndex - AOT-compiled handler entries.
 * @param handlerContextOps - Per-handler context operations.
 * @param augments - Collected middleware augments (with `contextOps`).
 * @param routeRegistrations - Container key → ref value mappings (used to
 *   translate handler binding keys to middleware export names).
 * @returns Violations — one per handler×missing-producer pair.
 *
 * @public
 */
export function validateContextDependencies(
  handlerIndex: readonly HandlerIndexEntry[],
  handlerContextOps: ReadonlyMap<string, readonly ContextOperation[]>,
  producerInfos: readonly MiddlewareProducerInfo[],
  routeRegistrations: readonly RouteRegistration[] = [],
): readonly ContextDependencyViolation[] {
  // middlewareName → produced keys
  const producersByName = new Map<string, Set<string>>();
  for (const info of producerInfos) {
    const produced = new Set<string>();
    for (const op of info.contextOps) {
      if (op.kind === 'set' && op.keyIdentifier !== null) {
        produced.add(op.keyIdentifier);
      }
    }
    if (produced.size > 0) {
      producersByName.set(info.middlewareName, produced);
    }
  }

  // produced key → middleware names that produce it (for diagnostic suggestions)
  const producersByKey = invertProducerMap(producersByName);

  // container key → middleware ref name (from registrations)
  const keyToRefName = buildKeyToRefName(routeRegistrations);

  const violations: ContextDependencyViolation[] = [];

  for (const entry of handlerIndex) {
    const ops = handlerContextOps.get(entry.id);
    if (ops === undefined) continue;

    const registeredNames = collectRegisteredMiddlewareNames(entry, keyToRefName);

    // Aggregate producers reachable from this handler's chain.
    const reachableKeys = new Set<string>();
    for (const name of registeredNames) {
      const producedKeys = producersByName.get(name);
      if (producedKeys === undefined) continue;
      for (const key of producedKeys) reachableKeys.add(key);
    }

    for (const op of ops) {
      if (op.kind !== 'use') continue;
      if (op.keyIdentifier === null) continue;
      if (reachableKeys.has(op.keyIdentifier)) continue;

      violations.push({
        handlerId: entry.id,
        keyIdentifier: op.keyIdentifier,
        start: op.start,
        knownProducersForKey: [...(producersByKey.get(op.keyIdentifier) ?? new Set<string>())].sort(),
        registeredMiddlewares: [...registeredNames].sort(),
      });
    }
  }

  return violations;
}

function invertProducerMap(byName: ReadonlyMap<string, ReadonlySet<string>>): Map<string, Set<string>> {
  const byKey = new Map<string, Set<string>>();
  for (const [name, keys] of byName) {
    for (const key of keys) {
      let set = byKey.get(key);
      if (set === undefined) {
        set = new Set<string>();
        byKey.set(key, set);
      }
      set.add(name);
    }
  }
  return byKey;
}

function buildKeyToRefName(registrations: readonly RouteRegistration[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const reg of registrations) {
    if (reg.kind !== 'ref') continue;
    const record = toRecord(reg.value);
    if (record === null) continue;
    const refName = record[ZIPBUL_REF];
    if (typeof refName !== 'string' || refName.length === 0) continue;
    map.set(reg.key, refName);
  }
  return map;
}

function collectRegisteredMiddlewareNames(
  entry: HandlerIndexEntry,
  keyToRefName: ReadonlyMap<string, string>,
): Set<string> {
  const names = new Set<string>();
  if (entry.mergedPhaseMiddlewareKeys !== undefined) {
    for (const phaseKeys of Object.values(entry.mergedPhaseMiddlewareKeys)) {
      for (const key of phaseKeys) {
        const name = keyToRefName.get(key);
        if (name !== undefined) names.add(name);
      }
    }
  }
  if (entry.middlewareKeys !== undefined) {
    for (const key of entry.middlewareKeys) {
      const name = keyToRefName.get(key);
      if (name !== undefined) names.add(name);
    }
  }
  return names;
}

/**
 * Formats a violation as a human-readable diagnostic string.
 *
 * @public
 */
export function formatViolationMessage(violation: ContextDependencyViolation): string {
  const lines = [
    `Handler '${violation.handlerId}' calls ctx.use(${violation.keyIdentifier}) but no middleware in its registered chain produces this key.`,
    `  Required key: ${violation.keyIdentifier}`,
    `  Hint: register a middleware that calls ctx.set(${violation.keyIdentifier}, ...) before this handler runs.`,
  ];

  if (violation.knownProducersForKey.length > 0) {
    lines.push(`  Producers found in this build (not registered for this handler): ${violation.knownProducersForKey.join(', ')}`);
  } else {
    lines.push(`  No middleware in this build produces '${violation.keyIdentifier}'.`);
  }

  if (violation.registeredMiddlewares.length > 0) {
    lines.push(`  Currently registered for this handler: ${violation.registeredMiddlewares.join(', ')}`);
  } else {
    lines.push('  No middleware is registered for this handler.');
  }

  return lines.join('\n');
}
