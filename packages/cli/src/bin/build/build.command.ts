import { mkdir } from 'fs/promises';
import { Glob } from 'bun';
import { join, resolve, relative } from 'path';

import type { CommandOptions } from '../interfaces';
import type { BuildCommandDeps } from './interfaces';

import { isErr } from '@zipbul/result';
import { parseSource } from '@zipbul/gildash';
import { AstParser, AdapterDefinitionResolver, ModuleGraph } from '../../compiler/analyzer';
import { validateCreateApplication } from '../../compiler/analyzer/validation';
import {
  outputDirPath,
  tempDirPath,
  scanGlobSorted,
  writeIfChanged,
  withAtomicEmit,
  installCancellation,
  openGildashWithFallback,
} from '../../common';
import { ConfigLoader } from '../../config';
import { buildDiagnostic, DiagnosticError } from '../../diagnostics';
import { validateDefineCallShape } from '../../compiler/define-call-shape';
import { EntryGenerator, ManifestGenerator } from '../../compiler/generator';
import { MiddlewareAugmentCollector } from '../../compiler/analyzer/adapter/middleware-augment-collector';
import { validateHandlerContextUsages } from '../../compiler/analyzer/adapter/context-usage-validator';
import {
  validateContextDependencies,
  formatViolationMessage,
} from '../../compiler/analyzer/adapter/context-dependency-validator';
import { buildLib } from './lib-build';
import { CliRenderer } from '../cli-renderer';
import { writeInterfaceCatalog, writeRuntimeReport } from './build-artifact-writer';
import { formatCount, buildModuleTree } from '../module-tree-renderer';
import { scanAndParseFiles } from './build-file-scanner';
import { reportOutputSizes, reportCouplingMetrics, reportComplexFiles, reportProjectStats } from './build-metrics-reporter';

