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
 * Violation reason.
 *
 * - `missing-producer` : no registered middleware produces this key
 * - `wrong-phase`      : producer is registered but in a phase running AFTER the consumer
 * - `wrong-order`      : producer is registered in the same phase as the consumer
 *                        but registered AFTER (later in the phase array)
 */
export type ContextDependencyViolationReason =
  | 'missing-producer'
  | 'wrong-phase'
  | 'wrong-order';

/**
 * Source of the consumer that triggered the violation.
 *
 * - `handler`    : the handler method itself (`ctx.use(KEY)` in the body)
 * - `middleware` : a middleware in the chain (`ctx.use(KEY)` in factory body)
 */
export type ContextDependencyConsumerSource = 'handler' | 'middleware';

export interface ContextDependencyViolation {
  readonly reason: ContextDependencyViolationReason;
  readonly handlerId: string;
  /** The required key identifier (`KEY` in `ctx.use(KEY)`). */
  readonly keyIdentifier: string;
  /** Source byte offset of the `ctx.use(KEY)` call (gildash `Node.start`). */
  readonly start: number | null;
  /** Where the consumer call originated. */
  readonly consumerSource: ContextDependencyConsumerSource;
  /**
   * Middleware export name that contains the consumer call —
   * `null` if `consumerSource === 'handler'`.
   */
  readonly consumerMiddlewareName: string | null;
  /**
   * Middleware names in *any* registered middleware that produce this key —
   * used for diagnostic suggestions.
   */
  readonly knownProducersForKey: readonly string[];
  /** Middleware names registered for this handler (for diagnostic context). */
  readonly registeredMiddlewares: readonly string[];
  /**
   * For `wrong-phase` / `wrong-order` violations, the producer middleware that
   * runs AFTER the consumer in the pipeline.
   */
  readonly wrongPositionDetails?: readonly { readonly middlewareName: string; readonly phase: string }[];
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
  const producerInfoByName = new Map<string, MiddlewareProducerInfo>();
  const producersByName = new Map<string, Set<string>>();

