import { mkdir } from 'fs/promises';
import { join, resolve, relative } from 'path';

import type { CommandOptions } from '../interfaces';
import type { BuildCommandDeps } from './interfaces';

import { isErr } from '@zipbul/result';
import { Gildash, GildashError, type GildashOptions } from '@zipbul/gildash';
import { AstParser, AdapterDefinitionResolver, ModuleGraph } from '../../compiler/analyzer';
import { validateCreateApplication } from '../../compiler/analyzer/validation';
import {
  outputDirPath,
  tempDirPath,
  scanGlobSorted,
  writeIfChanged,
} from '../../common';
import { ConfigLoader } from '../../config';
import { buildDiagnostic, DiagnosticError } from '../../diagnostics';
import { EntryGenerator, ManifestGenerator, ContextTypesGenerator, ImportRegistry } from '../../compiler/generator';
import { MiddlewareAugmentCollector } from '../../compiler/analyzer/adapter/middleware-augment-collector';
import { validateHandlerContextUsages } from '../../compiler/analyzer/adapter/context-usage-validator';
import {
  validateContextDependencies,
  formatViolationMessage,
} from '../../compiler/analyzer/adapter/context-dependency-validator';
import { buildLib } from './lib-build';
import { CliRenderer } from '../cli-renderer';
import { writeInterfaceCatalog, removeInterfaceCatalog, writeRuntimeReport, removeRuntimeReport } from './build-artifact-writer';
import { formatCount, buildModuleTree } from '../module-tree-renderer';
import { scanAndParseFiles } from './build-file-scanner';
import { reportOutputSizes, reportCouplingMetrics, reportComplexFiles, reportProjectStats } from './build-metrics-reporter';

