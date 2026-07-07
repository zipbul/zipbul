import { parseSource } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';
import { Logger } from '@zipbul/logger';

import type { Node as AstNode } from '@zipbul/gildash';

import type { FileAnalysis } from '../graph/interfaces';
import type { AdapterStaticSchema } from '../interfaces';
import type { ContextAdapterMap } from '../../generator/context-types-generator';
import type { DefineCallShapeInput } from '../../define-call-shape';
import type { AugmentsManifestIndex, ManifestMiddlewareEntry } from './augments-manifest-reader';
import type {
  MiddlewareContextAugment,
  MiddlewareProducerInfo,
  PropAugment,
} from './middleware-context-types';
import type { ExtractedAugment } from '../parser/augments-slot-extractor';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import { buildDiagnostic, DiagnosticError } from '../../../diagnostics';
import { analyzeMiddlewareLibraryFile } from '../../middleware-shape';
import {
  extractDefinitionParts,
  findContextAssignmentStart,
  readFactoryContextType,
} from '../parser/augments-slot-extractor';
import {
  extractMiddlewareContextOps,
  type ContextOperation,
} from '../parser/context-operation-extractor';

const logger = new Logger('compiler/middleware-collector');

/**
 * Result of middleware augment collection across the project.
 *
 * @public
 */
export interface MiddlewareAugmentCollectionResult {
  /** Augmentations declared by registered middleware (type augmentation + accessor registry input). */
  readonly augments: readonly MiddlewareContextAugment[];
  /** Producer/consumer ops per middleware (runtime data flow — separate concern from augments). */
  readonly producerInfos: readonly MiddlewareProducerInfo[];
  /** Adapter-provided namespace → interface mapping for declaration merging. */
  readonly adapterMap: ContextAdapterMap;
}

/**
 * Collects middleware context augmentations from both installed packages and
 * project source files.
 *
 * - Packages (npm AND workspace dist): the `dist/context-augments.json`
 *   manifest is AUTHORITATIVE — published dist JavaScript is never parsed
 *   (the augment supply function bodies are runtime-only; the old `__augments`
 *   IR channel is gone).
 * - Project/workspace source files: declarative `augments`-slot extraction
 *   via the grammar-v2 discovery walker. Legacy assignment-style augments
 *   (`ctx.to(...).request.x = ...`) are a hard error with a fix-it.
 *
 * @public
 */
export class MiddlewareAugmentCollector {
  /**
   * Collects augmentations from manifest entries and local `defineMiddleware`
   * declarations.
   *
   * @param fileMap - Map of file paths to their analysis results.
   * @param adapterStaticSchemas - Adapter static schemas keyed by adapter ID.
   * @param registeredMiddlewareRefs - Optional set of middleware export names to filter.
   * @param manifestIndex - Pre-pass index over `dist/context-augments.json` manifests.
   * @returns Collected augments, producer infos, and the adapter map.
   */
  async collect(
    fileMap: Map<string, FileAnalysis>,
    adapterStaticSchemas: Record<string, AdapterStaticSchema>,
    registeredMiddlewareRefs?: ReadonlySet<string>,
    manifestIndex?: AugmentsManifestIndex,
  ): Promise<MiddlewareAugmentCollectionResult> {
    const adapterMap = buildContextAdapterMap(adapterStaticSchemas);
    const augments: MiddlewareContextAugment[] = [];
    const producerInfos: MiddlewareProducerInfo[] = [];

    // 1. Package channel — JSON manifests (authoritative for anything shipped
    //    as a built package, npm or workspace).
    for (const entry of manifestIndex?.entries ?? []) {
      if (registeredMiddlewareRefs !== undefined && !registeredMiddlewareRefs.has(entry.exportName)) {
        continue;
      }

      const converted = convertManifestEntry(entry);

      if (converted.augment !== null) augments.push(converted.augment);
      if (converted.producerInfo !== null) producerInfos.push(converted.producerInfo);
    }

    // 2. Source channel — project-local middleware declarations.
    const localResults = await collectFromLocalSources(
      fileMap,
      adapterStaticSchemas,
      registeredMiddlewareRefs,
    );

    augments.push(...localResults.augments);
    producerInfos.push(...localResults.producerInfos);

    return { augments, producerInfos, adapterMap };
  }
}

