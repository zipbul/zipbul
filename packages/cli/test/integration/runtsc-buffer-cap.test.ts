/**
 * Regression test for the 4MB output cap on `runTsc`'s child-process
 * stdout/stderr capture. Without this cap a runaway `tsc` (or malicious
 * stub) emitting gigabytes of output would OOM the parent through
 * unbounded `string +=` accumulation.
 *
 * Strategy: stage an adapter package whose `tsc` stub is a shell script
 * that prints ~6MB to stderr then exits non-zero. The build must fail
 * (because exit non-zero), but the captured `reason` must contain the
 * truncation marker — proving the cap clamped the buffer instead of
 * letting it grow unbounded.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildAdapter } from '../../src/compiler/adapter-build';
import { DiagnosticError } from '../../src/diagnostics';

let workspaceRoot: string;
let packageRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'zb-tsc-buf-'));
  packageRoot = join(workspaceRoot, 'packages', 'fake');
  await mkdir(join(packageRoot, 'src'), { recursive: true });
  await mkdir(join(workspaceRoot, 'node_modules', '.bin'), { recursive: true });

  // tsc stub that prints ~6MB of error chatter to stderr then exits 1.
  // 6MB is comfortably above the 4MB cap so the truncation path is
  // exercised. Single-line tail keeps the script tiny.
  const stubPath = join(workspaceRoot, 'node_modules', '.bin', 'tsc');
  await writeFile(
    stubPath,
    [
      '#!/usr/bin/env bash',
      // Emit ~6MB of "X" to stderr.
      'yes "noisy diagnostic line ........................." | head -c 6291456 1>&2',
      'exit 1',
    ].join('\n'),
  );
  await chmod(stubPath, 0o755);

  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@example/fake',
      version: '0.0.1',
      module: 'src/index.ts',
      zipbul: { kind: 'adapter' },
    }),
  );
  await writeFile(join(packageRoot, 'index.ts'), 'export {};');
  await writeFile(
    join(packageRoot, 'src/index.ts'),
    `export { adapterDefinition } from './adapter-definition';`,
  );
  await writeFile(
    join(packageRoot, 'src/adapter-definition.ts'),
    [
      `import { defineAdapter } from '@zipbul/common';`,
      `import { CoreStep } from '@zipbul/core';`,
      `import { FA, FCx, FP, FS } from './adapter';`,
      `export const adapterDefinition = defineAdapter({`,
      `  adapter: FA, context: FCx, phase: FP, step: FS,`,
      `  pipeline: [FP.OnRequest, CoreStep.Handler],`,
      `});`,
    ].join('\n'),
  );
  await writeFile(
    join(packageRoot, 'src/adapter.ts'),
    [
      `import type { AdapterEntryDecorators } from '@zipbul/common';`,
      `export class FA { readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] }; }`,
      `export class FCx {}`,
      `export const C = () => () => {};`,
      `export const H = () => () => {};`,
      `export const FP = { OnRequest: 'OnRequest' } as const;`,
      `export const FS = {} as const;`,
    ].join('\n'),
  );
  await writeFile(
    join(packageRoot, 'tsconfig.build.json'),
    JSON.stringify({ compilerOptions: { module: 'esnext', target: 'esnext' }, include: ['src'] }),
  );
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('runTsc — output buffer cap', () => {
  it('truncates oversized tsc stderr at 4MB instead of accumulating without bound', async () => {
    let thrown: unknown;
    try {
      await buildAdapter({ packageRoot });
    } catch (cause) { thrown = cause; }

    expect(thrown).toBeInstanceOf(DiagnosticError);
    if (!(thrown instanceof DiagnosticError)) return;

    const reason = thrown.diagnostic.why;
    // Must include the truncation marker — proves the cap engaged.
    expect(reason).toMatch(/output truncated at \d+ bytes/);
    // And the captured message must NOT be larger than ~4MB+epsilon
    // (bounding the upper limit so an unbounded regression here would fail
    // the test even if the truncation tag somehow appeared).
    expect(reason.length).toBeLessThan(5 * 1024 * 1024);
  }, 30_000);
});
