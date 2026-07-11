import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { buildAdapter } from '../../src/compiler/adapter-build';
import { DiagnosticError } from '../../src/diagnostics';

/**
 * Make tsgo + workspace deps resolvable inside an isolated fixture: symlink the
 * hoisted typescript install and the `@zipbul` packages the fixture sources
 * import into `<pkgRoot>/node_modules`, and write a `tsconfig.build.json` (the
 * tsgo codegen driver — a package without it is a manifest-only build). Needed
 * only by the tests that assert a real `dist/index.js` emission.
 */
async function enableTsgoBuild(pkgRoot: string): Promise<void> {
  const monorepoRoot = resolve(__dirname, '../../../../..');
  await mkdir(join(pkgRoot, 'node_modules', '@zipbul'), { recursive: true });
  await symlink(join(monorepoRoot, 'node_modules', 'typescript'),
    join(pkgRoot, 'node_modules', 'typescript')).catch(() => {});
  for (const [sourcePath, name] of [
    ['packages/framework/common', 'common'],
    ['packages/framework/logger', 'logger'],
    ['packages/framework/core', 'core'],
    ['packages/libs/result', 'result'],
  ] as const) {
    await symlink(join(monorepoRoot, sourcePath),
      join(pkgRoot, 'node_modules', '@zipbul', name)).catch(() => {});
  }
  await Bun.write(join(pkgRoot, 'tsconfig.build.json'), JSON.stringify({
    compilerOptions: {
      module: 'esnext', target: 'esnext', moduleResolution: 'bundler',
      declaration: true, noEmit: false, emitDeclarationOnly: false,
      outDir: 'dist', rootDir: '.', skipLibCheck: true, strict: true,
    },
    include: ['index.ts', 'src'],
  }));
}

let pkgRoot: string;

beforeEach(async () => {
  pkgRoot = await mkdtemp(join(tmpdir(), 'zb-build-adapter-'));
  await mkdir(join(pkgRoot, 'src'), { recursive: true });
});

afterEach(async () => {
  await rm(pkgRoot, { recursive: true, force: true });
});

