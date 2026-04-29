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
  it('emits dist/adapter.manifest.json with adapter id from defineAdapter()', async () => {
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
        `import { TestAdapter } from './test-adapter';`,
        `export const adapterDefinition = defineAdapter({ adapter: TestAdapter });`,
      ].join('\n'),
    );

    const result = await buildAdapter({ packageRoot: pkgRoot });

    expect(result.adapterId).toBe('TestAdapter');
    expect(result.manifestPath).toBe(join(pkgRoot, 'dist', 'adapter.manifest.json'));

    const text = await readFile(result.manifestPath, 'utf8');
    const manifest = JSON.parse(text);

    expect(manifest).toEqual({
      $schemaName: 'adapter.manifest',
      adapterId: 'TestAdapter',
      producedBy: expect.stringMatching(/^@zipbul\/cli@/),
    });

    // canonical form: keys sorted, trailing newline
    expect(text.endsWith('\n')).toBe(true);
    const keysInFile = Object.keys(JSON.parse(text));
    expect(keysInFile).toEqual([...keysInFile].sort());
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
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@example/det-adapter',
        version: '0.0.1',
        zipbul: { kind: 'adapter' },
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/adapter-definition.ts'),
      `import { defineAdapter } from '@zipbul/common';\nexport const d = defineAdapter({ adapter: A });\nclass A {}`,
    );

    const r1 = await buildAdapter({ packageRoot: pkgRoot });
    const t1 = await readFile(r1.manifestPath, 'utf8');

    const r2 = await buildAdapter({ packageRoot: pkgRoot });
    const t2 = await readFile(r2.manifestPath, 'utf8');

    expect(t1).toBe(t2);
  });
});
