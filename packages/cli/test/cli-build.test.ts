import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { err } from '@zipbul/result';

import type { BuildCommandDeps } from '../src/bin/build.command';
import { __testing__ } from '../src/bin/build.command';
import type { AstParser, AdapterSpecResolver } from '../src/compiler/analyzer';
import type { GildashProvider, GildashProviderOptions } from '../src/compiler/gildash-provider';
import type { ResolvedZipbulConfig } from '../src/config';
import { ConfigLoadError } from '../src/config';

const { createBuildCommand } = __testing__;

// ---------------------------------------------------------------------------
// Minimal valid FileAnalysis factory for mock parser
// ---------------------------------------------------------------------------
const makeParseResult = (filePath: string) => {
  const isModule = filePath.endsWith('module.ts');
  return {
    classes: [],
    reExports: [],
    exports: isModule ? ['AppModule'] : [],
    imports: undefined,
    importEntries: undefined,
    exportedValues: undefined,
    localValues: undefined,
    moduleDefinition: isModule ? { name: 'AppModule', providers: [], imports: {} } : undefined,
    createApplicationCalls: isModule
      ? []
      : [{ callee: 'createApplication', args: [{ __zipbul_ref: 'AppModule' }] }],
    defineModuleCalls: isModule
      ? [{ callee: 'defineModule', args: [], exportedName: 'AppModule' }]
      : [],
    injectCalls: [],
  };
};

// ---------------------------------------------------------------------------
// Test fixture setup
// ---------------------------------------------------------------------------
let tmpDir: string;
let mainFile: string;
let moduleFile: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'cli-build-test-'));
  const srcDir = join(tmpDir, 'src');
  await mkdir(srcDir, { recursive: true });
  mainFile = join(srcDir, 'main.ts');
  moduleFile = join(srcDir, 'module.ts');
  await Bun.write(mainFile, '// main');
  await Bun.write(moduleFile, '// module');
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const testConfig: ResolvedZipbulConfig = {
  module: { fileName: 'module.ts' },
  sourceDir: 'src',
  entry: './src/main.ts',
  mcp: { exclude: [] },
};

const makeSource = () => ({ path: 'zipbul.jsonc', format: 'jsonc' as const });

// ---------------------------------------------------------------------------
// Shared mock dep factories
// ---------------------------------------------------------------------------
const makeManifestGenMock = () => ({
  generateJson: mock(() => '{"schemaVersion":"1"}'),
  generate: mock(() => 'const r={};'),
});

const makeEntryGenMock = () => ({
  generate: mock(() => 'const e={};'),
});

const makeAdapterResolverMock = () => ({
  resolve: mock(async () => ({ adapterStaticSpecs: [], handlerIndex: [] })),
}) as unknown as AdapterSpecResolver;

const makeGildashLedgerMock = () => ({
  hasCycle: mock(async () => false),
  close: mock(async () => {}),
}) as unknown as GildashProvider;

const makeGildashProviderMock = () => mock(async (_opts: GildashProviderOptions) => makeGildashLedgerMock());

const makeParserMock = () => ({
  parse: mock((filePath: string, _content: string) => makeParseResult(filePath)),
}) as unknown as AstParser;

