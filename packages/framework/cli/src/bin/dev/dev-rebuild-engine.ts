import { mkdir } from 'fs/promises';
import { join, resolve } from 'path';

import type { FileAnalysis } from '../../compiler/analyzer';
import { ModuleGraph } from '../../compiler/analyzer/graph/module-graph';
import { isErr } from '@zipbul/result';
import { buildDiagnostic, DiagnosticError } from '../../diagnostics';
import { writeIfChanged } from '../../common';
import { buildFileAnalysis } from '../build/build-analysis';
import { writeInterfaceCatalog, writeRuntimeReport } from '../build/build-artifact-writer';
import { normalizeModuleConfigPhaseKeys } from '../../compiler/analyzer/adapter/phase-key-normalizer';
import { MiddlewareAugmentCollector } from '../../compiler/analyzer/adapter/middleware-augment-collector';
import { validateHandlerContextUsages } from '../../compiler/analyzer/adapter/context-usage-validator';
import {
  validateContextDependencies,
  formatViolationMessage,
} from '../../compiler/analyzer/adapter/context-dependency-validator';
import { Logger } from '@zipbul/logger';

import type { CollectedClass } from '../interfaces';
import { reportDiagnostic } from '../report-diagnostic';
import type { RebuildContext, RebuildOptions, RebuildResult } from './interfaces';

const log = new Logger('dev/rebuild');

/**
 * Computes a structural fingerprint for a file analysis result.
 * Used to detect whether a file's structural shape has changed across re-parses.
 *
 * @param analysis - The file analysis to fingerprint
 * @returns A JSON string representing the structural shape (excluding filePath)
 * @public
 */
export function computeStructuralFingerprint(analysis: FileAnalysis): string {
  const { filePath: _, ...structural } = analysis;
  return JSON.stringify(structural);
}

/**
 * Determines whether a file should be analyzed by the dev compiler.
 * Excludes declaration files (`.d.ts`) and test files (`.spec.ts`, `.test.ts`).
 *
 * @param filePath - Absolute path of the file to check
 * @returns `true` if the file should be analyzed
 * @public
 */
export function shouldAnalyzeFile(filePath: string): boolean {
  if (filePath.endsWith('.d.ts')) {
    return false;
  }

  if (filePath.endsWith('.spec.ts') || filePath.endsWith('.test.ts')) {
    return false;
  }

  return true;
}

/**
 * Parses and analyzes a single source file, updating the file and fingerprint caches.
 *
 * @param filePath - Absolute path of the file to analyze
 * @param context - Shared rebuild context containing parser, caches, and renderer
 * @returns `true` if the file was analyzed successfully, `false` on parse error
 * @public
 */
export async function analyzeFile(filePath: string, context: AnalyzeFileContext): Promise<boolean> {
  const { parser, fileCache, fingerprintCache } = context;

  try {
    const fileContent = await Bun.file(filePath).text();
    const parseResult = await parser.parse(filePath, fileContent);

    if (isErr(parseResult)) {
      reportDiagnostic(parseResult.data, 'dev/parse');
      return false;
    }

    const analysis = buildFileAnalysis(filePath, parseResult);

    fileCache.set(filePath, analysis);
    fingerprintCache.set(filePath, computeStructuralFingerprint(analysis));

    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown parse error.';
    reportDiagnostic(buildDiagnostic({ reason, file: filePath, cause: error }), 'dev/parse');
    return false;
  }
}

interface AnalyzeFileContext {
  parser: RebuildContext['parser'];
  fileCache: Map<string, FileAnalysis>;
  fingerprintCache: Map<string, string>;
}

/**
 * Executes a full AOT rebuild: cycle check, graph construction, validation,
 * adapter resolution, manifest/runtime/entry generation, and artifact writing.
 *
 * @param context - Shared rebuild context with all required state
 * @param options - Optional rebuild options (e.g. skip cycle check)
 * @returns The module graph and handler index produced by the rebuild
 * @public
 */
