import { mkdir } from 'fs/promises';
import { Glob } from 'bun';
import { join, resolve, relative } from 'path';

import type { CommandOptions } from '../interfaces';
import type { BuildCommandDeps } from './interfaces';

import { isErr } from '@zipbul/result';
import { Logger } from '@zipbul/logger';
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
import { writeInterfaceCatalog, writeRuntimeReport } from './build-artifact-writer';
import { scanAndParseFiles } from './build-file-scanner';
import { reportOutputSizes, reportCouplingMetrics, reportComplexFiles, reportProjectStats } from './build-metrics-reporter';

export function createBuildCommand(deps: BuildCommandDeps) {
  return async function build(commandOptions?: CommandOptions): Promise<void> {
    const verbose = commandOptions?.verbose === true;
    const log = new Logger('build');

    log.time('total');
    const cancel = installCancellation();

    try {
      const configResult = await deps.loadConfig();
      const config = configResult.config;
      const moduleFileName = config.module.fileName;
      const projectRoot = process.cwd();
      const srcDir = resolve(projectRoot, config.sourceDir);
      const outDir = resolve(projectRoot, 'dist');
      const zipbulDir = outputDirPath(projectRoot);
      const buildTempDir = tempDirPath(projectRoot);

      log.info('project=%s source=%s output=%s',
        projectRoot,
        relative(projectRoot, srcDir) || '.',
        relative(projectRoot, outDir) || '.');

      const parser = deps.createParser();
      const userMain = resolve(projectRoot, config.entry);

      // -- 1. Scan + parse --
      log.time('scan');
      await validateUserAppShape({ srcDir, projectRoot, scanFiles: deps.scanFiles });
      const scanResult = await scanAndParseFiles({
        projectRoot,
        srcDir,
        entry: config.entry,
        parser,
        scanFiles: deps.scanFiles,
        resolveImport: deps.resolveImport,
      });
      const { fileMap, allClasses } = scanResult;
      log.info('scanned %d files, %d classes', fileMap.size, allClasses.length);
      log.timeEnd('scan');

      const appEntry = validateCreateApplication(fileMap);
      if (isErr(appEntry)) throw new DiagnosticError(appEntry.data);

      // -- 2. Module graph --
      log.time('graph');
      const ignorePatterns = ['dist', '.zipbul', '.gildash'];
      const { ledger, semanticAvailable } = await openGildashWithFallback({
        options: { projectRoot, ignorePatterns, watchMode: false },
        ...(deps.createGildash !== undefined ? { open: deps.createGildash } : {}),
      });

      const unsubscribeError = ledger.onError((error) => {
        log.warn('gildash: %s', error.message);
      });

      try {
        const hasCycle = await ledger.hasCycle();
        if (hasCycle) {
          const cyclePaths = await ledger.getCyclePaths(undefined, { maxCycles: 5 });
          const summary = cyclePaths.map(c => c.join(' -> ')).join('\n');
          throw new DiagnosticError(buildDiagnostic({
            reason: `Circular import chain detected:\n${summary}`,
            how: 'Break the cycle by extracting shared symbols into a third file, or by switching one side to `import type` if the dependency is types-only.',
          }));
        }

        const adapterDefinitionResolver = deps.createAdapterDefinitionResolver();
        const graph = new ModuleGraph(fileMap, moduleFileName, srcDir, ledger);
        graph.build();
        await graph.validateInheritedScopes();

        const adapterResolution = await adapterDefinitionResolver.resolve({ fileMap, projectRoot, graph });
        if (isErr(adapterResolution)) throw new DiagnosticError(adapterResolution.data);

        const controllerDecoratorNames = Object.values(adapterResolution.adapterStaticSchemas)
          .map(schema => schema.entryDecorators.controller);
        graph.registerControllers(controllerDecoratorNames);
        graph.validateUnusedProviders();

        let providerCount = 0;
        for (const mod of graph.modules.values()) providerCount += mod.providers.size;

        log.info('%d modules, %d providers', graph.modules.size, providerCount);
        log.timeEnd('graph');

        // -- 3. Generate manifests + entry/runtime/worker --
        log.time('manifest');
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
        if (isErr(runtimeResult)) throw new DiagnosticError(runtimeResult.data);
        await writeIfChanged(runtimeFile, runtimeResult);

        const augmentCollector = new MiddlewareAugmentCollector();
        const augmentResult = await augmentCollector.collect(fileMap, adapterResolution.adapterStaticSchemas);

        if (augmentResult.augments.length > 0) {
          const usageWarnings = validateHandlerContextUsages(
            adapterResolution.handlerIndex,
            adapterResolution.handlerContextUsages,
            augmentResult.augments,
            adapterResolution.routeRegistrations,
          );
          for (const w of usageWarnings) {
            graph.warnings.push(
              `Handler '${w.handlerId}' accesses '${w.usagePath.join('.')}' which is provided by middleware '${w.providedByMiddleware}', but that middleware is not registered for this handler.`,
            );
          }
        }

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

        const entryPointFile = join(buildTempDir, 'entry.ts');
        const entryGen = deps.createEntryGenerator();
        await writeIfChanged(entryPointFile, await entryGen.generate(userMain, false));

        const workerFile = join(buildTempDir, 'worker.ts');
        await writeIfChanged(workerFile, entryGen.generateWorker());

        const runtimeMasterFile = join(buildTempDir, 'runtime-master.ts');
        await writeIfChanged(runtimeMasterFile, entryGen.generateRuntimeMaster());

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
        log.timeEnd('manifest');

        // -- 4. Bundle --
        log.time('bundle');
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
              const logMessages = buildResult.logs.map(l => `[${l.level}] ${l.message}`).join('\n');
              throw new DiagnosticError(buildDiagnostic({
                reason: logMessages.length > 0 ? `Bundle failed:\n${logMessages}` : 'Bundle failed.',
                how: 'Resolve the bundler-reported errors above. If they reference missing modules, verify your imports and that all dependencies are installed.',
              }));
            }
          },
        );
        log.timeEnd('bundle');

        // -- Reports --
        const entryOutputFile = join(outDir, 'entry.js');
        const runtimeOutputFile = join(outDir, 'runtime.js');

        await reportOutputSizes({
          entryOutputFile, runtimeOutputFile, manifestFile, manifestJson, projectRoot,
        }, log);
        await reportCouplingMetrics(fileMap, ledger, projectRoot, log);
        reportComplexFiles(fileMap, ledger, projectRoot, log);
        reportProjectStats(ledger, log);

        if (verbose) {
          for (const m of graph.modules.values()) {
            log.info('module: %s controllers=%d providers=%d',
              m.name, m.controllers.size, m.providers.size);
          }
        }

        for (const warning of graph.warnings) {
          log.warn('%s', warning);
        }

        log.info('%d warning(s)', graph.warnings.length);
      } finally {
        unsubscribeError();
        try {
          await ledger.close();
        } catch (e) {
          log.warn('failed to close gildash: %s', e);
        }
      }

      log.timeEnd('total');
    } catch (error) {
      if (error instanceof DiagnosticError) throw error;
      throw new DiagnosticError(
        buildDiagnostic({
          reason: error instanceof Error ? error.message : 'Unknown build error.',
          how: 'This error is unwrapped — likely a compiler bug. Re-run with `--verbose` for stack context and report at https://github.com/zipbul/zipbul/issues with the build inputs.',
          cause: error,
        }),
        { cause: error },
      );
    } finally {
      cancel.dispose();
    }
  };
}

/**
 * Runs `validateDefineCallShape` over every `.ts` file inside `srcDir`.
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

  validateDefineCallShape(shapeInputs, new Set(['defineModule', 'defineAdapter']));
}

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
  });

  await impl(commandOptions);
}
