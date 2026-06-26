import type { FileAnalysis } from '../graph/interfaces';
import type { ModuleGraph } from '../graph/module-graph';
import type { AnalyzerValue, AnalyzerValueRecord } from '../types';
import type { ClassMetadata, DecoratorMetadata } from '../interfaces';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';

import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE,
  ZIPBUL_COMPUTED_PREFIX, ZIPBUL_COMPUTED_KEY, ZIPBUL_COMPUTED_VALUE,
} from '@zipbul/common';
import { isErr } from '@zipbul/result';
import { AstParser } from '../parser';
import { toRecord, isAnalyzerValueArray } from '../type-guards';
import { resolvePhaseId } from './phase-key-resolver';

/**
 * Rewrites a phase-key expression's import source to an absolute source path.
 *
 * Decorator-argument refs are captured with their raw import specifier (e.g.
 * the bare `'@zipbul/http-adapter'`), unlike module-config refs which the deep
 * converter already resolves. Resolving here makes both paths uniform before
 * the enum resolver reads the source; for an already-absolute source the
 * resolver is idempotent.
 */
function enrichRefSource(keyValue: AnalyzerValue, sourcePath: string, parser: AstParser): AnalyzerValue {
  const record = toRecord(keyValue);

  if (record === null || typeof record[ZIPBUL_REF] !== 'string' || typeof record[ZIPBUL_IMPORT_SOURCE] !== 'string') {
    return keyValue;
  }

  return { ...record, [ZIPBUL_IMPORT_SOURCE]: parser.resolveModuleSpecifier(sourcePath, record[ZIPBUL_IMPORT_SOURCE]) };
}

/**
 * Rewrites a phase-keyed `middlewares` record so every key is a plain phase
 * string. Static string keys pass through; a computed key
 * (`{ [HttpAdapterPhase.OnRequest]: [...] }`, encoded as a `__zipbul_computed_*`
 * slot) is resolved to its enum value via {@link resolvePhaseId} and re-keyed.
 *
 * @returns The normalized record, or a diagnostic on an unresolvable key.
 */
async function normalizeMiddlewareMap(
  middlewares: AnalyzerValueRecord,
  sourcePath: string,
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

    const keyExpr = enrichRefSource(computed[ZIPBUL_COMPUTED_KEY] as AnalyzerValue, sourcePath, parser);
    const resolved = await resolvePhaseId(keyExpr, fileMap, parser);

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
 * mutating the module nodes in place.
 */
async function normalizeModuleConfig(
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

      const normalized = await normalizeMiddlewareMap(middlewares, node.filePath, fileMap, parser);

      if (isErr(normalized)) {
        return normalized;
      }

      adapterRecord.middlewares = normalized;
    }
  }

  return undefined;
}

/**
 * Resolves the phase argument(s) of a single `@UseMiddlewares` decorator,
 * mutating the decorator's arguments in place. Two forms:
 *
 * - positional `@UseMiddlewares(Phase.X, [mw])` — `args[0]` is the phase;
 * - object map `@UseMiddlewares({ [Phase.X]: [mw] })` — `args[0]` is a record
 *   whose keys are phases.
 */
async function normalizeUseMiddlewaresDecorator(
  decorator: DecoratorMetadata,
  sourcePath: string,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Result<void, Diagnostic>> {
  const args = decorator.arguments;

  if (args.length === 2) {
    const resolved = await resolvePhaseId(enrichRefSource(args[0]!, sourcePath, parser), fileMap, parser);

    if (isErr(resolved)) {
      return resolved;
    }

    args[0] = resolved;

    return undefined;
  }

  if (args.length === 1) {
    const mapping = toRecord(args[0]);

    if (mapping !== null) {
      const normalized = await normalizeMiddlewareMap(mapping, sourcePath, fileMap, parser);

      if (isErr(normalized)) {
        return normalized;
      }

      args[0] = normalized;
    }
  }

  return undefined;
}

/**
 * Resolves enum/computed phase keys in every `@UseMiddlewares` decorator across
 * all analyzed classes (class- and method-level), mutating their arguments in
 * place.
 */
async function normalizeDecorators(
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Result<void, Diagnostic>> {
  for (const analysis of fileMap.values()) {
    for (const cls of analysis.classes) {
      const decorators = collectUseMiddlewaresDecorators(cls);

      for (const decorator of decorators) {
        const result = await normalizeUseMiddlewaresDecorator(decorator, analysis.filePath, fileMap, parser);

        if (isErr(result)) {
          return result;
        }
      }
    }
  }

  return undefined;
}

function collectUseMiddlewaresDecorators(cls: ClassMetadata): DecoratorMetadata[] {
  const all = [...cls.decorators, ...cls.methods.flatMap(method => method.decorators)];

  return all.filter(decorator => decorator.name === 'UseMiddlewares');
}

/**
 * Resolves every authored phase key — in `defineModule` adapter config and in
 * `@UseMiddlewares` decorators — to its plain phase string before codegen and
 * validation run, so those stages keep their string-only key logic. Mutates the
 * graph nodes and class metadata in place.
 *
 * @param graph - The built module graph (its nodes carry moduleDefinition).
 * @param fileMap - File analyses, for enum resolution + @UseMiddlewares walk.
 * @param parser - Parser used to resolve import sources + load enum files.
 * @returns Ok when all keys resolve, or the first resolution diagnostic.
 * @public
 */
export async function normalizePhaseKeys(
  graph: ModuleGraph,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Result<void, Diagnostic>> {
  const moduleResult = await normalizeModuleConfig(graph, fileMap, parser);

  if (isErr(moduleResult)) {
    return moduleResult;
  }

  return normalizeDecorators(fileMap, parser);
}
