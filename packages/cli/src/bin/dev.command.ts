import { Glob } from 'bun';
import { mkdir, rm } from 'fs/promises';
import { join, resolve, relative } from 'path';

import type { CommandOptions } from './types';

import { AdapterSpecResolver, AstParser, ModuleGraph, type FileAnalysis } from '../compiler/analyzer';
import { validateCreateApplication } from '../compiler/analyzer/validation';
import { ConfigLoader, type ResolvedZipbulConfig } from '../config';
import type { ZipbulConfigSource } from '../config/interfaces';
import { zipbulDirPath, scanGlobSorted, writeIfChanged } from '../common';
import { Logger } from '@zipbul/logger';
import { isErr } from '@zipbul/result';
import { buildDiagnostic, DiagnosticError, reportDiagnostic } from '../diagnostics';
import { ManifestGenerator } from '../compiler/generator';
import { Gildash, type GildashOptions } from '@zipbul/gildash';
import type { IndexResult, SymbolSearchResult } from '@zipbul/gildash';

import { buildDevIncrementalImpactLog } from './dev-incremental-impact';

// ---------------------------------------------------------------------------
// DI factory types
// ---------------------------------------------------------------------------

export interface DevCommandDeps {
  loadConfig: () => Promise<{ config: ResolvedZipbulConfig; source: ZipbulConfigSource }>;
  createParser: () => AstParser;
  createAdapterSpecResolver: () => AdapterSpecResolver;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
  createGildash?: (opts: GildashOptions) => Promise<Gildash>;
}

export function createDevCommand(deps: DevCommandDeps) {
  const logger = new Logger('Dev');

  return async function dev(commandOptions?: CommandOptions): Promise<void> {
    logger.info('Starting Zipbul Dev...');

    try {
      const configResult = await deps.loadConfig();
      const config = configResult.config;
      const moduleFileName = config.module.fileName;
      const buildProfile = commandOptions?.profile ?? 'full';
      const projectRoot = process.cwd();
      const srcDir = resolve(projectRoot, config.sourceDir);
      const outDir = zipbulDirPath(projectRoot);
      const parser = deps.createParser();
      const adapterSpecResolver = deps.createAdapterSpecResolver();
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
        try {
          const fileMap = new Map(fileCache.entries());
          const graph = new ModuleGraph(fileMap, moduleFileName);

          graph.build();

          const adapterSpecResolution = await adapterSpecResolver.resolve({ fileMap, projectRoot });

          if (isErr(adapterSpecResolution)) {
            throw new DiagnosticError(adapterSpecResolution.data);
          }

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
          throw error;
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

      logger.info('🛠️  AOT artifacts generated.');
      logger.info(`   Manifest: ${join(outDir, 'manifest.json')}`);

      const openGildash = deps.createGildash ?? Gildash.open;
      const ledger = await openGildash({
        projectRoot,
        ignorePatterns: ['dist', '.zipbul', '.gildash'],
      });

      try {
        // 심볼 캐시 (diffSymbols용)
        const symbolCache = new Map<string, SymbolSearchResult[]>();
        for (const filePath of fileCache.keys()) {
          try {
            symbolCache.set(filePath, ledger.getSymbolsByFile(filePath));
          } catch { /* 인덱싱 전이라 조회 실패 가능 */ }
        }

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

            // 4. 영향 파일 계산 (파일 레벨)
            const affectedFiles = await ledger.getAffected(result.changedFiles);

            // 5. 영향 파일만 재분석
            for (const file of affectedFiles) {
              if (shouldAnalyzeFile(file)) {
                await analyzeFile(file);
              }
            }

            // 6. 증분 영향 로그 (파일→모듈 매핑)
            const impactLog = buildDevIncrementalImpactLog({
              affectedFiles,
              fileCache,
              moduleFileName,
              toProjectRelativePath,
            });
            logger.info(impactLog.logLine);

            // 7. 재빌드
            await rebuild();
          }).catch((error) => {
            if (error instanceof DiagnosticError) {
              reportDiagnostic(error.diagnostic);
            } else {
              logger.fatal(error instanceof Error ? error.message : 'Unknown index callback error.');
            }
          });
        });

        process.on('SIGINT', () => {
          unsubscribe();
          ledger.close().catch((e) => {
            logger.error(e instanceof Error ? e.message : 'Failed to close gildash.');
          });
        });
      } catch (error) {
        try { await ledger.close(); } catch { /* cleanup 실패 무시 */ }
        throw error;
      }
    } catch (error) {
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
    createAdapterSpecResolver: () => new AdapterSpecResolver(),
    scanFiles: ({ glob, baseDir }) => scanGlobSorted({ glob, baseDir }),
  });
  await impl(commandOptions);
}
