import type { FileAnalysis } from '../graph/interfaces';
import type {
  ClassMetadata,
  RouteRegistration,
} from '../interfaces';
import type { AnalyzerValue } from '../types';
import type {
  CompiledMiddlewareBindingEntry,
  CompiledPipelineBindingEntry,
  CompiledPipelineScope,
} from '@zipbul/common';

import {
  ZIPBUL_REF, ZIPBUL_COMPUTED_PREFIX,
} from '@zipbul/common';
import { toRecord, isAnalyzerValueArray, isUnresolvable } from '../type-guards';

interface DecoratorKeyExtraction {
  keys: string[];
  bindings: CompiledPipelineBindingEntry[];
}

interface MiddlewareDecoratorKeyExtraction {
  keys: string[];
  bindings: CompiledMiddlewareBindingEntry[];
}

/**
 * Extracts middleware refs from `@UseMiddlewares` phase-aware decorator.
 *
 * Handles both forms:
 * - `@UseMiddlewares('OnReceive', [mw1, mw2])` -- positional
 * - `@UseMiddlewares({ OnReceive: [mw1] })` -- object map
 *
 * @param cls - The class metadata.
 * @param method - The method metadata.
 * @param keyPrefix - Prefix for generated container keys.
 * @param registrations - Accumulator for route-level container registrations.
 * @param startIndex - Starting index for key generation (to avoid collision with UseMiddlewares keys).
 * @returns Array of deterministic container keys and their bindings.
 * @public
 */
export function extractMiddlewaresDecoratorRefKeys(
  cls: ClassMetadata,
  method: { decorators: readonly { name: string; arguments: readonly AnalyzerValue[] }[] },
  keyPrefix: string,
  registrations: RouteRegistration[],
  startIndex: number,
): MiddlewareDecoratorKeyExtraction {
  const keys: string[] = [];
  const bindings: CompiledMiddlewareBindingEntry[] = [];
  let index = startIndex;

  const extractFromDecorator = (decorator: { arguments: readonly AnalyzerValue[] }, scope: 'cls' | 'mtd'): void => {
    const args = decorator.arguments;

    if (args.length === 2) {
      // Positional: @UseMiddlewares('OnReceive', [mw1, mw2])
      const refsArray = isAnalyzerValueArray(args[1]) ? args[1] : null;

      if (refsArray === null) {
        return;
      }

      for (const ref of refsArray) {
        const record = toRecord(ref);
        const refName = record !== null ? record[ZIPBUL_REF] : undefined;

        if (typeof refName === 'string' && refName.length > 0) {
          const key = `${keyPrefix}:${scope}:${index}`;
          const bindingScope: CompiledPipelineScope = scope === 'cls' ? 'controller' : 'handler';
          const phaseArg = args[0];
          const phase = typeof phaseArg === 'string' ? phaseArg : undefined;

          keys.push(key);
          registrations.push({ key, value: ref, kind: 'ref' });
          bindings.push({ key, scope: bindingScope, order: index, ...(phase !== undefined ? { phase } : {}) });
          index++;
        }
      }

      return;
    }

    if (args.length === 1) {
      // Object map: @UseMiddlewares({ OnReceive: [mw1] })
      const mapping = toRecord(args[0]);

      if (mapping === null) {
        return;
      }

      for (const phaseKey of Object.keys(mapping)) {
        if (phaseKey.startsWith(ZIPBUL_COMPUTED_PREFIX) || phaseKey.startsWith('__zipbul')) {
          continue;
        }

        const phaseRefs = isAnalyzerValueArray(mapping[phaseKey]) ? mapping[phaseKey] : null;

        if (phaseRefs === null) {
          continue;
        }

        for (const ref of phaseRefs) {
          const record = toRecord(ref);
          const refName = record !== null ? record[ZIPBUL_REF] : undefined;

          if (typeof refName === 'string' && refName.length > 0) {
            const key = `${keyPrefix}:${scope}:${index}`;
            const bindingScope: CompiledPipelineScope = scope === 'cls' ? 'controller' : 'handler';

            keys.push(key);
            registrations.push({ key, value: ref, kind: 'ref' });
            bindings.push({ key, scope: bindingScope, order: index, phase: phaseKey });
            index++;
          }
        }
      }
    }
  };

  // Class-level first
  for (const decorator of cls.decorators) {
    if (decorator.name !== 'UseMiddlewares') {
      continue;
    }

    extractFromDecorator(decorator, 'cls');
  }

  // Method-level second
  for (const decorator of method.decorators) {
    if (decorator.name !== 'UseMiddlewares') {
      continue;
    }

    extractFromDecorator(decorator, 'mtd');
  }

  return { keys, bindings };
}

