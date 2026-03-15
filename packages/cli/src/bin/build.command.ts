import { Glob } from 'bun';
import { mkdir } from 'fs/promises';
import { join, resolve, dirname, relative } from 'path';
import { gzipSync } from 'node:zlib';

import type { CliRendererLike, CollectedClass, CommandOptions } from './interfaces';

import { isErr } from '@zipbul/result';
import { Gildash, type GildashOptions } from '@zipbul/gildash';
import { AdapterDefinitionResolver, AstParser, ModuleGraph, type FileAnalysis } from '../compiler/analyzer';
import { validateCreateApplication } from '../compiler/analyzer/validation';
import {
  outputDirPath,
  tempDirPath,
  compareCodePoint,
  scanGlobSorted,
  writeIfChanged,
} from '../common';
import { ConfigLoader, type ResolvedConfig } from '../config';
import type { ConfigSource } from '../config/interfaces';
import { buildDiagnostic, DiagnosticError } from '../diagnostics';
import { EntryGenerator, ManifestGenerator } from '../compiler/generator';
import { CliRenderer } from './cli-renderer';
import { buildFileAnalysis } from './build-analysis';
import { writeInterfaceCatalog, removeInterfaceCatalog, writeRuntimeReport, removeRuntimeReport } from './build-artifact-writer';
import { formatCount, buildModuleTree } from './module-tree-renderer';

// ---------------------------------------------------------------------------
// dist → source resolution
// ---------------------------------------------------------------------------

/**
 * Maps a dist/ build output path back to the original TypeScript source.
 *
 * When a package.json `exports` field points to `./dist/index.js`,
 * `Bun.resolveSync` returns the dist path. The AOT compiler needs
 * the TypeScript source, so we check the package root and `src/`
 * for a matching `.ts` file.
 */
async function resolveDistToSource(resolvedPath: string): Promise<string | null> {
  const distSegmentIndex = resolvedPath.lastIndexOf('/dist/');

  if (distSegmentIndex === -1) {
    return null;
  }

  const packageRoot = resolvedPath.slice(0, distSegmentIndex);
  const relative = resolvedPath.slice(distSegmentIndex + 6).replace(/\.js$/, '.ts');

  const rootCandidate = join(packageRoot, relative);

  if (await Bun.file(rootCandidate).exists()) {
    return rootCandidate;
  }

  const srcCandidate = join(packageRoot, 'src', relative);

  if (await Bun.file(srcCandidate).exists()) {
    return srcCandidate;
  }

  return null;
}

// ---------------------------------------------------------------------------
// DI factory types
// ---------------------------------------------------------------------------

export interface BuildCommandDeps {
  loadConfig: () => Promise<{ config: ResolvedConfig; source: ConfigSource }>;
  createParser: () => AstParser;
  createManifestGenerator: () => ManifestGenerator;
  createEntryGenerator: () => EntryGenerator;
  createAdapterDefinitionResolver: () => AdapterDefinitionResolver;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
  resolveImport: (specifier: string, fromDir: string) => string;
  buildBundle: typeof Bun.build;
  createGildash?: (opts: GildashOptions) => Promise<Gildash>;
  renderer: CliRendererLike;
}

