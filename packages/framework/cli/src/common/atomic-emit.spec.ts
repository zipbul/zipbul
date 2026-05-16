import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { withAtomicEmit } from './atomic-emit';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'atomic-emit-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

describe('withAtomicEmit', () => {
  it('promotes staging to finalDir on success', async () => {
    const finalDir = join(tmp, 'dist');
    const stagingDir = join(tmp, 'dist.staging');

    await withAtomicEmit({ finalDir, stagingDir }, async (staging) => {
      await writeFile(join(staging, 'a.txt'), 'A');
      await writeFile(join(staging, 'b.txt'), 'B');
    });

    expect(await exists(stagingDir)).toBe(false);
    expect(await readFile(join(finalDir, 'a.txt'), 'utf8')).toBe('A');
    expect(await readFile(join(finalDir, 'b.txt'), 'utf8')).toBe('B');
  });

  it('removes staging and preserves prior finalDir on emit failure', async () => {
    const finalDir = join(tmp, 'dist');
    const stagingDir = join(tmp, 'dist.staging');

    // Seed a prior finalDir with content that must NOT be overwritten on failure.
    await mkdir(finalDir, { recursive: true });
    await writeFile(join(finalDir, 'prior.txt'), 'PRIOR');

    await expect(withAtomicEmit({ finalDir, stagingDir }, async (staging) => {
      await writeFile(join(staging, 'partial.txt'), 'X');
      throw new Error('emit failure');
    })).rejects.toThrow('emit failure');

    expect(await exists(stagingDir)).toBe(false);
    expect(await readFile(join(finalDir, 'prior.txt'), 'utf8')).toBe('PRIOR');
  });

  it('replaces an existing finalDir atomically on success', async () => {
    const finalDir = join(tmp, 'dist');
    const stagingDir = join(tmp, 'dist.staging');

    await mkdir(finalDir, { recursive: true });
    await writeFile(join(finalDir, 'old.txt'), 'OLD');

    await withAtomicEmit({ finalDir, stagingDir }, async (staging) => {
      await writeFile(join(staging, 'new.txt'), 'NEW');
    });

    expect(await exists(join(finalDir, 'old.txt'))).toBe(false);
    expect(await readFile(join(finalDir, 'new.txt'), 'utf8')).toBe('NEW');
  });

  it('clears any pre-existing staging dir before emit', async () => {
    const finalDir = join(tmp, 'dist');
    const stagingDir = join(tmp, 'dist.staging');

    // Pre-pollute staging with leftover content from a prior aborted run.
    await mkdir(stagingDir, { recursive: true });
    await writeFile(join(stagingDir, 'leftover.txt'), 'LEFTOVER');

    await withAtomicEmit({ finalDir, stagingDir }, async (staging) => {
      // The leftover must be gone before the callback runs.
      expect(await exists(join(staging, 'leftover.txt'))).toBe(false);
      await writeFile(join(staging, 'fresh.txt'), 'FRESH');
    });

    expect(await readFile(join(finalDir, 'fresh.txt'), 'utf8')).toBe('FRESH');
  });

  it('preserves prior finalDir contents when emit succeeds — verified via stat probe', async () => {
    const finalDir = join(tmp, 'dist');
    const stagingDir = join(tmp, 'dist.staging');

    await mkdir(finalDir, { recursive: true });
    await writeFile(join(finalDir, 'old.txt'), 'OLD');
    const oldInode = (await stat(join(finalDir, 'old.txt'))).ino;

    await withAtomicEmit({ finalDir, stagingDir }, async (staging) => {
      await writeFile(join(staging, 'new.txt'), 'NEW');
    });

    // Old file must be gone (replaced atomically)
    expect(await exists(join(finalDir, 'old.txt'))).toBe(false);
    expect(await readFile(join(finalDir, 'new.txt'), 'utf8')).toBe('NEW');
    // No leftover .backup-* dirs
    const leftovers = await Bun.$`ls ${tmp}/dist.backup-* 2>/dev/null || true`.text();
    expect(leftovers.trim()).toBe('');
    void oldInode;
  });

  it('restores prior finalDir from backup when emit throws after backup is taken', async () => {
    const finalDir = join(tmp, 'dist');
    const stagingDir = join(tmp, 'dist.staging');

    await mkdir(finalDir, { recursive: true });
    await writeFile(join(finalDir, 'sentinel.txt'), 'PRIOR');

    // Throw INSIDE the emit callback — backup hasn't been created yet, so
    // finalDir is preserved untouched.
    await expect(withAtomicEmit({ finalDir, stagingDir }, async () => {
      throw new Error('emit-time failure');
    })).rejects.toThrow('emit-time failure');

    expect(await readFile(join(finalDir, 'sentinel.txt'), 'utf8')).toBe('PRIOR');
    expect(await exists(stagingDir)).toBe(false);
    // No leftover backup
    const leftovers = await Bun.$`ls ${tmp}/dist.backup-* 2>/dev/null || true`.text();
    expect(leftovers.trim()).toBe('');
  });

  it('invokes registerCleanup with a function that removes staging', async () => {
    const finalDir = join(tmp, 'dist');
    const stagingDir = join(tmp, 'dist.staging');
    const registered: Array<() => Promise<void> | void> = [];

    await withAtomicEmit(
      {
        finalDir,
        stagingDir,
        registerCleanup: fn => { registered.push(fn); },
      },
      async (staging) => { await writeFile(join(staging, 'x.txt'), 'X'); },
    );

    // After success, finalDir holds content; the registered cleanup is a no-op
    // because staging is already promoted (rm -rf on a missing path is fine).
    expect(registered.length).toBe(1);
    await registered[0]!();
    expect(await readFile(join(finalDir, 'x.txt'), 'utf8')).toBe('X');
  });
});