/**
 * Extracts global pipeline bindings (middlewares, guards, exception filters)
 * from module definitions that reference the given adapter.
 *
 * @param fileMap - Map of file paths to their analysis results.
 * @param adapterId - The adapter identifier to match.
 * @param registrations - Accumulator for route-level container registrations.
 * @returns Global bindings grouped by type (middlewares, guards, exception filters).
 * @public
 */
export function extractGlobalPipelineBindings(
  fileMap: Map<string, FileAnalysis>,
  adapterId: string,
  registrations: RouteRegistration[],
): {
  middlewareBindings: CompiledMiddlewareBindingEntry[];
  guardBindings: CompiledPipelineBindingEntry[];
  exceptionFilterBindings: CompiledPipelineBindingEntry[];
} {
  const middlewareBindings: CompiledMiddlewareBindingEntry[] = [];
  const guardBindings: CompiledPipelineBindingEntry[] = [];
  const exceptionFilterBindings: CompiledPipelineBindingEntry[] = [];

  const analyses = [...fileMap.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));

  for (const analysis of analyses) {
    const moduleName = analysis.moduleDefinition?.name;
    const adaptersValue = analysis.moduleDefinition?.adapters;
    const adaptersArray = isAnalyzerValueArray(adaptersValue) ? adaptersValue : null;

    if (moduleName === undefined || adaptersArray === null) {
      continue;
    }

    for (const adapterNode of adaptersArray) {
      const itemRecord = toRecord(adapterNode);

      if (itemRecord === null) {
        continue;
      }

      const adapterRef = toRecord(itemRecord.adapter);
      const adapterClassName = typeof adapterRef?.[ZIPBUL_REF] === 'string' ? adapterRef[ZIPBUL_REF] : null;

      if (adapterClassName !== adapterId) {
        continue;
      }

      let middlewareIndex = middlewareBindings.length;
      const middlewares = toRecord(itemRecord.middlewares);

      if (middlewares !== null) {
        for (const phase of Object.keys(middlewares)) {
          if (phase.startsWith(ZIPBUL_COMPUTED_PREFIX) || phase.startsWith('__zipbul')) {
            continue;
          }

          const refs = isAnalyzerValueArray(middlewares[phase]) ? middlewares[phase] : null;

          if (refs === null) {
            continue;
          }

          for (const ref of refs) {
            const record = toRecord(ref);
            const refName = record !== null ? record[ZIPBUL_REF] : undefined;

            if (typeof refName !== 'string' || refName.length === 0) {
              continue;
            }

            const key = `__global_mw__:${moduleName}:${adapterId}:${phase}:${middlewareIndex}`;

            registrations.push({ key, value: ref, kind: 'ref' });
            middlewareBindings.push({ key, scope: 'global', order: middlewareIndex, phase });
            middlewareIndex++;
          }
        }
      }

      let guardIndex = guardBindings.length;
      const guards = isAnalyzerValueArray(itemRecord.guards) ? itemRecord.guards : null;

      if (guards !== null) {
        for (const ref of guards) {
          const record = toRecord(ref);
          const refName = record !== null ? record[ZIPBUL_REF] : undefined;

          if (typeof refName !== 'string' || refName.length === 0) {
            continue;
          }

          const key = `__global_gd__:${moduleName}:${adapterId}:${guardIndex}`;

          registrations.push({ key, value: ref, kind: 'ref' });
          guardBindings.push({ key, scope: 'global', order: guardIndex });
          guardIndex++;
        }
      }

      let filterIndex = exceptionFilterBindings.length;
      const exceptionFilters = isAnalyzerValueArray(itemRecord.exceptionFilters) ? itemRecord.exceptionFilters : null;

      if (exceptionFilters !== null) {
        for (const ref of exceptionFilters) {
          const record = toRecord(ref);
          const refName = record !== null ? record[ZIPBUL_REF] : undefined;

          if (typeof refName !== 'string' || refName.length === 0) {
            continue;
          }

          const key = `__global_ef__:${moduleName}:${adapterId}:${filterIndex}`;

          registrations.push({ key, value: ref, kind: 'ref' });
          exceptionFilterBindings.push({ key, scope: 'global', order: filterIndex });
          filterIndex++;
        }
      }
    }
  }

  return { middlewareBindings, guardBindings, exceptionFilterBindings };
}

