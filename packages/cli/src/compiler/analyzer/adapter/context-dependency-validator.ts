import type {
  AdapterStaticSchema,
  HandlerIndexEntry,
  RouteRegistration,
} from '../interfaces';
import type { MiddlewareProducerInfo } from './middleware-context-types';
import type { ContextOperation } from '../parser/context-operation-extractor';
import { ZIPBUL_REF } from '@zipbul/common';
import { toRecord } from '../type-guards';

/**
 * Pipeline rank derived from `defineAdapter().pipeline` declaration.
 *
 * The adapter's pipeline array is the single source of truth for phase ordering;
 * the validator does not hardcode HTTP phases or any adapter-specific names.
 * Each phase / step occupies a position; lower rank = runs earlier.
 *
 * The handler core step's rank ('Handler' in CoreStep) is the consumer rank
 * for handler `ctx.use(KEY)` — producers must run at this rank or earlier.
 */
interface PhaseRanker {
  rank(phaseOrStep: string): number | null;
  /** Rank of the 'Handler' core step — consumer rank for handler ctx.use. */
  readonly handlerStepRank: number | null;
}

function buildPhaseRanker(pipeline: readonly string[] | undefined): PhaseRanker {
  if (pipeline === undefined) {
    return { rank: () => null, handlerStepRank: null };
  }
  const map = new Map<string, number>();
  pipeline.forEach((step, idx) => map.set(step, idx));
  const handlerIdx = pipeline.indexOf('Handler');
  return {
    rank: (name) => map.get(name) ?? null,
    handlerStepRank: handlerIdx >= 0 ? handlerIdx : null,
  };
}

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
/**
 * Violation reason — distinguishes "no producer at all" from "wrong phase".
 *
 * `missing-producer`  : no registered middleware produces this key.
 * `wrong-phase`       : producer is registered but its phase runs AFTER the consumer.
 */
export type ContextDependencyViolationReason = 'missing-producer' | 'wrong-phase';

export interface ContextDependencyViolation {
  readonly reason: ContextDependencyViolationReason;
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
  /**
   * For `wrong-phase` violations, the phase(s) of the producer middleware that
   * runs AFTER the consumer — diagnostic helps user fix the registration phase.
   */
  readonly wrongPhaseDetails?: readonly { readonly middlewareName: string; readonly phase: string }[];
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
  adapterStaticSchemas: Readonly<Record<string, AdapterStaticSchema>> = {},
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

  // adapterId → phase ranker
  const rankerByAdapter = new Map<string, PhaseRanker>();
  for (const [adapterId, schema] of Object.entries(adapterStaticSchemas)) {
    rankerByAdapter.set(adapterId, buildPhaseRanker(schema.pipeline));
  }

  const violations: ContextDependencyViolation[] = [];

  for (const entry of handlerIndex) {
    const ops = handlerContextOps.get(entry.id);
    if (ops === undefined) continue;

    const ranker = rankerByAdapter.get(entry.adapterId) ?? buildPhaseRanker(undefined);
    const registeredNames = collectRegisteredMiddlewareNames(entry, keyToRefName);

    // Producer keys grouped by their effective rank — only producers running at
    // or before the handler step are reachable. `wrongPhaseProducers` collects
    // producers that exist on the chain but run too late, for `wrong-phase`
    // diagnostic specificity.
    const reachableKeys = new Set<string>();
    const wrongPhaseProducerByKey = new Map<string, Array<{ middlewareName: string; phase: string }>>();

    if (entry.mergedPhaseMiddlewareKeys !== undefined) {
      for (const [phase, keys] of Object.entries(entry.mergedPhaseMiddlewareKeys)) {
        const phaseRank = ranker.rank(phase);
        const consumerRank = ranker.handlerStepRank;
        const isReachable = phaseRank === null
          || consumerRank === null
          || phaseRank <= consumerRank;

        for (const key of keys) {
          const middlewareName = keyToRefName.get(key);
          if (middlewareName === undefined) continue;
          const producedKeys = producersByName.get(middlewareName);
          if (producedKeys === undefined) continue;

          if (isReachable) {
            for (const k of producedKeys) reachableKeys.add(k);
          } else {
            for (const k of producedKeys) {
              let arr = wrongPhaseProducerByKey.get(k);
              if (arr === undefined) {
                arr = [];
                wrongPhaseProducerByKey.set(k, arr);
              }
              arr.push({ middlewareName, phase });
            }
          }
        }
      }
    }

    for (const op of ops) {
      if (op.kind !== 'use') continue;
      if (op.keyIdentifier === null) continue;
      if (reachableKeys.has(op.keyIdentifier)) continue;

      const wrongPhaseDetails = wrongPhaseProducerByKey.get(op.keyIdentifier);
      const reason: ContextDependencyViolationReason = wrongPhaseDetails !== undefined && wrongPhaseDetails.length > 0
        ? 'wrong-phase'
        : 'missing-producer';

      violations.push({
        reason,
        handlerId: entry.id,
        keyIdentifier: op.keyIdentifier,
        start: op.start,
        knownProducersForKey: [...(producersByKey.get(op.keyIdentifier) ?? new Set<string>())].sort(),
        registeredMiddlewares: [...registeredNames].sort(),
        ...(wrongPhaseDetails !== undefined && wrongPhaseDetails.length > 0
          ? { wrongPhaseDetails: [...wrongPhaseDetails] }
          : {}),
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
  const summary = violation.reason === 'wrong-phase'
    ? `Handler '${violation.handlerId}' calls ctx.use(${violation.keyIdentifier}) but the producing middleware is registered in a phase that runs AFTER the handler.`
    : `Handler '${violation.handlerId}' calls ctx.use(${violation.keyIdentifier}) but no middleware in its registered chain produces this key.`;

  const lines = [
    summary,
    `  Required key: ${violation.keyIdentifier}`,
  ];

  if (violation.reason === 'wrong-phase' && violation.wrongPhaseDetails !== undefined) {
    const details = violation.wrongPhaseDetails
      .map((d) => `${d.middlewareName} @ ${d.phase}`)
      .join(', ');
    lines.push(`  Producer registered in late phase: ${details}`);
    lines.push(`  Hint: move the producer middleware to OnRequest, BeforeParse, BeforeValidate, or BeforeHandle phase.`);
  } else {
    lines.push(`  Hint: register a middleware that calls ctx.set(${violation.keyIdentifier}, ...) before this handler runs.`);
  }

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
