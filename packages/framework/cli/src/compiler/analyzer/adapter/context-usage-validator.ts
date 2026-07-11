import type { ContextUsage } from '../parser/handler-context-usage-extractor';
import type { HandlerIndexEntry, RouteRegistration } from '../interfaces';
import type { MiddlewareContextAugment } from './middleware-context-types';
import { buildKeyToRefName } from './context-dependency-validator';

/**
 * Build-time validation result for a handler's context usages.
 *
 * @public
 */
export interface ContextUsageWarning {
  /** Handler ID (e.g. `HttpAdapter:src/posts.controller.ts#PostsController.create`). */
  readonly handlerId: string;
  /** The context usage path that triggered the warning. */
  readonly usagePath: readonly string[];
  /** The middleware that provides this augment (if known). */
  readonly providedByMiddleware: string;
}

/**
 * Validates that each handler's context usages are backed by registered middleware augments.
 *
 * For every context usage path that matches a known middleware augment, the validator
 * checks whether the providing middleware is active in the handler's middleware pipeline.
 * Usages that don't match any known augment are assumed to be built-in adapter properties.
 *
 * @param handlerIndex - The compiled handler index entries.
 * @param handlerContextUsages - Per-handler context usages, keyed by handler ID.
 * @param augments - All middleware context augments collected from the project.
 * @returns Warnings for handlers using augments from non-registered middleware.
 * @public
 */
export function validateHandlerContextUsages(
  handlerIndex: readonly HandlerIndexEntry[],
  handlerContextUsages: ReadonlyMap<string, readonly ContextUsage[]>,
  augments: readonly MiddlewareContextAugment[],
  routeRegistrations: readonly RouteRegistration[] = [],
): readonly ContextUsageWarning[] {
  if (augments.length === 0) {
    return [];
  }

  // Build augment path → middleware name index
  const augmentIndex = buildAugmentIndex(augments);

  if (augmentIndex.size === 0) {
    return [];
  }

  // Build handler → registered middleware NAME index. Bindings carry container
  // keys (`__route_mw__:...`), so translate them to export names via the route
  // registrations — the augment index is keyed by middleware name too.
  const keyToRefName = buildKeyToRefName(routeRegistrations);
  const handlerMiddlewareIndex = buildHandlerMiddlewareIndex(handlerIndex, keyToRefName);

  const warnings: ContextUsageWarning[] = [];

  for (const entry of handlerIndex) {
    const usages = handlerContextUsages.get(entry.id);

    if (usages === undefined) {
      continue;
    }

    const registeredMiddlewares = handlerMiddlewareIndex.get(entry.id) ?? new Set<string>();

    for (const usage of usages) {
      const matchedMiddleware = findMatchingAugment(usage.path, augmentIndex);

      if (matchedMiddleware === null) {
        continue;
      }

      if (!registeredMiddlewares.has(matchedMiddleware)) {
        warnings.push({
          handlerId: entry.id,
          usagePath: usage.path,
          providedByMiddleware: matchedMiddleware,
        });
      }
    }
  }

  return warnings;
}

/**
 * Hard violation for a declared validated-accessor usage.
 *
 * - `missing-provider`: the handler calls the accessor but the providing
 *   middleware is absent from the handler's merged pipeline (implicit
 *   `provides` — the accessor's validated slot would never be supplied).
 * - `detached-read`: the accessor is read as a value (`const q = req.getQuery`)
 *   instead of called — the compile-time validation wiring cannot see the
 *   eventual call site.
 *
 * @public
 */
export interface AccessorUsageViolation {
  readonly handlerId: string;
  readonly usagePath: readonly string[];
  readonly middlewareName: string;
  readonly kind: 'missing-provider' | 'detached-read';
}

/**
 * Validates handler usages of DECLARED validated accessors (manifest or
 * augments-slot declared) — unlike {@link validateHandlerContextUsages},
 * matches are hard errors, not warnings.
 *
 * @param handlerIndex - The compiled handler index entries.
 * @param handlerContextUsages - Per-handler context usages, keyed by handler ID.
 * @param augments - Collected middleware augments (accessor declarations).
 * @param routeRegistrations - Container key → value mappings for name resolution.
 * @returns Hard violations. Empty when all accessor usages are wired.
 * @public
 */
