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
import type { Result } from '@zipbul/result';
import { isErr } from '@zipbul/result';
import type { Diagnostic } from '../diagnostics';
import { buildDiagnostic, reportDiagnostic, DiagnosticCode } from '../diagnostics';
import { ManifestGenerator } from '../compiler/generator';
import { GildashProvider, type GildashProviderOptions } from '../compiler/gildash-provider';
import type { IndexResult } from '@zipbul/gildash';

import { buildDevIncrementalImpactLog } from './dev-incremental-impact';

// ---------------------------------------------------------------------------
// DI factory types
// ---------------------------------------------------------------------------

export interface DevCommandDeps {
  loadConfig: () => Promise<{ config: ResolvedZipbulConfig; source: ZipbulConfigSource }>;
  createParser: () => AstParser;
  createAdapterSpecResolver: () => AdapterSpecResolver;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
  createGildashProvider?: (opts: GildashProviderOptions) => Promise<Result<GildashProvider, Diagnostic>>;
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
            code: DiagnosticCode.BuildParseFailed,
            severity: 'error',
            reason,
            file: filePath,
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
            reportDiagnostic(adapterSpecResolution.data);
            throw new Error(adapterSpecResolution.data.reason);
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
          const reason = error instanceof Error ? error.message : 'Unknown dev error.';
          const diagnostic = buildDiagnostic({
            code: DiagnosticCode.DevFailed,
            severity: 'error',
            reason,
          });

          reportDiagnostic(diagnostic);
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
        reportDiagnostic(appEntry.data);
        throw new Error(appEntry.data.reason);
      }

      await rebuild();

      logger.info('🛠️  AOT artifacts generated.');
      logger.info(`   Manifest: ${join(outDir, 'manifest.json')}`);

      const openGildash = deps.createGildashProvider ?? GildashProvider.open;
      const ledgerResult = await openGildash({
        projectRoot,
        ignorePatterns: ['dist', 'node_modules', '.zipbul'],
      });

      if (isErr(ledgerResult)) {
        reportDiagnostic(ledgerResult.data);
        throw new Error(ledgerResult.data.reason);
      }

      const ledger = ledgerResult;

      const unsubscribe = ledger.onIndexed(async (result: IndexResult) => {
        // 1. 삭제 파일 제거
        for (const file of result.deletedFiles) {
          fileCache.delete(file);
        }

        // 2. 파싱 실패 파일 로깅
        for (const file of result.failedFiles) {
          const diagnostic = buildDiagnostic({
            code: DiagnosticCode.DevGildashParse,
            severity: 'warning',
            reason: `File could not be indexed: ${toProjectRelativePath(file)}`,
            file,
          });
          reportDiagnostic(diagnostic);
        }

        // 3. 영향 파일 계산 (파일 레벨)
        const affectedResult = await ledger.getAffected(result.changedFiles);

        if (isErr(affectedResult)) {
          reportDiagnostic(affectedResult.data);

          return;
        }

        const affectedFiles = affectedResult;

        // 4. 영향 파일만 재분석
        for (const file of affectedFiles) {
          if (shouldAnalyzeFile(file)) {
            await analyzeFile(file);
          }
        }

        // 5. 증분 영향 로그 (파일→모듈 매핑)
        const impactLog = buildDevIncrementalImpactLog({
          affectedFiles,
          fileCache,
          moduleFileName,
          toProjectRelativePath,
        });
        logger.info(impactLog.logLine);

        // 6. 재빌드
        try {
          await rebuild();
        } catch {
          // rebuild() already reports diagnostics internally
        }
      });

      process.on('SIGINT', () => {
        unsubscribe();
        void ledger.close();
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown dev error.';
      const diagnostic = buildDiagnostic({
        code: DiagnosticCode.DevFailed,
        severity: 'error',
        reason,
      });

      reportDiagnostic(diagnostic);

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
