import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { watchAdapter } from '../../src/compiler/adapter-build';

let pkgRoot: string;

beforeEach(async () => {
  pkgRoot = await mkdtemp(join(tmpdir(), 'zb-watch-'));
  await mkdir(join(pkgRoot, 'src'), { recursive: true });

  await Bun.write(
    join(pkgRoot, 'package.json'),
    JSON.stringify({ name: '@example/w', version: '0.0.1', zipbul: { kind: 'adapter' } }),
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
});

afterEach(async () => {
  await rm(pkgRoot, { recursive: true, force: true });
});

describe('watchAdapter — Section K', () => {
  it('runs initial build and rebuilds on source change', async () => {
    const builds: Array<{ ok: boolean; adapterId: string | null }> = [];

    const handle = await watchAdapter({
      packageRoot: pkgRoot,
      debounceMs: 30,
      onRebuild(result, error) {
        builds.push({ ok: error === null, adapterId: result?.adapterId ?? null });
      },
    });

    try {
      // Initial build should have completed by now (await above)
      expect(builds.length).toBe(1);
      expect(builds[0]!.ok).toBe(true);
      expect(builds[0]!.adapterId).toBe('A');

      // Touch src/x.ts to trigger rebuild
      await new Promise(r => setTimeout(r, 50));
      await writeFile(join(pkgRoot, 'src/x.ts'), await Bun.file(join(pkgRoot, 'src/x.ts')).text() + '\n// tick');

      // Wait debounce + build
      await new Promise(r => setTimeout(r, 800));

      expect(builds.length).toBeGreaterThanOrEqual(2);
      expect(builds[builds.length - 1]!.ok).toBe(true);
    } finally {
      handle.close();
    }
  }, { timeout: 10000 });
});
