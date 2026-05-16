import type { ContextUsage } from '../parser/handler-context-usage-extractor';
import type { HandlerIndexEntry } from '../interfaces';
import type { MiddlewareContextAugment } from './middleware-context-types';

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
): readonly ContextUsageWarning[] {
  if (augments.length === 0) {
    return [];
  }

  // Build augment path → middleware name index
  const augmentIndex = buildAugmentIndex(augments);

  if (augmentIndex.size === 0) {
    return [];
  }

  // Build handler → registered middleware refs index
  const handlerMiddlewareIndex = buildHandlerMiddlewareIndex(handlerIndex);

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
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const entry of handlerIndex) {
    const refs = new Set<string>();

    if (entry.middlewareBindings !== undefined) {
      for (const binding of entry.middlewareBindings) {
        refs.add(binding.key);
      }
    }

    if (entry.middlewareKeys !== undefined) {
      for (const key of entry.middlewareKeys) {
        refs.add(key);
      }
    }

    if (entry.mergedPhaseMiddlewareKeys !== undefined) {
      for (const keys of Object.values(entry.mergedPhaseMiddlewareKeys)) {
        for (const key of keys) {
          refs.add(key);
        }
      }
    }

    index.set(entry.id, refs);
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
