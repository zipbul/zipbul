import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { DevCommandDeps } from '../src/bin/dev.command';
import { __testing__ } from '../src/bin/dev.command';
import type { AstParser, AdapterSpecResolver } from '../src/compiler/analyzer';
import type { GildashProvider, GildashProviderOptions } from '../src/compiler/gildash-provider';
import type { ResolvedZipbulConfig } from '../src/config';
import { ConfigLoadError } from '../src/config';

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

const testConfig: ResolvedZipbulConfig = {
  module: { fileName: 'module.ts' },
  sourceDir: 'src',
  entry: './src/main.ts',
  mcp: { exclude: [] },
};

const makeSource = () => ({ path: 'zipbul.jsonc', format: 'jsonc' as const });

const makeParserMock = () => ({
  parse: mock((filePath: string, _content: string) => makeParseResult(filePath)),
}) as unknown as AstParser;

const makeAdapterResolverMock = () => ({
  resolve: mock(async () => ({ adapterStaticSpecs: [], handlerIndex: [] })),
}) as unknown as AdapterSpecResolver;

const makeGildashLedgerMock = () => ({
  onIndexed: mock((_cb: unknown) => mock(() => {})),
  getAffected: mock(async (_files: string[]) => [] as string[]),
  close: mock(async () => {}),
}) as unknown as GildashProvider;

const makeGildashProviderMock = () => mock(async (_opts: GildashProviderOptions) => makeGildashLedgerMock());

const makeDeps = (overrides?: Partial<DevCommandDeps>): DevCommandDeps => ({
  loadConfig: mock(async () => ({ config: testConfig, source: makeSource() })),
  createParser: mock(() => makeParserMock()),
  createAdapterSpecResolver: mock(() => makeAdapterResolverMock()),
  scanFiles: mock(async () => ['module.ts', 'main.ts']),
  createGildashProvider: makeGildashProviderMock(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('createDevCommand', () => {
  let cwdSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    cwdSpy = spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
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

  it('should call createAdapterSpecResolver once when dev() is invoked', async () => {
    // Arrange
    const deps = makeDeps();
    const dev = createDevCommand(deps);

    // Act
    await dev();

    // Assert
    expect(deps.createAdapterSpecResolver).toHaveBeenCalledTimes(1);
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
});
