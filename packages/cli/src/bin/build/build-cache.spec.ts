import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { join } from 'path';

import type { FileAnalysis } from '../../compiler/analyzer/graph/interfaces';

const mockMkdir = mock(() => Promise.resolve());
const mockRename = mock(() => Promise.resolve());
const mockRm = mock(() => Promise.resolve());

mock.module('fs/promises', () => ({
  mkdir: mockMkdir,
  rename: mockRename,
  rm: mockRm,
}));

const { loadBuildCache, saveBuildCache, computeTsconfigHash, clearBuildCache } = await import('./build-cache');

function createFileAnalysis(filePath: string): FileAnalysis {
  return {
    filePath,
    classes: [],
    reExports: [],
    exports: [],
  };
}

describe('loadBuildCache', () => {
  let bunFileSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    mockMkdir.mockClear();
    mockRename.mockClear();
    mockRm.mockClear();
  });

  afterEach(() => {
    bunFileSpy?.mockRestore();
  });

  it('should return empty cache when cache file does not exist', async () => {
    // Arrange
    bunFileSpy = spyOn(Bun, 'file').mockImplementation(() => ({
      text: () => Promise.reject(new Error('ENOENT')),
    }) as any);

    // Act
    const cache = await loadBuildCache('/project/.zipbul/cache/file-analysis.json', 'abc123');

    // Assert
    expect(cache.get('/project/src/app.ts', 'hash1')).toBeUndefined();
  });

  it('should return cached analysis when hash matches', async () => {
    // Arrange
    const analysis = createFileAnalysis('/project/src/app.ts');
    const payload = JSON.stringify({
      schemaVersion: 1,
      tsconfigHash: 'abc123',
      entries: {
        '/project/src/app.ts': { contentHash: 'hash1', analysis },
      },
    });

    bunFileSpy = spyOn(Bun, 'file').mockImplementation(() => ({
      text: () => Promise.resolve(payload),
    }) as any);

    // Act
    const cache = await loadBuildCache('/project/.zipbul/cache/file-analysis.json', 'abc123');
    const result = cache.get('/project/src/app.ts', 'hash1');

    // Assert
    expect(result).toEqual(analysis);
  });

  it('should return undefined when content hash does not match', async () => {
    // Arrange
    const analysis = createFileAnalysis('/project/src/app.ts');
    const payload = JSON.stringify({
      schemaVersion: 1,
      tsconfigHash: 'abc123',
      entries: {
        '/project/src/app.ts': { contentHash: 'hash1', analysis },
      },
    });

    bunFileSpy = spyOn(Bun, 'file').mockImplementation(() => ({
      text: () => Promise.resolve(payload),
    }) as any);

    // Act
    const cache = await loadBuildCache('/project/.zipbul/cache/file-analysis.json', 'abc123');
    const result = cache.get('/project/src/app.ts', 'different-hash');

    // Assert
    expect(result).toBeUndefined();
  });

  it('should return empty cache when JSON is corrupt', async () => {
    // Arrange
    bunFileSpy = spyOn(Bun, 'file').mockImplementation(() => ({
      text: () => Promise.resolve('{ not valid json !!!'),
    }) as any);

    // Act
    const cache = await loadBuildCache('/project/.zipbul/cache/file-analysis.json', 'abc123');

    // Assert
    expect(cache.get('/project/src/app.ts', 'hash1')).toBeUndefined();
  });

  it('should return empty cache when tsconfig hash does not match', async () => {
    // Arrange
    const analysis = createFileAnalysis('/project/src/app.ts');
    const payload = JSON.stringify({
      schemaVersion: 1,
      tsconfigHash: 'old-hash',
      entries: {
        '/project/src/app.ts': { contentHash: 'hash1', analysis },
      },
    });

    bunFileSpy = spyOn(Bun, 'file').mockImplementation(() => ({
      text: () => Promise.resolve(payload),
    }) as any);

    // Act
    const cache = await loadBuildCache('/project/.zipbul/cache/file-analysis.json', 'new-hash');

    // Assert
    expect(cache.get('/project/src/app.ts', 'hash1')).toBeUndefined();
  });

  it('should return empty cache when schema version does not match', async () => {
    // Arrange
    const analysis = createFileAnalysis('/project/src/app.ts');
    const payload = JSON.stringify({
      schemaVersion: 999,
      tsconfigHash: 'abc123',
      entries: {
        '/project/src/app.ts': { contentHash: 'hash1', analysis },
      },
    });

    bunFileSpy = spyOn(Bun, 'file').mockImplementation(() => ({
      text: () => Promise.resolve(payload),
    }) as any);

    // Act
    const cache = await loadBuildCache('/project/.zipbul/cache/file-analysis.json', 'abc123');

    // Assert
    expect(cache.get('/project/src/app.ts', 'hash1')).toBeUndefined();
  });

  it('should return undefined when file path is not in cache', async () => {
    // Arrange
    const analysis = createFileAnalysis('/project/src/app.ts');
    const payload = JSON.stringify({
      schemaVersion: 1,
      tsconfigHash: 'abc123',
      entries: {
        '/project/src/app.ts': { contentHash: 'hash1', analysis },
      },
    });

    bunFileSpy = spyOn(Bun, 'file').mockImplementation(() => ({
      text: () => Promise.resolve(payload),
    }) as any);

    // Act
    const cache = await loadBuildCache('/project/.zipbul/cache/file-analysis.json', 'abc123');
    const result = cache.get('/project/src/unknown.ts', 'hash1');

    // Assert
    expect(result).toBeUndefined();
  });
});

