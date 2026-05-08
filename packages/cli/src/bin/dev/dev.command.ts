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

import { reportDiagnostic, reportDiagnosticError } from '../report-diagnostic';

import type { DevCommandDeps, RebuildContext } from './interfaces';
import { shouldAnalyzeFile, analyzeFile, rebuild } from './dev-rebuild-engine';
import { createChangeHandler } from './dev-change-handler';
import { DevProcessManager } from './dev-process-manager';

/**
 * Creates the `dev` command with injected dependencies.
 *
 * Output uses `dev:` prefix for status, `dev/rebuild:` for rebuild trigger
 * lines that monitor tools can match against. App subprocess output is
 * tagged with `app:` so agents can filter dev watcher events from app
 * events.
 *
 * @param deps - Factory-style dependencies for testability
 * @returns An async function that runs the dev watcher loop
 * @public
 */
export function createDevCommand(deps: DevCommandDeps) {
  return async function dev(commandOptions?: CommandOptions): Promise<void> {
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

    const toProjectRelativePath = (filePath: string): string => relative(projectRoot, filePath) || '.';

    console.log('dev: project=%s source=%s output=%s',
      projectRoot,
      relative(projectRoot, srcDir) || '.',
      relative(projectRoot, outDir) || '.');

    // -- 1. Scan --
    console.time('dev/scan');
    const glob = new Glob('**/*.ts');
    const srcFiles = await deps.scanFiles({ glob, baseDir: srcDir });
    let classCount = 0;

    const analyzeContext = { parser, fileCache, fingerprintCache };

    for (const file of srcFiles) {
      const fullPath = join(srcDir, file);
      if (!shouldAnalyzeFile(fullPath)) continue;
      await analyzeFile(fullPath, analyzeContext);
    }

    for (const analysis of fileCache.values()) classCount += analysis.classes.length;

    console.log('dev: scanned %d files (%d classes)', fileCache.size, classCount);
    console.timeEnd('dev/scan');

    const appEntry = validateCreateApplication(fileCache);
    if (isErr(appEntry)) throw new DiagnosticError(appEntry.data);

    // -- 2. Gildash init --
    console.time('dev/gildash');
    const ignorePatterns = ['dist', '.zipbul', '.gildash'];
    const { ledger, semanticAvailable } = await openGildashWithFallback({
      options: { projectRoot, ignorePatterns },
      ...(deps.createGildash !== undefined ? { open: deps.createGildash } : {}),
    });
    console.log('dev: gildash ready (semantic=%s)', String(semanticAvailable));
    console.timeEnd('dev/gildash');

    const unsubscribeError = ledger.onError((error) => {
      console.error('warn: gildash: %s', error.message);
    });

    const unsubscribeRole = ledger.onRoleChanged((newRole) => {
      if (newRole === 'reader') {
        console.error('warn: another instance took watcher ownership; file change detection delegated');
      } else {
        console.log('dev: reacquired watcher ownership');
      }
    });

    // -- 3. Initial build --
    console.time('dev/boot');
    const rebuildContext: RebuildContext = {
      parser,
      adapterDefinitionResolver,
      manifestGen,
      entryGen,
      fileCache,
      fingerprintCache,
      previousSignatures: undefined,
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
      console.error('warn: changelog pruning failed: %s',
        pruneError instanceof Error ? pruneError.message : 'unknown');
    }

    const { graph } = initialResult;

    let providerCount = 0;
    for (const mod of graph.modules.values()) providerCount += mod.providers.size;

    console.log('dev: %d modules, %d providers', graph.modules.size, providerCount);
    console.timeEnd('dev/boot');

    for (const warning of graph.warnings) {
      console.error('warn: %s', warning);
    }

    if (verbose) {
      for (const m of graph.modules.values()) {
        console.log('module: %s controllers=%d providers=%d',
          m.name, m.controllers.size, m.providers.size);
      }
    }

    console.log('dev: artifacts manifest=%s runtime=%s entry=%s',
      toProjectRelativePath(join(outDir, 'manifest.json')),
      toProjectRelativePath(join(outDir, 'runtime.ts')),
      toProjectRelativePath(join(outDir, 'entry.ts')));

    // Start app process
    const processManager = new DevProcessManager({
      entryPath: join(outDir, 'entry.ts'),
      cwd: projectRoot,
      spawnProcess: deps.spawnProcess ?? ((command, cwd) =>
        Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env } })),
    });
    processManager.start();

    console.log('dev: watching for changes');

    try {
      const { handleIndexResult, state: changeHandlerState } = createChangeHandler({
        rebuildContext,
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
            reportDiagnostic(error.diagnostic);
          } else {
            reportDiagnosticError(error);
          }

          console.error('warn: dev/rebuild failed; keeping previous process running');
        });
      });

      // Signal handling — share the same primitive used by build commands.
      // Note: dev exits 0 on signal (clean shutdown of watcher), unlike
      // build commands which use 130 to signal interrupted work.
      const cancel = installCancellation({ signalExitCode: 0 });
      cancel.registerCleanup(async () => {
        await processManager.stop();
        unsubscribe();
        unsubscribeError();
        unsubscribeRole();
        try {
          await ledger.close();
        } catch (e) {
          console.error('warn: failed to close gildash: %s',
            e instanceof Error ? e.message : 'unknown');
        }
      });
    } catch (error) {
      await processManager.stop();
      unsubscribeError();
      unsubscribeRole();
      try {
        await ledger.close();
      } catch (e) {
        console.error('warn: failed to close gildash: %s',
          e instanceof Error ? e.message : 'unknown');
      }
      throw error;
    }
  };
}

/**
 * Production entry point for the `zb dev` command.
 *
 * @param commandOptions - CLI options (verbose, etc.)
 * @public
 */
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
  });
  await impl(commandOptions);
}
