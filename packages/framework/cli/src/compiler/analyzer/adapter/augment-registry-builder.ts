/**
 * Builds the per-adapter augment-accessor registry the compiler emits into
 * the compiled adapter config slice (`AdapterConfig.augmentAccessors`), and
 * enforces the validated-accessor phase rule.
 *
 * Registry contents: every augment-declared context member reachable in an
 * adapter's pipelines — global AND route-scoped — resolved from the handler
 * index bindings + collected augments (package manifests / workspace source).
 *
 * @public
 */
import type { AugmentAccessorRegistryEntry } from '@zipbul/common';

import type {
  AdapterStaticSchema,
  HandlerIndexEntry,
  RouteRegistration,
} from '../interfaces';
import type { MiddlewareContextAugment } from './middleware-context-types';

import { buildDiagnostic, DiagnosticError } from '../../../diagnostics';
import { buildKeyToRefName } from './context-dependency-validator';

/**
 * One validated-accessor phase-rule violation: the declaring middleware is
 * registered at (or after) the adapter's `Validation` step, so the accessor's
 * raw supply could never precede baker validation.
 *
 * @public
 */
export interface AccessorPhaseViolation {
  readonly adapterId: string;
  readonly middlewareName: string;
  readonly phase: string;
  readonly handlerId: string;
}

/**
 * Builds the accessor registry per adapter ID.
 *
 * Identical `(namespace, prop)` tuples merge idempotently; the same tuple
 * declared by two DIFFERENT middlewares/packages is a hard error (compile-time
 * mirror of the boot-time collision rule).
 *
 * @public
 */
export function buildAugmentAccessorRegistries(params: {
  readonly handlerIndex: readonly HandlerIndexEntry[];
  readonly routeRegistrations?: readonly RouteRegistration[];
  readonly augments: readonly MiddlewareContextAugment[];
}): Map<string, readonly AugmentAccessorRegistryEntry[]> {
  const { handlerIndex, routeRegistrations = [], augments } = params;
  const augmentsByName = indexAugmentsByName(augments);
  const keyToRefName = buildKeyToRefName(routeRegistrations);
  // adapterId → ns.prop → entry (+ owning middleware for collision reporting)
  const perAdapter = new Map<string, Map<string, { entry: AugmentAccessorRegistryEntry; owner: string }>>();

  for (const entry of handlerIndex) {
    const names = collectMiddlewareNames(entry, keyToRefName);

    if (names.size === 0) continue;

    let registry = perAdapter.get(entry.adapterId);

    if (registry === undefined) {
      registry = new Map();
      perAdapter.set(entry.adapterId, registry);
    }

    for (const name of names) {
      const augment = augmentsByName.get(name);

      if (augment === undefined) continue;

      for (const registryEntry of toRegistryEntries(augment)) {
        const slot = `${registryEntry.namespace}.${registryEntry.prop}`;
        const existing = registry.get(slot);

        if (existing === undefined) {
          registry.set(slot, { entry: registryEntry, owner: name });
          continue;
        }

        if (existing.owner !== name || existing.entry.kind !== registryEntry.kind) {
          throw new DiagnosticError(buildDiagnostic({
            reason: `Adapter '${entry.adapterId}': context member '${slot}' is declared by both middleware '${existing.owner}' and '${name}'. A (namespace, prop) tuple must have exactly one declaring middleware.`,
            how: 'Rename one of the contributed members, or remove one of the middlewares from the adapter\'s pipelines.',
          }));
        }
      }
    }
  }

  const result = new Map<string, readonly AugmentAccessorRegistryEntry[]>();

  for (const [adapterId, registry] of perAdapter) {
    if (registry.size === 0) continue;

    const entries = [...registry.values()]
      .map(({ entry }) => entry)
      .sort((left, right) => {
        const nsDiff = left.namespace.localeCompare(right.namespace);

        return nsDiff !== 0 ? nsDiff : left.prop.localeCompare(right.prop);
      });

    result.set(adapterId, entries);
  }

  return result;
}

/**
 * Phase rule: middleware carrying a `validatedAccessor` must be registered at
 * a phase strictly BEFORE the adapter's `Validation` step — otherwise the raw
 * supply cannot precede baker validation.
 *
 * @public
 */