export function createBuildCommand(deps: BuildCommandDeps) {
  const { renderer } = deps;

  return async function build(commandOptions?: CommandOptions): Promise<void> {
    renderer.intro('build');
    const buildStartedAt = performance.now();

    try {
      const configResult = await deps.loadConfig();
      const config = configResult.config;
      const moduleFileName = config.module.fileName;
      const buildProfile = commandOptions?.profile ?? 'full';
      const verbose = commandOptions?.verbose === true;
      const projectRoot = process.cwd();
      const srcDir = resolve(projectRoot, config.sourceDir);
      const outDir = resolve(projectRoot, 'dist');
      const zipbulDir = outputDirPath(projectRoot);
      const buildTempDir = tempDirPath(outDir);

      renderer.outputPaths('📂 Project', [
        { label: 'Root', value: projectRoot },
        { label: 'Source', value: relative(projectRoot, srcDir) || '.' },
        { label: 'Output', value: relative(projectRoot, outDir) || '.' },
      ]);

      const parser = deps.createParser();
      const manifestGen = deps.createManifestGenerator();
      const adapterDefinitionResolver = deps.createAdapterDefinitionResolver();
      const fileMap = new Map<string, FileAnalysis>();
      const allClasses: CollectedClass[] = [];

      const scanSpinner = renderer.startSpinner('[1/4] 🔍 Scanning source files');

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

      let queueIndex = 0;

      while (queueIndex < queue.length) {
        const filePath = queue[queueIndex] as string;
        queueIndex++;

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

          const analysis = buildFileAnalysis(filePath, parseResult);

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
              } catch {
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
              } else {
                const sourceCandidate = await resolveDistToSource(resolvedPath);

                if (sourceCandidate !== null) {
                  resolvedPath = sourceCandidate;
                }
              }
            }

            if (resolvedPath && !visited.has(resolvedPath)) {
              if (!resolvedPath.endsWith('.d.ts') && resolvedPath.endsWith('.ts')) {
                const normalizedPath = resolvedPath.replaceAll('\\', '/');
                if (normalizedPath.includes('/node_modules/')) {
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

      scanSpinner.stop(`[1/4] 🔍 Scanned ${formatCount(fileMap.size)} files (${formatCount(allClasses.length)} classes)`);

      const appEntry = validateCreateApplication(fileMap);

      if (isErr(appEntry)) {
        throw new DiagnosticError(appEntry.data);
      }

      const graphSpinner = renderer.startSpinner('[2/4] 🧩 Building module graph');

      // gildash 파일 레벨 순환 감지 + semantic DI 검증
      const openGildash = deps.createGildash ?? ((opts: GildashOptions) => Gildash.open(opts));
      const ignorePatterns = ['dist', '.zipbul', '.gildash'];
      let ledger: Gildash;
      let semanticAvailable = true;

      try {
        ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true, watchMode: false });
      } catch (e) {
        semanticAvailable = false;
        renderer.warn(`Semantic mode unavailable, falling back: ${e instanceof Error ? e.message : 'unknown'}`);
        ledger = await openGildash({ projectRoot, ignorePatterns, watchMode: false });
      }

      const unsubscribeError = ledger.onError((error) => {
        renderer.warn(`Gildash: ${error.message}`);
      });

      try {
        const hasCycle = await ledger.hasCycle();

        if (hasCycle) {
          const cyclePaths = await ledger.getCyclePaths(undefined, { maxCycles: 5 });
          const summary = cyclePaths.map(c => c.join(' → ')).join('\n');

          throw new DiagnosticError(
            buildDiagnostic({ reason: `Circular import chain detected:\n${summary}` }),
          );
        }

        const graph = new ModuleGraph(fileMap, moduleFileName, srcDir, ledger);

        graph.build();
        await graph.validateInheritedScopes();

        const adapterResolution = await adapterDefinitionResolver.resolve({ fileMap, projectRoot });

        if (isErr(adapterResolution)) {
          throw new DiagnosticError(adapterResolution.data);
        }

        let providerCount = 0;
        for (const mod of graph.modules.values()) {
          providerCount += mod.providers.size;
        }
        graphSpinner.stop(`[2/4] 🧩 Module graph built (${formatCount(graph.modules.size)} modules, ${formatCount(providerCount)} providers)`);

        const manifestSpinner = renderer.startSpinner('[3/4] 📋 Generating manifests');

        await mkdir(zipbulDir, { recursive: true });

        const manifestFile = join(zipbulDir, 'manifest.json');
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
        const runtimeResult = manifestGen.generate(graph, allClasses, buildTempDir, resolvedHandlerIndex);

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
          adapterStaticSchemas: adapterResolution.adapterStaticSchemas,
          handlerIndex: adapterResolution.handlerIndex,
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
          await writeInterfaceCatalog({
            modules: graph.modules,
            ledger,
            semanticAvailable,
            projectRoot,
            catalogFilePath: interfaceCatalogFile,
          });
        } else {
          await removeInterfaceCatalog(interfaceCatalogFile);
        }

        if (buildProfile === 'full') {
          await writeRuntimeReport(runtimeReportFile);
        } else {
          await removeRuntimeReport(runtimeReportFile);
        }

        manifestSpinner.stop('[3/4] 📋 Manifests generated');

        const bundleSpinner = renderer.startSpinner('[4/4] 📦 Bundling application');

        const buildResult = await deps.buildBundle({
          entrypoints: [entryPointFile, runtimeFile],
          outdir: outDir,
          target: 'bun',
          splitting: true,
          minify: false,
          sourcemap: 'external',
          naming: '[name].js',
        });

        if (!buildResult.success) {
          const logMessages = buildResult.logs.map(log => log.message).join('\n');
          const reason = logMessages.length > 0 ? `Build failed:\n${logMessages}` : 'Build failed.';

          throw new Error(reason);
        }

        bundleSpinner.stop('[4/4] 📦 Application bundled');

        const moduleTreeResult = buildModuleTree(
          { modules: graph.modules, handlerIndex: adapterResolution.handlerIndex },
          { verbose },
        );

        renderer.outputPaths('🧱 Application', moduleTreeResult.treeLines);

        // ── Output file sizes + gzip ──
        const entryOutputFile = join(outDir, 'entry.js');
        const runtimeOutputFile = join(outDir, 'runtime.js');
        const [entryBuffer, runtimeBuffer] = await Promise.all([
          Bun.file(entryOutputFile).arrayBuffer(),
          Bun.file(runtimeOutputFile).arrayBuffer(),
        ]);
        const manifestBuffer = Buffer.from(manifestJson, 'utf-8');

        const entrySize = entryBuffer.byteLength;
        const runtimeSize = runtimeBuffer.byteLength;
        const manifestSize = manifestBuffer.byteLength;

        const entryGzip = gzipSync(Buffer.from(entryBuffer)).byteLength;
        const runtimeGzip = gzipSync(Buffer.from(runtimeBuffer)).byteLength;
        const manifestGzip = gzipSync(manifestBuffer).byteLength;

        const buildDuration = ((performance.now() - buildStartedAt) / 1000).toFixed(1);
        const warningCount = graph.warnings.length;

        renderer.success(`Build complete in ${buildDuration}s`);

        if (buildProfile === 'full') {
          const filePaths = Array.from(fileMap.keys());
          const metricsResults = await Promise.all(
            filePaths.map(async (filePath) => {
              try {
                const metrics = await ledger.getFanMetrics(filePath);
                return { filePath, fanIn: metrics.fanIn, fanOut: metrics.fanOut };
              } catch {
                return null;
              }
            })
          );

          const highCoupling = metricsResults
            .filter((m): m is NonNullable<typeof m> => m !== null)
            .filter(m => m.fanIn > 10 || m.fanOut > 8)
            .sort((a, b) => (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut))
            .slice(0, 5);

          if (highCoupling.length > 0) {
            renderer.outputPaths('High Coupling', highCoupling.map(m => ({
              label: relative(projectRoot, m.filePath),
              value: `fan-in: ${m.fanIn}, fan-out: ${m.fanOut}`,
            })));
          }

          const complexFiles = filePaths
            .map((filePath) => {
              try {
                return { filePath, stats: ledger.getFileStats(filePath) };
              } catch {
                return null;
              }
            })
            .filter((f): f is NonNullable<typeof f> => f !== null)
            .filter(f => f.stats.symbolCount > 20 || f.stats.lineCount > 500)
            .sort((a, b) => b.stats.symbolCount - a.stats.symbolCount)
            .slice(0, 5);

          if (complexFiles.length > 0) {
            renderer.outputPaths('Complex Files', complexFiles.map(f => ({
              label: relative(projectRoot, f.filePath),
              value: `${f.stats.symbolCount} symbols, ${f.stats.lineCount} lines, ${f.stats.exportedSymbolCount} exports`,
            })));
          }

          try {
            const stats = ledger.getStats();
            renderer.info(`Project: ${stats.fileCount} files, ${stats.symbolCount} symbols`);
          } catch { /* stats failure ignored */ }
        }

        renderer.outputFiles('📦 Output', [
          { name: relative(projectRoot, entryOutputFile), size: entrySize, gzipSize: entryGzip },
          { name: relative(projectRoot, runtimeOutputFile), size: runtimeSize, gzipSize: runtimeGzip },
          { name: relative(projectRoot, manifestFile), size: manifestSize, gzipSize: manifestGzip },
        ]);

        const outroSuffix = warningCount > 0 ? ` with ${String(warningCount)} warnings` : '';
        renderer.outro(`Ready to deploy (profile: ${buildProfile})${outroSuffix}`);
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
    createAdapterDefinitionResolver: () => new AdapterDefinitionResolver(),
    scanFiles: ({ glob, baseDir }) => scanGlobSorted({ glob, baseDir }),
    resolveImport: (specifier, fromDir) => Bun.resolveSync(specifier, fromDir),
    buildBundle: (...args) => Bun.build(...args),
    renderer: new CliRenderer(),
  });

  await impl(commandOptions);
}
