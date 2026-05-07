/**
 * `zb build --lib` 통합 테스트 — kind 강제 + defineX shape + mutual exclusion.
 * lib-build 자체의 augment 추출 흐름은 lib-augment-injector.spec.ts 가 cover.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CliRenderer } from '../../src/bin/cli-renderer';
import { buildLib } from '../../src/bin/build/lib-build';
import { Glob } from 'bun';
import { scanGlobSorted } from '../../src/common';

let pkgRoot: string;

beforeEach(async () => {
  pkgRoot = await mkdtemp(join(tmpdir(), 'zb-lib-build-'));
  await mkdir(join(pkgRoot, 'src'), { recursive: true });
});

afterEach(async () => {
  await rm(pkgRoot, { recursive: true, force: true });
});

const silentRenderer: CliRenderer = new CliRenderer();

const deps = {
  scanFiles: ({ glob, baseDir }: { glob: Glob; baseDir: string }) => scanGlobSorted({ glob, baseDir }),
  buildBundle: (...args: Parameters<typeof Bun.build>) => Bun.build(...args),
} as Parameters<typeof buildLib>[0];

const realRun = (cwd: string) => {
  const originalCwd = process.cwd();
  process.chdir(cwd);
  return () => process.chdir(originalCwd);
};

describe('zb build --lib — kind 강제', () => {
  it('rejects when zipbul.kind is missing', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/no-kind', type: 'module' }),
    );
    await Bun.write(join(pkgRoot, 'src/index.ts'), 'export const x = 1;');

    const restore = realRun(pkgRoot);
    try {
      await expect(buildLib(deps, silentRenderer, performance.now())).rejects.toThrow(/zipbul.+kind.+middleware/);
    } finally {
      restore();
    }
  });

  it('rejects when kind is "adapter" (mutual exclusion)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/adapter', type: 'module', zipbul: { kind: 'adapter' } }),
    );
    await Bun.write(join(pkgRoot, 'src/index.ts'), 'export const x = 1;');

    const restore = realRun(pkgRoot);
    try {
      await expect(buildLib(deps, silentRenderer, performance.now())).rejects.toThrow(/zipbul.+kind.+middleware/);
    } finally {
      restore();
    }
  });
});

describe('zb build --lib — defineX shape 강제', () => {
  it('rejects when defineMiddleware is not at top-level export const', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/bad-shape', type: 'module', zipbul: { kind: 'middleware' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `const mw = defineMiddleware(() => () => {});`,
        `export { mw };`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { module: 'esnext', target: 'esnext' }, include: ['src'] }),
    );

    const restore = realRun(pkgRoot);
    try {
      await expect(buildLib(deps, silentRenderer, performance.now())).rejects.toThrow(/top-level exported `const`/);
    } finally {
      restore();
    }
  });

  it('rejects aliased defineMiddleware not at top-level export', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/bad-alias', type: 'module', zipbul: { kind: 'middleware' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
      [
        `import { defineMiddleware as mw } from '@zipbul/common';`,
        `const cookie = mw(() => () => {});`,
        `export { cookie };`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { module: 'esnext', target: 'esnext' }, include: ['src'] }),
    );

    const restore = realRun(pkgRoot);
    try {
      await expect(buildLib(deps, silentRenderer, performance.now())).rejects.toThrow(/top-level exported `const`/);
    } finally {
      restore();
    }
  });
});