export async function rebuild(context: RebuildContext, options?: RebuildOptions): Promise<RebuildResult> {
  const {
    parser,
    adapterDefinitionResolver,
    manifestGen,
    entryGen,
    fileCache,
    moduleFileName,
    srcDir,
    outDir,
    projectRoot,
    config,
    configSource,
    semanticAvailable,
    ledger,
  } = context;

  // File-level import cycle detection (treated as build error, watcher stays alive)
  if (!options?.skipCycleCheck) {
    try {
      const hasCycle = await ledger.hasCycle();
      if (hasCycle) {
        const cyclePaths = await ledger.getCyclePaths(undefined, { maxCycles: 3 });
        const summary = cyclePaths.map(c => c.join(' → ')).join('\n');
        throw new DiagnosticError(buildDiagnostic({
          reason: `Circular import chain detected:\n${summary}`,
          how: 'Break the cycle by extracting shared symbols into a third file or by switching one side to `import type` if the dependency is types-only. The watcher stays alive — fix the imports and save to retry.',
        }));
      }
    } catch (cycleError) {
      if (cycleError instanceof DiagnosticError) {
        throw cycleError;
      }
      log.warn('cycle detection unavailable this rebuild (%s); circular imports may not be reported', cycleError);
    }
  }

  const fileMap = new Map(fileCache.entries());
  const graph = new ModuleGraph(fileMap, moduleFileName, srcDir, ledger);

  graph.buildStructure();

  try {
    await graph.validateInheritedScopes();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Scope validation failed.';
    throw new DiagnosticError(buildDiagnostic({
      reason,
      how: 'Check the offending @Injectable() / module visibility settings. A scope is inherited only if every parent module in the import chain permits it.',
    }));
  }

  const phaseKeysResult = await normalizeModuleConfigPhaseKeys(graph, fileMap, parser);
  if (isErr(phaseKeysResult)) throw new DiagnosticError(phaseKeysResult.data);

  const adapterResolution = await adapterDefinitionResolver.resolve({ fileMap, projectRoot, graph });

  if (isErr(adapterResolution)) {
    throw new DiagnosticError(adapterResolution.data);
  }

  const controllerDecoratorNames = Object.values(adapterResolution.adapterStaticSchemas)
    .map(schema => schema.entryDecorators.controller);

  graph.registerControllers(controllerDecoratorNames);
  graph.validateUnusedProviders();

  const currentSignatures = graph.computeSignatures();
  const signatureChanged = !context.previousSignatures
    || context.previousSignatures.size !== currentSignatures.size
    || [...currentSignatures].some(([path, sig]) => context.previousSignatures!.get(path) !== sig);

  if (signatureChanged) {
    graph.validate();
  }

  context.previousSignatures = currentSignatures;

  const manifestJson = manifestGen.generateJson({
    graph,
    projectRoot,
    source: configSource,
    resolvedConfig: config,
    adapterStaticSchemas: adapterResolution.adapterStaticSchemas,
    handlerIndex: adapterResolution.handlerIndex,
  });

  await mkdir(outDir, { recursive: true });
  await writeIfChanged(join(outDir, 'manifest.json'), manifestJson);

  // Generate runtime.ts
  const allClasses: CollectedClass[] = [];
  for (const [filePath, analysis] of fileMap) {
    for (const classMeta of analysis.classes) {
      allClasses.push({ metadata: classMeta, filePath });
    }
  }

  const controllerKeyMap = new Map<string, string>();

  for (const node of graph.modules.values()) {
    for (const ctrlName of node.controllers) {
      controllerKeyMap.set(ctrlName, `${node.name}::${ctrlName}`);
    }
  }

  const resolvedHandlerIndex = adapterResolution.handlerIndex.map(entry => ({
    ...entry,
    controllerKey: controllerKeyMap.get(entry.className) ?? entry.className,
  }));

  const runtimeResult = manifestGen.generate(graph, allClasses, outDir, resolvedHandlerIndex, adapterResolution.routeRegistrations, srcDir);

  if (isErr(runtimeResult)) {
    throw new DiagnosticError(runtimeResult.data);
  }

  await writeIfChanged(join(outDir, 'runtime.ts'), runtimeResult);

  // Collect middleware augments for build-time validation only.
  // The .d.ts emission is the responsibility of `zb build middleware`
  // (each middleware library ships its own `dist/context-augments.d.ts`).
  const augmentCollector = new MiddlewareAugmentCollector();
  const augmentResult = await augmentCollector.collect(fileMap, adapterResolution.adapterStaticSchemas);

  if (augmentResult.augments.length > 0) {
    const usageWarnings = validateHandlerContextUsages(
      adapterResolution.handlerIndex,
      adapterResolution.handlerContextUsages,
      augmentResult.augments,
      adapterResolution.routeRegistrations,
    );

    for (const warning of usageWarnings) {
      graph.warnings.push(
        `Handler '${warning.handlerId}' accesses '${warning.usagePath.join('.')}' which is provided by middleware '${warning.providedByMiddleware}', but that middleware is not registered for this handler.`,
      );
    }
  }

  // AOT producer-consumer dependency validation — HARD ERROR.
  const dependencyViolations = validateContextDependencies(
    adapterResolution.handlerIndex,
    adapterResolution.handlerContextOps,
    augmentResult.producerInfos,
    adapterResolution.routeRegistrations,
    adapterResolution.adapterStaticSchemas,
  );

  if (dependencyViolations.length > 0) {
    const summary = dependencyViolations
      .map((v) => `${formatViolationMessage(v)}`)
      .join('\n\n');
    throw new DiagnosticError(buildDiagnostic({
      reason: `${dependencyViolations.length} context dependency violation(s):\n\n${summary}`,
      how: 'Each violation lists the consumer and the missing producer middleware. Add the missing middleware to the relevant pipeline phase, or remove the dependency from the consumer.',
    }));
  }

  // Generate entry.ts
  const userMain = resolve(projectRoot, config.entry);
  const entryContent = await entryGen.generate(userMain, true);

  await writeIfChanged(join(outDir, 'entry.ts'), entryContent);

  const interfaceCatalogPath = join(outDir, 'interface-catalog.json');
  const runtimeReportPath = join(outDir, 'runtime-report.json');

  await writeInterfaceCatalog({
    modules: graph.modules,
    ledger,
    semanticAvailable,
    projectRoot,
    catalogFilePath: interfaceCatalogPath,
  });
  await writeRuntimeReport(runtimeReportPath);

  return { graph, handlerIndex: adapterResolution.handlerIndex };
}
