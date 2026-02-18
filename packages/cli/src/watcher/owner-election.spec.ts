import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createRequire } from 'node:module';

// MUST: MUST-4 (모듈 경계 판정 deterministic)

type RmSyncOptions = { force?: boolean };

type InMemoryFsState = {
  files: Map<string, string>;
  dirs: Set<string>;
};

const state: InMemoryFsState = {
  files: new Map<string, string>(),
  dirs: new Set<string>(),
};

function createEexistError(): NodeJS.ErrnoException {
  const err = new Error('EEXIST') as NodeJS.ErrnoException;
  err.code = 'EEXIST';
  return err;
}

function createEnoentError(): NodeJS.ErrnoException {
  const err = new Error('ENOENT') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

const openSyncMock = mock((_path: string, flags: string) => {
  if (flags !== 'wx') {
    throw new Error(`Unexpected flags: ${flags}`);
  }

  if (state.files.has(_path)) {
    throw createEexistError();
  }

  state.files.set(_path, '');

  return 1;
});

const closeSyncMock = mock((_fd: number) => {});

const readFileSyncMock = mock((_path: string, _encoding: string) => {
  const content = state.files.get(_path);
  if (content === undefined) {
    throw createEnoentError();
  }
  return content;
});

const writeFileSyncMock = mock((_path: string, data: string, _encoding: string) => {
  state.files.set(_path, data);
});

const rmSyncMock = mock((_path: string, _opts?: RmSyncOptions) => {
  state.files.delete(_path);
});

const mkdirSyncMock = mock((_path: string, _opts?: { recursive?: boolean }) => {
  state.dirs.add(_path);
});

mock.module('node:fs', () => {
  return {
    openSync: openSyncMock,
    closeSync: closeSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    rmSync: rmSyncMock,
    mkdirSync: mkdirSyncMock,
  };
});

const require = createRequire(import.meta.url);
const actualPath = require('path');

mock.module('path', () => {
  return {
    ...actualPath,
    join: (...args: unknown[]) => actualPath.join(...args),
    dirname: (...args: unknown[]) => actualPath.dirname(...args),
  };
});

afterAll(() => {
  mock.restore();
  mock.clearAllMocks();
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { OwnerElection } = require('./owner-election');
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { zipbulCacheDirPath, zipbulCacheFilePath } = require('../common/zipbul-paths.ts');

describe('OwnerElection', () => {
  const projectRoot = '/repo';
  const lockPath = zipbulCacheFilePath(projectRoot, 'watcher.owner.lock');
  const lockDir = zipbulCacheDirPath(projectRoot);

  beforeEach(() => {
    state.files.clear();
    state.dirs.clear();

    openSyncMock.mockClear();
    closeSyncMock.mockClear();
    readFileSyncMock.mockClear();
    writeFileSyncMock.mockClear();
    rmSyncMock.mockClear();
    mkdirSyncMock.mockClear();
  });

  it('should acquire ownership when lock does not exist', () => {
    // Arrange
    const pid = 111;
    const election = new OwnerElection({ projectRoot, pid });

    // Act
    const res = election.acquire();

    // Assert
    expect(mkdirSyncMock).toHaveBeenCalledTimes(1);
    expect(mkdirSyncMock).toHaveBeenCalledWith(lockDir, { recursive: true });

    expect(openSyncMock).toHaveBeenCalledTimes(1);
    expect(openSyncMock).toHaveBeenCalledWith(lockPath, 'wx');

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    expect(writeFileSyncMock).toHaveBeenCalledWith(lockPath, `${pid}\n`, 'utf8');

    expect(res).toEqual({ role: 'owner', ownerPid: pid, lockPath });
  });

  it('should become reader when lock exists and owner pid is alive', () => {
    // Arrange
    const ownerPid = 222;
    state.files.set(lockPath, `${ownerPid}\n`);

    const killSpy = spyOn(process, 'kill').mockImplementation((_pid: number, _sig: any) => true as any);
    const election = new OwnerElection({ projectRoot, pid: 111 });

    // Act
    const res = election.acquire();

    // Assert
    expect(openSyncMock).toHaveBeenCalledTimes(1);
    expect(readFileSyncMock).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledTimes(1);

    expect(res).toEqual({ role: 'reader', ownerPid, lockPath });

    killSpy.mockRestore();
  });

  it('should promote to owner when lock exists but owner pid is dead', () => {
    // Arrange
    const ownerPid = 333;
    state.files.set(lockPath, `${ownerPid}\n`);

    const killSpy = spyOn(process, 'kill').mockImplementation((_pid: number, _sig: any) => {
      const err = new Error('ESRCH') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    const pid = 111;
    const election = new OwnerElection({ projectRoot, pid });

    // Act
    const res = election.acquire();

    // Assert
    expect(rmSyncMock).toHaveBeenCalledTimes(1);
    expect(rmSyncMock).toHaveBeenCalledWith(lockPath, { force: true });

    expect(openSyncMock).toHaveBeenCalledTimes(2); // first EEXIST, then acquired after stale removal
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);

    expect(res).toEqual({ role: 'owner', ownerPid: pid, lockPath });

    killSpy.mockRestore();
  });

  it('should treat a corrupt lock file as stale and acquire ownership', () => {
    // Arrange
    state.files.set(lockPath, `not-a-pid\n`);

    const pid = 111;
    const election = new OwnerElection({ projectRoot, pid });

    // Act
    const res = election.acquire();

    // Assert
    expect(rmSyncMock).toHaveBeenCalledTimes(1);
    expect(openSyncMock).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ role: 'owner', ownerPid: pid, lockPath });
  });

  it('should release lock only when the lock matches current pid', () => {
    // Arrange
    const pid = 111;
    state.files.set(lockPath, `${pid}\n`);

    const election = new OwnerElection({ projectRoot, pid });

    // Act
    election.release();

    // Assert
    expect(rmSyncMock).toHaveBeenCalledTimes(1);
    expect(rmSyncMock).toHaveBeenCalledWith(lockPath, { force: true });
  });

  it('should not release lock when the lock belongs to a different pid', () => {
    // Arrange
    state.files.set(lockPath, `999\n`);

    const election = new OwnerElection({ projectRoot, pid: 111 });

    // Act
    election.release();

    // Assert
    expect(rmSyncMock).toHaveBeenCalledTimes(0);
  });
});
