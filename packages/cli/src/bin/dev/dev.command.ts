import { Glob } from 'bun';
import { join, resolve, relative } from 'path';

import type { CommandOptions } from '../interfaces';

import { AdapterDefinitionResolver, AstParser, type FileAnalysis } from '../../compiler/analyzer';
import { validateCreateApplication } from '../../compiler/analyzer/validation';
import { ConfigLoader } from '../../config';
import { outputDirPath, scanGlobSorted, installCancellation, openGildashWithFallback } from '../../common';
import { isErr } from '@zipbul/result';
import { DiagnosticError } from '../../diagnostics';
import { EntryGenerator, ManifestGenerator } from '../../compiler/generator';
import type { IndexResult } from '@zipbul/gildash';

import { formatCount, buildModuleTree } from '../module-tree-renderer';
import { CliRenderer } from '../cli-renderer';

import type { DevCommandDeps, RebuildContext } from './interfaces';
import { shouldAnalyzeFile, analyzeFile, rebuild } from './dev-rebuild-engine';
import { createChangeHandler } from './dev-change-handler';
import { DevProcessManager } from './dev-process-manager';

/**
 * Creates the `dev` command with injected dependencies.
 *
 * @param deps - Factory-style dependencies for testability
 * @returns An async function that runs the dev watcher loop
 * @public
 */
export function createDevCommand(deps: DevCommandDeps) {
  const { renderer } = deps;

  return async function dev(commandOptions?: CommandOptions): Promise<void> {
    renderer.intro('dev');

    const verbose = commandOptions?.verbose === true;
    const configResult = await deps.loadConfig();
    const config = configResult.config;
    const moduleFileName = config.module.fileName;
    const projectRoot = process.cwd();
    const srcDir = resolve(projectRoot, config.sourceDir);
    const outDir = outputDirPath(projectRoot);
    const parser = deps.createParser();
    const adapterDefinitionResolver = deps.createAdapterDefinitionResolver();
    const manifestGen = deps.createManifestGenerator();
    const entryGen = deps.createEntryGenerator();
    const fileCache = new Map<string, FileAnalysis>();
    const fingerprintCache = new Map<string, string>();

    const toProjectRelativePath = (filePath: string): string => {
      return relative(projectRoot, filePath) || '.';
    };

    const fmt = formatCount;

    renderer.outputPaths('\u{1f4c2} Project', [
      { label: 'Root', value: projectRoot },
      { label: 'Source', value: relative(projectRoot, srcDir) || '.' },
      { label: 'Output', value: relative(projectRoot, outDir) || '.' },
    ]);

    // -- 1. Scan --
    const scanSpinner = renderer.startSpinner('\u{1f50d} Scanning source files');

    const glob = new Glob('**/*.ts');
    const srcFiles = await deps.scanFiles({ glob, baseDir: srcDir });
    let classCount = 0;

    const analyzeContext = { parser, fileCache, fingerprintCache, renderer };

    for (const file of srcFiles) {
      const fullPath = join(srcDir, file);

      if (!shouldAnalyzeFile(fullPath)) {
        continue;
      }

      await analyzeFile(fullPath, analyzeContext);
    }

    for (const analysis of fileCache.values()) {
      classCount += analysis.classes.length;
    }

    scanSpinner.stop(`\u{1f50d} Scanned ${fmt(fileCache.size)} files (${fmt(classCount)} classes)`);

    const appEntry = validateCreateApplication(fileCache);

    if (isErr(appEntry)) {
      throw new DiagnosticError(appEntry.data);
    }

    // -- 2. Gildash init --
    const gildashSpinner = renderer.startSpinner('Initializing code intelligence');
    const ignorePatterns = ['dist', '.zipbul', '.gildash'];
    const { ledger, semanticAvailable } = await openGildashWithFallback({
      options: { projectRoot, ignorePatterns },
      renderer,
      ...(deps.createGildash !== undefined ? { open: deps.createGildash } : {}),
    });
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

    // -- 3. Build + Generate --
    const buildSpinner = renderer.startSpinner('\u{1f9e9} Building AOT artifacts');
    const bootStartedAt = performance.now();

    const rebuildContext: RebuildContext = {
      parser,
      adapterDefinitionResolver,
      manifestGen,
      entryGen,
      fileCache,
      fingerprintCache,
      previousSignatures: undefined,
      renderer,
      moduleFileName,
      srcDir,
      outDir,
      projectRoot,
      config,
      configSource: configResult.source,
      semanticAvailable,
      ledger,
    };

    const initialResult = await rebuild(rebuildContext);

    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      ledger.pruneChangelog(oneDayAgo);
    } catch (pruneError) {
      renderer.warn(`Changelog pruning failed: ${pruneError instanceof Error ? pruneError.message : 'unknown'}`);
    }

    const bootDuration = ((performance.now() - bootStartedAt) / 1000).toFixed(1);
    const { graph, handlerIndex } = initialResult;

    let providerCount = 0;
    for (const mod of graph.modules.values()) {
      providerCount += mod.providers.size;
    }

    buildSpinner.stop(`\u{1f9e9} AOT artifacts generated in ${bootDuration}s (${fmt(graph.modules.size)} modules, ${fmt(providerCount)} providers)`);

    if (graph.warnings.length > 0) {
      for (const warning of graph.warnings) {
        renderer.warn(warning);
      }
    }

    // -- Application tree --
    const moduleTreeResult = buildModuleTree({ modules: graph.modules, handlerIndex }, { verbose });

    renderer.outputPaths('\u{1f9f1} Application', moduleTreeResult.treeLines);

    renderer.outputPaths('\u{1f4cb} Artifacts', [
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
      const { handleIndexResult, state: changeHandlerState } = createChangeHandler({
        rebuildContext,
        renderer,
        toProjectRelativePath,
        ledger,
        processManager,
        moduleFileName,
      });

      let indexQueue = Promise.resolve();
      const unsubscribe = ledger.onIndexed((result: IndexResult) => {
        indexQueue = indexQueue.then(async () => {
          await handleIndexResult(result);
        }).catch((error) => {
          changeHandlerState.lastRebuildFailed = true;

          if (error instanceof DiagnosticError) {
            renderer.diagnostic(error.diagnostic);
          } else {
            renderer.error(error instanceof Error ? error.message : 'Unknown index callback error.');
          }

          renderer.warn('Rebuild failed. Keeping previous process running.');
        });
      });

      // Signal handling — share the same primitive used by build commands.
      // Note: dev exits 0 on signal (clean shutdown of watcher), unlike
      // build commands which use 130 to signal interrupted work.
      const cancel = installCancellation({ renderer, signalExitCode: 0 });
      cancel.registerCleanup(async () => {
        await processManager.stop();
        unsubscribe();
        unsubscribeError();
        unsubscribeRole();
        try {
          await ledger.close();
        } catch (e) {
          renderer.warn(e instanceof Error ? e.message : 'Failed to close gildash.');
        }
      });
    } catch (error) {
      await processManager.stop();
      unsubscribeError();
      unsubscribeRole();
      try {
        await ledger.close();
      } catch (e) {
        renderer.warn(e instanceof Error ? e.message : 'Failed to close gildash.');
      }
      throw error;
    }
  };
}

export const __testing__ = { createDevCommand };

/**
 * Production entry point for the `zb dev` command.
 *
 * @param commandOptions - CLI options (profile, verbose, etc.)
 * @public
 */
export async function dev(
  commandOptions?: CommandOptions,
  renderer?: import('../interfaces').CliRendererLike,
): Promise<void> {
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
    renderer: renderer ?? new CliRenderer(),
  });
  await impl(commandOptions);
}
