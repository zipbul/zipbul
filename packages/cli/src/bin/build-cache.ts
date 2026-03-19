import { mkdir, rename, rm } from 'fs/promises';
import { dirname, join } from 'path';

import type { FileAnalysis } from '../compiler/analyzer/graph/interfaces';

const CACHE_SCHEMA_VERSION = 1;

interface CacheEntry {
  contentHash: string;
  analysis: FileAnalysis;
}

interface CachePayload {
  schemaVersion: number;
  tsconfigHash: string;
  entries: Record<string, CacheEntry>;
}

export interface BuildCache {
  get(filePath: string, contentHash: string): FileAnalysis | undefined;
}

/**
 * Loads a build cache from disk. Returns an empty cache on any failure.
 *
 * @param cachePath - Absolute path to the cache JSON file.
 * @param tsconfigHash - Hash of the current tsconfig.json content.
 * @returns A BuildCache backed by disk.
 * @public
 */
export async function loadBuildCache(cachePath: string, tsconfigHash: string): Promise<BuildCache> {
  const entries = new Map<string, CacheEntry>();

  try {
    const raw = await Bun.file(cachePath).text();
    const payload: CachePayload = JSON.parse(raw);

    if (
      payload.schemaVersion === CACHE_SCHEMA_VERSION
      && payload.tsconfigHash === tsconfigHash
    ) {
      for (const [filePath, entry] of Object.entries(payload.entries)) {
        entries.set(filePath, entry);
      }
    }
  } catch {
    /* cache miss or corrupt — start fresh */
  }

  return {
    get(filePath: string, contentHash: string): FileAnalysis | undefined {
      const entry = entries.get(filePath);

      if (entry === undefined || entry.contentHash !== contentHash) {
        return undefined;
      }

      return entry.analysis;
    },
  };
}

/**
 * Persists a build cache to disk atomically via write-to-tmp + rename.
 *
 * @param cachePath - Absolute path to the cache JSON file.
 * @param tsconfigHash - Hash of the current tsconfig.json content.
 * @param fileMap - File analysis map to persist.
 * @param contentHashes - Content hashes keyed by file path.
 * @public
 */
export async function saveBuildCache(
  cachePath: string,
  tsconfigHash: string,
  fileMap: ReadonlyMap<string, FileAnalysis>,
  contentHashes: ReadonlyMap<string, string>,
): Promise<void> {
  const entries: Record<string, CacheEntry> = {};

  for (const [filePath, analysis] of fileMap) {
    const hash = contentHashes.get(filePath);

    if (hash !== undefined) {
      entries[filePath] = { contentHash: hash, analysis };
    }
  }

  const payload: CachePayload = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    tsconfigHash,
    entries,
  };

  try {
    const cacheDir = dirname(cachePath);
    const tmpPath = join(cacheDir, `file-analysis-cache.${Date.now()}.tmp`);

    await mkdir(cacheDir, { recursive: true });
    await Bun.write(tmpPath, JSON.stringify(payload));
    await rename(tmpPath, cachePath);
  } catch {
    /* cache write failure — non-fatal */
  }
}

/**
 * Computes a combined hash of the tsconfig.json file and its full `extends` chain.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns A deterministic hash string.
 * @public
 */
export async function computeTsconfigHash(projectRoot: string): Promise<string> {
  const parts: string[] = [];
  const visited = new Set<string>();
  let currentPath = join(projectRoot, 'tsconfig.json');

  while (currentPath && !visited.has(currentPath)) {
    visited.add(currentPath);

    try {
      const content = await Bun.file(currentPath).text();

      parts.push(content);

      const parsed = JSON.parse(content);
      const extendsValue = parsed.extends;

      if (typeof extendsValue === 'string') {
        currentPath = join(dirname(currentPath), extendsValue);

        if (!currentPath.endsWith('.json')) {
          currentPath += '.json';
        }
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return Bun.hash(parts.join('\n')).toString(36);
}

/**
 * Removes the build cache file.
 *
 * @param cachePath - Absolute path to the cache JSON file.
 * @public
 */
export async function clearBuildCache(cachePath: string): Promise<void> {
  await rm(cachePath, { force: true });
}
