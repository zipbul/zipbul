import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildAdapter, readAdapterManifest, detectMultiAdapterConflicts } from '../../src/compiler/adapter-build';
import { DiagnosticError } from '../../src/diagnostics';

let pkgRoot: string;

beforeEach(async () => {
  pkgRoot = await mkdtemp(join(tmpdir(), 'zb-manifest-reader-'));
  await mkdir(join(pkgRoot, 'src'), { recursive: true });
});

afterEach(async () => {
  await rm(pkgRoot, { recursive: true, force: true });
});

async function writeAdapter(): Promise<void> {
  await Bun.write(
    join(pkgRoot, 'package.json'),
    JSON.stringify({ name: '@example/x', version: '0.0.1', zipbul: { kind: 'adapter' } }),
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
}

describe('readAdapterManifest — Section M (Item 114·115)', () => {
  it('reads emitted manifest tree from dist/', async () => {
    await writeAdapter();
    await buildAdapter({ packageRoot: pkgRoot });

    const result = await readAdapterManifest(join(pkgRoot, 'dist'));

    expect(result.packageName).toBe('@example/x');
    expect(result.adapter.adapterId).toBe('A');
    expect(result.adapter.$schemaName).toBe('adapter.manifest');
    expect(result.pipeline).not.toBeNull();
    expect(result.pipeline!.phaseEnum).toBe('P');
    expect(result.decorators).not.toBeNull();
    expect(result.decorators!.controller).toBe('C');
    expect(result.peerContract).not.toBeNull();
    expect(result.contextNamespaces).not.toBeNull();
    expect(result.constructorSchema).not.toBeNull();
    expect(result.builtins).not.toBeNull();
  });

  it('throws when adapter package.json is missing (E5 — packageName required)', async () => {
    await writeAdapter();
    await buildAdapter({ packageRoot: pkgRoot });

    // Remove package.json after build.
    await rm(join(pkgRoot, 'package.json'));

    await expect(
      readAdapterManifest(join(pkgRoot, 'dist')),
    ).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('throws when adapter package.json has no name field', async () => {
    await writeAdapter();
    await buildAdapter({ packageRoot: pkgRoot });

    // Overwrite package.json with no name field.
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ version: '0.0.1', zipbul: { kind: 'adapter' } }),
    );

    await expect(
      readAdapterManifest(join(pkgRoot, 'dist')),
    ).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('throws when dist/adapter.manifest.json is missing (Item 115 — hard error)', async () => {
    await writeAdapter();

    await expect(
      readAdapterManifest(join(pkgRoot, 'dist')),
    ).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('throws when sibling manifest has wrong $schemaName', async () => {
    await writeAdapter();
    await buildAdapter({ packageRoot: pkgRoot });

    // Corrupt the pipeline-schema.json with a wrong $schemaName.
    await Bun.write(
      join(pkgRoot, 'dist', 'pipeline-schema.json'),
      JSON.stringify({ $schemaName: 'adapter.decorator-schema', phaseEnum: 'P', stepEnum: 'S', pipeline: [] }),
    );

    await expect(
      readAdapterManifest(join(pkgRoot, 'dist')),
    ).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects manifest index entry with `..` segment (path traversal guard)', async () => {
    await writeAdapter();
    await buildAdapter({ packageRoot: pkgRoot });

    // Corrupt the root manifest's index to point outside dist/.
    const topPath = join(pkgRoot, 'dist', 'adapter.manifest.json');
    const top = JSON.parse(await Bun.file(topPath).text());
    top.manifests['pipeline-schema'] = '../../etc/passwd';
    await Bun.write(topPath, JSON.stringify(top));

    await expect(
      readAdapterManifest(join(pkgRoot, 'dist')),
    ).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('rejects manifest index entry that is an absolute path', async () => {
    await writeAdapter();
    await buildAdapter({ packageRoot: pkgRoot });

    const topPath = join(pkgRoot, 'dist', 'adapter.manifest.json');
    const top = JSON.parse(await Bun.file(topPath).text());
    top.manifests['pipeline-schema'] = '/etc/passwd';
    await Bun.write(topPath, JSON.stringify(top));

    await expect(
      readAdapterManifest(join(pkgRoot, 'dist')),
    ).rejects.toBeInstanceOf(DiagnosticError);
  });
});

describe('detectMultiAdapterConflicts — Item 119', () => {
  it('returns empty list when adapters are disjoint', () => {
    const a = manifestFixture('A', { decorators: ['Get', 'Post'], provides: ['kA'] });
    const b = manifestFixture('B', { decorators: ['Send', 'Recv'], provides: ['kB'] });

    expect(detectMultiAdapterConflicts([a, b])).toEqual([]);
  });

  it('reports decorator name collision', () => {
    const a = manifestFixture('A', { decorators: ['Get', 'Inject'], provides: [] });
    const b = manifestFixture('B', { decorators: ['Inject'], provides: [] });

    const conflicts = detectMultiAdapterConflicts([a, b]);

    expect(conflicts).toEqual([
      { kind: 'decorator-name', name: 'Inject', adapters: ['A', 'B'] },
    ]);
  });

  it('reports context-key collision', () => {
    const a = manifestFixture('A', { decorators: [], provides: ['SHARED'] });
    const b = manifestFixture('B', { decorators: [], provides: ['SHARED'] });

    const conflicts = detectMultiAdapterConflicts([a, b]);

    expect(conflicts).toEqual([
      { kind: 'context-key', name: 'SHARED', adapters: ['A', 'B'] },
    ]);
  });
});

function manifestFixture(adapterId: string, opts: { decorators: readonly string[]; provides: readonly string[] }) {
  return {
    packageName: `@example/${adapterId.toLowerCase()}`,
    adapter: {
      $schemaName: 'adapter.manifest' as const,
      adapterId,
      manifests: {},
    },
    pipeline: null,
    decorators: opts.decorators.length === 0 ? null : {
      $schemaName: 'adapter.decorator-schema' as const,
      controller: opts.decorators[0]!,
      handlers: opts.decorators.slice(1),
      options: [],
    },
    peerContract: opts.provides.length === 0 ? null : {
      $schemaName: 'adapter.peer-contract' as const,
      clusterStrategy: 'Shared' as const,
      provides: opts.provides,
      peerSymbols: {},
    },
    contextNamespaces: null,
    constructorSchema: null,
    builtins: null,
  };
}
