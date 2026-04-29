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

describe('readAdapterManifest — Section M (Step 11)', () => {
  it('reads emitted manifest tree from dist/', async () => {
    await writeAdapter();
    await buildAdapter({ packageRoot: pkgRoot });

    const result = await readAdapterManifest(join(pkgRoot, 'dist'));

    expect(result).not.toBeNull();
    expect(result!.adapter.adapterId).toBe('A');
    expect(result!.adapter.$schemaName).toBe('adapter.manifest');
    expect(result!.pipeline).not.toBeNull();
    expect(result!.pipeline!.phaseEnum).toBe('P');
    expect(result!.decorators).not.toBeNull();
    expect(result!.decorators!.controller).toBe('C');
    expect(result!.peerContract).not.toBeNull();
    expect(result!.contextNamespaces).not.toBeNull();
    expect(result!.constructorSchema).not.toBeNull();
    expect(result!.builtins).not.toBeNull();
  });

  it('throws when dist/adapter.manifest.json is missing (Item 115 default)', async () => {
    await writeAdapter();

    await expect(
      readAdapterManifest(join(pkgRoot, 'dist')),
    ).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('returns null when allowMissing=true and manifest absent (Item 115 fallback)', async () => {
    await writeAdapter();

    const result = await readAdapterManifest(join(pkgRoot, 'dist'), { allowMissing: true });

    expect(result).toBeNull();
  });

  it('rejects producer/user-app major version mismatch (Item 116)', async () => {
    await writeAdapter();
    await buildAdapter({ packageRoot: pkgRoot });

    // The fresh manifest declares producedBy `@zipbul/cli@0.1.0`. A user app
    // running 1.0.0 should be rejected as a major mismatch.
    await expect(
      readAdapterManifest(join(pkgRoot, 'dist'), { userAppCliVersion: '1.0.0' }),
    ).rejects.toBeInstanceOf(DiagnosticError);
  });

  it('accepts matching major version', async () => {
    await writeAdapter();
    await buildAdapter({ packageRoot: pkgRoot });

    const result = await readAdapterManifest(join(pkgRoot, 'dist'), { userAppCliVersion: '0.999.999' });

    expect(result).not.toBeNull();
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
    adapter: {
      $schemaName: 'adapter.manifest' as const,
      adapterId,
      producedBy: '@zipbul/cli@0.1.0',
      manifests: {},
      contentHash: '0'.repeat(64),
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
