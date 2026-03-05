import { describe, expect, it } from 'bun:test';

import {
  ZIPBUL_DIRNAME,
  ZIPBUL_CACHE_DIRNAME,
  ZIPBUL_TEMP_DIRNAME,
  outputDirPath,
  cacheDirPath,
  cacheFilePath,
  tempDirPath,
} from './paths';

describe('zipbul-paths', () => {
  it('should expose reserved directory names as constants', () => {
    expect(ZIPBUL_DIRNAME).toBe('.zipbul');
    expect(ZIPBUL_CACHE_DIRNAME).toBe('cache');
    expect(ZIPBUL_TEMP_DIRNAME).toBe('.zipbul-temp');
  });

  it('should build zipbul paths deterministically', () => {
    const projectRoot = '/repo';
    const outDir = '/repo/dist';

    const zipbulDir = outputDirPath(projectRoot);
    const cacheDir = cacheDirPath(projectRoot);
    const signalPath = cacheFilePath(projectRoot, 'reindex.signal');
    const tempDir = tempDirPath(outDir);

    expect(zipbulDir).toBe('/repo/.zipbul');
    expect(cacheDir).toBe('/repo/.zipbul/cache');
    expect(signalPath).toBe('/repo/.zipbul/cache/reindex.signal');
    expect(tempDir).toBe('/repo/dist/.zipbul-temp');
  });
});
