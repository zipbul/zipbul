import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createRequire } from 'node:module';

// MUST: MUST-4 (모듈 경계 판정 deterministic)

type ParcelWatchEvent = { type: 'create' | 'update' | 'delete'; path: string };
type ParcelWatchCallback = (err: Error | null, events: Array<ParcelWatchEvent>) => void;

let parcelCallback: ParcelWatchCallback | undefined;
const unsubscribeMock = mock(async () => {});
const subscribeMock = mock(async (_rootPath: string, cb: ParcelWatchCallback, _options?: unknown) => {
  parcelCallback = cb;
  return { unsubscribe: unsubscribeMock } as any;
});

const mkdirSyncMock = mock((_path: string, _opts?: { recursive?: boolean }) => {});

mock.module('@parcel/watcher', () => {
  return {
    subscribe: subscribeMock,
  };
});

mock.module('fs', () => {
  return {
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
const mod = require('./reindex-signal.ts') as typeof import('./reindex-signal.ts');
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { zipbulCacheDirPath, zipbulCacheFilePath } = require('../common/zipbul-paths.ts') as typeof import('../common/zipbul-paths');

describe('reindex-signal', () => {
  const projectRoot = '/repo';
  const signalPath = zipbulCacheFilePath(projectRoot, 'reindex.signal');
  const signalDir = zipbulCacheDirPath(projectRoot);

  let writeSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    parcelCallback = undefined;

    unsubscribeMock.mockClear();
    subscribeMock.mockClear();
    mkdirSyncMock.mockClear();

    writeSpy = spyOn(Bun, 'write').mockImplementation(async () => 0);
  });

  afterEach(() => {
    writeSpy?.mockRestore();
  });

  describe('emitReindexSignal', () => {
    it('should create cache dir and write a signal file', async () => {
      // Arrange
      const pid = 123;
      const nowMs = () => 1700000000000;

      // Act
      const res = await mod.emitReindexSignal({ projectRoot, pid, nowMs });

      // Assert
      expect(mkdirSyncMock).toHaveBeenCalledTimes(1);
      expect(mkdirSyncMock).toHaveBeenCalledWith(signalDir, { recursive: true });

      expect(writeSpy!).toHaveBeenCalledTimes(1);
      expect(writeSpy!).toHaveBeenCalledWith(signalPath, `${pid}\n${nowMs()}\n`);

      expect(res).toEqual({ signalPath });
    });
  });

  describe('parseReindexSignalText', () => {
    it('should return null when text is empty', () => {
      // Arrange
      const text = '';

      // Act
      const res = mod.parseReindexSignalText(text);

      // Assert
      expect(res).toBeNull();
    });

    it('should return null when pid is invalid', () => {
      // Arrange
      const text = `nope\n1700000000000\n`;

      // Act
      const res = mod.parseReindexSignalText(text);

      // Assert
      expect(res).toBeNull();
    });

    it('should parse pid and timestamp when valid', () => {
      // Arrange
      const text = `123\n1700000000000\n`;

      // Act
      const res = mod.parseReindexSignalText(text);

      // Assert
      expect(res).toEqual({ pid: 123, timestampMs: 1700000000000 });
    });
  });

  describe('ReindexSignalWatcher', () => {
    it('should watch cache dir and invoke callback when reindex.signal changes', async () => {
      // Arrange
      const onSignal = mock(() => {});

      const fileTextSpy = spyOn(Bun, 'file').mockImplementation((..._args: any[]) => {
        return {
          text: async () => `123\n1700000000000\n`,
        } as any;
      });

      const watcher = new mod.ReindexSignalWatcher({ projectRoot });

      // Act
      await watcher.start(onSignal);
      parcelCallback?.(null, [{ type: 'update', path: signalPath }]);
      await Promise.resolve();

      // Assert
      expect(subscribeMock).toHaveBeenCalledTimes(1);
      expect(onSignal).toHaveBeenCalledTimes(1);
      expect(onSignal).toHaveBeenCalledWith({ pid: 123, timestampMs: 1700000000000 });

      await watcher.close();
      expect(unsubscribeMock).toHaveBeenCalledTimes(1);

      fileTextSpy.mockRestore();
    });

    it('should ignore other filenames', async () => {
      // Arrange
      const onSignal = mock(() => {});
      const watcher = new mod.ReindexSignalWatcher({ projectRoot });

      // Act
      await watcher.start(onSignal);
      parcelCallback?.(null, [{ type: 'update', path: `${signalDir}/other.signal` }]);

      // Assert
      expect(onSignal).toHaveBeenCalledTimes(0);

      await watcher.close();
    });
  });
});