/**
 * Combines middleware bindings from multiple sources, reindexing with global-first ordering.
 *
 * @param parts - Arrays of middleware bindings to combine.
 * @returns Combined and reindexed middleware bindings.
 * @public
 */
export function combineMiddlewareBindings(
  ...parts: (readonly CompiledMiddlewareBindingEntry[] | undefined)[]
): CompiledMiddlewareBindingEntry[] {
  return reindexBindings(parts.flatMap(part => part ?? []), 'global-first');
}

/**
 * Combines guard bindings from multiple sources, reindexing with global-first ordering.
 *
 * @param parts - Arrays of guard bindings to combine.
 * @returns Combined and reindexed guard bindings.
 * @public
 */
export function combineGuardBindings(
  ...parts: (readonly CompiledPipelineBindingEntry[] | undefined)[]
): CompiledPipelineBindingEntry[] {
  return reindexBindings(parts.flatMap(part => part ?? []), 'global-first');
}

/**
 * Combines exception filter bindings from multiple sources, reindexing with handler-first ordering.
 *
 * @param parts - Arrays of exception filter bindings to combine.
 * @returns Combined and reindexed exception filter bindings.
 * @public
 */
export function combineExceptionFilterBindings(
  ...parts: (readonly CompiledPipelineBindingEntry[] | undefined)[]
): CompiledPipelineBindingEntry[] {
  return reindexBindings(parts.flatMap(part => part ?? []), 'handler-first');
}

/**
 * Reindexes bindings by scope priority and original order,
 * assigning new sequential order values.
 *
 * @param bindings - The bindings to reindex.
 * @param scopeDirection - Whether to sort global-first or handler-first.
 * @returns Reindexed bindings with sequential order values.
 */
function reindexBindings<T extends { key: string; scope: CompiledPipelineScope; order: number }>(
  bindings: readonly T[],
  scopeDirection: 'global-first' | 'handler-first' = 'handler-first',
): T[] {
  return [...bindings]
    .sort((left, right) => {
      const leftRank = getScopeRank(left.scope);
      const rightRank = getScopeRank(right.scope);
      const scopeDiff = scopeDirection === 'global-first'
        ? rightRank - leftRank
        : leftRank - rightRank;

      if (scopeDiff !== 0) {
        return scopeDiff;
      }

      return left.order - right.order;
    })
    .map((binding, index) => ({ ...binding, order: index }));
}

/**
 * Builds a phase-keyed record of merged middleware keys from bindings.
 *
 * @param bindings - The middleware bindings to group by phase.
 * @returns Frozen record mapping phase IDs to frozen arrays of keys.
 * @public
 */