export function createBuildCommand(deps: BuildCommandDeps) {
  const { renderer } = deps;

  return async function build(commandOptions?: CommandOptions): Promise<void> {
    const isLibMode = commandOptions?.lib === true;

    renderer.intro(isLibMode ? 'build --lib' : 'build');
    const buildStartedAt = performance.now();

    const cancel = installCancellation({ renderer });

    try {
      if (isLibMode) {
        await buildLib(deps, renderer, buildStartedAt, cancel);
        return;
      }

      const configResult = await deps.loadConfig();
      const config = configResult.config;
      const moduleFileName = config.module.fileName;
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

      // Single normative shape rule — every regulated `defineX` call in
      // user-app source MUST appear as `export const NAME = defineX(...)`.
      // Runs BEFORE traversal so violations fail fast and downstream extractors
      // can assume the well-formed shape.
      await validateUserAppShape({ srcDir, projectRoot, scanFiles: deps.scanFiles });

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
      const ignorePatterns = ['dist', '.zipbul', '.gildash'];
      const { ledger, semanticAvailable } = await openGildashWithFallback({
        options: { projectRoot, ignorePatterns, watchMode: false },
        renderer,
        ...(deps.createGildash !== undefined ? { open: deps.createGildash } : {}),
      });

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

        // Atomicity note: `.zipbul/` files are written via `writeIfChanged`
        // (single-call `Bun.write` per file). Each file replacement is
        // atomic at the FS level, but cross-file consistency is NOT
        // guaranteed — if the process crashes between two files, one is
        // updated and another remains stale. This is acceptable because
        // `.zipbul/` is intermediate AOT cache: the next `zb build` reads
        // it for incremental work and reproduces missing pieces; the
        // shipped artifact is `dist/` (which IS swapped atomically via
        // `withAtomicEmit`). Wrapping `.zipbul/` in atomic-emit would
        // defeat `writeIfChanged`'s incremental-rebuild advantage.
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

        // Collect middleware augments (from registered middleware factories)
        // for build-time validation. The .d.ts emission is the responsibility
        // of `zb build --lib` (each middleware library ships its own
        // `dist/context-augments.d.ts` with `declare module` augmentation),
        // so the user-app build no longer writes `.zipbul/context.d.ts`.
        const augmentCollector = new MiddlewareAugmentCollector();
        const augmentResult = await augmentCollector.collect(fileMap, adapterResolution.adapterStaticSchemas);

        if (augmentResult.augments.length > 0) {
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
        // ctx.use(KEY) must have a matching ctx.set(KEY, ...) in a middleware
        // registered on the handler's chain AND running in an earlier-or-equal
        // phase. Violations are HARD ERRORS — runtime would throw, deployment
        // unsafe, build must fail.
        const dependencyViolations = validateContextDependencies(
          adapterResolution.handlerIndex,
          adapterResolution.handlerContextOps,
          augmentResult.producerInfos,
          adapterResolution.routeRegistrations,
          adapterResolution.adapterStaticSchemas,
        );

        if (dependencyViolations.length > 0) {
          const summary = dependencyViolations
            .map((v) => `[Zipbul AOT] ${formatViolationMessage(v)}`)
            .join('\n\n');
          throw new DiagnosticError(buildDiagnostic({
            reason: `${dependencyViolations.length} context dependency violation(s):\n\n${summary}`,
            how: 'Each violation lists the consumer and the missing producer middleware. Add the missing middleware to the relevant pipeline phase, or remove the dependency from the consumer.',
          }));
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
          throw new DiagnosticError(buildDiagnostic({
            reason: 'Manifest output is not deterministic for the current build inputs.',
            how: 'This indicates a compiler bug. Please report it with a minimal reproduction at https://github.com/zipbul/zipbul/issues.',
          }));
        }

        const interfaceCatalogFile = join(zipbulDir, 'interface-catalog.json');
        const runtimeReportFile = join(zipbulDir, 'runtime-report.json');

        await writeInterfaceCatalog({
          modules: graph.modules,
          ledger,
          semanticAvailable,
          projectRoot,
          catalogFilePath: interfaceCatalogFile,
        });
        await writeRuntimeReport(runtimeReportFile);

        manifestSpinner.stop('[3/4] \u{1F4CB} Manifests generated');

        const bundleSpinner = renderer.startSpinner('[4/4] \u{1F4E6} Bundling application');

        // Atomic emit: bundle into staging, then swap into dist/. On any
        // failure (Bun.build error or interruption) the prior dist/ remains
        // intact; staging is cleaned up.
        await withAtomicEmit(
          {
            finalDir: outDir,
            stagingDir: `${outDir}.staging`,
            registerCleanup: cancel.registerCleanup,
          },
          async (stagingDir) => {
            const buildResult = await deps.buildBundle({
              entrypoints: [entryPointFile, runtimeFile, workerFile, runtimeMasterFile],
              outdir: stagingDir,
              target: 'bun',
              splitting: true,
              minify: false,
              sourcemap: 'external',
              naming: '[name].js',
            });

            if (!buildResult.success) {
              const logMessages = buildResult.logs.map(log => `[${log.level}] ${log.message}`).join('\n');
              throw new DiagnosticError(buildDiagnostic({
                reason: logMessages.length > 0 ? `Bundle failed:\n${logMessages}` : 'Bundle failed.',
                how: 'Resolve the bundler-reported errors above. If they reference missing modules, verify your imports and that all dependencies are installed.',
              }));
            }
          },
        );

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

        await reportCouplingMetrics(fileMap, ledger, projectRoot, renderer);
        reportComplexFiles(fileMap, ledger, projectRoot, renderer);
        reportProjectStats(ledger, renderer);

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
        renderer.outro(`Ready to deploy${outroSuffix}`);
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
    } finally {
      cancel.dispose();
    }
  };
}

/**
 * Runs `validateDefineCallShape` over every `.ts` file inside `srcDir`. Scoped
 * to source files (excludes `.d.ts`, `.spec.ts`, `.test.ts`) so external
 * packages reached via import traversal are not validated here — those are
 * the responsibility of their own publishing pipeline (`zb build --lib` /
 * `zb build adapter`).
 */
async function validateUserAppShape(params: {
  srcDir: string;
  projectRoot: string;
  scanFiles: BuildCommandDeps['scanFiles'];
}): Promise<void> {
  const { srcDir, projectRoot, scanFiles } = params;
  const glob = new Glob('**/*.ts');
  const allFiles = await scanFiles({ glob, baseDir: srcDir });
  const tsFiles = allFiles.filter(
    f => !f.endsWith('.d.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.test.ts'),
  );

  const shapeInputs = await Promise.all(tsFiles.map(async file => {
    const fullPath = join(srcDir, file);
    const sourceText = await Bun.file(fullPath).text();
    const parsed = parseSource(fullPath, sourceText);
    if (isErr(parsed)) {
      throw new DiagnosticError(buildDiagnostic({
        reason: `Failed to parse ${fullPath} for shape validation: ${JSON.stringify(parsed.data)}`,
        file: fullPath,
      }));
    }
    return { filePath: relative(projectRoot, fullPath) || fullPath, parsed };
  }));

  // user-app context: defineModule + defineAdapter strict. defineMiddleware /
  // defineGuard / defineExceptionFilter remain factory-allowed (they are
  // consumers in user-app code, see define-call-shape.ts).
  validateDefineCallShape(shapeInputs, new Set(['defineModule', 'defineAdapter']));
}

export const __testing__ = { createBuildCommand };

// ---------------------------------------------------------------------------
// Default export -- maintains backward compatibility
// ---------------------------------------------------------------------------

export async function build(
  commandOptions?: CommandOptions,
  renderer?: import('../interfaces').CliRendererLike,
): Promise<void> {
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
    renderer: renderer ?? new CliRenderer(),
  });

  await impl(commandOptions);
}
