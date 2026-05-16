/**
 * `zb` CLI surface options — `--help`, `-h`, `--version`. These tests spawn
 * the actual entry script and assert exit codes + stdout shape so that
 * a future refactor of the option handling never silently regresses.
 */
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

const ZB_ENTRY = resolve(__dirname, '../../src/bin/zb.ts');

interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

async function runZb(args: readonly string[]): Promise<SpawnResult> {
  const proc = Bun.spawn(['bun', ZB_ENTRY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('zb --help / -h', () => {
  it('--help writes usage to stdout and exits 0', async () => {
    const r = await runZb(['--help']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: zb <command>');
    expect(r.stdout).toContain('--help, -h');
    expect(r.stdout).toContain('--version');
  });

  it('-h is the short form of --help', async () => {
    const r = await runZb(['-h']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Usage: zb <command>');
  });
});

describe('zb --version', () => {
  it('writes "zb <version>" matching package.json#version and exits 0', async () => {
    const pkgUrl = new URL('../../package.json', import.meta.url);
    const pkg = await Bun.file(pkgUrl).json() as { version: string };

    const r = await runZb(['--version']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(`zb ${pkg.version}`);
  });
});

describe('zb (no command)', () => {
  it('prints usage and exits non-zero so shells/CI catch the misuse', async () => {
    const r = await runZb([]);
    expect(r.exitCode).not.toBe(0);
  });
});

describe('zb unknown command', () => {
  it('reports the unsupported command and exits non-zero', async () => {
    const r = await runZb(['banana']);
    expect(r.exitCode).not.toBe(0);
  });
});
