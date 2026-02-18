import { Glob } from 'bun';
import { mkdir, rm } from 'fs/promises';
import { join, resolve, relative } from 'path';

import type { CommandOptions } from './types';

import { AdapterSpecResolver, AstParser, ModuleGraph, type FileAnalysis } from '../compiler/analyzer';
import { validateCreateApplication } from '../compiler/analyzer/validation';
import { ConfigLoader, ConfigLoadError } from '../config';
import { zipbulDirPath, scanGlobSorted, writeIfChanged } from '../common';
import { buildDiagnostic, DiagnosticReportError, reportDiagnostics } from '../diagnostics';
import { ManifestGenerator } from '../compiler/generator';
import * as watcher from '@parcel/watcher';

import { ChangesetWriter, OwnerElection, ProjectWatcher } from '../watcher';
import { zipbulCacheDirPath } from '../common/zipbul-paths';
import { buildDevIncrementalImpactLog } from './dev-incremental-impact';

export async function dev(commandOptions?: CommandOptions) {
  console.info('🚀 Starting Zipbul Dev...');

  try {
    const configResult = await ConfigLoader.load();
    const config = configResult.config;
    const moduleFileName = config.module.fileName;
    const buildProfile = commandOptions?.profile ?? 'full';
    const projectRoot = process.cwd();
    const srcDir = resolve(projectRoot, config.sourceDir);
    const outDir = zipbulDirPath(projectRoot);
    const parser = new AstParser();
    const adapterSpecResolver = new AdapterSpecResolver();
    const fileCache = new Map<string, FileAnalysis>();

    const toProjectRelativePath = (filePath: string): string => {
      return relative(projectRoot, filePath) || '.';
    };

    async function analyzeFile(filePath: string) {
      try {
        const fileContent = await Bun.file(filePath).text();
        const parseResult = parser.parse(filePath, fileContent);
        const analysis: FileAnalysis = {
          filePath,
          classes: parseResult.classes,
          reExports: parseResult.reExports,
          exports: parseResult.exports,
          createApplicationCalls: parseResult.createApplicationCalls,
          defineModuleCalls: parseResult.defineModuleCalls,
          injectCalls: parseResult.injectCalls,
        };

        if (parseResult.imports !== undefined) {
          analysis.imports = parseResult.imports;
        }

        if (parseResult.importEntries !== undefined) {
          analysis.importEntries = parseResult.importEntries;
        }

        if (parseResult.exportedValues !== undefined) {
          analysis.exportedValues = parseResult.exportedValues;
        }

        if (parseResult.localValues !== undefined) {
          analysis.localValues = parseResult.localValues;
        }

        if (parseResult.moduleDefinition !== undefined) {
          analysis.moduleDefinition = parseResult.moduleDefinition;
        }

        fileCache.set(filePath, analysis);

        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown parse error.';
        const diagnostic = buildDiagnostic({
          code: 'PARSE_FAILED',
          severity: 'fatal',
          summary: 'Parse failed.',
          reason,
          file: toProjectRelativePath(filePath),
        });

        reportDiagnostics({ diagnostics: [diagnostic] });

        return false;
      }
    }

    async function rebuild() {
      try {
        const fileMap = new Map(fileCache.entries());
        const graph = new ModuleGraph(fileMap, moduleFileName);

        graph.build();

        const adapterSpecResolution = await adapterSpecResolver.resolve({ fileMap, projectRoot });
        const manifestGen = new ManifestGenerator();
        const manifestJson = manifestGen.generateJson({
          graph,
          projectRoot,
          source: configResult.source,
          resolvedConfig: config,
          adapterStaticSpecs: adapterSpecResolution.adapterStaticSpecs,
          handlerIndex: adapterSpecResolution.handlerIndex,
        });

        await mkdir(outDir, { recursive: true });
        await writeIfChanged(join(outDir, 'manifest.json'), manifestJson);

        if (!['minimal', 'standard', 'full'].includes(buildProfile)) {
          throw new Error(`Invalid build profile: ${buildProfile}`);
        }

        const interfaceCatalogPath = join(outDir, 'interface-catalog.json');
        const runtimeReportPath = join(outDir, 'runtime-report.json');

        if (buildProfile === 'standard' || buildProfile === 'full') {
          const interfaceCatalogJson = JSON.stringify({ schemaVersion: '1', entries: [] }, null, 2);

          await writeIfChanged(interfaceCatalogPath, interfaceCatalogJson);
        } else {
          await rm(interfaceCatalogPath, { force: true });
        }

        if (buildProfile === 'full') {
          const runtimeReportJson = JSON.stringify({ schemaVersion: '1', adapters: [] }, null, 2);

          await writeIfChanged(runtimeReportPath, runtimeReportJson);
        } else {
          await rm(runtimeReportPath, { force: true });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown dev error.';
        const diagnostic = buildDiagnostic({
          code: 'DEV_FAILED',
          severity: 'fatal',
          summary: 'Dev failed.',
          reason,
          file: '.',
        });

        throw new DiagnosticReportError(diagnostic);
      }
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

    const glob = new Glob('**/*.ts');
    const srcFiles = await scanGlobSorted({ glob, baseDir: srcDir });

    for (const file of srcFiles) {
      const fullPath = join(srcDir, file);

      if (!shouldAnalyzeFile(fullPath)) {
        continue;
      }

      await analyzeFile(fullPath);
    }

    validateCreateApplication(fileCache);

    await rebuild();

    console.info('🛠️  AOT artifacts generated.');
    console.info(`   Manifest: ${join(outDir, 'manifest.json')}`);

    const election = new OwnerElection({ projectRoot, pid: process.pid });
    const electionRes = election.acquire();

    if (electionRes.role === 'owner') {
      const changesetWriter = new ChangesetWriter({ projectRoot, nowMs: () => Date.now() });
      const projectWatcher = new ProjectWatcher(srcDir);

      await projectWatcher.start(event => {
        void (async () => {
          const filename = event.filename;
          if (!filename) {
            return;
          }

          const fullPath = join(srcDir, filename);

          if (!shouldAnalyzeFile(fullPath)) {
            return;
          }

          const previousFileMap = new Map(fileCache.entries());

          const exists = await Bun.file(fullPath).exists();
          const isDeleted = event.eventType === 'delete' || (event.eventType === 'rename' && !exists);

          const changesetEvent: 'change' | 'rename' | 'delete' =
            event.eventType === 'change' ? 'change' : isDeleted ? 'delete' : 'rename';

          await changesetWriter.append({
            event: changesetEvent,
            file: toProjectRelativePath(fullPath).replaceAll('\\', '/'),
          });

          if (isDeleted) {
            console.info(`🗑️ File deleted: ${filename}`);
            fileCache.delete(fullPath);
          } else {
            await analyzeFile(fullPath);
          }

          const impactLog = buildDevIncrementalImpactLog({
            previousFileMap,
            nextFileMap: new Map(fileCache.entries()),
            moduleFileName,
            changedFilePath: fullPath,
            isDeleted,
            toProjectRelativePath,
          });

          console.info(impactLog.logLine);

          try {
            await rebuild();
          } catch (error) {
            if (error instanceof DiagnosticReportError) {
              reportDiagnostics({ diagnostics: [error.diagnostic] });
            }

            return;
          }
        })();
      });

      const onSigint = () => {
        void projectWatcher.close();
        election.release();
      };

      process.on('SIGINT', onSigint);
    } else {
      console.info(`👁️  Watcher owner detected (pid=${electionRes.ownerPid}). Running in reader mode.`);

      const cacheDir = zipbulCacheDirPath(projectRoot);

      const subscription = await watcher.subscribe(cacheDir, (_err, events) => {
        void (async () => {
          const hasChangesetEvent = events.some(
            evt => evt.path.endsWith('changeset.jsonl') || evt.path.endsWith('changeset.jsonl.1'),
          );
          if (!hasChangesetEvent) {
            return;
          }

          const previousFileMap = new Map(fileCache.entries());

          // Safe fallback: re-scan & re-analyze all source files.
          fileCache.clear();
          const rescanFiles = await scanGlobSorted({ glob: new Glob('**/*.ts'), baseDir: srcDir });
          for (const file of rescanFiles) {
            const fullPath = join(srcDir, file);
            if (!shouldAnalyzeFile(fullPath)) {
              continue;
            }
            await analyzeFile(fullPath);
          }

          const impactLog = buildDevIncrementalImpactLog({
            previousFileMap,
            nextFileMap: new Map(fileCache.entries()),
            moduleFileName,
            changedFilePath: srcDir,
            isDeleted: false,
            toProjectRelativePath,
          });

          console.info(impactLog.logLine);

          try {
            await rebuild();
          } catch (error) {
            if (error instanceof DiagnosticReportError) {
              reportDiagnostics({ diagnostics: [error.diagnostic] });
            }
          }
        })();
      });

      const onSigint = () => {
        void subscription.unsubscribe();
      };

      process.on('SIGINT', onSigint);
    }
  } catch (error) {
    if (error instanceof DiagnosticReportError) {
      reportDiagnostics({ diagnostics: [error.diagnostic] });

      throw error;
    }

    const sourcePath = error instanceof ConfigLoadError ? error.sourcePath : undefined;
    const file = typeof sourcePath === 'string' && sourcePath.length > 0 ? sourcePath : '.';
    const reason = error instanceof Error ? error.message : 'Unknown dev error.';
    const diagnostic = buildDiagnostic({
      code: 'DEV_FAILED',
      severity: 'fatal',
      summary: 'Dev failed.',
      reason,
      file,
    });

    reportDiagnostics({ diagnostics: [diagnostic] });

    throw error;
  }
}