describe('saveBuildCache', () => {
  let bunWriteSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    mockMkdir.mockClear();
    mockRename.mockClear();
    mockRm.mockClear();
  });

  afterEach(() => {
    bunWriteSpy?.mockRestore();
  });

  it('should write cache payload atomically via tmp file and rename', async () => {
    // Arrange
    const cachePath = '/project/.zipbul/cache/file-analysis.json';
    const analysis = createFileAnalysis('/project/src/app.ts');
    const fileMap = new Map<string, FileAnalysis>([['/project/src/app.ts', analysis]]);
    const contentHashes = new Map<string, string>([['/project/src/app.ts', 'hash1']]);

    let writtenPath: string | undefined;
    let writtenContent: string | undefined;

    bunWriteSpy = spyOn(Bun, 'write').mockImplementation((path: any, content: any) => {
      writtenPath = String(path);
      writtenContent = String(content);
      return Promise.resolve(0) as any;
    });

    // Act
    await saveBuildCache(cachePath, 'abc123', fileMap, contentHashes);

    // Assert
    expect(mockMkdir).toHaveBeenCalledWith('/project/.zipbul/cache', { recursive: true });
    expect(bunWriteSpy).toHaveBeenCalledTimes(1);
    expect(writtenPath).toMatch(/file-analysis-cache\.\d+\.tmp$/);
    expect(mockRename).toHaveBeenCalledTimes(1);
    expect(mockRename).toHaveBeenCalledWith(writtenPath, cachePath);

    const parsed = JSON.parse(writtenContent!);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.tsconfigHash).toBe('abc123');
    expect(parsed.entries['/project/src/app.ts'].contentHash).toBe('hash1');
    expect(parsed.entries['/project/src/app.ts'].analysis).toEqual(analysis);
  });

  it('should skip entries without a content hash', async () => {
    // Arrange
    const cachePath = '/project/.zipbul/cache/file-analysis.json';
    const analysis = createFileAnalysis('/project/src/app.ts');
    const fileMap = new Map<string, FileAnalysis>([['/project/src/app.ts', analysis]]);
    const contentHashes = new Map<string, string>();

    let writtenContent: string | undefined;

    bunWriteSpy = spyOn(Bun, 'write').mockImplementation((_path: any, content: any) => {
      writtenContent = String(content);
      return Promise.resolve(0) as any;
    });

    // Act
    await saveBuildCache(cachePath, 'abc123', fileMap, contentHashes);

    // Assert
    const parsed = JSON.parse(writtenContent!);

    expect(Object.keys(parsed.entries)).toHaveLength(0);
  });

  it('should silently succeed when mkdir fails', async () => {
    // Arrange
    const cachePath = '/project/.zipbul/cache/file-analysis.json';
    const fileMap = new Map<string, FileAnalysis>();
    const contentHashes = new Map<string, string>();

    mockMkdir.mockImplementationOnce(() => Promise.reject(new Error('EACCES')));

    bunWriteSpy = spyOn(Bun, 'write').mockImplementation(() => Promise.resolve(0) as any);

    // Act & Assert — should not throw
    await saveBuildCache(cachePath, 'abc123', fileMap, contentHashes);
  });
});

describe('saveBuildCache + loadBuildCache round-trip', () => {
  let bunFileSpy: ReturnType<typeof spyOn> | undefined;
  let bunWriteSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    mockMkdir.mockClear();
    mockRename.mockClear();
    mockRm.mockClear();
  });

  afterEach(() => {
    bunFileSpy?.mockRestore();
    bunWriteSpy?.mockRestore();
  });

  it('should round-trip saved data through load', async () => {
    // Arrange
    const cachePath = '/project/.zipbul/cache/file-analysis.json';
    const analysis = createFileAnalysis('/project/src/app.ts');
    const fileMap = new Map<string, FileAnalysis>([['/project/src/app.ts', analysis]]);
    const contentHashes = new Map<string, string>([['/project/src/app.ts', 'hash1']]);
    let savedPayload: string | undefined;

    bunWriteSpy = spyOn(Bun, 'write').mockImplementation((_path: any, content: any) => {
      savedPayload = String(content);
      return Promise.resolve(0) as any;
    });

    await saveBuildCache(cachePath, 'abc123', fileMap, contentHashes);

    bunWriteSpy.mockRestore();

    bunFileSpy = spyOn(Bun, 'file').mockImplementation(() => ({
      text: () => Promise.resolve(savedPayload!),
    }) as any);

    // Act
    const cache = await loadBuildCache(cachePath, 'abc123');
    const result = cache.get('/project/src/app.ts', 'hash1');

    // Assert
    expect(result).toEqual(analysis);
  });
});

