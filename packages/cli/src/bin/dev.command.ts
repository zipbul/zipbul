import { Glob, type Subprocess } from 'bun';
import { mkdir, rm } from 'fs/promises';
import { join, resolve, relative } from 'path';

import type { CollectedClass, CommandOptions } from './types';

import { AdapterDefinitionResolver, AstParser, ModuleGraph, type FileAnalysis } from '../compiler/analyzer';
import { validateCreateApplication } from '../compiler/analyzer/validation';
import { ConfigLoader, type ResolvedConfig } from '../config';
import type { ConfigSource } from '../config/interfaces';
import { outputDirPath, scanGlobSorted, writeIfChanged } from '../common';
import { Logger } from '@zipbul/logger';
import { isErr } from '@zipbul/result';
import { buildDiagnostic, DiagnosticError, reportDiagnostic } from '../diagnostics';
import { EntryGenerator, ManifestGenerator } from '../compiler/generator';
import { Gildash, type GildashOptions } from '@zipbul/gildash';
import type { IndexResult, SymbolSearchResult } from '@zipbul/gildash';

import { buildDevIncrementalImpactLog } from './dev-incremental-impact';
import { DevProcessManager } from './dev-process-manager';

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
}

export function createDevCommand(deps: DevCommandDeps) {
  const logger = new Logger('Dev');

  return async function dev(commandOptions?: CommandOptions): Promise<void> {
    logger.info('Starting Zipbul Dev...');

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

    const toProjectRelativePath = (filePath: string): string => {
      return relative(projectRoot, filePath) || '.';
    };

    async function analyzeFile(filePath: string) {
      try {
        const fileContent = await Bun.file(filePath).text();
        const parseResult = parser.parse(filePath, fileContent);

        if (isErr(parseResult)) {
          reportDiagnostic(parseResult.data);

          return false;
        }

        const analysis: FileAnalysis = {
          filePath,
          classes: parseResult.classes,
          reExports: parseResult.reExports,
          exports: parseResult.exports,
        };

        if (parseResult.createApplicationCalls !== undefined) {
          analysis.createApplicationCalls = parseResult.createApplicationCalls;
        }

        if (parseResult.defineModuleCalls !== undefined) {
          analysis.defineModuleCalls = parseResult.defineModuleCalls;
        }

        if (parseResult.injectCalls !== undefined) {
          analysis.injectCalls = parseResult.injectCalls;
        }

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
          reason,
          file: filePath,
          cause: error,
        });

        reportDiagnostic(diagnostic);

        return false;
      }
    }

    async function rebuild() {
      const fileMap = new Map(fileCache.entries());
      const graph = new ModuleGraph(fileMap, moduleFileName, srcDir);

      graph.build();

      const adapterResolution = await adapterDefinitionResolver.resolve({ fileMap, projectRoot });

      if (isErr(adapterResolution)) {
        throw new DiagnosticError(adapterResolution.data);
      }

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

      // runtime.ts 생성
      const allClasses: CollectedClass[] = [];
      for (const [filePath, analysis] of fileMap) {
        for (const classMeta of analysis.classes) {
          allClasses.push({ metadata: classMeta, filePath });
        }
      }

      const runtimeResult = manifestGen.generate(graph, allClasses, outDir);

      if (isErr(runtimeResult)) {
        throw new DiagnosticError(runtimeResult.data);
      }

      await writeIfChanged(join(outDir, 'runtime.ts'), runtimeResult);

      // entry.ts 생성
      const userMain = resolve(projectRoot, config.entry);
      const entryContent = entryGen.generate(userMain, true);

      await writeIfChanged(join(outDir, 'entry.ts'), entryContent);

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
    const srcFiles = await deps.scanFiles({ glob, baseDir: srcDir });

    for (const file of srcFiles) {
      const fullPath = join(srcDir, file);

      if (!shouldAnalyzeFile(fullPath)) {
        continue;
      }

      await analyzeFile(fullPath);
    }

    const appEntry = validateCreateApplication(fileCache);

    if (isErr(appEntry)) {
      throw new DiagnosticError(appEntry.data);
    }

    await rebuild();

    logger.info('AOT artifacts generated.');
    logger.info(`   Manifest:  ${join(outDir, 'manifest.json')}`);
    logger.info(`   Runtime:   ${join(outDir, 'runtime.ts')}`);
    logger.info(`   Entry:     ${join(outDir, 'entry.ts')}`);

    // 앱 프로세스 시작
    const processManager = new DevProcessManager({
      entryPath: join(outDir, 'entry.ts'),
      cwd: projectRoot,
      logger,
      spawnProcess: deps.spawnProcess ?? ((command, cwd) => Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit' })),
    });
    processManager.start();

    let ledger: Gildash;
    try {
      const openGildash = deps.createGildash ?? Gildash.open;
      ledger = await openGildash({
        projectRoot,
        ignorePatterns: ['dist', '.zipbul', '.gildash'],
      });
    } catch (error) {
      await processManager.stop();
      throw error;
    }

    try {
      // 심볼 캐시 (diffSymbols용)
      const symbolCache = new Map<string, SymbolSearchResult[]>();
      for (const filePath of fileCache.keys()) {
        try {
          symbolCache.set(filePath, ledger.getSymbolsByFile(filePath));
        } catch { /* 인덱싱 전이라 조회 실패 가능 */ }
      }

      let lastRebuildFailed = false;
      let indexQueue = Promise.resolve();
      const unsubscribe = ledger.onIndexed((result: IndexResult) => {
        indexQueue = indexQueue.then(async () => {
          // 1. 삭제 파일 제거
          for (const file of result.deletedFiles) {
            fileCache.delete(file);
            symbolCache.delete(file);
          }

          // 2. 파싱 실패 파일 로깅
          for (const file of result.failedFiles) {
            logger.warn(`File could not be indexed: ${toProjectRelativePath(file)}`);
          }

          // 3. 심볼 레벨 변경 분석 (diffSymbols)
          for (const file of result.changedFiles) {
            const before = symbolCache.get(file) ?? [];
            try {
              const after = ledger.getSymbolsByFile(file);
              const diff = ledger.diffSymbols(before, after);

              if (diff.removed.length > 0) {
                logger.warn(`Breaking: removed exports in ${toProjectRelativePath(file)}: ${diff.removed.map(s => s.name).join(', ')}`);
              }
              if (diff.modified.length > 0) {
                logger.info(`Modified: ${diff.modified.map(m => m.after.name).join(', ')} in ${toProjectRelativePath(file)}`);
              }
              if (diff.added.length > 0) {
                logger.info(`Added: ${diff.added.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
              }

              symbolCache.set(file, after);
            } catch (e) {
              logger.warn(`Symbol diff failed for ${toProjectRelativePath(file)}: ${e instanceof Error ? e.message : 'unknown'}`);
            }
          }

          // 4. 변경 파일 자체 재분석 (getAffected는 변경 파일 제외)
          for (const file of result.changedFiles) {
            if (shouldAnalyzeFile(file)) {
              await analyzeFile(file);
            }
          }

          // 5. 영향 파일 계산 (파일 레벨)
          const affectedFiles = await ledger.getAffected(result.changedFiles);

          // 6. 영향 파일 재분석
          for (const file of affectedFiles) {
            if (shouldAnalyzeFile(file)) {
              await analyzeFile(file);
            }
          }

          // 7. 증분 영향 로그 (파일→모듈 매핑)
          const allAffected = [...result.changedFiles, ...affectedFiles];
          const impactLog = buildDevIncrementalImpactLog({
            affectedFiles: allAffected,
            fileCache,
            moduleFileName,
            toProjectRelativePath,
          });
          logger.info(impactLog.logLine);

          // 8. 재빌드 + 프로세스 재시작
          await rebuild();

          if (lastRebuildFailed) {
            logger.info('Build recovered.');
            lastRebuildFailed = false;
          }

          await processManager.restart();
        }).catch((error) => {
          lastRebuildFailed = true;

          if (error instanceof DiagnosticError) {
            reportDiagnostic(error.diagnostic);
          } else {
            logger.error(error instanceof Error ? error.message : 'Unknown index callback error.');
          }

          logger.warn('Rebuild failed. Keeping previous process running.');
        });
      });

      // 시그널 핸들링
      let shuttingDown = false;

      const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;

        logger.info(`${signal} received. Shutting down...`);
        await processManager.stop();
        unsubscribe();
        try { await ledger.close(); } catch { /* cleanup 실패 무시 */ }
        process.exit(0);
      };

      process.on('SIGINT', () => { void shutdown('SIGINT'); });
      process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    } catch (error) {
      await processManager.stop();
      try { await ledger.close(); } catch { /* cleanup 실패 무시 */ }
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
  });
  await impl(commandOptions);
}