export function validateAccessorUsages(
  handlerIndex: readonly HandlerIndexEntry[],
  handlerContextUsages: ReadonlyMap<string, readonly ContextUsage[]>,
  augments: readonly MiddlewareContextAugment[],
  routeRegistrations: readonly RouteRegistration[] = [],
): readonly AccessorUsageViolation[] {
  // path → declaring middleware, validated accessors only.
  const accessorIndex = new Map<string, string>();

  for (const augment of augments) {
    for (const prop of augment.augments) {
      accessorIndex.set(prop.path.join('.'), augment.middlewareName);
    }
  }

  if (accessorIndex.size === 0) return [];

  const keyToRefName = buildKeyToRefName(routeRegistrations);
  const handlerMiddlewareIndex = buildHandlerMiddlewareIndex(handlerIndex, keyToRefName);
  const violations: AccessorUsageViolation[] = [];

  for (const entry of handlerIndex) {
    const usages = handlerContextUsages.get(entry.id);

    if (usages === undefined) continue;

    const registeredMiddlewares = handlerMiddlewareIndex.get(entry.id) ?? new Set<string>();

    for (const usage of usages) {
      const matched = findMatchingAugment(usage.path, accessorIndex);

      if (matched === null) continue;

      if (!usage.isCall) {
        violations.push({
          handlerId: entry.id,
          usagePath: usage.path,
          middlewareName: matched,
          kind: 'detached-read',
        });
        continue;
      }

      if (!registeredMiddlewares.has(matched)) {
        violations.push({
          handlerId: entry.id,
          usagePath: usage.path,
          middlewareName: matched,
          kind: 'missing-provider',
        });
      }
    }
  }

  return violations;
}

/**
 * Formats one accessor-usage violation as a diagnostic string.
 *
 * @public
 */
export function formatAccessorUsageViolation(violation: AccessorUsageViolation): string {
  const path = violation.usagePath.join('.');

  if (violation.kind === 'detached-read') {
    return [
      `Handler '${violation.handlerId}' reads the validated accessor '${path}' (declared by middleware '${violation.middlewareName}') without calling it.`,
      '  Hint: validated accessors must be invoked directly (`ctx.request.getQuery(Dto)`) — detached reads hide the DTO from compile-time validation wiring.',
    ].join('\n');
  }

  return [
    `Handler '${violation.handlerId}' calls '${path}', but the providing middleware '${violation.middlewareName}' is not registered in this route's pipeline.`,
    `  Hint: register '${violation.middlewareName}' globally or via @UseMiddlewares for this route — the accessor's validated slot is supplied by that middleware.`,
  ].join('\n');
}

/**
 * Builds a prefix-based index from augment paths to providing middleware names.
 * Augment paths like `['request', 'cookie']` are stored as `'request.cookie'` keys.
 */
function buildAugmentIndex(
  augments: readonly MiddlewareContextAugment[],
): Map<string, string> {
  const index = new Map<string, string>();

  for (const augment of augments) {
    for (const prop of augment.augments) {
      const key = prop.path.join('.');
      index.set(key, augment.middlewareName);
    }
  }

  return index;
}

/**
 * Builds per-handler middleware reference sets from handler index entries.
 *
 * Collects middleware references from:
 * - `middlewareBindings[].key` — route/controller/module/global bindings
 * - `mergedPhaseMiddlewareKeys` — phase-keyed middleware keys
 */
function buildHandlerMiddlewareIndex(
  handlerIndex: readonly HandlerIndexEntry[],
  keyToRefName: Map<string, string>,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const entry of handlerIndex) {
    const names = new Set<string>();
    const addKey = (key: string): void => {
      const name = keyToRefName.get(key);
      if (name !== undefined) {
        names.add(name);
      }
    };

    if (entry.middlewareBindings !== undefined) {
      for (const binding of entry.middlewareBindings) {
        addKey(binding.key);
      }
    }

    if (entry.middlewareKeys !== undefined) {
      for (const key of entry.middlewareKeys) {
        addKey(key);
      }
    }

    if (entry.mergedPhaseMiddlewareKeys !== undefined) {
      for (const keys of Object.values(entry.mergedPhaseMiddlewareKeys)) {
        for (const key of keys) {
          addKey(key);
        }
      }
    }

    index.set(entry.id, names);
  }

  return index;
}

/**
 * Finds the middleware that provides an augment matching the given usage path.
 * Matches the longest augment path prefix.
 *
 * Example: usage `['request', 'cookie', 'get']` matches augment `['request', 'cookie']`.
 */
function findMatchingAugment(
  usagePath: readonly string[],
  augmentIndex: ReadonlyMap<string, string>,
): string | null {
  // Try progressively shorter prefixes (longest match first)
  for (let length = usagePath.length; length >= 1; length--) {
    const prefix = usagePath.slice(0, length).join('.');
    const middleware = augmentIndex.get(prefix);

    if (middleware !== undefined) {
      return middleware;
    }
  }

  return null;
}