export function buildMergedPhaseMiddlewareKeys(
  bindings: readonly CompiledMiddlewareBindingEntry[],
): Record<string, readonly string[]> {
  const grouped = new Map<string, string[]>();

  for (const binding of bindings) {
    if (binding.phase === undefined) {
      continue;
    }

    const bucket = grouped.get(binding.phase);

    if (bucket === undefined) {
      grouped.set(binding.phase, [binding.key]);
      continue;
    }

    bucket.push(binding.key);
  }

  return Object.freeze(
    Object.fromEntries(
      Array.from(grouped.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([phase, phaseKeys]) => [phase, Object.freeze([...phaseKeys])] as const),
    ),
  );
}

/**
 * Extracts merged binding keys from pipeline bindings.
 *
 * @param bindings - The pipeline bindings to extract keys from.
 * @returns Frozen array of binding keys.
 * @public
 */
export function extractMergedBindingKeys(
  bindings: readonly CompiledPipelineBindingEntry[],
): readonly string[] {
  return Object.freeze(bindings.map(binding => binding.key));
}

/**
 * Returns a numeric rank for pipeline scope priority.
 * Lower rank = closer to the handler.
 *
 * @param scope - The pipeline scope.
 * @returns Numeric rank for sorting.
 * @public
 */
export function getScopeRank(scope: CompiledPipelineScope): number {
  switch (scope) {
    case 'handler':
      return 0;
    case 'controller':
      return 1;
    case 'module':
      return 2;
    case 'global':
      return 3;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Extracts decorator argument references from class-level and method-level decorators,
 * generating deterministic container keys and route registrations for each reference.
 *
 * Class-level decorators are placed first (pipeline order), method-level after.
 *
 * @param cls - The class metadata.
 * @param method - The method metadata.
 * @param decoratorName - The decorator name to search for (e.g. 'UseMiddlewares').
 * @param keyPrefix - Prefix for generated container keys.
 * @param registrations - Accumulator for route-level container registrations.
 * @returns Extracted keys and their bindings.
 * @public
 */
export function extractDecoratorRefKeys(
  cls: ClassMetadata,
  method: { decorators: readonly { name: string; arguments: readonly AnalyzerValue[] }[] },
  decoratorName: string,
  keyPrefix: string,
  registrations: RouteRegistration[],
): DecoratorKeyExtraction {
  const keys: string[] = [];
  const bindings: CompiledPipelineBindingEntry[] = [];
  let index = 0;

  // Class-level first (applies to all handlers in this controller)
  for (const decorator of cls.decorators) {
    if (decorator.name !== decoratorName) {
      continue;
    }

    for (const arg of decorator.arguments) {
      if (isUnresolvable(arg)) {
        throw new Error(`[Zipbul AOT] @${decoratorName} on '${cls.className}': decorator argument must be a statically resolvable identifier. Found: ${arg.nodeType ?? arg.sourceText ?? 'unknown'} expression.`);
      }

      const record = toRecord(arg);
      const ref = record !== null ? record[ZIPBUL_REF] : undefined;

      if (typeof ref === 'string' && ref.length > 0) {
        const key = `${keyPrefix}:cls:${index}`;

        keys.push(key);
        registrations.push({ key, value: arg, kind: 'ref' });
        bindings.push({ key, scope: 'controller', order: index });
        index++;
      }
    }
  }

  // Method-level second
  for (const decorator of method.decorators) {
    if (decorator.name !== decoratorName) {
      continue;
    }

    for (const arg of decorator.arguments) {
      if (isUnresolvable(arg)) {
        throw new Error(`[Zipbul AOT] @${decoratorName} on '${cls.className}': decorator argument must be a statically resolvable identifier. Found: ${arg.nodeType ?? arg.sourceText ?? 'unknown'} expression.`);
      }

      const record = toRecord(arg);
      const ref = record !== null ? record[ZIPBUL_REF] : undefined;

      if (typeof ref === 'string' && ref.length > 0) {
        const key = `${keyPrefix}:mtd:${index}`;

        keys.push(key);
        registrations.push({ key, value: arg, kind: 'ref' });
        bindings.push({ key, scope: 'handler', order: index });
        index++;
      }
    }
  }

  return { keys, bindings };
}