describe('computeTsconfigHash', () => {
  let bunFileSpy: ReturnType<typeof spyOn> | undefined;
  let bunHashSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    bunFileSpy?.mockRestore();
    bunHashSpy?.mockRestore();
  });

  it('should compute hash for a single tsconfig', async () => {
    // Arrange
    const tsconfigContent = JSON.stringify({ compilerOptions: { strict: true } });

    bunFileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
      const filePath = String(path);

      if (filePath === join('/project', 'tsconfig.json')) {
        return { text: () => Promise.resolve(tsconfigContent) } as any;
      }

      return { text: () => Promise.reject(new Error('ENOENT')) } as any;
    });

    bunHashSpy = spyOn(Bun, 'hash').mockReturnValue(12345 as any);

    // Act
    const result = await computeTsconfigHash('/project');

    // Assert
    expect(bunHashSpy).toHaveBeenCalledWith(tsconfigContent);
    expect(result).toBe((12345).toString(36));
  });

  it('should follow extends chain and hash all tsconfigs', async () => {
    // Arrange
    const baseTsconfig = JSON.stringify({ compilerOptions: { strict: true } });
    const childTsconfig = JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { outDir: 'dist' } });

    bunFileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
      const filePath = String(path);

      if (filePath === join('/project', 'tsconfig.json')) {
        return { text: () => Promise.resolve(childTsconfig) } as any;
      }

      if (filePath === join('/project', 'tsconfig.base.json')) {
        return { text: () => Promise.resolve(baseTsconfig) } as any;
      }

      return { text: () => Promise.reject(new Error('ENOENT')) } as any;
    });

    bunHashSpy = spyOn(Bun, 'hash').mockReturnValue(67890 as any);

    // Act
    const result = await computeTsconfigHash('/project');

    // Assert
    const expectedInput = [childTsconfig, baseTsconfig].join('\n');

    expect(bunHashSpy).toHaveBeenCalledWith(expectedInput);
    expect(result).toBe((67890).toString(36));
  });

  it('should return empty string when tsconfig does not exist', async () => {
    // Arrange
    bunFileSpy = spyOn(Bun, 'file').mockImplementation(() => ({
      text: () => Promise.reject(new Error('ENOENT')),
    }) as any);

    // Act
    const result = await computeTsconfigHash('/project');

    // Assert
    expect(result).toBe('');
  });

  it('should append .json to extends path when extension is missing', async () => {
    // Arrange
    const baseTsconfig = JSON.stringify({ compilerOptions: {} });
    const childTsconfig = JSON.stringify({ extends: './base' });

    bunFileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
      const filePath = String(path);

      if (filePath === join('/project', 'tsconfig.json')) {
        return { text: () => Promise.resolve(childTsconfig) } as any;
      }

      if (filePath === join('/project', 'base.json')) {
        return { text: () => Promise.resolve(baseTsconfig) } as any;
      }

      return { text: () => Promise.reject(new Error('ENOENT')) } as any;
    });

    bunHashSpy = spyOn(Bun, 'hash').mockReturnValue(11111 as any);

    // Act
    const result = await computeTsconfigHash('/project');

    // Assert
    expect(bunHashSpy).toHaveBeenCalledWith([childTsconfig, baseTsconfig].join('\n'));
    expect(result).toBe((11111).toString(36));
  });

  it('should stop traversal when extends forms a cycle', async () => {
    // Arrange
    const configA = JSON.stringify({ extends: './tsconfig.b.json' });
    const configB = JSON.stringify({ extends: './tsconfig.json' });

    bunFileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
      const filePath = String(path);

      if (filePath === join('/project', 'tsconfig.json')) {
        return { text: () => Promise.resolve(configA) } as any;
      }

      if (filePath === join('/project', 'tsconfig.b.json')) {
        return { text: () => Promise.resolve(configB) } as any;
      }

      return { text: () => Promise.reject(new Error('ENOENT')) } as any;
    });

    bunHashSpy = spyOn(Bun, 'hash').mockReturnValue(99999 as any);

    // Act
    const result = await computeTsconfigHash('/project');

    // Assert — should hash both but not loop infinitely
    expect(bunHashSpy).toHaveBeenCalledWith([configA, configB].join('\n'));
    expect(result).toBe((99999).toString(36));
  });
});

describe('clearBuildCache', () => {
  beforeEach(() => {
    mockRm.mockClear();
  });

  it('should call rm with force option', async () => {
    // Arrange
    const cachePath = '/project/.zipbul/cache/file-analysis.json';

    // Act
    await clearBuildCache(cachePath);

    // Assert
    expect(mockRm).toHaveBeenCalledWith(cachePath, { force: true });
  });
});