export function createBuildCommand(deps: BuildCommandDeps) {
  const { renderer } = deps;

  return async function build(commandOptions?: CommandOptions): Promise<void> {
    const isLibMode = commandOptions?.lib === true;

    renderer.intro(isLibMode ? 'build --lib' : 'build');
    const buildStartedAt = performance.now();

    try {
      if (isLibMode) {
        await buildLib(deps, renderer, buildStartedAt);
        return;
      }

      const configResult = await deps.loadConfig();
      const config = configResult.config;
      const moduleFileName = config.module.fileName;
      const buildProfile = commandOptions?.profile ?? 'full';
      const verbose = commandOptions?.verbose === true;
      const projectRoot = process.cwd();
      const srcDir = resolve(projectRoot, config.sourceDir);
      const outDir = resolve(projectRoot, 'dist');
      const zipbulDir = outputDirPath(projectRoot);
      const buildTempDir = tempDirPath(projectRoot);

      renderer.outputPaths('\u{1F4C2} Project', [
        { label: 'Root', value: projectRoot },
        { label: 'Source', value: relative(projectRoot, srcDir) || '.' },
        { label: 'Output', value: relative(projectRoot, outDir) || '.' },
      ]);

      const parser = deps.createParser();
      const userMain = resolve(projectRoot, config.entry);

      const scanSpinner = renderer.startSpinner('[1/4] \u{1F50D} Scanning source files');

      const scanResult = await scanAndParseFiles({
        projectRoot,
        srcDir,
        entry: config.entry,
        parser,
        scanFiles: deps.scanFiles,
        resolveImport: deps.resolveImport,
        renderer,
      });

      const { fileMap, allClasses } = scanResult;

      scanSpinner.stop(`[1/4] \u{1F50D} Scanned ${formatCount(fileMap.size)} files (${formatCount(allClasses.length)} classes)`);

      const appEntry = validateCreateApplication(fileMap);

      if (isErr(appEntry)) {
        throw new DiagnosticError(appEntry.data);
      }

      const graphSpinner = renderer.startSpinner('[2/4] \u{1F9E9} Building module graph');

      // gildash file-level cycle detection + semantic DI validation
      const openGildash = deps.createGildash ?? ((opts: GildashOptions) => Gildash.open(opts));
      const ignorePatterns = ['dist', '.zipbul', '.gildash'];
      let ledger: Gildash;
      let semanticAvailable = true;

      try {
        ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true, watchMode: false });
      } catch (e) {
        if (e instanceof GildashError && e.type === 'semantic') {
          semanticAvailable = false;
          renderer.warn(`Semantic mode unavailable, falling back: ${e.message}`);
          ledger = await openGildash({ projectRoot, ignorePatterns, watchMode: false });
        } else {
          throw e;
        }
      }

      const unsubscribeError = ledger.onError((error) => {
        renderer.warn(`Gildash: ${error.message}`);
      });

      try {
        const hasCycle = await ledger.hasCycle();

        if (hasCycle) {
          const cyclePaths = await ledger.getCyclePaths(undefined, { maxCycles: 5 });
          const summary = cyclePaths.map(c => c.join(' \u2192 ')).join('\n');

          throw new DiagnosticError(
            buildDiagnostic({ reason: `Circular import chain detected:\n${summary}` }),
          );
        }

        const adapterDefinitionResolver = deps.createAdapterDefinitionResolver();
        const graph = new ModuleGraph(fileMap, moduleFileName, srcDir, ledger);

        graph.build();
        await graph.validateInheritedScopes();

        const adapterResolution = await adapterDefinitionResolver.resolve({ fileMap, projectRoot, graph });

        if (isErr(adapterResolution)) {
          throw new DiagnosticError(adapterResolution.data);
        }

        const controllerDecoratorNames = Object.values(adapterResolution.adapterStaticSchemas)
          .map(schema => schema.entryDecorators.controller);

        graph.registerControllers(controllerDecoratorNames);
        graph.validateUnusedProviders();

        let providerCount = 0;
        for (const mod of graph.modules.values()) {
          providerCount += mod.providers.size;
        }
        graphSpinner.stop(`[2/4] \u{1F9E9} Module graph built (${formatCount(graph.modules.size)} modules, ${formatCount(providerCount)} providers)`);

        const manifestSpinner = renderer.startSpinner('[3/4] \u{1F4CB} Generating manifests');

        await mkdir(zipbulDir, { recursive: true });

        const manifestFile = join(zipbulDir, 'manifest.json');
        const manifestGen = deps.createManifestGenerator();
        const manifestJson = manifestGen.generateJson({
          graph,
          projectRoot,
          source: configResult.source,
          resolvedConfig: config,
          adapterStaticSchemas: adapterResolution.adapterStaticSchemas,
          handlerIndex: adapterResolution.handlerIndex,
        });

        await writeIfChanged(manifestFile, manifestJson);
        await mkdir(buildTempDir, { recursive: true });

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

        const runtimeFile = join(buildTempDir, 'runtime.ts');
        const runtimeResult = manifestGen.generate(graph, allClasses, buildTempDir, resolvedHandlerIndex, adapterResolution.routeRegistrations, srcDir);

        if (isErr(runtimeResult)) {
          throw new DiagnosticError(runtimeResult.data);
        }

        await writeIfChanged(runtimeFile, runtimeResult);

        // Generate context.d.ts — AOT declaration merging for middleware augments
        const augmentCollector = new MiddlewareAugmentCollector();
        const augmentResult = await augmentCollector.collect(fileMap, adapterResolution.adapterStaticSchemas);

        if (augmentResult.augments.length > 0) {
          const contextTypesGen = new ContextTypesGenerator();
          const contextRegistry = new ImportRegistry(zipbulDir);
          const contextDts = contextTypesGen.generate(augmentResult.augments, contextRegistry, augmentResult.adapterMap);

          await writeIfChanged(join(zipbulDir, 'context.d.ts'), contextDts);

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

        // AOT producer-consumer dependency validation —
        // every handler's `ctx.use(KEY)` must have a matching `ctx.set(KEY, ...)`
        // in a middleware registered on the handler's chain.
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

        const entryPointFile = join(buildTempDir, 'entry.ts');
        const entryGen = deps.createEntryGenerator();
        const buildEntryContent = await entryGen.generate(userMain, false);

        await writeIfChanged(entryPointFile, buildEntryContent);

        // Generate worker entry for cluster mode
        const workerFile = join(buildTempDir, 'worker.ts');
        const workerContent = entryGen.generateWorker();

        await writeIfChanged(workerFile, workerContent);

        // Generate lightweight master runtime for cluster mode
        const runtimeMasterFile = join(buildTempDir, 'runtime-master.ts');
        const runtimeMasterContent = entryGen.generateRuntimeMaster();

        await writeIfChanged(runtimeMasterFile, runtimeMasterContent);

        const manifestJsonGuard = manifestGen.generateJson({
          graph,
          projectRoot,
          source: configResult.source,
          resolvedConfig: config,
          adapterStaticSchemas: adapterResolution.adapterStaticSchemas,
          handlerIndex: adapterResolution.handlerIndex,
        });

        if (manifestJsonGuard !== manifestJson) {
          throw new Error('Manifest output is not deterministic for the current build inputs.');
        }

        if (!['minimal', 'standard', 'full'].includes(buildProfile)) {
          throw new Error(`Invalid build profile: ${buildProfile}`);
        }

        const interfaceCatalogFile = join(zipbulDir, 'interface-catalog.json');
        const runtimeReportFile = join(zipbulDir, 'runtime-report.json');

        if (buildProfile === 'standard' || buildProfile === 'full') {
          await writeInterfaceCatalog({
            modules: graph.modules,
            ledger,
            semanticAvailable,
            projectRoot,
            catalogFilePath: interfaceCatalogFile,
          });
        } else {
          await removeInterfaceCatalog(interfaceCatalogFile);
        }

        if (buildProfile === 'full') {
          await writeRuntimeReport(runtimeReportFile);
        } else {
          await removeRuntimeReport(runtimeReportFile);
        }

        manifestSpinner.stop('[3/4] \u{1F4CB} Manifests generated');

        const bundleSpinner = renderer.startSpinner('[4/4] \u{1F4E6} Bundling application');

        const buildResult = await deps.buildBundle({
          entrypoints: [entryPointFile, runtimeFile, workerFile, runtimeMasterFile],
          outdir: outDir,
          target: 'bun',
          splitting: true,
          minify: false,
          sourcemap: 'external',
          naming: '[name].js',
        });

        if (!buildResult.success) {
          const logMessages = buildResult.logs.map(log => `[${log.level}] ${log.message}`).join('\n');

          throw new Error(logMessages.length > 0 ? `Bundle failed:\n${logMessages}` : 'Bundle failed');
        }

        bundleSpinner.stop('[4/4] \u{1F4E6} Application bundled');

        const moduleTreeResult = buildModuleTree(
          { modules: graph.modules, handlerIndex: adapterResolution.handlerIndex },
          { verbose },
        );

        renderer.outputPaths('\u{1F9F1} Application', moduleTreeResult.treeLines);

        const entryOutputFile = join(outDir, 'entry.js');
        const runtimeOutputFile = join(outDir, 'runtime.js');

        const buildDuration = ((performance.now() - buildStartedAt) / 1000).toFixed(1);
        const warningCount = graph.warnings.length;

        renderer.success(`Build complete in ${buildDuration}s`);

        if (buildProfile === 'full') {
          await reportCouplingMetrics(fileMap, ledger, projectRoot, renderer);
          reportComplexFiles(fileMap, ledger, projectRoot, renderer);
          reportProjectStats(ledger, renderer);
        }

        await reportOutputSizes(
          { entryOutputFile, runtimeOutputFile, manifestFile, manifestJson, projectRoot },
          renderer,
        );

        if (warningCount > 0) {
          for (const warning of graph.warnings) {
            renderer.warn(warning);
          }
        }

        const outroSuffix = warningCount > 0 ? ` with ${String(warningCount)} warning${warningCount === 1 ? '' : 's'}` : '';
        renderer.outro(`Ready to deploy (profile: ${buildProfile})${outroSuffix}`);
      } finally {
        unsubscribeError();
        try {
          await ledger.close();
        } catch (e) {
          renderer.warn(e instanceof Error ? e.message : 'Failed to close gildash.');
        }
      }
    } catch (error) {
      if (error instanceof DiagnosticError) {
        throw error;
      }

      throw new DiagnosticError(
        buildDiagnostic({ reason: error instanceof Error ? error.message : 'Unknown build error.' }),
        { cause: error },
      );
    }
  };
}

export const __testing__ = { createBuildCommand };

// ---------------------------------------------------------------------------
// Default export -- maintains backward compatibility
// ---------------------------------------------------------------------------

export async function build(commandOptions?: CommandOptions): Promise<void> {
  const impl = createBuildCommand({
    loadConfig: async () => {
      const result = await ConfigLoader.load();
      return { config: result.config, source: result.source };
    },
    createParser: () => new AstParser(),
    createManifestGenerator: () => new ManifestGenerator(),
    createEntryGenerator: () => new EntryGenerator(),
    createAdapterDefinitionResolver: () => new AdapterDefinitionResolver(),
    scanFiles: ({ glob, baseDir }) => scanGlobSorted({ glob, baseDir }),
    resolveImport: (specifier, fromDir) => Bun.resolveSync(specifier, fromDir),
    buildBundle: (...args) => Bun.build(...args),
    renderer: new CliRenderer(),
  });

  await impl(commandOptions);
}
