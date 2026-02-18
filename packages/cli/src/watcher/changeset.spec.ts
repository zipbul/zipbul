import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createRequire } from 'node:module';

// MUST: MUST-4 (모듈 경계 판정 deterministic)

const require = createRequire(import.meta.url);

const mkdirMock = mock(async (_path: string, _opts?: { recursive?: boolean }) => {});
const appendFileMock = mock(async (_path: string, _data: string, _encoding?: string) => {});
const renameMock = mock(async (_from: string, _to: string) => {});
const rmMock = mock(async (_path: string, _opts?: { force?: boolean }) => {});

mock.module('node:fs/promises', () => {
  return {
    mkdir: mkdirMock,
    appendFile: appendFileMock,
    rename: renameMock,
    rm: rmMock,
  };
});

afterAll(() => {
  mock.restore();
  mock.clearAllMocks();
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const mod = require('./changeset.ts') as typeof import('./changeset');
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const paths = require('../common/zipbul-paths.ts') as typeof import('../common/zipbul-paths');

describe('ChangesetWriter', () => {
  const projectRoot = '/repo';
  const changesetPath = paths.zipbulCacheFilePath(projectRoot, mod.CHANGESET_FILE_NAME);
  const rotatedPath = paths.zipbulCacheFilePath(projectRoot, mod.CHANGESET_ROTATED_FILE_NAME);
  const cacheDir = paths.zipbulCacheDirPath(projectRoot);

  let bunFileSpy: ReturnType<typeof spyOn> | undefined;
  let exists = false;
  let text = '';

  beforeEach(() => {
    mkdirMock.mockClear();
    appendFileMock.mockClear();
    renameMock.mockClear();
    rmMock.mockClear();

    exists = false;
    text = '';

    bunFileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
      if (path === changesetPath) {
        return {
          exists: async () => exists,
          text: async () => text,
        } as any;
      }

      return {
        exists: async () => false,
        text: async () => '',
      } as any;
    });
  });

  afterEach(() => {
    bunFileSpy?.mockRestore();
  });

  afterAll(() => {
    bunFileSpy?.mockRestore();
  });

  it('should append a JSONL record to .zipbul/cache/changeset.jsonl', async () => {
    // Arrange
    const nowMs = () => 1700000000000;
    const writer = new mod.ChangesetWriter({ projectRoot, nowMs });

    // Act
    await writer.append({ event: 'change', file: 'src/foo.ts' });

    // Assert
    expect(mkdirMock).toHaveBeenCalledTimes(1);
    expect(mkdirMock).toHaveBeenCalledWith(cacheDir, { recursive: true });

    expect(appendFileMock).toHaveBeenCalledTimes(1);
    expect(appendFileMock).toHaveBeenCalledWith(
      changesetPath,
      `${JSON.stringify({ ts: nowMs(), event: 'change', file: 'src/foo.ts' })}\n`,
      'utf8',
    );
  });

  it('should rotate when maxLines is reached and keep 2 generations', async () => {
    // Arrange
    exists = true;
    text = `{"ts":1,"event":"change","file":"a.ts"}\n{"ts":2,"event":"change","file":"b.ts"}\n`;

    const writer = new mod.ChangesetWriter({
      projectRoot,
      nowMs: () => 3,
      maxLines: 2,
    });

    // Act
    await writer.append({ event: 'rename', file: 'src/c.ts' });

    // Assert
    expect(rmMock).toHaveBeenCalledTimes(1);
    expect(rmMock).toHaveBeenCalledWith(rotatedPath, { force: true });

    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledWith(changesetPath, rotatedPath);

    expect(appendFileMock).toHaveBeenCalledTimes(1);
    expect(appendFileMock).toHaveBeenCalledWith(
      changesetPath,
      `${JSON.stringify({ ts: 3, event: 'rename', file: 'src/c.ts' })}\n`,
      'utf8',
    );
  });
});
