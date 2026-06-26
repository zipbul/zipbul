import { join } from 'node:path';

import type { FileAnalysis } from '../graph/interfaces';
import type { AnalyzerValue } from '../types';
import type { ReExport } from '../parser-models';
import type { CompiledValidationEntry } from '@zipbul/common';

import { ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE } from '@zipbul/common';
import { AstParser } from '../parser';
import { toRecord, isAnalyzerValueArray } from '../type-guards';
import { getFileAnalysis } from './config-extractor';

/**
 * Resolves an enum to its name→value map, following the imported file and —
 * when that file merely re-exports the enum (a barrel) — chasing `reExports`
 * recursively to the file that actually declares it. Handles named re-exports
 * (with `as` aliases), `export *`, directory-style targets resolving to
 * `index.ts`, and import cycles.
 */
async function findEnumMemberMap(
  enumName: string,
  filePath: string | null,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
  visited: Set<string>,
): Promise<Map<string, string> | undefined> {
  if (filePath === null) {
    return scanAllForEnum(enumName, fileMap);
  }

  const normalizedPath = filePath.endsWith('.ts') ? filePath : `${filePath}.ts`;

  if (visited.has(normalizedPath)) {
    return undefined;
  }
  visited.add(normalizedPath);

  // `from './dir'` resolves to `./dir/index.ts` when `./dir.ts` is absent.
  let analysis = await getFileAnalysis(normalizedPath, fileMap, parser);

  if (analysis === null && !filePath.endsWith('.ts')) {
    analysis = await getFileAnalysis(join(filePath, 'index.ts'), fileMap, parser);
  }

  if (analysis === null) {
    return undefined;
  }

  const direct = getEnumMembers(analysis, enumName);

  if (direct !== undefined) {
    return direct;
  }

  for (const reExport of analysis.reExports) {
    const localName = reExportLocalName(reExport, enumName);

    if (localName === null) {
      continue;
    }

    // `reExport.module` is already resolved to an absolute path by the parser.
    const found = await findEnumMemberMap(localName, reExport.module, fileMap, parser, visited);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

/**
 * The name the enum is known by in `reExport`'s target module, or `null` when
 * the re-export does not forward `enumName`. `export *` forwards every name
 * unchanged; `export { Local as Exported }` forwards `Exported`, declared as
 * `Local` in the target.
 */
function reExportLocalName(reExport: ReExport, enumName: string): string | null {
  if (reExport.exportAll) {
    return enumName;
  }

  const match = (reExport.names ?? []).find(name => name.exported === enumName);

  return match !== undefined ? match.local : null;
}

/**
 * Last-resort lookup over every already-loaded file analysis, used when no
 * import source anchors the search.
 */
function scanAllForEnum(enumName: string, fileMap: Map<string, FileAnalysis>): Map<string, string> | undefined {
  for (const analysis of fileMap.values()) {
    const members = getEnumMembers(analysis, enumName);

    if (members !== undefined) {
      return members;
    }
  }

  return undefined;
}

/**
 * Looks up enum member values by resolving the enum from file analyses,
 * chasing barrel re-exports to the declaring file.
 *
 * @param enumName - The enum identifier name.
 * @param importSource - The import source file path (if available).
 * @param fileMap - Map of file paths to their analysis results.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns Set of enum member values, or undefined if not found.
 * @public
 */
export async function resolveEnumValues(
  enumName: string,
  importSource: string | null,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Set<string> | undefined> {
  const members = await resolveEnumMemberMap(enumName, importSource, fileMap, parser);

  return members !== undefined ? new Set(members.values()) : undefined;
}

/**
 * Resolves `static readonly pipeline = [EnumA.X, EnumB.Y, ...]` from the adapter class.
 * Each item is an enum reference like `{ __zipbul_ref: "HttpPhase.OnRequest" }`.
 * Resolves each reference to its string value by looking up enum members.
 *
 * @param value - The property initializer AST value.
 * @param fileMap - Map of file paths to their analysis results.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns Ordered array of resolved pipeline step strings, or undefined if unresolvable.
 * @public
 */
export async function resolvePipelineArray(
  value: AnalyzerValue | undefined,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<readonly string[] | undefined> {
  if (!isAnalyzerValueArray(value)) {
    return undefined;
  }

  const steps: string[] = [];
  const enumCache = new Map<string, Map<string, string>>();

  for (const item of value) {
    if (typeof item === 'string') {
      steps.push(item);
      continue;
    }

    const rec = toRecord(item);

    if (rec === null || typeof rec[ZIPBUL_REF] !== 'string') {
      continue;
    }

    const ref = rec[ZIPBUL_REF] as string;
    const importSource = typeof rec[ZIPBUL_IMPORT_SOURCE] === 'string' ? rec[ZIPBUL_IMPORT_SOURCE] as string : null;

    // ref = "HttpPhase.OnRequest" -> enumName = "HttpPhase", memberName = "OnRequest"
    const dotIndex = ref.indexOf('.');

    if (dotIndex === -1) {
      steps.push(ref);
      continue;
    }

    const enumName = ref.slice(0, dotIndex);
    const memberName = ref.slice(dotIndex + 1);

    let members = enumCache.get(enumName);

    if (members === undefined) {
      members = await resolveEnumMemberMap(enumName, importSource, fileMap, parser) ?? new Map();
      enumCache.set(enumName, members);
    }

    const memberValue = members.get(memberName);
    steps.push(memberValue ?? memberName);
  }

  return steps.length > 0 ? steps : undefined;
}

/**
 * Resolves an enum to its name→value Map, chasing barrel re-exports to the
 * declaring file (see {@link findEnumMemberMap}). Falls back to scanning every
 * already-loaded file analysis when no source path leads to the declaration.
 *
 * @param enumName - The enum identifier name.
 * @param importSource - The import source file path (if available).
 * @param fileMap - Map of file paths to their analysis results.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns Map of enum member names to their string values, or undefined if not found.
 * @public
 */
export async function resolveEnumMemberMap(
  enumName: string,
  importSource: string | null,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Map<string, string> | undefined> {
  const viaSource = await findEnumMemberMap(enumName, importSource, fileMap, parser, new Set());

  return viaSource ?? scanAllForEnum(enumName, fileMap);
}

/**
 * Extracts enum members from a file analysis for a given enum name.
 *
 * @param analysis - The file analysis (may be null/undefined).
 * @param enumName - The enum identifier name.
 * @returns Map of member names to their string values, or undefined if not found.
 */
function getEnumMembers(
  analysis: FileAnalysis | null | undefined,
  enumName: string,
): Map<string, string> | undefined {
  const enums = analysis?.enums;

  if (enums === undefined) {
    return undefined;
  }

  if (enums instanceof Map) {
    return enums.get(enumName);
  }

  if (typeof enums === 'object' && enums !== null && enumName in enums) {
    const serializedMembers = (enums as Record<string, unknown>)[enumName];

    if (serializedMembers instanceof Map) {
      return serializedMembers;
    }

    if (typeof serializedMembers === 'object' && serializedMembers !== null) {
      return new Map(
        Object.entries(serializedMembers).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    }
  }

  return undefined;
}

/**
 * Compiles a per-handler pipeline by eliminating dead steps.
 *
 * Splits the pipeline at `Handler` into `compiledPre` and `compiledPost`.
 * Handler itself is in neither array -- core calls it directly between them.
 *
 * Elimination rules:
 * - Phase steps (in validPhases): removed when no middlewares from any scope
 * - `Guard`: removed when no merged guards (all scopes)
 * - `Validation`: removed when handler has no validations
 * - `Handler` and adapter-specific steps: always retained
 *
 * @param pipeline - The full pipeline step sequence.
 * @param validPhases - Set of valid phase identifiers.
 * @param hasMergedGuards - Whether the handler has any merged guard bindings.
 * @param globalPhaseMiddlewares - Set of phase IDs with global middleware registrations.
 * @param routePhaseMiddlewares - Set of phase IDs with route-level middleware registrations.
 * @param validations - Validation entries for the handler.
 * @returns Pre/post pipeline arrays, or undefined if no pipeline is configured.
 * @public
 */
export function compilePipeline(
  pipeline: readonly string[] | undefined,
  validPhases: ReadonlySet<string> | undefined,
  hasMergedGuards: boolean,
  globalPhaseMiddlewares: ReadonlySet<string>,
  routePhaseMiddlewares: ReadonlySet<string>,
  validations: readonly CompiledValidationEntry[],
): { compiledPre: readonly string[]; compiledPost: readonly string[] } | undefined {
  if (pipeline === undefined) {
    return undefined;
  }

  const shouldRetain = (step: string): boolean => {
    if (validPhases !== undefined && validPhases.has(step)) {
      return globalPhaseMiddlewares.has(step) || routePhaseMiddlewares.has(step);
    }

    if (step === 'Guard') return hasMergedGuards;
    if (step === 'Validation') return validations.length > 0;

    return true;
  };

  const pre: string[] = [];
  const post: string[] = [];
  let reachedHandler = false;

  for (const step of pipeline) {
    if (step === 'Handler') {
      reachedHandler = true;
      continue;
    }

    if (!shouldRetain(step)) {
      continue;
    }

    if (reachedHandler) {
      post.push(step);
    } else {
      pre.push(step);
    }
  }

  return {
    compiledPre: pre,
    compiledPost: post,
  };
}
