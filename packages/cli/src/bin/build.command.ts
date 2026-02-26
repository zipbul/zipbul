import { Glob } from 'bun';
import { mkdir, rm } from 'fs/promises';
import { join, resolve, dirname } from 'path';

import type { CollectedClass, CommandOptions } from './types';

import { isErr } from '@zipbul/result';
import { Logger } from '@zipbul/logger';
import { Gildash, type GildashOptions } from '@zipbul/gildash';
import { AdapterSpecResolver, AstParser, ModuleGraph, type FileAnalysis } from '../compiler/analyzer';
import { validateCreateApplication } from '../compiler/analyzer/validation';
import {
  zipbulDirPath,
  zipbulTempDirPath,
  compareCodePoint,
  scanGlobSorted,
  writeIfChanged,
} from '../common';
import { ConfigLoader, type ResolvedZipbulConfig } from '../config';
import type { ZipbulConfigSource } from '../config/interfaces';
import { buildDiagnostic, DiagnosticError } from '../diagnostics';
import { EntryGenerator, ManifestGenerator } from '../compiler/generator';

// ---------------------------------------------------------------------------
// DI factory types
// ---------------------------------------------------------------------------

export interface BuildCommandDeps {
  loadConfig: () => Promise<{ config: ResolvedZipbulConfig; source: ZipbulConfigSource }>;
  createParser: () => AstParser;
  createManifestGenerator: () => ManifestGenerator;
  createEntryGenerator: () => EntryGenerator;
  createAdapterSpecResolver: () => AdapterSpecResolver;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
  resolveImport: (specifier: string, fromDir: string) => string;
  buildBundle: typeof Bun.build;
  createGildash?: (opts: GildashOptions) => Promise<Gildash>;
}