describe('zb build adapter — Slice 1', () => {
  async function writeMinimalAdapter(): Promise<void> {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/test-adapter',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );

    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import { TestAdapter, TestContext, TestPhase, TestStep } from './test-adapter';`,
        `export const adapterDefinition = defineAdapter({`,
        `  adapter: TestAdapter,`,
        `  context: TestContext,`,
        `  phase: TestPhase,`,
        `  step: TestStep,`,
        `  pipeline: [`,
        `    TestPhase.OnRequest,`,
        `    TestStep.ResolveRoute,`,
        `    CoreStep.Handler,`,
        `    TestPhase.AfterResponse,`,
        `  ],`,
        `});`,
      ].join('\n'),
    );

    await Bun.write(
      join(pkgRoot, 'src/test-adapter.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `import { ClusterStrategy } from '@zipbul/common';`,
        `export interface TestOptions { readonly port?: number; }`,
        `export class TestAdapter {`,
        `  readonly decorators: AdapterEntryDecorators = {`,
        `    controller: TestController,`,
        `    handlers: [TestGet, TestPost],`,
        `    options: [TestStatus],`,
        `  };`,
        `  readonly clusterStrategy = ClusterStrategy.Shared;`,
        `  constructor(options: TestOptions = {}) {`,
        `    void options;`,
        `  }`,
        `  async start(_ctx: unknown): Promise<void> {}`,
        `  async stop(): Promise<void> {}`,
        `  async drain(_timeoutMs: number): Promise<void> {}`,
        `  async dispatchRequest(_ctx: unknown): Promise<void> {}`,
        `  applyConfig(_config: unknown): void {}`,
        `  initializePipeline(_container: unknown): void {}`,
        `}`,
        `export class TestContext {`,
        `  private internal = 1;`,
        `  acquire(id: string): void { void id; }`,
        `  release(): boolean { return true; }`,
        `}`,
        `export const TestController = () => () => {};`,
        `export const TestGet = () => () => {};`,
        `export const TestPost = () => () => {};`,
        `export const TestStatus = () => () => {};`,
        `export const TestPhase = { OnRequest: 'OnRequest', AfterResponse: 'AfterResponse' } as const;`,
        `export const TestStep = { ResolveRoute: 'ResolveRoute' } as const;`,
      ].join('\n'),
    );
  }

  it('emits dist/adapter.manifest.json with adapter id from defineAdapter()', async () => {
    await writeMinimalAdapter();

    const result = await buildAdapter({ packageRoot: pkgRoot });

    expect(result.adapterId).toBe('TestAdapter');
    expect(result.manifestPath).toBe(join(pkgRoot, 'dist', 'adapter.manifest.json'));

    const text = await readFile(result.manifestPath, 'utf8');
    const manifest = JSON.parse(text);

    expect(manifest).toEqual({
      $schemaName: 'adapter.manifest',
      adapterId: 'TestAdapter',
      manifests: {
        'pipeline-schema': 'pipeline-schema.json',
        'decorator-schema': 'decorator-schema.json',
        'peer-contract': 'peer-contract.json',
        'context-namespaces': 'context-namespaces.json',
        'adapter-constructor-schema': 'adapter-constructor-schema.json',
      },
    });

    expect(text.endsWith('\n')).toBe(true);
    const keysInFile = Object.keys(JSON.parse(text));
    expect(keysInFile).toEqual([...keysInFile].sort());
  });

  it('emits dist/pipeline-schema.json with phase/step enums + ordered pipeline refs', async () => {
    await writeMinimalAdapter();

    await buildAdapter({ packageRoot: pkgRoot });

    const text = await readFile(join(pkgRoot, 'dist', 'pipeline-schema.json'), 'utf8');
    const schema = JSON.parse(text);

    expect(schema).toEqual({
      $schemaName: 'adapter.pipeline-schema',
      phaseEnum: 'TestPhase',
      stepEnum: 'TestStep',
      phaseMembers: ['OnRequest', 'AfterResponse'],
      stepMembers: ['ResolveRoute'],
      pipeline: [
        { qualifier: 'TestPhase', name: 'OnRequest' },
        { qualifier: 'TestStep', name: 'ResolveRoute' },
        { qualifier: 'CoreStep', name: 'Handler' },
        { qualifier: 'TestPhase', name: 'AfterResponse' },
      ],
    });
  });

  it('emits dist/decorator-schema.json with controller/handlers/options identifiers', async () => {
    await writeMinimalAdapter();

    await buildAdapter({ packageRoot: pkgRoot });

    const text = await readFile(join(pkgRoot, 'dist', 'decorator-schema.json'), 'utf8');
    const schema = JSON.parse(text);

    expect(schema).toEqual({
      $schemaName: 'adapter.decorator-schema',
      controller: 'TestController',
      handlers: ['TestGet', 'TestPost'],
      options: ['TestStatus'],
    });
  });

  it('emits dist/peer-contract.json with default Shared cluster + empty provides + peer imports', async () => {
    await writeMinimalAdapter();

    await buildAdapter({ packageRoot: pkgRoot });

    const text = await readFile(join(pkgRoot, 'dist', 'peer-contract.json'), 'utf8');
    const contract = JSON.parse(text);

    expect(contract.$schemaName).toBe('adapter.peer-contract');
    expect(contract.clusterStrategy).toBe('Shared');
    expect(contract.provides).toEqual([]);
    // entry imports defineAdapter + CoreStep
    expect(contract.peerSymbols['@zipbul/common']).toContain('defineAdapter');
    expect(contract.peerSymbols['@zipbul/core']).toContain('CoreStep');
  });

  it('emits dist/context-namespaces.json with public method signatures only', async () => {
    await writeMinimalAdapter();

    await buildAdapter({ packageRoot: pkgRoot });

    const text = await readFile(join(pkgRoot, 'dist', 'context-namespaces.json'), 'utf8');
    const schema = JSON.parse(text);

    expect(schema.$schemaName).toBe('adapter.context-namespaces');
    expect(schema.contextType).toBe('TestContext');
    // private `internal` excluded; sorted by name; constructor excluded
    expect(schema.methods.map((m: { name: string }) => m.name)).toEqual(['acquire', 'release']);
    const acquire = schema.methods.find((m: { name: string }) => m.name === 'acquire');
    expect(acquire.params).toEqual([{ name: 'id', type: 'string' }]);
    expect(acquire.returnType).toBe('void');
  });

  /**
   * The middleware-augment contract requires the adapter manifest to carry
   * every getter / setter / public-property as a namespace entry — so a
   * middleware lib's `dist/context-augments.d.ts` can target the right
   * interface (e.g. `request → HttpRequest`). Compound types (`A | B`,
   * `A[]`, generics) are recorded with `type: null` because TS declaration
   * merging requires a single identifier on the LHS of `interface X { ... }`.
   * Static / private / protected members are excluded.
   */
  it('emits namespaces for getters, setters and field properties (single-identifier types only)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/ns-adapter',
        type: 'module',
        zipbul: { kind: 'adapter' },
        peerDependencies: { '@zipbul/core': '*', '@zipbul/common': '*' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/test-adapter.ts'),
      [
        `import { defineAdapter, ClusterStrategy } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `export class FooReq {}`,
        `export class FooRes {}`,
        `export class TestAdapter {`,
        `  clusterStrategy = ClusterStrategy.Shared;`,
        `  decorators = { controller: TestController, handlers: [TestGet] };`,
        `  constructor(options: { x?: number } = {}) { void options; }`,
        `}`,
        `export class TestContext {`,
        `  // public field with single-identifier type → namespace entry`,
        `  public meta!: FooReq;`,
        `  // public field with union type → namespace entry but type: null`,
        `  public optional!: FooReq | undefined;`,
        `  // getter with single-identifier return type → namespace entry`,
        `  get request(): FooReq { return new FooReq(); }`,
        `  // setter without paired getter → namespace entry from param type`,
        `  set logger(value: FooRes) { void value; }`,
        `  // getter with compound return type → namespace entry but type: null`,
        `  get pipelineError(): FooReq | undefined { return undefined; }`,
        `  // static property → excluded entirely`,
        `  static readonly version = '1.0';`,
        `  // private → excluded`,
        `  private internal = 1;`,
        `  // method → goes to methods, not namespaces`,
        `  doStuff(): void {}`,
        `}`,
        `export const TestController = () => () => {};`,
        `export const TestGet = () => () => {};`,
        `export const adapterDefinition = defineAdapter({`,
        `  adapter: TestAdapter, context: TestContext, step: TestStep, phase: TestPhase,`,
        `  pipeline: [TestStep.Boot, CoreStep.Handler],`,
        `});`,
        `export const TestStep = { Boot: 'Boot' } as const;`,
        `export const TestPhase = {} as const;`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'index.ts'),
      `export { TestAdapter, TestContext } from './src/test-adapter';\n`,
    );

    await buildAdapter({ packageRoot: pkgRoot });

    const schema = JSON.parse(await readFile(join(pkgRoot, 'dist', 'context-namespaces.json'), 'utf8'));
    const namespaceByName = new Map<string, string | null>(
      schema.namespaces.map((n: { name: string; type: string | null }) => [n.name, n.type] as const),
    );

    // Field with single-identifier type → preserved.
    expect(namespaceByName.get('meta')).toBe('FooReq');
    // Getter with single-identifier return type → preserved.
    expect(namespaceByName.get('request')).toBe('FooReq');
    // Setter without paired getter → preserved from param type.
    expect(namespaceByName.get('logger')).toBe('FooRes');
    // Compound types (union/optional) → namespace entry exists but type=null.
    expect(namespaceByName.has('optional')).toBe(true);
    expect(namespaceByName.get('optional')).toBeNull();
    expect(namespaceByName.has('pipelineError')).toBe(true);
    expect(namespaceByName.get('pipelineError')).toBeNull();
    // Static / private excluded.
    expect(namespaceByName.has('version')).toBe(false);
    expect(namespaceByName.has('internal')).toBe(false);
    // Methods do not appear in namespaces.
    expect(namespaceByName.has('doStuff')).toBe(false);
    expect(schema.methods.map((m: { name: string }) => m.name)).toContain('doStuff');
  });

  it('emits dist/adapter-constructor-schema.json with options param type', async () => {
    await writeMinimalAdapter();

    await buildAdapter({ packageRoot: pkgRoot });

    const text = await readFile(join(pkgRoot, 'dist', 'adapter-constructor-schema.json'), 'utf8');
    const schema = JSON.parse(text);

    expect(schema.$schemaName).toBe('adapter.constructor-schema');
    expect(schema.optionsParam).toEqual({ name: 'options', type: 'TestOptions' });
    expect(schema.optional).toBe(true);
  });

  it('does not emit dist/builtins.json (adapter packages are pure, no built-in middleware)', async () => {
    await writeMinimalAdapter();

    await buildAdapter({ packageRoot: pkgRoot });

    expect(await Bun.file(join(pkgRoot, 'dist', 'builtins.json')).exists()).toBe(false);
    const indexJson = await Bun.file(join(pkgRoot, 'dist', 'adapter.manifest.json')).text();
    expect(JSON.parse(indexJson).manifests).not.toHaveProperty('builtins');
  });

  it('emits dist/index.js via tsgo alongside the manifests', async () => {
    await writeMinimalAdapter();
    await Bun.write(
      join(pkgRoot, 'index.ts'),
      [
        `export { TestAdapter, TestContext } from './src/test-adapter';`,
        `export { adapterDefinition } from './src/adapter-definition';`,
      ].join('\n'),
    );
    await enableTsgoBuild(pkgRoot);

    await buildAdapter({ packageRoot: pkgRoot });

    const indexJs = await readFile(join(pkgRoot, 'dist', 'index.js'), 'utf8');
    expect(indexJs.length).toBeGreaterThan(0);
    expect(indexJs).toContain('TestAdapter');
    // Manifests also emitted
    expect((await readFile(join(pkgRoot, 'dist', 'adapter.manifest.json'), 'utf8')).length).toBeGreaterThan(0);
  });

  it('builds successfully with aliased `defineAdapter as ...` import', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/aliased-adapter', version: '0.0.1', zipbul: { kind: 'adapter' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter as makeAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import { A, Ctx, P, S } from './x';`,
        `export const def = makeAdapter({`,
        `  adapter: A, context: Ctx, phase: P, step: S,`,
        `  pipeline: [P.X, CoreStep.Handler],`,
        `});`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class A { readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] }; }`,
        `export class Ctx {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const P = { X: 'X' } as const;`,
        `export const S = {} as const;`,
      ].join('\n'),
    );

    const result = await buildAdapter({ packageRoot: pkgRoot });
    expect(result.adapterId).toBe('A');
  });

  it('hard error when adapter src has aliased `defineMiddleware as ...` (purity policy + alias)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/aliased-impure', version: '0.0.1', zipbul: { kind: 'adapter' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { A, Ctx, P, S } from './x';`,
        `export const d = defineAdapter({ adapter: A, context: Ctx, phase: P, step: S, pipeline: [P.X, CoreStep.Handler] });`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class A { readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] }; }`,
        `export class Ctx {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const P = { X: 'X' } as const;`,
        `export const S = {} as const;`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/forbidden.ts'),
      [
        `import { defineMiddleware as mw } from '@zipbul/common';`,
        `import { A } from './x';`,
        `export const cookieMiddleware = mw([A], () => (ctx: unknown) => { void ctx; });`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toThrow(/pure protocol adapters/);
  });

  it('hard error when defineX call is not at top-level export const (shape policy)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/bad-shape',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { A, Ctx, P, S } from './x';`,
        // Not exported — shape violation: top-level const but no export
        `const adapterDefinition = defineAdapter({`,
        `  adapter: A, context: Ctx, phase: P, step: S,`,
        `  pipeline: [P.X, CoreStep.Handler],`,
        `});`,
        `export { adapterDefinition };`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class A { readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] }; }`,
        `export class Ctx {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const P = { X: 'X' } as const;`,
        `export const S = {} as const;`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toThrow(/top-level exported `const`/);
  });

  it('hard error when adapter package contains defineMiddleware / defineGuard / defineExceptionFilter calls (purity policy)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/impure-adapter',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { A, Ctx, P, S } from './x';`,
        `export const d = defineAdapter({ adapter: A, context: Ctx, phase: P, step: S, pipeline: [P.X, CoreStep.Handler] });`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class A {`,
        `  readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] };`,
        `}`,
        `export class Ctx {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const P = { X: 'X' } as const;`,
        `export const S = {} as const;`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/forbidden.ts'),
      [
        `import { defineMiddleware, defineGuard, defineExceptionFilter } from '@zipbul/common';`,
        `import { A } from './x';`,
        `export const cookieMiddleware = defineMiddleware([A], () => (ctx: unknown) => { void ctx; });`,
        `export const authGuard = defineGuard(() => (ctx: unknown) => { void ctx; return true; });`,
        `export const httpFilter = defineExceptionFilter(() => () => {});`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toThrow(/pure protocol adapters/);
  });

  it('peer-contract honors explicit ClusterStrategy.Exclusive on adapter class + provides field', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/exclusive-adapter',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter, type ContextKey } from '@zipbul/common';`,
        `import { ClusterStrategy } from '@zipbul/common';`,
        `import { ExAdapter, ExContext, KEY_A, KEY_B, P, S } from './x';`,
        `export const d = defineAdapter({`,
        `  adapter: ExAdapter,`,
        `  context: ExContext,`,
        `  phase: P,`,
        `  step: S,`,
        `  pipeline: [P.X, CoreStep.Handler],`,
        `  provides: [KEY_A, KEY_B],`,
        `});`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import { ClusterStrategy, type AdapterEntryDecorators } from '@zipbul/common';`,
        `export class ExAdapter {`,
        `  readonly clusterStrategy = ClusterStrategy.Exclusive;`,
        `  readonly decorators: AdapterEntryDecorators = {`,
        `    controller: C,`,
        `    handlers: [H],`,
        `  };`,
        `}`,
        `export class ExContext {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const KEY_A = {} as unknown;`,
        `export const KEY_B = {} as unknown;`,
        `export const P = { X: 'X' } as const;`,
        `export const S = {} as const;`,
      ].join('\n'),
    );

    await buildAdapter({ packageRoot: pkgRoot });

    const text = await readFile(join(pkgRoot, 'dist', 'peer-contract.json'), 'utf8');
    const contract = JSON.parse(text);

    expect(contract.clusterStrategy).toBe('Exclusive');
    expect(contract.provides).toEqual(['KEY_A', 'KEY_B']);
    expect(contract.peerSymbols['@zipbul/common']).toContain('defineAdapter');
    expect(contract.peerSymbols['@zipbul/common']).toContain('ClusterStrategy');
  });

  it('rejects adapter class without decorators property', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/no-decorators',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { TestAdapter, P, S } from './x';`,
        `export const d = defineAdapter({ adapter: TestAdapter, phase: P, step: S, pipeline: [P.A] });`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `export class TestAdapter {}`,
        `export const P = { A: 'A' } as const;`,
        `export const S = {} as const;`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects duplicate decorator names within an adapter entry (Item 40)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/dup-decorators',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { A, P, S } from './x';`,
        `export const d = defineAdapter({ adapter: A, phase: P, step: S, pipeline: [P.X, CoreStep.Handler] });`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class A {`,
        `  readonly decorators: AdapterEntryDecorators = {`,
        `    controller: Get,`,
        `    handlers: [Get, Post],`,
        `    options: [],`,
        `  };`,
        `}`,
        `export const Get = () => () => {};`,
        `export const Post = () => () => {};`,
        `export const P = { X: 'X' } as const;`,
        `export const S = {} as const;`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects packages without zipbul.kind=adapter with a clear reason', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/no-kind', version: '0.0.1' }),
    );
    await Bun.write(join(pkgRoot, 'src/index.ts'), `export const x = 1;`);

    try {
      await buildAdapter({ packageRoot: pkgRoot });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DiagnosticError);
      const diagnostic = (error as DiagnosticError).diagnostic;
      expect(diagnostic.why).toMatch(/must declare "zipbul": \{ "kind": "adapter" \}/);
    }
  });

  it('rejects package.json types field that is not a .d.ts (Item 45)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/bad-types',
        version: '0.0.1',
        types: 'dist/index.js',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(join(pkgRoot, 'src/index.ts'), `export const x = 1;`);

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects mismatched module vs exports[.] default (Item 45)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/mismatch',
        version: '0.0.1',
        module: 'dist/index.js',
        exports: { '.': { import: 'dist/other.js' } },
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(join(pkgRoot, 'src/index.ts'), `export const x = 1;`);

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects files array missing dist (Item 45)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/no-dist',
        version: '0.0.1',
        files: ['src'],
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(join(pkgRoot, 'src/index.ts'), `export const x = 1;`);

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects multiple defineAdapter() calls in the package (Item 27)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/two-adapters', version: '0.0.1', zipbul: { kind: 'adapter' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-a.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import { A, Ctx, P, S } from './x';`,
        `export const dA = defineAdapter({ adapter: A, context: Ctx, phase: P, step: S, pipeline: [P.X, CoreStep.Handler] });`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-b.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import { A, Ctx, P, S } from './x';`,
        `export const dB = defineAdapter({ adapter: A, context: Ctx, phase: P, step: S, pipeline: [P.X, CoreStep.Handler] });`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class A {`,
        `  readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] };`,
        `}`,
        `export class Ctx {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const P = { X: 'X' } as const;`,
        `export const S = {} as const;`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('aggregates multiple validation errors (Item 82)', async () => {
    // Two errors at once: bad types field + missing dist in files
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/multi-err',
        version: '0.0.1',
        types: 'dist/index.js',          // err1: not .d.ts
        files: ['src'],                   // err2: dist missing
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import { TestAdapter, TestContext, TestPhase, TestStep } from './test-adapter';`,
        `export const d = defineAdapter({ adapter: TestAdapter, context: TestContext, phase: TestPhase, step: TestStep, pipeline: [TestPhase.OnRequest, CoreStep.Handler] });`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/test-adapter.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class TestAdapter {`,
        `  readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] };`,
        `}`,
        `export class TestContext {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const TestPhase = { OnRequest: 'OnRequest' } as const;`,
        `export const TestStep = {} as const;`,
      ].join('\n'),
    );

    try {
      await buildAdapter({ packageRoot: pkgRoot });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DiagnosticError);
      const why = (error as DiagnosticError).diagnostic.why;
      expect(why).toContain('package.json issues');
    }
  });

  it('rejects unexported Adapter class (Item 37)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/no-export-adapter', version: '0.0.1', zipbul: { kind: 'adapter' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import { A, Ctx, P, S } from './x';`,
        `export const d = defineAdapter({ adapter: A, context: Ctx, phase: P, step: S, pipeline: [P.X, CoreStep.Handler] });`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        // intentionally not exported (no `export` keyword on the class)
        `class A {`,
        `  readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] };`,
        `}`,
        `export class Ctx {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const P = { X: 'X' } as const;`,
        `export const S = {} as const;`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects packages without zipbul.kind === "adapter"', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/not-adapter', version: '0.0.1' }),
    );
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
      `export const x = 1;`,
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects packages whose entry has no defineAdapter() call', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/empty-adapter',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      `// defineAdapter mention in comment only\nexport const x = 1;`,
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('produces canonical, deterministic JSON (re-running yields byte-identical output)', async () => {
    await writeMinimalAdapter();

    const r1 = await buildAdapter({ packageRoot: pkgRoot });
    const t1 = await readFile(r1.manifestPath, 'utf8');
    const p1 = await readFile(join(pkgRoot, 'dist', 'pipeline-schema.json'), 'utf8');

    const r2 = await buildAdapter({ packageRoot: pkgRoot });
    const t2 = await readFile(r2.manifestPath, 'utf8');
    const p2 = await readFile(join(pkgRoot, 'dist', 'pipeline-schema.json'), 'utf8');

    expect(t1).toBe(t2);
    expect(p1).toBe(p2);
  });

  it('rejects defineAdapter() missing phase/step/pipeline fields', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/incomplete-adapter',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      `import { defineAdapter } from '@zipbul/common';\nexport const d = defineAdapter({ adapter: A });\nclass A {}`,
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects pipeline with member not in the configured phase enum', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/bad-pipeline', version: '0.0.1', zipbul: { kind: 'adapter' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import { A, Ctx, P, S } from './x';`,
        `export const d = defineAdapter({`,
        `  adapter: A, context: Ctx, phase: P, step: S,`,
        `  pipeline: [P.NotARealMember, CoreStep.Handler],`,
        `});`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class A {`,
        `  readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] };`,
        `}`,
        `export class Ctx {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const P = { OnRequest: 'OnRequest' } as const;`,
        `export const S = { Resolve: 'Resolve' } as const;`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects pipeline missing CoreStep.Handler (Item 32)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/no-handler', version: '0.0.1', zipbul: { kind: 'adapter' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { A, Ctx, P, S } from './x';`,
        `export const d = defineAdapter({`,
        `  adapter: A, context: Ctx, phase: P, step: S,`,
        `  pipeline: [P.OnRequest],`,
        `});`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/x.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class A {`,
        `  readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] };`,
        `}`,
        `export class Ctx {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const P = { OnRequest: 'OnRequest' } as const;`,
        `export const S = { Resolve: 'Resolve' } as const;`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects empty pipeline arrays', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/empty-pipeline-adapter',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { A, P, S } from './x';`,
        `export const d = defineAdapter({ adapter: A, phase: P, step: S, pipeline: [] });`,
      ].join('\n'),
    );

    await expect(buildAdapter({ packageRoot: pkgRoot })).rejects.toBeInstanceOf(DiagnosticError);
  });
});
