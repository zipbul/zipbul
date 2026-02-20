import { join } from 'path';

export const ZIPBUL_DIRNAME = '.zipbul' as const;
export const ZIPBUL_CACHE_DIRNAME = 'cache' as const;
export const ZIPBUL_TEMP_DIRNAME = '.zipbul-temp' as const;

export function zipbulDirPath(projectRoot: string): string {
  return join(projectRoot, ZIPBUL_DIRNAME);
}

export function zipbulCacheDirPath(projectRoot: string): string {
  return join(projectRoot, ZIPBUL_DIRNAME, ZIPBUL_CACHE_DIRNAME);
}

export function zipbulCacheFilePath(projectRoot: string, fileName: string): string {
  return join(projectRoot, ZIPBUL_DIRNAME, ZIPBUL_CACHE_DIRNAME, fileName);
}

export function zipbulTempDirPath(outDir: string): string {
  return join(outDir, ZIPBUL_TEMP_DIRNAME);
}