export function createBuildCommand(deps: BuildCommandDeps) {
  const logger = new Logger('Build');

  return async function build(commandOptions?: CommandOptions): Promise<void> {
    logger.info('Starting Zipbul Production Build...');

    try {
      const configResult = await deps.loadConfig();
      const config = configResult.config;
      const moduleFileName = config.module.fileName;
      const buildProfile = commandOptions?.profile ?? 'full';
      const projectRoot = process.cwd();
      const srcDir = resolve(projectRoot, config.sourceDir);
      const outDir = resolve(projectRoot, 'dist');
      const zipbulDir = zipbulDirPath(projectRoot);
      const buildTempDir = zipbulTempDirPath(outDir);

      logger.info(`📂 Project Root: ${projectRoot}`);
      logger.info(`📂 Source Dir: ${srcDir}`);
      logger.info(`📂 Output Dir: ${outDir}`);

      const parser = deps.createParser();
      const manifestGen = deps.createManifestGenerator();
      const adapterSpecResolver = deps.createAdapterSpecResolver();
      const fileMap = new Map<string, FileAnalysis>();
      const allClasses: CollectedClass[] = [];

      logger.info('🔍 Scanning source files...');

      const userMain = resolve(projectRoot, config.entry);
      const visited = new Set<string>();
      const queue: string[] = [userMain];
      const glob = new Glob('**/*.ts');
      const srcFiles = await deps.scanFiles({ glob, baseDir: srcDir });

      for (const file of srcFiles) {
        const fullPath = join(srcDir, file);

        if (fullPath !== userMain) {
          queue.push(fullPath);
        }
      }

      while (queue.length > 0) {
        const filePath = queue.shift();

        if (filePath === undefined) {
          continue;
        }

        if (visited.has(filePath)) {
          continue;
        }

        visited.add(filePath);

        if (!filePath.endsWith('.ts')) {
          continue;
        }

        if (filePath.endsWith('.d.ts')) {
          continue;
        }

        try {
          const fileContent = await Bun.file(filePath).text();
          const parseResult = parser.parse(filePath, fileContent);

          if (isErr(parseResult)) {
            throw new DiagnosticError(parseResult.data);
          }

          const classInfos = parseResult.classes.map(meta => ({ metadata: meta, filePath }));

          allClasses.push(...classInfos);

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

          fileMap.set(filePath, analysis);

          const pathsToFollow = new Set<string>();

          if (parseResult.imports !== undefined) {
            Object.values(parseResult.imports).forEach(p => pathsToFollow.add(p));
          }

          if (parseResult.reExports.length > 0) {
            parseResult.reExports.forEach(re => pathsToFollow.add(re.module));
          }

          const orderedPathsToFollow = Array.from(pathsToFollow).sort(compareCodePoint);

          for (const rawImportPath of orderedPathsToFollow) {
            let resolvedPath = rawImportPath;

            if (!resolvedPath.startsWith('/') && !resolvedPath.match(/^[a-zA-Z]:/)) {
              try {
                resolvedPath = deps.resolveImport(resolvedPath, dirname(filePath));
              } catch (_e) {
                continue;
              }
            }

            if (
              resolvedPath &&
              !resolvedPath.endsWith('.ts') &&
              !resolvedPath.endsWith('.d.ts')
            ) {
              if (await Bun.file(resolvedPath + '.ts').exists()) {
                resolvedPath += '.ts';
              } else if (await Bun.file(resolvedPath + '/index.ts').exists()) {
                resolvedPath += '/index.ts';
              }
            }

            if (resolvedPath && !visited.has(resolvedPath)) {
              if (!resolvedPath.endsWith('.d.ts') && resolvedPath.endsWith('.ts')) {
                const normalizedPath = resolvedPath.replaceAll('\\', '/');
                if (normalizedPath.includes('/node_modules/@types/')) {
                  continue;
                }

                queue.push(resolvedPath);
              }
            }
          }
        } catch (error) {
          if (error instanceof DiagnosticError) {
            throw error;
          }

          const reason = error instanceof Error ? error.message : 'Unknown parse error.';

          throw new DiagnosticError(
            buildDiagnostic({ reason, file: filePath }),
            { cause: error },
          );
        }
      }

      const appEntry = validateCreateApplication(fileMap);

      if (isErr(appEntry)) {
        throw new DiagnosticError(appEntry.data);
      }

      logger.info('🕸️  Building Module Graph...');

      // gildash 파일 레벨 순환 감지 + semantic DI 검증
      const openGildash = deps.createGildash ?? Gildash.open;
      const ignorePatterns = ['dist', '.zipbul', '.gildash'];
      let ledger: Gildash;

      try {
        ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true });
      } catch (e) {
        logger.warn(`Semantic mode unavailable, falling back: ${e instanceof Error ? e.message : 'unknown'}`);
        ledger = await openGildash({ projectRoot, ignorePatterns });
      }

      try {
        const hasCycle = await ledger.hasCycle();

        if (hasCycle) {
          const cyclePaths = await ledger.getCyclePaths(undefined, { maxCycles: 5 });
          const summary = cyclePaths.map(c => c.join(' → ')).join('\n');

          throw new DiagnosticError(
            buildDiagnostic({ reason: `Circular import chain detected:\n${summary}` }),
          );
        }

        const graph = new ModuleGraph(fileMap, moduleFileName, ledger);

        graph.build();
        await graph.validateInheritedScopes();

        const adapterSpecResolution = await adapterSpecResolver.resolve({ fileMap, projectRoot });

        if (isErr(adapterSpecResolution)) {
          throw new DiagnosticError(adapterSpecResolution.data);
        }

        logger.info('🛠️  Generating intermediate manifests...');

        await mkdir(zipbulDir, { recursive: true });

        const manifestFile = join(zipbulDir, 'manifest.json');
        const manifestJson = manifestGen.generateJson({
          graph,
          projectRoot,
          source: configResult.source,
          resolvedConfig: config,
          adapterStaticSpecs: adapterSpecResolution.adapterStaticSpecs,
          handlerIndex: adapterSpecResolution.handlerIndex,
        });

        await writeIfChanged(manifestFile, manifestJson);
        await mkdir(buildTempDir, { recursive: true });

        const runtimeFile = join(buildTempDir, 'runtime.ts');
        const runtimeResult = manifestGen.generate(graph, allClasses, buildTempDir);

        if (isErr(runtimeResult)) {
          throw new DiagnosticError(runtimeResult.data);
        }

        await writeIfChanged(runtimeFile, runtimeResult);

        const entryPointFile = join(buildTempDir, 'entry.ts');
        const entryGen = deps.createEntryGenerator();
        const buildEntryContent = entryGen.generate(userMain, false);

        await writeIfChanged(entryPointFile, buildEntryContent);

        const manifestJsonGuard = manifestGen.generateJson({
          graph,
          projectRoot,
          source: configResult.source,
          resolvedConfig: config,
          adapterStaticSpecs: adapterSpecResolution.adapterStaticSpecs,
          handlerIndex: adapterSpecResolution.handlerIndex,
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
          const interfaceCatalogJson = JSON.stringify({ schemaVersion: '1', entries: [] }, null, 2);

          await writeIfChanged(interfaceCatalogFile, interfaceCatalogJson);
        } else {
          await rm(interfaceCatalogFile, { force: true });
        }

        if (buildProfile === 'full') {
          const runtimeReportJson = JSON.stringify({ schemaVersion: '1', adapters: [] }, null, 2);

          await writeIfChanged(runtimeReportFile, runtimeReportJson);
        } else {
          await rm(runtimeReportFile, { force: true });
        }

        logger.info('📦 Bundling application and manifest...');

        const buildResult = await deps.buildBundle({
          entrypoints: [entryPointFile, runtimeFile],
          outdir: outDir,
          target: 'bun',
          minify: false,
          sourcemap: 'external',
          naming: '[name].js',
        });

        if (!buildResult.success) {
          const logMessages = buildResult.logs.map(log => log.message).join('\n');
          const reason = logMessages.length > 0 ? `Build failed:\n${logMessages}` : 'Build failed.';

          throw new Error(reason);
        }

        logger.info('✅ Build Complete!');
        logger.info(`   Entry: ${join(outDir, 'entry.js')}`);
        logger.info(`   Runtime: ${join(outDir, 'runtime.js')}`);
        logger.info(`   Manifest: ${manifestFile}`);
      } finally {
        try {
          await ledger.close();
        } catch (e) {
          logger.error(e instanceof Error ? e.message : 'Failed to close gildash.');
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
// Default export — maintains backward compatibility
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
    createAdapterSpecResolver: () => new AdapterSpecResolver(),
    scanFiles: ({ glob, baseDir }) => scanGlobSorted({ glob, baseDir }),
    resolveImport: (specifier, fromDir) => Bun.resolveSync(specifier, fromDir),
    buildBundle: (...args) => Bun.build(...args),
  });

  await impl(commandOptions);
}
