import { describe, expect, it } from 'bun:test';

import {
  ZIPBUL_DIRNAME,
  ZIPBUL_CACHE_DIRNAME,
  ZIPBUL_TEMP_DIRNAME,
  zipbulDirPath,
  zipbulCacheDirPath,
  zipbulCacheFilePath,
  zipbulTempDirPath,
} from './zipbul-paths';

describe('zipbul-paths', () => {
  it('should expose reserved directory names as constants', () => {
    expect(ZIPBUL_DIRNAME).toBe('.zipbul');
    expect(ZIPBUL_CACHE_DIRNAME).toBe('cache');
    expect(ZIPBUL_TEMP_DIRNAME).toBe('.zipbul-temp');
  });

  it('should build zipbul paths deterministically', () => {
    const projectRoot = '/repo';
    const outDir = '/repo/dist';

    const zipbulDir = zipbulDirPath(projectRoot);
    const cacheDir = zipbulCacheDirPath(projectRoot);
    const signalPath = zipbulCacheFilePath(projectRoot, 'reindex.signal');
    const tempDir = zipbulTempDirPath(outDir);

    expect(zipbulDir).toBe('/repo/.zipbul');
    expect(cacheDir).toBe('/repo/.zipbul/cache');
    expect(signalPath).toBe('/repo/.zipbul/cache/reindex.signal');
    expect(tempDir).toBe('/repo/dist/.zipbul-temp');
  });
});
