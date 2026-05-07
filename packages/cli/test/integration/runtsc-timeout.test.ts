/**
 * Integration test for `runTsc` timeout — verifies the 5-min hard cap
 * actually fires (overridden via `ZIPBUL_TSC_TIMEOUT_MS` for fast CI).
 *
 * Strategy: stage an adapter package that has all the source needed for
 * extraction to succeed, then place a fake `tsc` shell script at
 * `node_modules/.bin/tsc` that sleeps for 60s. With a 500ms timeout
 * override, the build must fail with a "timed out" diagnostic in well
 * under that 60s.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildAdapter } from '../../src/compiler/adapter-build';
import { DiagnosticError } from '../../src/diagnostics';

let workspaceRoot: string;
let packageRoot: string;
const originalTimeout = process.env.ZIPBUL_TSC_TIMEOUT_MS;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'zb-tsc-timeout-'));
  packageRoot = join(workspaceRoot, 'packages', 'fake-adapter');
  await mkdir(join(packageRoot, 'src'), { recursive: true });
  await mkdir(join(workspaceRoot, 'node_modules', '.bin'), { recursive: true });

  // Fake tsc — just sleeps long enough to outlast any reasonable timeout.
  const stubPath = join(workspaceRoot, 'node_modules', '.bin', 'tsc');
  await writeFile(stubPath, '#!/usr/bin/env bash\nsleep 60\n');
  await chmod(stubPath, 0o755);

  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@example/fake-adapter',
      version: '0.0.1',
      module: 'src/index.ts',
      zipbul: { kind: 'adapter' },
    }),
  );
  await writeFile(join(packageRoot, 'index.ts'), `export {};`);
  await writeFile(
    join(packageRoot, 'src/index.ts'),
    `export { adapterDefinition } from './adapter-definition';`,
  );
  await writeFile(
    join(packageRoot, 'src/adapter-definition.ts'),
    [
      `import { defineAdapter } from '@zipbul/common';`,
      `import { CoreStep } from '@zipbul/core';`,
      `import { FakeAdapter, FakeContext, FakePhase, FakeStep } from './adapter';`,
      `export const adapterDefinition = defineAdapter({`,
      `  adapter: FakeAdapter,`,
      `  context: FakeContext,`,
      `  phase: FakePhase,`,
      `  step: FakeStep,`,
      `  pipeline: [FakePhase.OnRequest, CoreStep.Handler],`,
      `});`,
    ].join('\n'),
  );
  await writeFile(
    join(packageRoot, 'src/adapter.ts'),
    [
      `import type { AdapterEntryDecorators } from '@zipbul/common';`,
      `export class FakeAdapter {`,
      `  readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] };`,
      `}`,
      `export class FakeContext {}`,
      `export const C = () => () => {};`,
      `export const H = () => () => {};`,
      `export const FakePhase = { OnRequest: 'OnRequest' } as const;`,
      `export const FakeStep = {} as const;`,
    ].join('\n'),
  );
  await writeFile(
    join(packageRoot, 'tsconfig.build.json'),
    JSON.stringify({ compilerOptions: { module: 'esnext', target: 'esnext' }, include: ['src'] }),
  );
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
  if (originalTimeout === undefined) {
    delete process.env.ZIPBUL_TSC_TIMEOUT_MS;
  } else {
    process.env.ZIPBUL_TSC_TIMEOUT_MS = originalTimeout;
  }
});

describe('runTsc — timeout fires', () => {
  it('throws a "timed out" DiagnosticError when tsc exceeds ZIPBUL_TSC_TIMEOUT_MS', async () => {
    process.env.ZIPBUL_TSC_TIMEOUT_MS = '500';

    const startedAt = performance.now();

    let thrown: unknown;
    try {
      await buildAdapter({ packageRoot });
    } catch (cause) {
      thrown = cause;
    }

    const elapsed = performance.now() - startedAt;

    // Must have thrown — tsc would otherwise sleep 60s before exit.
    expect(thrown).toBeInstanceOf(DiagnosticError);
    if (!(thrown instanceof DiagnosticError)) return;

    expect(thrown.diagnostic.why).toMatch(/timed out|aborted/i);

    // Must have completed well before the 60s sleep — give 5s leeway for
    // process startup / Bun.build overhead.
    expect(elapsed).toBeLessThan(5_000);
  }, 10_000);
});
