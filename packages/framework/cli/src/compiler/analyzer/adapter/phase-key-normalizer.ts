import type { FileAnalysis } from '../graph/interfaces';
import type { ModuleGraph } from '../graph/module-graph';
import type { AnalyzerValue, AnalyzerValueRecord } from '../types';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';

import { ZIPBUL_COMPUTED_PREFIX, ZIPBUL_COMPUTED_KEY, ZIPBUL_COMPUTED_VALUE } from '@zipbul/common';
import { isErr } from '@zipbul/result';
import { AstParser } from '../parser';
import { toRecord, isAnalyzerValueArray } from '../type-guards';
import { resolvePhaseId } from './phase-key-resolver';

/**
 * Rewrites a phase-keyed `middlewares` record so every key is a plain phase
 * string. Static string keys pass through; a computed key
 * (`{ [HttpAdapterPhase.OnRequest]: [...] }`, encoded as a `__zipbul_computed_*`
 * slot) is resolved to its enum value via {@link resolvePhaseId} and re-keyed.
 *
 * Resolving here — in the async analysis stage — lets every downstream consumer
 * (validator, pipeline processor, adapter-config codegen) keep its string-only
 * logic, instead of each teaching itself to decode computed/enum keys.
 *
 * @returns The normalized record, or a diagnostic on an unresolvable key.
 */
async function normalizeMiddlewareMap(
  middlewares: AnalyzerValueRecord,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Result<AnalyzerValueRecord, Diagnostic>> {
  const normalized: AnalyzerValueRecord = {};

  for (const [key, value] of Object.entries(middlewares)) {
    if (!key.startsWith(ZIPBUL_COMPUTED_PREFIX)) {
      normalized[key] = value;
      continue;
    }

    const computed = toRecord(value);

    if (computed === null) {
      continue;
    }

    const resolved = await resolvePhaseId(computed[ZIPBUL_COMPUTED_KEY] as AnalyzerValue, fileMap, parser);

    if (isErr(resolved)) {
      return resolved;
    }

    normalized[resolved] = computed[ZIPBUL_COMPUTED_VALUE] as AnalyzerValue;
  }

  return normalized;
}

/**
 * Resolves enum/computed phase keys in every module's
 * `defineModule({ adapters: [{ middlewares }] })` config to plain phase strings,
 * mutating the module nodes in place before codegen reads them.
 *
 * @param graph - The built module graph (its nodes carry moduleDefinition).
 * @param fileMap - File analyses, for enum resolution.
 * @param parser - Parser used to load enum-declaring files on demand.
 * @returns Ok when all keys resolve, or the first resolution diagnostic.
 * @public
 */
export async function normalizeModuleConfigPhaseKeys(
  graph: ModuleGraph,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Result<void, Diagnostic>> {
  for (const node of graph.modules.values()) {
    const adapters = node.moduleDefinition?.adapters;

    if (!isAnalyzerValueArray(adapters)) {
      continue;
    }

    for (const entry of adapters) {
      const adapterRecord = toRecord(entry);
      const middlewares = adapterRecord !== null ? toRecord(adapterRecord.middlewares) : null;

      if (adapterRecord === null || middlewares === null) {
        continue;
      }

      const normalized = await normalizeMiddlewareMap(middlewares, fileMap, parser);

      if (isErr(normalized)) {
        return normalized;
      }

      adapterRecord.middlewares = normalized;
    }
  }

  return undefined;
}
