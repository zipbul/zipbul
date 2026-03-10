import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'fs/promises';
import { join, resolve, dirname, relative } from 'path';
import { gzipSync } from 'node:zlib';

import type { CliRendererLike, CollectedClass, CommandOptions } from './interfaces';

import { isErr } from '@zipbul/result';
import { Gildash, type GildashOptions } from '@zipbul/gildash';
import { AdapterDefinitionResolver, AstParser, ModuleGraph, type FileAnalysis } from '../compiler/analyzer';
import type { ModuleNode } from '../compiler/analyzer/graph/module-node';
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
function resolveDistToSource(resolvedPath: string): string | null {
  const distSegmentIndex = resolvedPath.lastIndexOf('/dist/');

  if (distSegmentIndex === -1) {
    return null;
  }

  const packageRoot = resolvedPath.slice(0, distSegmentIndex);
  const relative = resolvedPath.slice(distSegmentIndex + 6).replace(/\.js$/, '.ts');

  const rootCandidate = join(packageRoot, relative);

  if (existsSync(rootCandidate)) {
    return rootCandidate;
  }

  const srcCandidate = join(packageRoot, 'src', relative);

  if (existsSync(srcCandidate)) {
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

  const fmt = (value: number): string => value.toLocaleString('en-US');

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
              } else {
                const sourceCandidate = resolveDistToSource(resolvedPath);

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

      scanSpinner.stop(`[1/4] 🔍 Scanned ${fmt(fileMap.size)} files (${fmt(allClasses.length)} classes)`);

      const appEntry = validateCreateApplication(fileMap);

      if (isErr(appEntry)) {
        throw new DiagnosticError(appEntry.data);
      }

      const graphSpinner = renderer.startSpinner('[2/4] 🧩 Building module graph');

      // gildash 파일 레벨 순환 감지 + semantic DI 검증
      const openGildash = deps.createGildash ?? Gildash.open;
      const ignorePatterns = ['dist', '.zipbul', '.gildash'];
      let ledger: Gildash;

      try {
        ledger = await openGildash({ projectRoot, ignorePatterns, semantic: true });
      } catch (e) {
        renderer.warn(`Semantic mode unavailable, falling back: ${e instanceof Error ? e.message : 'unknown'}`);
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
        graphSpinner.stop(`[2/4] 🧩 Module graph built (${fmt(graph.modules.size)} modules, ${fmt(providerCount)} providers)`);

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

        const pluralize = (count: number, singular: string): string =>
          `${fmt(count)} ${count === 1 ? singular : singular + 's'}`;

        // ── Handlers per controller ──
        const handlersByController = new Map<string, number>();
        for (const handler of adapterResolution.handlerIndex) {
          const hashIndex = handler.id.indexOf('#');
          if (hashIndex !== -1) {
            const className = handler.id.slice(hashIndex + 1).split('.')[0];
            handlersByController.set(className, (handlersByController.get(className) ?? 0) + 1);
          }
        }

        // ── Scope counts ──
        const scopeCounts = { singleton: 0, request: 0, transient: 0 };
        for (const mod of graph.modules.values()) {
          for (const provider of mod.providers.values()) {
            scopeCounts[provider.scope ?? 'singleton']++;
          }
        }

        // ── Adapter summary ──
        const adapterIds = new Set<string>();
        for (const handler of adapterResolution.handlerIndex) {
          adapterIds.add(handler.id.slice(0, handler.id.indexOf(':')));
        }

        // ── Module tree builder (directory-based hierarchy) ──
        const treeLines: Array<{ label: string; value: string }> = [];

        const buildModuleStats = (mod: ModuleNode): string => {
          const parts: string[] = [];
          if (mod.providers.size > 0) {
            parts.push(pluralize(mod.providers.size, 'provider'));
          }
          if (mod.controllers.size > 0) {
            let totalHandlers = 0;
            for (const ctrl of mod.controllers) {
              totalHandlers += handlersByController.get(ctrl) ?? 0;
            }
            parts.push(pluralize(mod.controllers.size, 'controller'));
            if (totalHandlers > 0) {
              parts.push(pluralize(totalHandlers, 'handler'));
            }
          }
          return parts.join(', ');
        };

        // Build parent-child map from directory containment
        const moduleEntries = Array.from(graph.modules.entries())
          .map(([path, mod]) => ({ path, dir: dirname(path), mod }))
          .sort((entryA, entryB) => entryA.dir.length - entryB.dir.length);

        const childrenOf = new Map<string, ModuleNode[]>();

        for (const entry of moduleEntries) {
          childrenOf.set(entry.path, []);
        }

        for (let index = 1; index < moduleEntries.length; index++) {
          const entry = moduleEntries[index];
          let parentPath: string | undefined;

          // Find closest ancestor module by directory containment
          for (let parentIndex = index - 1; parentIndex >= 0; parentIndex--) {
            const candidate = moduleEntries[parentIndex];
            if (entry.dir.startsWith(candidate.dir + '/') || entry.dir === candidate.dir) {
              parentPath = candidate.path;
              break;
            }
          }

          if (parentPath !== undefined) {
            childrenOf.get(parentPath)?.push(entry.mod);
          }
        }

        const walkTree = (mod: ModuleNode, modPath: string, prefix: string, isLast: boolean, isRoot: boolean): void => {
          const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
          const stats = buildModuleStats(mod);
          const label = `${prefix}${connector}${mod.name}`;
          treeLines.push({ label, value: stats });

          const children = (childrenOf.get(modPath) ?? [])
            .sort((childA, childB) => childA.name.localeCompare(childB.name));
          const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

          children.forEach((child, childIndex) => {
            walkTree(child, child.filePath, childPrefix, childIndex === children.length - 1, false);
          });
        };

        // Root = shallowest directory module
        if (moduleEntries.length > 0) {
          const root = moduleEntries[0];
          walkTree(root.mod, root.path, '', true, true);
        }

        // ── Summary line ──
        const scopeParts = Object.entries(scopeCounts)
          .filter(([, count]) => count > 0)
          .map(([scope, count]) => `${fmt(count)} ${scope}`);
        const adapterParts = Array.from(adapterIds)
          .sort()
          .map(id => `${id} (${fmt(handlersByController.size > 0 ? adapterResolution.handlerIndex.filter(h => h.id.startsWith(id + ':')).length : 0)} handlers)`);

        const summaryParts: string[] = [];
        if (scopeParts.length > 0) {
          summaryParts.push(`💉 ${scopeParts.join(', ')}`);
        }
        if (adapterParts.length > 0) {
          summaryParts.push(`🔌 ${adapterParts.join(', ')}`);
        }

        if (verbose) {
          // Verbose: expand providers per module under the tree
          const verboseLines: Array<{ label: string; value: string }> = [...treeLines];

          verboseLines.push({ label: '', value: '' });
          for (const mod of graph.modules.values()) {
            if (mod.providers.size === 0 && mod.controllers.size === 0) {
              continue;
            }
            const items: Array<{ label: string; value: string }> = [];
            for (const [token, provider] of [...mod.providers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
              items.push({ label: `  ${token}`, value: provider.scope ?? 'singleton' });
            }
            for (const ctrl of [...mod.controllers].sort()) {
              const count = handlersByController.get(ctrl) ?? 0;
              items.push({ label: `  ${ctrl}`, value: count > 0 ? pluralize(count, 'handler') : 'controller' });
            }
            verboseLines.push({ label: `${mod.name}`, value: '' });
            verboseLines.push(...items);
          }

          if (summaryParts.length > 0) {
            verboseLines.push({ label: '', value: '' });
            verboseLines.push({ label: summaryParts.join(' · '), value: '' });
          }

          renderer.outputPaths('🧱 Application', verboseLines);
        } else {
          if (summaryParts.length > 0) {
            treeLines.push({ label: '', value: '' });
            treeLines.push({ label: summaryParts.join(' · '), value: '' });
          }

          renderer.outputPaths('🧱 Application', treeLines);
        }

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
        renderer.outputFiles('📦 Output', [
          { name: relative(projectRoot, entryOutputFile), size: entrySize, gzipSize: entryGzip },
          { name: relative(projectRoot, runtimeOutputFile), size: runtimeSize, gzipSize: runtimeGzip },
          { name: relative(projectRoot, manifestFile), size: manifestSize, gzipSize: manifestGzip },
        ]);

        const outroSuffix = warningCount > 0 ? ` with ${String(warningCount)} warnings` : '';
        renderer.outro(`Ready to deploy (profile: ${buildProfile})${outroSuffix}`);
      } finally {
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