export function validateAccessorPhaseRules(params: {
  readonly handlerIndex: readonly HandlerIndexEntry[];
  readonly routeRegistrations?: readonly RouteRegistration[];
  readonly adapterStaticSchemas: Readonly<Record<string, AdapterStaticSchema>>;
  readonly augments: readonly MiddlewareContextAugment[];
}): readonly AccessorPhaseViolation[] {
  const { handlerIndex, routeRegistrations = [], adapterStaticSchemas, augments } = params;
  const accessorMiddlewares = new Set<string>();

  for (const augment of augments) {
    if (augment.augments.length > 0) {
      accessorMiddlewares.add(augment.middlewareName);
    }
  }

  if (accessorMiddlewares.size === 0) return [];

  const keyToRefName = buildKeyToRefName(routeRegistrations);
  const violations: AccessorPhaseViolation[] = [];
  const seen = new Set<string>();

  for (const entry of handlerIndex) {
    const pipeline = adapterStaticSchemas[entry.adapterId]?.pipeline;

    if (pipeline === undefined) continue;

    const validationRank = pipeline.indexOf('Validation');

    if (validationRank === -1) continue;
    if (entry.mergedPhaseMiddlewareKeys === undefined) continue;

    for (const [phase, keys] of Object.entries(entry.mergedPhaseMiddlewareKeys)) {
      const phaseRank = pipeline.indexOf(phase);

      if (phaseRank === -1 || phaseRank < validationRank) continue;

      for (const key of keys) {
        const name = keyToRefName.get(key);

        if (name === undefined || !accessorMiddlewares.has(name)) continue;

        const dedupeKey = `${entry.adapterId}:${name}:${phase}`;

        if (seen.has(dedupeKey)) continue;

        seen.add(dedupeKey);
        violations.push({ adapterId: entry.adapterId, middlewareName: name, phase, handlerId: entry.id });
      }
    }
  }

  return violations;
}

/**
 * Formats one phase-rule violation as a diagnostic string.
 *
 * @public
 */
export function formatAccessorPhaseViolation(violation: AccessorPhaseViolation): string {
  return [
    `Middleware '${violation.middlewareName}' declares a validatedAccessor but is registered at phase '${violation.phase}' of adapter '${violation.adapterId}', which runs at or after the Validation step (first seen on handler '${violation.handlerId}').`,
    '  Hint: register the middleware at a phase that runs strictly before Validation so the raw supply precedes baker validation.',
  ].join('\n');
}

function indexAugmentsByName(
  augments: readonly MiddlewareContextAugment[],
): Map<string, MiddlewareContextAugment> {
  const map = new Map<string, MiddlewareContextAugment>();

  for (const augment of augments) {
    map.set(augment.middlewareName, augment);
  }

  return map;
}

/** Declarative augments (every one a `validated-accessor`) as registry entries. */
function toRegistryEntries(augment: MiddlewareContextAugment): AugmentAccessorRegistryEntry[] {
  const entries: AugmentAccessorRegistryEntry[] = [];

  for (const prop of augment.augments) {
    if (prop.path.length !== 2) continue;

    entries.push({
      namespace: prop.path[0]!,
      prop: prop.path[1]!,
      kind: 'validated-accessor',
      ...(augment.packageName !== undefined ? { package: augment.packageName } : {}),
    });
  }

  return entries;
}

/**
 * All middleware export names bound to a handler's pipeline (route-scoped AND
 * global bindings — both ride the handler entry after merge).
 */
function collectMiddlewareNames(
  entry: HandlerIndexEntry,
  keyToRefName: ReadonlyMap<string, string>,
): Set<string> {
  const names = new Set<string>();
  const addKey = (key: string): void => {
    const name = keyToRefName.get(key);

    if (name !== undefined) names.add(name);
  };

  if (entry.mergedPhaseMiddlewareKeys !== undefined) {
    for (const keys of Object.values(entry.mergedPhaseMiddlewareKeys)) {
      for (const key of keys) addKey(key);
    }
  }

  if (entry.middlewareKeys !== undefined) {
    for (const key of entry.middlewareKeys) addKey(key);
  }

  if (entry.middlewareBindings !== undefined) {
    for (const binding of entry.middlewareBindings) addKey(binding.key);
  }

  return names;
}