  for (const info of producerInfos) {
    producerInfoByName.set(info.middlewareName, info);
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

  const producersByKey = invertProducerMap(producersByName);
  const keyToRefName = buildKeyToRefName(routeRegistrations);

  const rankerByAdapter = new Map<string, PhaseRanker>();
  for (const [adapterId, schema] of Object.entries(adapterStaticSchemas)) {
    rankerByAdapter.set(adapterId, buildPhaseRanker(schema.pipeline));
  }

  const violations: ContextDependencyViolation[] = [];

  for (const entry of handlerIndex) {
    const ranker = rankerByAdapter.get(entry.adapterId) ?? buildPhaseRanker(undefined);
    const consumerRank = ranker.handlerStepRank;
    const registeredNames = collectRegisteredMiddlewareNames(entry, keyToRefName);

    // Pre-compute set of all keys produced by *some* registered middleware on
    // this chain — used to distinguish missing-producer vs wrong-phase/order.
    const allProducedOnChain = new Set<string>();
    for (const name of registeredNames) {
      const produced = producersByName.get(name);
      if (produced === undefined) continue;
      for (const k of produced) allProducedOnChain.add(k);
    }

    // ── Topological walk of the middleware chain (phase rank, then order) ──
    const reachable = new Set<string>();
    const lateProducerByKey = new Map<string, Array<{ middlewareName: string; phase: string }>>();

    const sortedPhases = sortPhasesByRank(entry.mergedPhaseMiddlewareKeys, ranker);

    for (const { phase, keys } of sortedPhases) {
      const phaseRank = ranker.rank(phase);
      const inChainScope =
        phaseRank === null
        || consumerRank === null
        || phaseRank <= consumerRank;

      for (const key of keys) {
        const mwName = keyToRefName.get(key);
        if (mwName === undefined) continue;

        const info = producerInfoByName.get(mwName);
        if (info === undefined) continue;

        if (inChainScope) {
          // 1) Validate this middleware's consumer ops against currently-reachable keys.
          for (const op of info.contextOps) {
            if (op.kind !== 'use') continue;
            if (op.keyIdentifier === null) continue;
            if (reachable.has(op.keyIdentifier)) continue;

            violations.push(buildViolation({
              entry,
              keyIdentifier: op.keyIdentifier,
              start: op.start,
              consumerSource: 'middleware',
              consumerMiddlewareName: mwName,
              consumerPhase: phase,
              allProducedOnChain,
              producersByKey,
              registeredNames,
              lateProducerByKey,
            }));
          }

          // 2) Add this middleware's producers to reachable AFTER consumer check
          //    (so a same-middleware self-use is not auto-satisfied).
          for (const op of info.contextOps) {
            if (op.kind === 'set' && op.keyIdentifier !== null) {
              reachable.add(op.keyIdentifier);
            }
          }
        } else {
          // Producer in late phase — record for diagnostic specificity.
          for (const op of info.contextOps) {
            if (op.kind === 'set' && op.keyIdentifier !== null) {
              let arr = lateProducerByKey.get(op.keyIdentifier);
              if (arr === undefined) {
                arr = [];
                lateProducerByKey.set(op.keyIdentifier, arr);
              }
              arr.push({ middlewareName: mwName, phase });
            }
          }
        }
      }
    }

    // ── Validate handler's own ctx.use ops ──
    const handlerOps = handlerContextOps.get(entry.id);
    if (handlerOps !== undefined) {
      for (const op of handlerOps) {
        if (op.kind !== 'use') continue;
        if (op.keyIdentifier === null) continue;
        if (reachable.has(op.keyIdentifier)) continue;

        violations.push(buildViolation({
          entry,
          keyIdentifier: op.keyIdentifier,
          start: op.start,
          consumerSource: 'handler',
          consumerMiddlewareName: null,
          consumerPhase: null,
          allProducedOnChain,
          producersByKey,
          registeredNames,
          lateProducerByKey,
        }));
      }
    }
  }

  return violations;
}

interface ViolationContext {
  readonly entry: HandlerIndexEntry;
  readonly keyIdentifier: string;
  readonly start: number | null;
  readonly consumerSource: ContextDependencyConsumerSource;
  readonly consumerMiddlewareName: string | null;
  readonly consumerPhase: string | null;
  readonly allProducedOnChain: ReadonlySet<string>;
  readonly producersByKey: ReadonlyMap<string, ReadonlySet<string>>;
  readonly registeredNames: ReadonlySet<string>;
  readonly lateProducerByKey: ReadonlyMap<string, ReadonlyArray<{ middlewareName: string; phase: string }>>;
}

function buildViolation(ctx: ViolationContext): ContextDependencyViolation {
  const lateProducers = ctx.lateProducerByKey.get(ctx.keyIdentifier) ?? [];
  const producedOnChain = ctx.allProducedOnChain.has(ctx.keyIdentifier);

  let reason: ContextDependencyViolationReason;
  if (!producedOnChain) {
    reason = 'missing-producer';
  } else if (lateProducers.length > 0) {
    reason = 'wrong-phase';
  } else {
    // Producer exists on chain at same/earlier phase but consumer hit it
    // before producer ran — same-phase order issue.
    reason = 'wrong-order';
  }

  return {
    reason,
    handlerId: ctx.entry.id,
    keyIdentifier: ctx.keyIdentifier,
    start: ctx.start,
    consumerSource: ctx.consumerSource,
    consumerMiddlewareName: ctx.consumerMiddlewareName,
    knownProducersForKey: [...(ctx.producersByKey.get(ctx.keyIdentifier) ?? new Set<string>())].sort(),
    registeredMiddlewares: [...ctx.registeredNames].sort(),
    ...(lateProducers.length > 0 ? { wrongPositionDetails: [...lateProducers] } : {}),
  };
}

function sortPhasesByRank(
  mergedPhaseMiddlewareKeys: HandlerIndexEntry['mergedPhaseMiddlewareKeys'] | undefined,
  ranker: PhaseRanker,
): Array<{ phase: string; keys: readonly string[] }> {
  if (mergedPhaseMiddlewareKeys === undefined) return [];
  const entries: Array<{ phase: string; keys: readonly string[]; rank: number }> = [];
  for (const [phase, keys] of Object.entries(mergedPhaseMiddlewareKeys)) {
    const rank = ranker.rank(phase) ?? Number.MAX_SAFE_INTEGER;
    entries.push({ phase, keys, rank });
  }
  entries.sort((a, b) => a.rank - b.rank);
  return entries.map(({ phase, keys }) => ({ phase, keys }));
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
  const consumerLabel = violation.consumerSource === 'middleware'
    ? `Middleware '${violation.consumerMiddlewareName}' (in handler '${violation.handlerId}')`
    : `Handler '${violation.handlerId}'`;

  const summary = (() => {
    switch (violation.reason) {
      case 'missing-producer':
        return `${consumerLabel} calls ctx.use(${violation.keyIdentifier}) but no middleware in its registered chain produces this key.`;
      case 'wrong-phase':
        return `${consumerLabel} calls ctx.use(${violation.keyIdentifier}) but the producing middleware is registered in a phase that runs AFTER this consumer.`;
      case 'wrong-order':
        return `${consumerLabel} calls ctx.use(${violation.keyIdentifier}) but the producing middleware is registered AFTER this consumer in the same phase.`;
    }
  })();

  const lines = [summary, `  Required key: ${violation.keyIdentifier}`];

  if (
    (violation.reason === 'wrong-phase' || violation.reason === 'wrong-order')
    && violation.wrongPositionDetails !== undefined
  ) {
    const details = violation.wrongPositionDetails
      .map((d) => `${d.middlewareName} @ ${d.phase}`)
      .join(', ');
    lines.push(`  Producer registered in late position: ${details}`);
  }

  if (violation.reason === 'wrong-phase') {
    lines.push(`  Hint: move the producer middleware to an earlier phase.`);
  } else if (violation.reason === 'wrong-order') {
    lines.push(`  Hint: register the producer middleware BEFORE this consumer in the @UseMiddlewares array.`);
  } else {
    lines.push(`  Hint: register a middleware that calls ctx.set(${violation.keyIdentifier}, ...) before this consumer runs.`);
  }

  if (violation.knownProducersForKey.length > 0) {
    lines.push(`  Producers in this build: ${violation.knownProducersForKey.join(', ')}`);
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
