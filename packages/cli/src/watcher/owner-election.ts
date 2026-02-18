import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'path';

import { zipbulCacheFilePath } from '../common/zipbul-paths';

export type OwnerRole = 'owner' | 'reader';

export interface OwnerElectionAcquireResult {
  role: OwnerRole;
  ownerPid: number;
  lockPath: string;
}

export interface OwnerElectionInput {
  projectRoot: string;
  pid: number;
}

function parsePidFromLock(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const num = Number(trimmed);
  if (!Number.isInteger(num) || num <= 0) {
    return null;
  }

  return num;
}

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}

function isOwnerAlive(pid: number): boolean {
  try {
    // `0` is the conventional "existence check" signal.
    process.kill(pid, 0 as any);
    return true;
  } catch (err) {
    if (isErrno(err) && err.code === 'ESRCH') {
      return false;
    }

    // EPERM (no permission) and others: treat as alive to avoid unsafe takeover.
    return true;
  }
}

export class OwnerElection {
  private readonly lockPath: string;

  constructor(private readonly input: OwnerElectionInput) {
    this.lockPath = zipbulCacheFilePath(input.projectRoot, 'watcher.owner.lock');
  }

  acquire(): OwnerElectionAcquireResult {
    const { pid } = this.input;
    const lockDir = dirname(this.lockPath);

    mkdirSync(lockDir, { recursive: true });

    // Bounded loop: handle stale lock removal and retry once.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const fd = openSync(this.lockPath, 'wx');
        try {
          writeFileSync(this.lockPath, `${pid}\n`, 'utf8');
        } finally {
          closeSync(fd);
        }

        return { role: 'owner', ownerPid: pid, lockPath: this.lockPath };
      } catch (err) {
        if (!isErrno(err) || err.code !== 'EEXIST') {
          throw err;
        }

        let existingPid: number | null = null;
        try {
          const content = readFileSync(this.lockPath, 'utf8');
          existingPid = parsePidFromLock(content);
        } catch (readErr) {
          if (isErrno(readErr) && readErr.code === 'ENOENT') {
            // raced with deletion; retry
            continue;
          }
          throw readErr;
        }

        if (existingPid === null) {
          rmSync(this.lockPath, { force: true });
          continue;
        }

        if (isOwnerAlive(existingPid)) {
          return { role: 'reader', ownerPid: existingPid, lockPath: this.lockPath };
        }

        rmSync(this.lockPath, { force: true });
      }
    }

    // Should be unreachable unless the FS is extremely contended.
    const lastContent = readFileSync(this.lockPath, 'utf8');
    const lastPid = parsePidFromLock(lastContent);
    const ownerPid = lastPid ?? pid;
    return { role: ownerPid === pid ? 'owner' : 'reader', ownerPid, lockPath: this.lockPath };
  }

  release(): void {
    const { pid } = this.input;

    let existingPid: number | null = null;
    try {
      const content = readFileSync(this.lockPath, 'utf8');
      existingPid = parsePidFromLock(content);
    } catch (err) {
      if (isErrno(err) && err.code === 'ENOENT') {
        return;
      }
      throw err;
    }

    if (existingPid === pid) {
      rmSync(this.lockPath, { force: true });
    }
  }
}
