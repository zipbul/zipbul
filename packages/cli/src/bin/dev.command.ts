import { Glob, type Subprocess } from 'bun';
import { mkdir } from 'fs/promises';
import { join, resolve, relative } from 'path';

import type { CliRendererLike, CollectedClass, CommandOptions } from './interfaces';

import { AdapterDefinitionResolver, AstParser, ModuleGraph, type FileAnalysis } from '../compiler/analyzer';
import { validateCreateApplication } from '../compiler/analyzer/validation';
import { ConfigLoader, type ResolvedConfig } from '../config';
import type { ConfigSource } from '../config/interfaces';
import { outputDirPath, scanGlobSorted, writeIfChanged } from '../common';
import { isErr } from '@zipbul/result';
import { buildDiagnostic, DiagnosticError } from '../diagnostics';
import { EntryGenerator, ManifestGenerator } from '../compiler/generator';
import { Gildash, GildashError, type GildashOptions } from '@zipbul/gildash';
import type { IndexResult } from '@zipbul/gildash';

import { buildFileAnalysis } from './build-analysis';
import { writeInterfaceCatalog, removeInterfaceCatalog, writeRuntimeReport, removeRuntimeReport } from './build-artifact-writer';
import { formatCount, buildModuleTree } from './module-tree-renderer';
import { buildDevIncrementalImpactLog } from './dev-incremental-impact';
import { DevProcessManager } from './dev-process-manager';
import { CliRenderer } from './cli-renderer';

// ---------------------------------------------------------------------------
// DI factory types
// ---------------------------------------------------------------------------

export interface DevCommandDeps {
  loadConfig: () => Promise<{ config: ResolvedConfig; source: ConfigSource }>;
  createParser: () => AstParser;
  createAdapterDefinitionResolver: () => AdapterDefinitionResolver;
  createManifestGenerator: () => ManifestGenerator;
  createEntryGenerator: () => EntryGenerator;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
  createGildash?: (opts: GildashOptions) => Promise<Gildash>;
  spawnProcess?: (command: string[], cwd: string) => Subprocess;
  renderer: CliRendererLike;
}

