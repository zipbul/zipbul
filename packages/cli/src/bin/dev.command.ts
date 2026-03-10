import { Glob, type Subprocess } from 'bun';
import { mkdir, rm } from 'fs/promises';
import { join, resolve, dirname, relative } from 'path';

import type { CliRendererLike, CollectedClass, CommandOptions } from './interfaces';

import { AdapterDefinitionResolver, AstParser, ModuleGraph, type FileAnalysis } from '../compiler/analyzer';
import type { ModuleNode } from '../compiler/analyzer/graph/module-node';
import { validateCreateApplication } from '../compiler/analyzer/validation';
import { ConfigLoader, type ResolvedConfig } from '../config';
import type { ConfigSource } from '../config/interfaces';
import { outputDirPath, scanGlobSorted, writeIfChanged } from '../common';
import { isErr } from '@zipbul/result';
import { buildDiagnostic, DiagnosticError } from '../diagnostics';
import { EntryGenerator, ManifestGenerator } from '../compiler/generator';
import { Gildash, type GildashOptions } from '@zipbul/gildash';
import type { IndexResult, SymbolSearchResult } from '@zipbul/gildash';

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

        renderer.diagnostic(diagnostic);

        return false;
      }
    }

    interface RebuildResult {
      graph: ModuleGraph;
      handlerIndex: readonly { id: string }[];
    }

    async function rebuild(): Promise<RebuildResult> {
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

    const fmt = (value: number): string => value.toLocaleString('en-US');
    const pluralize = (count: number, singular: string): string =>
      `${fmt(count)} ${count === 1 ? singular : singular + 's'}`;

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

    // ── 2. Build + Generate ──
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
    const handlersByController = new Map<string, number>();
    for (const handler of handlerIndex) {
      const hashIndex = handler.id.indexOf('#');
      if (hashIndex !== -1) {
        const className = handler.id.slice(hashIndex + 1).split('.')[0];
        handlersByController.set(className, (handlersByController.get(className) ?? 0) + 1);
      }
    }

    const scopeCounts = { singleton: 0, request: 0, transient: 0 };
    for (const mod of graph.modules.values()) {
      for (const provider of mod.providers.values()) {
        scopeCounts[provider.scope ?? 'singleton']++;
      }
    }

    const adapterIds = new Set<string>();
    for (const handler of handlerIndex) {
      adapterIds.add(handler.id.slice(0, handler.id.indexOf(':')));
    }

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

    if (moduleEntries.length > 0) {
      const root = moduleEntries[0];
      walkTree(root.mod, root.path, '', true, true);
    }

    const scopeParts = Object.entries(scopeCounts)
      .filter(([, count]) => count > 0)
      .map(([scope, count]) => `${fmt(count)} ${scope}`);
    const adapterParts = Array.from(adapterIds)
      .sort()
      .map(id => `${id} (${fmt(handlerIndex.filter(h => h.id.startsWith(id + ':')).length)} handlers)`);

    const summaryParts: string[] = [];
    if (scopeParts.length > 0) {
      summaryParts.push(`💉 ${scopeParts.join(', ')}`);
    }
    if (adapterParts.length > 0) {
      summaryParts.push(`🔌 ${adapterParts.join(', ')}`);
    }
    if (summaryParts.length > 0) {
      treeLines.push({ label: '', value: '' });
      treeLines.push({ label: summaryParts.join(' · '), value: '' });
    }

    renderer.outputPaths('🧱 Application', treeLines);

    renderer.outputPaths('📋 Artifacts', [
      { label: 'Manifest', value: toProjectRelativePath(join(outDir, 'manifest.json')) },
      { label: 'Runtime', value: toProjectRelativePath(join(outDir, 'runtime.ts')) },
      { label: 'Entry', value: toProjectRelativePath(join(outDir, 'entry.ts')) },
    ]);

    // 앱 프로세스 시작
    const processManager = new DevProcessManager({
      entryPath: join(outDir, 'entry.ts'),
      cwd: projectRoot,
      renderer,
      spawnProcess: deps.spawnProcess ?? ((command, cwd) => Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env } })),
    });
    processManager.start();
    renderer.step('Watching for changes...');

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
          renderer.separator();

          // 1. 삭제 파일 제거
          for (const file of result.deletedFiles) {
            fileCache.delete(file);
            symbolCache.delete(file);
          }

          if (result.deletedFiles.length > 0) {
            renderer.info(`Deleted: ${result.deletedFiles.map(toProjectRelativePath).join(', ')}`);
          }

          // 2. 파싱 실패 파일 로깅
          for (const file of result.failedFiles) {
            renderer.warn(`File could not be indexed: ${toProjectRelativePath(file)}`);
          }

          // 3. 심볼 레벨 변경 분석 (diffSymbols)
          for (const file of result.changedFiles) {
            const before = symbolCache.get(file) ?? [];
            try {
              const after = ledger.getSymbolsByFile(file);
              const diff = ledger.diffSymbols(before, after);

              if (diff.removed.length > 0) {
                renderer.warn(`Removed: ${diff.removed.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
              }
              if (diff.modified.length > 0) {
                renderer.info(`Modified: ${diff.modified.map(m => m.after.name).join(', ')} in ${toProjectRelativePath(file)}`);
              }
              if (diff.added.length > 0) {
                renderer.info(`Added: ${diff.added.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
              }

              symbolCache.set(file, after);
            } catch (e) {
              renderer.warn(`Symbol diff failed for ${toProjectRelativePath(file)}: ${e instanceof Error ? e.message : 'unknown'}`);
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

          // 7. 증분 영향 로그 (파일→모듈 매핑) + 재빌드
          const rebuildStartedAt = performance.now();
          const allAffected = [...result.changedFiles, ...affectedFiles];
          const impactLog = buildDevIncrementalImpactLog({
            affectedFiles: allAffected,
            fileCache,
            moduleFileName,
            toProjectRelativePath,
          });

          // 8. 재빌드 + 프로세스 재시작
          await rebuild();

          const rebuildDuration = ((performance.now() - rebuildStartedAt) / 1000).toFixed(1);

          // 영향 모듈명 요약 (파일 경로 대신 디렉토리 기반 모듈명)
          const moduleNames = Array.from(impactLog.affectedModules)
            .map(toProjectRelativePath)
            .map(p => p.replace(/\/module\.ts$/, '').replace(/\/__module__\.ts$/, ''))
            .sort();
          const moduleSummary = moduleNames.length > 0 ? moduleNames.join(', ') : '(none)';
          renderer.step(`🧭 ${moduleSummary} → rebuilt (${rebuildDuration}s)`);

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

      // 시그널 핸들링
      let shuttingDown = false;

      const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;

        renderer.cancelled(`${signal} received. Stopped`);
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
    renderer: new CliRenderer(),
  });
  await impl(commandOptions);
}
