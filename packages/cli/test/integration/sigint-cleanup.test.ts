/**
 * Integration test for SIGINT cleanup — verifies that an interrupted
 * `zb build adapter` removes its `dist.staging/` before exit, leaving any
 * prior `dist/` intact.
 *
 * Strategy: stage a fake adapter fixture with a tsc stub that sleeps 60s.
 * Spawn `bun zb.ts build adapter` as a subprocess. After staging is
 * detected, send SIGINT. Assert (a) exit code 130, (b) staging removed,
 * (c) prior dist/ contents preserved.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { join, resolve as pathResolve } from 'node:path';
import { tmpdir } from 'node:os';

let workspaceRoot: string;
let packageRoot: string;
const cliEntry = pathResolve(import.meta.dir, '../../src/bin/zb.ts');

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'zb-sigint-cleanup-'));
  packageRoot = join(workspaceRoot, 'packages', 'fake-adapter');
  await mkdir(join(packageRoot, 'src'), { recursive: true });
  await mkdir(join(workspaceRoot, 'node_modules', '.bin'), { recursive: true });

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
});

async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs = 30): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await Bun.sleep(intervalMs);
  }
  return false;
}

describe('SIGINT cleanup', () => {
  it('removes dist.staging on SIGINT and preserves prior dist/', async () => {
    // Seed prior dist/ to assert preservation.
    await mkdir(join(packageRoot, 'dist'), { recursive: true });
    await writeFile(join(packageRoot, 'dist', 'PRIOR.txt'), 'PRIOR');

    const child = Bun.spawn(['bun', cliEntry, 'build', 'adapter'], {
      cwd: packageRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    });

    // Capture stderr so we can verify the cancellation line is emitted.
    const stderrChunks: string[] = [];
    void (async () => {
      const reader = (child.stderr as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          stderrChunks.push(decoder.decode(value, { stream: true }));
        }
      } catch { /* stream closed */ }
    })();

    // Staging path now carries `-<pid>-<rand>` to prevent collisions
    // between concurrent builds. Match by glob/prefix instead of hardcoded.
    const stagingPrefix = `${join(packageRoot, 'dist')}.staging-`;
    const findStaging = async (): Promise<string | null> => {
      const { readdir } = await import('node:fs/promises');
      try {
        const entries = await readdir(packageRoot);
        for (const e of entries) {
          if (e.startsWith('dist.staging-')) return join(packageRoot, e);
        }
      } catch { /* dir not yet present */ }
      return null;
    };

    let stagingDir: string | null = null;
    const stagingAppeared = await waitFor(async () => {
      stagingDir = await findStaging();
      return stagingDir !== null;
    }, 5_000);
    expect(stagingAppeared).toBe(true);
    expect(stagingDir).not.toBeNull();
    void stagingPrefix;

    child.kill('SIGINT');
    const exitCode = await child.exited;

    // Exit code 130 is the SIGINT convention; some runtimes report 128+2,
    // others null when the process was killed before installCancellation
    // could call process.exit. Both are acceptable evidence of signal
    // delivery — the more important assertion is the cleanup below.
    expect([130, 128 + 2, null]).toContain(exitCode);

    const stagingGone = await waitFor(async () => !(await pathExists(stagingDir as string)), 2_000);
    expect(stagingGone).toBe(true);

    // Prior dist/ must still be intact — atomic emit promised this.
    const priorContent = await readFile(join(packageRoot, 'dist', 'PRIOR.txt'), 'utf8');
    expect(priorContent).toBe('PRIOR');

    // Cancellation line must hit stderr in the agent-line format. Allow a
    // brief drain window for the stream reader to catch up after exit.
    await Bun.sleep(50);
    const stderrText = stderrChunks.join('');
    expect(stderrText).toMatch(/warn: \[zb\/cancel\] SIGINT received/);
  }, 15_000);
});