/**
 * Builds the `ContextAdapterMap` from adapter schemas' `contextNamespaces`.
 *
 * `contextNamespaces` is auto-derived by the config-extractor from the
 * context class's getter return types (e.g. `get request(): HttpRequest`).
 */
function buildContextAdapterMap(
  adapterStaticSchemas: Record<string, AdapterStaticSchema>,
): ContextAdapterMap {
  const map: Record<string, Record<string, { interface: string; module: string }>> = {};

  for (const schema of Object.values(adapterStaticSchemas)) {
    if (schema.contextNamespaces === undefined) continue;

    const { contextType, module: moduleSpecifier, namespaces } = schema.contextNamespaces;
    const targets: Record<string, { interface: string; module: string }> = {};

    for (const [getterName, typeName] of Object.entries(namespaces)) {
      targets[getterName] = { interface: typeName, module: moduleSpecifier };
    }

    map[contextType] = targets;
  }

  return map;
}

interface MiddlewareExtraction {
  readonly augment: MiddlewareContextAugment | null;
  readonly producerInfo: MiddlewareProducerInfo | null;
}

/**
 * Converts one manifest middleware entry into collector output. Every augment
 * is a DTO-validated accessor.
 */
function convertManifestEntry(entry: ManifestMiddlewareEntry): MiddlewareExtraction {
  const producerInfo: MiddlewareProducerInfo | null = entry.contextOps.length > 0
    ? {
      middlewareName: entry.exportName,
      sourceFilePath: entry.packageName,
      contextOps: entry.contextOps.map((op): ContextOperation => ({
        kind: op.kind,
        keyIdentifier: op.keyIdentifier,
        start: null,
      })),
    }
    : null;

  if (entry.augments.length === 0 || entry.contextType === null) {
    return { augment: null, producerInfo };
  }

  const props: PropAugment[] = entry.augments.map(augment => ({
    path: [augment.ns, augment.prop],
  }));

  return {
    augment: {
      middlewareName: entry.exportName,
      contextType: entry.contextType,
      sourceFilePath: entry.packageName,
      packageName: entry.packageName,
      augments: props,
      classImports: new Map(),
    },
    producerInfo,
  };
}

/**
 * Scans project-local source files (never `node_modules`) for
 * `defineMiddleware` declarations and extracts their `augments` slots.
 */
async function collectFromLocalSources(
  fileMap: Map<string, FileAnalysis>,
  adapterStaticSchemas: Record<string, AdapterStaticSchema>,
  registeredRefs?: ReadonlySet<string>,
): Promise<{ augments: MiddlewareContextAugment[]; producerInfos: MiddlewareProducerInfo[] }> {
  const augments: MiddlewareContextAugment[] = [];
  const producerInfos: MiddlewareProducerInfo[] = [];

  for (const filePath of [...fileMap.keys()].sort((a, b) => a.localeCompare(b))) {
    if (filePath.includes('/node_modules/')) continue;
    if (filePath.endsWith('.d.ts') || filePath.endsWith('.spec.ts') || filePath.endsWith('.test.ts')) continue;

    const file = Bun.file(filePath);

    if (!(await file.exists())) continue;

    const sourceText = await file.text();

    if (!sourceText.includes('defineMiddleware')) continue;

    const parseResult = parseSource(filePath, sourceText);

    if (isErr(parseResult)) {
      logger.warn(`Failed to parse middleware source: ${filePath}`);
      continue;
    }

    const shapeInput: DefineCallShapeInput = { filePath, parsed: parseResult };
    // Discovery only — the user-app grammar is laxer than a middleware
    // library's, so shape violations are not errors here; undiscovered call
    // sites simply contribute nothing.
    const { middlewares } = analyzeMiddlewareLibraryFile(shapeInput);

    for (const mw of middlewares) {
      if (registeredRefs !== undefined && !registeredRefs.has(mw.exportName)) continue;

      const extraction = extractLocalMiddleware({
        shapeInput,
        exportName: mw.exportName,
        calls: mw.calls,
        adapterStaticSchemas,
      });

      if (extraction.augment !== null) augments.push(extraction.augment);
      if (extraction.producerInfo !== null) producerInfos.push(extraction.producerInfo);
    }
  }

  return { augments, producerInfos };
}

