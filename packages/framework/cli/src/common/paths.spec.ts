import { describe, expect, it } from 'bun:test';

import {
  ZIPBUL_DIRNAME,
  ZIPBUL_CACHE_DIRNAME,
  ZIPBUL_TEMP_DIRNAME,
  outputDirPath,
  cacheDirPath,
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

    expect(outputDirPath(projectRoot)).toBe('/repo/.zipbul');
    expect(cacheDirPath(projectRoot)).toBe('/repo/.zipbul/cache');
    expect(tempDirPath(outDir)).toBe('/repo/dist/.zipbul-temp');
  });
});
