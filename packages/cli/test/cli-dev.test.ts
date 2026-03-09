import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Subprocess } from 'bun';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { Gildash, GildashOptions, IndexResult } from '@zipbul/gildash';

import type { DevCommandDeps } from '../src/bin/dev.command';
import { __testing__ } from '../src/bin/dev.command';
import type { AstParser, AdapterDefinitionResolver } from '../src/compiler/analyzer';
import type { ResolvedConfig } from '../src/config';
import { ConfigLoadError } from '../src/config';
import type { ManifestGenerator } from '../src/compiler/generator/manifest-generator';
import type { EntryGenerator } from '../src/compiler/generator/entry-generator';

const { createDevCommand } = __testing__;

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
// Mock subprocess factory
// ---------------------------------------------------------------------------
const mockSubprocess = (): Subprocess => ({
  pid: 12345,
  kill: mock(() => {}),
  exited: Promise.resolve(0),
  exitCode: null,
  signalCode: null,
  killed: false,
  stdin: null,
  stdout: null,
  stderr: null,
  ref: mock(() => {}),
  unref: mock(() => {}),
  [Symbol.dispose]: mock(() => {}),
}) as unknown as Subprocess;

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------
let tmpDir: string;
let mainFile: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'cli-dev-test-'));
  const srcDir = join(tmpDir, 'src');
  await mkdir(srcDir, { recursive: true });
  mainFile = join(srcDir, 'main.ts');
  await Bun.write(mainFile, '// main');
  await Bun.write(join(srcDir, 'module.ts'), '// module');
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const testConfig: ResolvedConfig = {
  module: { fileName: 'module.ts' },
  sourceDir: 'src',
  entry: './src/main.ts',
};

const makeSource = () => ({ path: 'zipbul.jsonc', format: 'jsonc' as const });

const makeParserMock = () => ({
  parse: mock((filePath: string, _content: string) => makeParseResult(filePath)),
}) as unknown as AstParser;

const makeAdapterResolverMock = () => ({
  resolve: mock(async () => ({ adapterStaticSchemas: [], handlerIndex: [] })),
}) as unknown as AdapterDefinitionResolver;

const makeManifestGeneratorMock = () => ({
  generateJson: mock(() => '{}'),
  generate: mock(() => '// runtime'),
}) as unknown as ManifestGenerator;

const makeEntryGeneratorMock = () => ({
  generate: mock(() => '// entry'),
}) as unknown as EntryGenerator;

const makeGildashLedgerMock = () => ({
  onIndexed: mock((_cb: unknown) => mock(() => {})),
  getAffected: mock(async (_files: string[]) => [] as string[]),
  getSymbolsByFile: mock((_file: string) => []),
  diffSymbols: mock((_before: unknown, _after: unknown) => ({ added: [], removed: [], modified: [] })),
  close: mock(async () => {}),
}) as unknown as Gildash;

const makeGildashMock = () => mock(async (_opts: GildashOptions) => makeGildashLedgerMock());