/**
 * Extracts augments-slot declarations + context ops from one discovered
 * local middleware export. Assignment-style augments are a hard error.
 */
function extractLocalMiddleware(params: {
  readonly shapeInput: DefineCallShapeInput;
  readonly exportName: string;
  readonly calls: readonly AstNode[];
  readonly adapterStaticSchemas: Record<string, AdapterStaticSchema>;
}): MiddlewareExtraction {
  const { shapeInput, exportName, calls, adapterStaticSchemas } = params;
  const filePath = shapeInput.filePath;
  const extracted: ExtractedAugment[] = [];
  const contextOps: ContextOperation[] = [];
  const adapterNames = new Set<string>();
  let fallbackContextType: string | null = null;

  for (const call of calls) {
    const parts = extractDefinitionParts({ file: shapeInput, call, exportName });

    for (const name of parts.adapters) adapterNames.add(name);

    if (parts.factory !== null) {
      const offending = findContextAssignmentStart(parts.factory);

      if (offending !== null) {
        const lineOffsets = buildLineOffsets(shapeInput.parsed.sourceText);
        const { line, column } = getLineColumn(lineOffsets, offending);

        throw new DiagnosticError(buildDiagnostic({
          reason: `${filePath}:${line}:${column} \`${exportName}\`: assignment-style context augments (\`ctx.to(...)\` binding property assignment) are no longer supported.`,
          file: filePath,
          how: 'Declare the contribution in the defineMiddleware `augments` slot instead: `augments: { request: { myProp: (ctx) => ... } }`.',
        }));
      }

      contextOps.push(...extractMiddlewareContextOps(parts.factory));
      fallbackContextType ??= readFactoryContextType(parts.factory);
    }

    extracted.push(...parts.augments);
  }

  const producerInfo: MiddlewareProducerInfo | null = contextOps.length > 0
    ? { middlewareName: exportName, sourceFilePath: filePath, contextOps }
    : null;

  if (extracted.length === 0) {
    return { augment: null, producerInfo };
  }

  const contextType = resolveLocalContextType(extracted, adapterNames, adapterStaticSchemas)
    ?? fallbackContextType;

  if (contextType === null) {
    return { augment: null, producerInfo };
  }

  const props: PropAugment[] = extracted.map(augment => ({
    path: [augment.ns, augment.prop],
  }));

  return {
    augment: {
      middlewareName: exportName,
      contextType,
      sourceFilePath: filePath,
      augments: props,
      classImports: new Map(),
    },
    producerInfo,
  };
}

/**
 * Resolves the context type of a local middleware from its declared adapters
 * and augment namespaces via the adapter static schemas.
 */
function resolveLocalContextType(
  extracted: readonly ExtractedAugment[],
  adapterNames: ReadonlySet<string>,
  adapterStaticSchemas: Record<string, AdapterStaticSchema>,
): string | null {
  const namespacesUsed = new Set(extracted.map(a => a.ns));

  // Prefer schemas of explicitly declared adapters.
  for (const adapterName of adapterNames) {
    const schema = adapterStaticSchemas[adapterName];
    const contextNamespaces = schema?.contextNamespaces;

    if (contextNamespaces === undefined) continue;

    for (const ns of namespacesUsed) {
      if (contextNamespaces.namespaces[ns] !== undefined) {
        return contextNamespaces.contextType;
      }
    }
  }

  // Fall back to any schema that declares one of the used namespaces.
  for (const schema of Object.values(adapterStaticSchemas)) {
    const contextNamespaces = schema.contextNamespaces;

    if (contextNamespaces === undefined) continue;

    for (const ns of namespacesUsed) {
      if (contextNamespaces.namespaces[ns] !== undefined) {
        return contextNamespaces.contextType;
      }
    }
  }

  return null;
}