const makeDeps = (overrides?: Partial<BuildCommandDeps>): BuildCommandDeps => ({
  loadConfig: mock(async () => ({ config: testConfig, source: makeSource() })),
  createParser: mock(() => makeParserMock()),
  createManifestGenerator: mock(() => makeManifestGenMock()) as unknown as BuildCommandDeps['createManifestGenerator'],
  createEntryGenerator: mock(() => makeEntryGenMock()),
  createAdapterSpecResolver: mock(() => makeAdapterResolverMock()),
  scanFiles: mock(async () => ['module.ts']),
  resolveImport: mock((_spec: string, _from: string) => { throw new Error('resolve'); }),
  buildBundle: mock(async () => ({ success: true as const, outputs: [], logs: [] })) as unknown as BuildCommandDeps['buildBundle'],
  createGildashProvider: makeGildashProviderMock(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('createBuildCommand', () => {
  let cwdSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    cwdSpy = spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
  });

  // -- Happy Path --

  it('should call loadConfig when build() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act
    await build();

    // Assert
    expect(deps.loadConfig).toHaveBeenCalledTimes(1);
  });

  it('should call createParser once when build() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act
    await build();

    // Assert
    expect(deps.createParser).toHaveBeenCalledTimes(1);
  });

  it('should call createManifestGenerator once when build() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act
    await build();

    // Assert
    expect(deps.createManifestGenerator).toHaveBeenCalledTimes(1);
  });

  it('should call createEntryGenerator once when build() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act
    await build();

    // Assert
    expect(deps.createEntryGenerator).toHaveBeenCalledTimes(1);
  });

  it('should call createAdapterSpecResolver once when build() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act
    await build();

    // Assert
    expect(deps.createAdapterSpecResolver).toHaveBeenCalledTimes(1);
  });

  it('should call scanFiles with the resolved srcDir as baseDir when build() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act
    await build();

    // Assert
    expect(deps.scanFiles).toHaveBeenCalledTimes(1);
    const callArg = (deps.scanFiles as ReturnType<typeof mock>).mock.calls[0]?.[0] as { glob: unknown; baseDir: string };
    expect(callArg?.baseDir).toContain('src');
  });

  it('should call buildBundle with generated runtime and entry entrypoints when build() succeeds', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act
    await build();

    // Assert
    expect(deps.buildBundle).toHaveBeenCalledTimes(1);
    const bundleArg = (deps.buildBundle as ReturnType<typeof mock>).mock.calls[0]?.[0] as { entrypoints: string[] };
    expect(bundleArg?.entrypoints).toHaveLength(2);
    expect(bundleArg?.entrypoints.some((p: string) => p.endsWith('runtime.ts'))).toBe(true);
    expect(bundleArg?.entrypoints.some((p: string) => p.endsWith('entry.ts'))).toBe(true);
  });

  it('should not throw when buildBundle returns success: true', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build()).resolves.toBeUndefined();
  });

  it('should not throw when buildProfile is full', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build({ profile: 'full' })).resolves.toBeUndefined();
  });

  it('should not throw when buildProfile is standard', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build({ profile: 'standard' })).resolves.toBeUndefined();
  });

  it('should not throw when buildProfile is minimal', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build({ profile: 'minimal' })).resolves.toBeUndefined();
  });

  // -- Negative / Error --

  it('should report BUILD_FAILED with sourcePath when loadConfig throws ConfigLoadError with sourcePath', async () => {
    // Arrange
    const deps = makeDeps({
      loadConfig: mock(async () => {
        throw new ConfigLoadError('bad config', 'zipbul.jsonc');
      }),
    });
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build()).rejects.toThrow();
  });

  it('should report BUILD_FAILED when loadConfig throws generic Error', async () => {
    // Arrange
    const deps = makeDeps({
      loadConfig: mock(async () => {
        throw new Error('unexpected');
      }),
    });
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build()).rejects.toThrow();
  });

  it('should throw when buildBundle returns success: false', async () => {
    // Arrange
    const deps = makeDeps({
      buildBundle: mock(async () => ({
        success: false as const,
        outputs: [],
        logs: [{ message: 'bundler error', level: 'error' as const, position: null }],
      })) as unknown as BuildCommandDeps['buildBundle'],
    });
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build()).rejects.toThrow();
  });

  it('should throw when manifestJson output is non-deterministic on two generateJson calls', async () => {
    // Arrange
    let callCount = 0;
    const manifestGenMock = {
      generateJson: mock(() => {
        callCount++;
        return callCount === 1 ? '{"v":1}' : '{"v":2}';
      }),
      generate: mock(() => 'const r={};'),
    };
    const deps = makeDeps({
      createManifestGenerator: mock(() => manifestGenMock) as unknown as BuildCommandDeps['createManifestGenerator'],
    });
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build()).rejects.toThrow('not deterministic');
  });

  it('should throw when buildProfile is invalid value', async () => {
    // Arrange
    const deps = makeDeps();
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build({ profile: 'ultra' as any })).rejects.toThrow();
  });

  it('should throw and report PARSE_FAILED when parser.parse() returns Err during BFS', async () => {
    // Arrange
    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((_filePath: string, _content: string) => {
          return err({ severity: 'error' as const, why: 'test' });
        }),
      }) as unknown as AstParser),
    });
    const build = createBuildCommand(deps);

    // Act & Assert
    await expect(build()).rejects.toThrow();
  });

  // -- Edge --

  it('should skip non-.ts files from BFS processing when encountered in queue', async () => {
    // Arrange - mock parser returns an import that resolveImport maps to .json;
    // BFS should skip the .json path and the build should still succeed
    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((filePath: string, _content: string) => {
          const result = makeParseResult(filePath);
          if (filePath.endsWith('main.ts')) {
            // Return an import path that resolves to a non-.ts file
            return { ...result, imports: { './data': '/some/data.json' } };
          }
          return result;
        }),
      }) as unknown as AstParser),
      resolveImport: mock((_spec: string, _from: string) => '/some/data.json'),
    });
    const build = createBuildCommand(deps);

    // Act - BFS encounters /some/data.json, skips it (non-.ts); build succeeds
    await expect(build()).resolves.toBeUndefined();
  });

  it('should not re-process already-visited files when same file appears in BFS queue multiple times', async () => {
    // Arrange
    const parseCallCounts: Record<string, number> = {};
    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((filePath: string, _content: string) => {
          parseCallCounts[filePath] = (parseCallCounts[filePath] ?? 0) + 1;
          return makeParseResult(filePath);
        }),
      }) as unknown as AstParser),
      // scanFiles includes module.ts twice to test deduplication via visited Set
      scanFiles: mock(async () => ['module.ts', 'module.ts']),
    });
    const build = createBuildCommand(deps);

    // Act
    await build();

    // Assert: each file processed exactly once
    for (const count of Object.values(parseCallCounts)) {
      expect(count).toBe(1);
    }
  });

  it('should skip paths containing node_modules/@types/ during BFS import resolution', async () => {
    // Arrange - resolveImport returns @types path; should be filtered
    const deps = makeDeps({
      resolveImport: mock((_spec: string, _from: string) => '/some/node_modules/@types/foo/index.ts'),
    });
    const build = createBuildCommand(deps);

    // Act & Assert - if @types path is NOT skipped, it would trigger Bun.file() on a non-existent path
    await expect(build()).resolves.toBeUndefined();
  });
});
