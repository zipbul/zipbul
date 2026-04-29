import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildAdapter } from '../../src/compiler/adapter-build';
import { DiagnosticError } from '../../src/diagnostics';

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
        `export interface TestOptions { readonly port?: number; }`,
        `export class TestAdapter {`,
        `  readonly decorators: AdapterEntryDecorators = {`,
        `    controller: TestController,`,
        `    handlers: [TestGet, TestPost],`,
        `    options: [TestStatus],`,
        `  };`,
        `  constructor(options: TestOptions = {}) {`,
        `    void options;`,
        `  }`,
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
      producedBy: expect.stringMatching(/^@zipbul\/cli@/),
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
    // private `internal` excluded; sorted by name; getters/setters/constructor excluded
    expect(schema.methods.map((m: { name: string }) => m.name)).toEqual(['acquire', 'release']);
    const acquire = schema.methods.find((m: { name: string }) => m.name === 'acquire');
    expect(acquire.params).toEqual([{ name: 'id', type: 'string' }]);
    expect(acquire.returnType).toBe('void');
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
        `  pipeline: [P.X],`,
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
        `export const d = defineAdapter({ adapter: A, phase: P, step: S, pipeline: [P.X] });`,
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
