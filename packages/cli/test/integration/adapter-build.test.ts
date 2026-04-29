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
        `import { TestAdapter, TestPhase, TestStep } from './test-adapter';`,
        `export const adapterDefinition = defineAdapter({`,
        `  adapter: TestAdapter,`,
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
      manifests: { 'pipeline-schema': 'pipeline-schema.json' },
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