export function createDevCommand(deps: DevCommandDeps) {
  const { renderer } = deps;

  return async function dev(commandOptions?: CommandOptions): Promise<void> {
    renderer.intro('dev');

    const configResult = await deps.loadConfig();
    const config = configResult.config;
    const moduleFileName = config.module.fileName;
    const buildProfile = commandOptions?.profile ?? 'full';
    const projectRoot = process.cwd();
    const srcDir = resolve(projectRoot, config.sourceDir);
    const outDir = outputDirPath(projectRoot);
    const parser = deps.createParser();
    const adapterDefinitionResolver = deps.createAdapterDefinitionResolver();
    const manifestGen = deps.createManifestGenerator();
    const entryGen = deps.createEntryGenerator();
    const fileCache = new Map<string, FileAnalysis>();
    const fingerprintCache = new Map<string, string>();

    function computeStructuralFingerprint(analysis: FileAnalysis): string {
      const { filePath: _, ...structural } = analysis;
      return JSON.stringify(structural);
    }

    const toProjectRelativePath = (filePath: string): string => {
      return relative(projectRoot, filePath) || '.';
    };

    async function analyzeFile(filePath: string) {
      try {
        const fileContent = await Bun.file(filePath).text();
        const parseResult = parser.parse(filePath, fileContent);

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

    interface RebuildResult {
      graph: ModuleGraph;
      handlerIndex: readonly { id: string }[];
    }

    async function rebuild(): Promise<RebuildResult> {
      // File-level import cycle detection (treated as build error, watcher stays alive)
      try {
        const hasCycle = await ledger.hasCycle();
        if (hasCycle) {
          const cyclePaths = await ledger.getCyclePaths(undefined, { maxCycles: 3 });
          const summary = cyclePaths.map(c => c.join(' \u2192 ')).join('\n');
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

      const fileMap = new Map(fileCache.entries());
      const graph = new ModuleGraph(fileMap, moduleFileName, srcDir, ledger);

      graph.build();

      try {
        await graph.validateInheritedScopes();
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Scope validation failed.';
        throw new DiagnosticError(buildDiagnostic({ reason }));
      }

      const adapterResolution = await adapterDefinitionResolver.resolve({ fileMap, projectRoot });

      if (isErr(adapterResolution)) {
        throw new DiagnosticError(adapterResolution.data);
      }

      const controllerDecoratorNames = Object.values(adapterResolution.adapterStaticSchemas)
        .map(schema => schema.entryDecorators.controller);

      graph.registerControllers(controllerDecoratorNames);

      const manifestJson = manifestGen.generateJson({
        graph,
        projectRoot,
        source: configResult.source,
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

      const runtimeResult = manifestGen.generate(graph, allClasses, outDir, resolvedHandlerIndex, adapterResolution.routeRegistrations);

      if (isErr(runtimeResult)) {
        throw new DiagnosticError(runtimeResult.data);
      }

      await writeIfChanged(join(outDir, 'runtime.ts'), runtimeResult);

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

    function shouldAnalyzeFile(filePath: string): boolean {
      if (filePath.endsWith('.d.ts')) {
        return false;
      }

      if (filePath.endsWith('.spec.ts') || filePath.endsWith('.test.ts')) {
        return false;
      }

      return true;
    }

    const fmt = formatCount;

    renderer.outputPaths('📂 Project', [
      { label: 'Root', value: projectRoot },
      { label: 'Source', value: relative(projectRoot, srcDir) || '.' },
      { label: 'Output', value: relative(projectRoot, outDir) || '.' },
    ]);

    // ── 1. Scan ──
    const scanSpinner = renderer.startSpinner('🔍 Scanning source files');

    const glob = new Glob('**/*.ts');
    const srcFiles = await deps.scanFiles({ glob, baseDir: srcDir });
    let classCount = 0;

    for (const file of srcFiles) {
      const fullPath = join(srcDir, file);

      if (!shouldAnalyzeFile(fullPath)) {
        continue;
      }

      await analyzeFile(fullPath);
    }

    for (const analysis of fileCache.values()) {
      classCount += analysis.classes.length;
    }

    scanSpinner.stop(`🔍 Scanned ${fmt(fileCache.size)} files (${fmt(classCount)} classes)`);

    const appEntry = validateCreateApplication(fileCache);

    if (isErr(appEntry)) {
      throw new DiagnosticError(appEntry.data);
    }

    // ── 2. Gildash init ──
    const gildashSpinner = renderer.startSpinner('Initializing code intelligence');
    const ignorePatterns = ['dist', '.zipbul', '.gildash'];
    const openGildash = deps.createGildash ?? ((opts: GildashOptions) => Gildash.open(opts));
    let ledger: Gildash;
    let semanticAvailable = true;
    try {
      ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true });
    } catch (e) {
      if (e instanceof GildashError && e.type === 'semantic') {
        semanticAvailable = false;
        renderer.warn(`Semantic mode unavailable, falling back: ${e.message}`);
        ledger = await openGildash({ projectRoot, ignorePatterns });
      } else {
        throw e;
      }
    }
    gildashSpinner.stop('Code intelligence ready');

    const unsubscribeError = ledger.onError((error) => {
      renderer.warn(`Gildash: ${error.message}`);
    });

    const unsubscribeRole = ledger.onRoleChanged((newRole) => {
      if (newRole === 'reader') {
        renderer.warn('Another instance took watcher ownership. File change detection delegated.');
      } else {
        renderer.info('Reacquired watcher ownership.');
      }
    });

    // ── 3. Build + Generate ──
    const buildSpinner = renderer.startSpinner('🧩 Building AOT artifacts');
    const bootStartedAt = performance.now();

    const initialResult = await rebuild();

    const bootDuration = ((performance.now() - bootStartedAt) / 1000).toFixed(1);
    const { graph, handlerIndex } = initialResult;

    let providerCount = 0;
    for (const mod of graph.modules.values()) {
      providerCount += mod.providers.size;
    }

    buildSpinner.stop(`🧩 AOT artifacts generated in ${bootDuration}s (${fmt(graph.modules.size)} modules, ${fmt(providerCount)} providers)`);

    // ── Application tree ──
    const moduleTreeResult = buildModuleTree({ modules: graph.modules, handlerIndex });

    renderer.outputPaths('🧱 Application', moduleTreeResult.treeLines);

    renderer.outputPaths('📋 Artifacts', [
      { label: 'Manifest', value: toProjectRelativePath(join(outDir, 'manifest.json')) },
      { label: 'Runtime', value: toProjectRelativePath(join(outDir, 'runtime.ts')) },
      { label: 'Entry', value: toProjectRelativePath(join(outDir, 'entry.ts')) },
    ]);

    // Start app process
    const processManager = new DevProcessManager({
      entryPath: join(outDir, 'entry.ts'),
      cwd: projectRoot,
      renderer,
      spawnProcess: deps.spawnProcess ?? ((command, cwd) => Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env } })),
    });
    processManager.start();

    renderer.step('Watching for changes...');

    try {
      let lastRebuildFailed = false;
      let indexQueue = Promise.resolve();
      const unsubscribe = ledger.onIndexed((result: IndexResult) => {
        indexQueue = indexQueue.then(async () => {
          renderer.separator();

          // 1. Remove deleted files
          for (const file of result.deletedFiles) {
            fileCache.delete(file);
            fingerprintCache.delete(file);
          }

          if (result.deletedFiles.length > 0) {
            renderer.info(`Deleted: ${result.deletedFiles.map(toProjectRelativePath).join(', ')}`);
          }

          // 2. Log parse-failed files
          for (const file of result.failedFiles) {
            renderer.warn(`File could not be indexed: ${toProjectRelativePath(file)}`);
          }

          // 3. Analyze symbol-level changes (changedSymbols)
          const { added, modified, removed } = result.changedSymbols;

          if (removed.length > 0) {
            const grouped = Map.groupBy(removed, (s) => s.filePath);
            for (const [file, symbols] of grouped) {
              renderer.warn(`Removed: ${symbols.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
            }
          }
          if (modified.length > 0) {
            const grouped = Map.groupBy(modified, (s) => s.filePath);
            for (const [file, symbols] of grouped) {
              renderer.info(`Modified: ${symbols.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
            }
          }
          if (added.length > 0) {
            const grouped = Map.groupBy(added, (s) => s.filePath);
            for (const [file, symbols] of grouped) {
              renderer.info(`Added: ${symbols.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
            }
          }

          // 4. Skip if only non-app files changed
          const hasAppChanges = result.changedFiles.some(shouldAnalyzeFile);
          if (!hasAppChanges && result.deletedFiles.length === 0) {
            renderer.info('No app files changed, skipping restart');
            return;
          }

          // 5. Save fingerprints before re-analyzing changed files
          const oldFingerprints = new Map<string, string>();
          for (const file of result.changedFiles) {
            if (shouldAnalyzeFile(file)) {
              const existing = fingerprintCache.get(file);
              if (existing !== undefined) {
                oldFingerprints.set(file, existing);
              }
            }
          }

          // 6. Re-analyze changed files themselves (getAffected excludes changed files)
          for (const file of result.changedFiles) {
            if (shouldAnalyzeFile(file)) {
              await analyzeFile(file);
            }
          }

          // 7. Compute affected files (file-level)
          let affectedFiles: string[];
          try {
            affectedFiles = await ledger.getAffected(result.changedFiles);
          } catch {
            affectedFiles = [];
          }

          // 8. Save fingerprints + re-analyze affected files
          for (const file of affectedFiles) {
            if (shouldAnalyzeFile(file)) {
              const existing = fingerprintCache.get(file);
              if (existing !== undefined) {
                oldFingerprints.set(file, existing);
              }
              await analyzeFile(file);
            }
          }

          // 9. Determine if structural change occurred
          let needsRebuild = result.deletedFiles.length > 0;

          if (!needsRebuild) {
            for (const [file, oldFp] of oldFingerprints) {
              const newFp = fingerprintCache.get(file);
              if (newFp !== oldFp) {
                needsRebuild = true;
                break;
              }
            }
          }

          // Newly added files (no previous fingerprint) → rebuild required
          if (!needsRebuild) {
            for (const file of result.changedFiles) {
              if (shouldAnalyzeFile(file) && !oldFingerprints.has(file) && fingerprintCache.has(file)) {
                needsRebuild = true;
                break;
              }
            }
          }

          // 10. Conditional rebuild
          if (needsRebuild) {
            const rebuildStartedAt = performance.now();
            const allAffected = [...result.changedFiles, ...affectedFiles];
            const impactLog = buildDevIncrementalImpactLog({
              affectedFiles: allAffected,
              fileCache,
              moduleFileName,
              toProjectRelativePath,
            });

            await rebuild();

            const rebuildDuration = ((performance.now() - rebuildStartedAt) / 1000).toFixed(1);

            const moduleNames = Array.from(impactLog.affectedModules)
              .map(toProjectRelativePath)
              .map(p => p.replace(/\/module\.ts$/, '').replace(/\/__module__\.ts$/, ''))
              .sort();
            const moduleSummary = moduleNames.length > 0 ? moduleNames.join(', ') : '(none)';
            renderer.step(`🧭 ${moduleSummary} → rebuilt (${rebuildDuration}s)`);
          } else {
            renderer.info('No structural changes, skipping rebuild');
          }

          if (lastRebuildFailed) {
            renderer.success('Build recovered');
            lastRebuildFailed = false;
          }

          await processManager.restart();
        }).catch((error) => {
          lastRebuildFailed = true;

          if (error instanceof DiagnosticError) {
            renderer.diagnostic(error.diagnostic);
          } else {
            renderer.error(error instanceof Error ? error.message : 'Unknown index callback error.');
          }

          renderer.warn('Rebuild failed. Keeping previous process running.');
        });
      });

      // Signal handling
      let shuttingDown = false;

      const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;

        renderer.cancelled(`${signal} received. Stopped`);
        await processManager.stop();
        unsubscribe();
        unsubscribeError();
        unsubscribeRole();
        try { await ledger.close(); } catch { /* cleanup failure — ignore */ }
        process.exit(0);
      };

      process.on('SIGINT', () => { void shutdown('SIGINT'); });
      process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    } catch (error) {
      await processManager.stop();
      unsubscribeError();
      unsubscribeRole();
      try { await ledger.close(); } catch { /* cleanup failure — ignore */ }
      throw error;
    }
  };
}

export const __testing__ = { createDevCommand };

export async function dev(commandOptions?: CommandOptions): Promise<void> {
  const impl = createDevCommand({
    loadConfig: async () => {
      const result = await ConfigLoader.load();
      return { config: result.config, source: result.source };
    },
    createParser: () => new AstParser(),
    createAdapterDefinitionResolver: () => new AdapterDefinitionResolver(),
    createManifestGenerator: () => new ManifestGenerator(),
    createEntryGenerator: () => new EntryGenerator(),
    scanFiles: ({ glob, baseDir }) => scanGlobSorted({ glob, baseDir }),
    renderer: new CliRenderer(),
  });
  await impl(commandOptions);
}