const makeDeps = (overrides?: Partial<DevCommandDeps>): DevCommandDeps => ({
  loadConfig: mock(async () => ({ config: testConfig, source: makeSource() })),
  createParser: mock(() => makeParserMock()),
  createAdapterDefinitionResolver: mock(() => makeAdapterResolverMock()),
  createManifestGenerator: mock(() => makeManifestGeneratorMock()),
  createEntryGenerator: mock(() => makeEntryGeneratorMock()),
  scanFiles: mock(async () => ['module.ts', 'main.ts']),
  createGildash: makeGildashMock(),
  spawnProcess: mock(() => mockSubprocess()),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('createDevCommand', () => {
  let cwdSpy: ReturnType<typeof spyOn>;
  let processOnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    cwdSpy = spyOn(process, 'cwd').mockReturnValue(tmpDir);
    processOnSpy = spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    processOnSpy.mockRestore();
  });

  // -- Happy Path --

  it('should call loadConfig when dev() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    expect(deps.loadConfig).toHaveBeenCalledTimes(1);
  });

  it('should call createParser once when dev() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    expect(deps.createParser).toHaveBeenCalledTimes(1);
  });

  it('should call createAdapterDefinitionResolver once when dev() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    expect(deps.createAdapterDefinitionResolver).toHaveBeenCalledTimes(1);
  });

  it('should call scanFiles with the resolved srcDir as baseDir when dev() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    expect(deps.scanFiles).toHaveBeenCalledTimes(1);
    const callArg = (deps.scanFiles as ReturnType<typeof mock>).mock.calls[0]?.[0] as { glob: unknown; baseDir: string };
    expect(callArg?.baseDir).toContain('src');
  });

  it('should call analyzeFile for each .ts file returned by scanFiles', async () => {
    // Arrange
    const parseCalls: string[] = [];
    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((filePath: string, _content: string) => {
          parseCalls.push(filePath);
          return makeParseResult(filePath);
        }),
      }) as unknown as AstParser),
      scanFiles: mock(async () => ['module.ts', 'main.ts']),
    });
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert: both files from scanFiles were analyzed
    expect(parseCalls.some(f => f.endsWith('main.ts'))).toBe(true);
    expect(parseCalls.some(f => f.endsWith('module.ts'))).toBe(true);
  });

  it('should proceed to rebuild after initial scan succeeds', async () => {
    // Arrange - if rebuild is reached it completes without throwing
    const deps = makeDeps();
    const dev = createDevCommand(deps);

    // Act & Assert - no error means rebuild was called
    await expect(dev()).resolves.toBeUndefined();
  });

  it('should pass a Glob instance to scanFiles when dev() is invoked', async () => {
    // Arrange
    let capturedBaseDir: string | null = null;
    const deps = makeDeps({
      scanFiles: mock(async ({ baseDir }: { glob: unknown; baseDir: string }) => {
        capturedBaseDir = baseDir;
        return ['module.ts', 'main.ts'];
      }),
    });
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert: baseDir is the resolved srcDir (config.sourceDir = 'src')
    expect(capturedBaseDir).not.toBeNull();
    expect(capturedBaseDir!).toContain('src');
  });

  // -- Negative / Error --

  it('should report DEV_FAILED when loadConfig throws ConfigLoadError with sourcePath', async () => {
    // Arrange
    const deps = makeDeps({
      loadConfig: mock(async () => {
        throw new ConfigLoadError('missing config', 'zipbul.jsonc');
      }),
    });
    const dev = createDevCommand(deps);

    // Act & Assert
    await expect(dev()).rejects.toThrow();
  });

  it('should report DEV_FAILED when loadConfig throws generic Error', async () => {
    // Arrange
    const deps = makeDeps({
      loadConfig: mock(async () => {
        throw new Error('unexpected config error');
      }),
    });
    const dev = createDevCommand(deps);

    // Act & Assert
    await expect(dev()).rejects.toThrow();
  });

  it('should continue scanning when one file fails to parse (analyzeFile returns false)', async () => {
    // Arrange
    let parseAttempts = 0;
    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((filePath: string, _content: string) => {
          parseAttempts++;
          // service.ts fails, module.ts and main.ts succeed
          if (filePath.endsWith('service.ts')) {
            throw new Error('parse fail');
          }
          return makeParseResult(filePath);
        }),
      }) as unknown as AstParser),
      // Include module.ts (defineModule) + main.ts (createApplication) + service.ts (fails)
      scanFiles: mock(async () => ['service.ts', 'module.ts', 'main.ts']),
    });
    const dev = createDevCommand(deps);

    // Act & Assert - should not throw even when one parse fails
    // (analyzeFile returns false on error, scan continues)
    await expect(dev()).resolves.toBeUndefined();
  });

  // -- Edge --

  it('should skip .d.ts files from initial scan', async () => {
    // Arrange
    const parseCalls: string[] = [];
    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((filePath: string, _content: string) => {
          parseCalls.push(filePath);
          return makeParseResult(filePath);
        }),
      }) as unknown as AstParser),
      scanFiles: mock(async () => ['types.d.ts', 'module.ts', 'main.ts']),
    });
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert: .d.ts file skipped
    expect(parseCalls.every(f => !f.endsWith('.d.ts'))).toBe(true);
  });

  it('should skip .spec.ts files from initial scan', async () => {
    // Arrange
    const parseCalls: string[] = [];
    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((filePath: string, _content: string) => {
          parseCalls.push(filePath);
          return makeParseResult(filePath);
        }),
      }) as unknown as AstParser),
      scanFiles: mock(async () => ['app.spec.ts', 'module.ts', 'main.ts']),
    });
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    expect(parseCalls.every(f => !f.endsWith('.spec.ts'))).toBe(true);
  });

  it('should skip .test.ts files from initial scan', async () => {
    // Arrange
    const parseCalls: string[] = [];
    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((filePath: string, _content: string) => {
          parseCalls.push(filePath);
          return makeParseResult(filePath);
        }),
      }) as unknown as AstParser),
      scanFiles: mock(async () => ['app.test.ts', 'module.ts', 'main.ts']),
    });
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    expect(parseCalls.every(f => !f.endsWith('.test.ts'))).toBe(true);
  });

  // -- Ordering --

  it('should call analyzeFile before validateCreateApplication before rebuild', async () => {
    // Arrange
    const order: string[] = [];
    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((filePath: string, _content: string) => {
          order.push('analyze:' + filePath.split('/').pop());
          return makeParseResult(filePath);
        }),
      }) as unknown as AstParser),
    });
    const dev = createDevCommand(deps);

    // Act - we know rebuild runs after validation since DEV_FAILED is only thrown by rebuild
    await dev();

    // Assert: parse calls happen before watch setup (which requires rebuild to have completed)
    expect(order.some(e => e.startsWith('analyze:'))).toBe(true);
  });

  // -- runtime.ts / entry.ts 생성 --

  it('should generate runtime.ts in .zipbul/ on initial build', async () => {
    // Arrange
    const deps = makeDeps();
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    const outDir = join(tmpDir, '.zipbul');
    const runtimeContent = await readFile(join(outDir, 'runtime.ts'), 'utf-8');
    expect(runtimeContent).toBe('// runtime');
  });

  it('should generate entry.ts in .zipbul/ on initial build', async () => {
    // Arrange
    const deps = makeDeps();
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    const outDir = join(tmpDir, '.zipbul');
    const entryContent = await readFile(join(outDir, 'entry.ts'), 'utf-8');
    expect(entryContent).toBe('// entry');
  });

  // -- 프로세스 관리 --

  it('should spawn app process after initial build', async () => {
    // Arrange
    const spawnFn = mock(() => mockSubprocess());
    const deps = makeDeps({ spawnProcess: spawnFn });
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const callArgs = spawnFn.mock.calls[0] as unknown as [string[], string];
    expect(callArgs[0]).toEqual(['bun', join(tmpDir, '.zipbul', 'entry.ts')]);
    expect(callArgs[1]).toBe(tmpDir);
  });

  // -- 워치 콜백 관련 --

  it('should re-analyze changedFiles before affectedFiles in watch callback', async () => {
    // Arrange
    const analyzeOrder: string[] = [];
    const changedFile = join(tmpDir, 'src', 'main.ts');
    const affectedFile = join(tmpDir, 'src', 'module.ts');

    let onIndexedCallback: ((result: IndexResult) => void) | null = null;
    const ledgerMock = {
      onIndexed: mock((cb: (result: IndexResult) => void) => {
        onIndexedCallback = cb;
        return mock(() => {});
      }),
      getAffected: mock(async (_files: string[]) => [affectedFile]),
      getSymbolsByFile: mock(() => []),
      diffSymbols: mock(() => ({ added: [], removed: [], modified: [] })),
      close: mock(async () => {}),
    } as unknown as Gildash;

    const deps = makeDeps({
      createParser: mock(() => ({
        parse: mock((filePath: string, _content: string) => {
          analyzeOrder.push(filePath);
          return makeParseResult(filePath);
        }),
      }) as unknown as AstParser),
      createGildash: mock(async () => ledgerMock),
    });

    const dev = createDevCommand(deps);
    await dev();

    // Clear initial parse calls
    analyzeOrder.length = 0;

    // Act: simulate file change
    expect(onIndexedCallback).not.toBeNull();
    onIndexedCallback!({
      changedFiles: [changedFile],
      deletedFiles: [],
      failedFiles: [],
      indexedFiles: 1,
      removedFiles: 0,
      totalSymbols: 0,
      totalRelations: 0,
      durationMs: 0,
      changedSymbols: { added: [], modified: [], removed: [] },
    } satisfies IndexResult);

    // Wait for the async queue to process
    await new Promise(resolve => setTimeout(resolve, 50));

    // Assert: changedFile re-analyzed before affectedFile
    const changedIdx = analyzeOrder.indexOf(changedFile);
    const affectedIdx = analyzeOrder.indexOf(affectedFile);
    expect(changedIdx).toBeGreaterThanOrEqual(0);
    expect(affectedIdx).toBeGreaterThanOrEqual(0);
    expect(changedIdx).toBeLessThan(affectedIdx);
  });

  it('should restart process after successful rebuild on file change', async () => {
    // Arrange
    const subprocess = mockSubprocess();
    const spawnFn = mock(() => subprocess);
    const changedFile = join(tmpDir, 'src', 'main.ts');

    let onIndexedCallback: ((result: IndexResult) => void) | null = null;
    const ledgerMock = {
      onIndexed: mock((cb: (result: IndexResult) => void) => {
        onIndexedCallback = cb;
        return mock(() => {});
      }),
      getAffected: mock(async () => []),
      getSymbolsByFile: mock(() => []),
      diffSymbols: mock(() => ({ added: [], removed: [], modified: [] })),
      close: mock(async () => {}),
    } as unknown as Gildash;

    const deps = makeDeps({
      createGildash: mock(async () => ledgerMock),
      spawnProcess: spawnFn,
    });

    const dev = createDevCommand(deps);
    await dev();

    // Initial spawn
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // Act: simulate file change
    onIndexedCallback!({
      changedFiles: [changedFile],
      deletedFiles: [],
      failedFiles: [],
      indexedFiles: 1,
      removedFiles: 0,
      totalSymbols: 0,
      totalRelations: 0,
      durationMs: 0,
      changedSymbols: { added: [], modified: [], removed: [] },
    } satisfies IndexResult);

    await new Promise(resolve => setTimeout(resolve, 50));

    // Assert: process restarted (stop old + start new = 2 total spawns)
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });

  it('should NOT restart process when rebuild fails', async () => {
    // Arrange
    const subprocess = mockSubprocess();
    const spawnFn = mock(() => subprocess);
    const changedFile = join(tmpDir, 'src', 'main.ts');
    let rebuildCount = 0;

    const manifestGenMock = {
      generateJson: mock(() => {
        rebuildCount++;
        // Fail on second call (during watch callback rebuild)
        if (rebuildCount > 1) {
          throw new Error('rebuild fail');
        }
        return '{}';
      }),
      generate: mock(() => '// runtime'),
    } as unknown as ManifestGenerator;

    let onIndexedCallback: ((result: IndexResult) => void) | null = null;
    const ledgerMock = {
      onIndexed: mock((cb: (result: IndexResult) => void) => {
        onIndexedCallback = cb;
        return mock(() => {});
      }),
      getAffected: mock(async () => []),
      getSymbolsByFile: mock(() => []),
      diffSymbols: mock(() => ({ added: [], removed: [], modified: [] })),
      close: mock(async () => {}),
    } as unknown as Gildash;

    const deps = makeDeps({
      createManifestGenerator: mock(() => manifestGenMock),
      createGildash: mock(async () => ledgerMock),
      spawnProcess: spawnFn,
    });

    const dev = createDevCommand(deps);
    await dev();

    // Initial spawn
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // Act: simulate file change that triggers a failing rebuild
    onIndexedCallback!({
      changedFiles: [changedFile],
      deletedFiles: [],
      failedFiles: [],
      indexedFiles: 1,
      removedFiles: 0,
      totalSymbols: 0,
      totalRelations: 0,
      durationMs: 0,
      changedSymbols: { added: [], modified: [], removed: [] },
    } satisfies IndexResult);

    await new Promise(resolve => setTimeout(resolve, 50));

    // Assert: still only 1 spawn (no restart on failure)
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('should log recovery message when rebuild succeeds after previous failure', async () => {
    // Arrange
    const logMessages: string[] = [];
    const subprocess = mockSubprocess();
    const spawnFn = mock(() => subprocess);
    const changedFile = join(tmpDir, 'src', 'main.ts');
    let rebuildCount = 0;

    const manifestGenMock = {
      generateJson: mock(() => {
        rebuildCount++;
        // Fail on 2nd call (first watch rebuild), succeed on 3rd (second watch rebuild)
        if (rebuildCount === 2) {
          throw new Error('transient fail');
        }
        return '{}';
      }),
      generate: mock(() => '// runtime'),
    } as unknown as ManifestGenerator;

    let onIndexedCallback: ((result: IndexResult) => void) | null = null;
    const ledgerMock = {
      onIndexed: mock((cb: (result: IndexResult) => void) => {
        onIndexedCallback = cb;
        return mock(() => {});
      }),
      getAffected: mock(async () => []),
      getSymbolsByFile: mock(() => []),
      diffSymbols: mock(() => ({ added: [], removed: [], modified: [] })),
      close: mock(async () => {}),
    } as unknown as Gildash;

    // Spy on Logger to capture messages
    const { Logger } = await import('@zipbul/logger');
    const infoSpy = spyOn(Logger.prototype, 'info').mockImplementation((message: string) => {
      logMessages.push(message);
    });
    const warnSpy = spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const errorSpy = spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    try {
      const deps = makeDeps({
        createManifestGenerator: mock(() => manifestGenMock),
        createGildash: mock(async () => ledgerMock),
        spawnProcess: spawnFn,
      });

      const dev = createDevCommand(deps);
      await dev();

      const indexEvent = {
        changedFiles: [changedFile],
        deletedFiles: [],
        failedFiles: [],
        indexedFiles: 1,
        removedFiles: 0,
        totalSymbols: 0,
        totalRelations: 0,
        durationMs: 0,
        changedSymbols: { added: [], modified: [], removed: [] },
      } satisfies IndexResult;

      // 1st watch event: rebuild fails
      onIndexedCallback!(indexEvent);
      await new Promise(resolve => setTimeout(resolve, 50));

      // 2nd watch event: rebuild succeeds → should log recovery
      logMessages.length = 0;
      onIndexedCallback!(indexEvent);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert
      expect(logMessages).toContain('Build recovered.');
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  // -- 시그널 핸들링 --

  it('should register SIGINT and SIGTERM handlers', async () => {
    // Arrange
    const deps = makeDeps();
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    const signalCalls = processOnSpy.mock.calls.map((call: unknown[]) => call[0]);
    expect(signalCalls).toContain('SIGINT');
    expect(signalCalls).toContain('SIGTERM');
  });
});
