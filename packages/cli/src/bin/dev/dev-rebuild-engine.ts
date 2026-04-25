import { mkdir } from 'fs/promises';
import { join, resolve } from 'path';

import type { FileAnalysis } from '../../compiler/analyzer';
import { ModuleGraph } from '../../compiler/analyzer/graph/module-graph';
import { isErr } from '@zipbul/result';
import { buildDiagnostic, DiagnosticError } from '../../diagnostics';
import { writeIfChanged } from '../../common';
import { buildFileAnalysis } from '../build/build-analysis';
import { writeInterfaceCatalog, removeInterfaceCatalog, writeRuntimeReport, removeRuntimeReport } from '../build/build-artifact-writer';
import { MiddlewareAugmentCollector } from '../../compiler/analyzer/adapter/middleware-augment-collector';
import { validateHandlerContextUsages } from '../../compiler/analyzer/adapter/context-usage-validator';
import {
  validateContextDependencies,
  formatViolationMessage,
} from '../../compiler/analyzer/adapter/context-dependency-validator';
import { ContextTypesGenerator, ImportRegistry } from '../../compiler/generator';

import type { CliRendererLike, CollectedClass } from '../interfaces';
import type { RebuildContext, RebuildOptions, RebuildResult } from './interfaces';

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
  const { parser, fileCache, fingerprintCache, renderer } = context;

  try {
    const fileContent = await Bun.file(filePath).text();
    const parseResult = await parser.parse(filePath, fileContent);

    if (isErr(parseResult)) {
      renderer.diagnostic(parseResult.data);

      return false;
    }

    const analysis = buildFileAnalysis(filePath, parseResult);

    fileCache.set(filePath, analysis);
    fingerprintCache.set(filePath, computeStructuralFingerprint(analysis));

    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown parse error.';
    const diagnostic = buildDiagnostic({
      reason,
      file: filePath,
      cause: error,
    });

    renderer.diagnostic(diagnostic);

    return false;
  }
}

interface AnalyzeFileContext {
  parser: RebuildContext['parser'];
  fileCache: Map<string, FileAnalysis>;
  fingerprintCache: Map<string, string>;
  renderer: CliRendererLike;
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
    buildProfile,
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
        throw new DiagnosticError(
          buildDiagnostic({ reason: `Circular import chain detected:\n${summary}` }),
        );
      }
    } catch (cycleError) {
      if (cycleError instanceof DiagnosticError) {
        throw cycleError;
      }
      /* Gildash cycle detection failure — ignore */
    }
  }

  const fileMap = new Map(fileCache.entries());
  const graph = new ModuleGraph(fileMap, moduleFileName, srcDir, ledger);

  graph.buildStructure();

  try {
    await graph.validateInheritedScopes();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Scope validation failed.';
    throw new DiagnosticError(buildDiagnostic({ reason }));
  }

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

  // Generate context.d.ts — AOT declaration merging for middleware augments
  const augmentCollector = new MiddlewareAugmentCollector();
  const augmentResult = await augmentCollector.collect(fileMap, adapterResolution.adapterStaticSchemas);

  if (augmentResult.augments.length > 0) {
    const contextTypesGen = new ContextTypesGenerator();
    const contextRegistry = new ImportRegistry(outDir);
    const contextDts = contextTypesGen.generate(augmentResult.augments, contextRegistry, augmentResult.adapterMap);

    await writeIfChanged(join(outDir, 'context.d.ts'), contextDts);

    // Validate handler context usages against registered middleware augments
    const usageWarnings = validateHandlerContextUsages(
      adapterResolution.handlerIndex,
      adapterResolution.handlerContextUsages,
      augmentResult.augments,
    );

    for (const warning of usageWarnings) {
      graph.warnings.push(
        `[Zipbul AOT] Handler '${warning.handlerId}' accesses '${warning.usagePath.join('.')}' which is provided by middleware '${warning.providedByMiddleware}', but that middleware is not registered for this handler.`,
      );
    }
  }

  // AOT producer-consumer dependency validation
  const dependencyViolations = validateContextDependencies(
    adapterResolution.handlerIndex,
    adapterResolution.handlerContextOps,
    augmentResult.augments,
    adapterResolution.routeRegistrations,
  );

  for (const violation of dependencyViolations) {
    graph.warnings.push(
      `[Zipbul AOT] ${formatViolationMessage(violation)}`,
    );
  }

  // Generate entry.ts
  const userMain = resolve(projectRoot, config.entry);
  const entryContent = await entryGen.generate(userMain, true);

  await writeIfChanged(join(outDir, 'entry.ts'), entryContent);

  if (!['minimal', 'standard', 'full'].includes(buildProfile)) {
    throw new Error(`Invalid build profile: ${buildProfile}`);
  }

  const interfaceCatalogPath = join(outDir, 'interface-catalog.json');
  const runtimeReportPath = join(outDir, 'runtime-report.json');

  if (buildProfile === 'standard' || buildProfile === 'full') {
    await writeInterfaceCatalog({
      modules: graph.modules,
      ledger,
      semanticAvailable,
      projectRoot,
      catalogFilePath: interfaceCatalogPath,
    });
  } else {
    await removeInterfaceCatalog(interfaceCatalogPath);
  }

  if (buildProfile === 'full') {
    await writeRuntimeReport(runtimeReportPath);
  } else {
    await removeRuntimeReport(runtimeReportPath);
  }

  return { graph, handlerIndex: adapterResolution.handlerIndex };
}
