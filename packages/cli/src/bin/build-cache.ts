import { mkdir, rm } from 'fs/promises';
import { dirname } from 'path';

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
  set(filePath: string, contentHash: string, analysis: FileAnalysis): void;
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

    set(filePath: string, contentHash: string, analysis: FileAnalysis): void {
      entries.set(filePath, { contentHash, analysis });
    },
  };
}

/**
 * Persists a build cache to disk.
 *
 * @param cachePath - Absolute path to the cache JSON file.
 * @param tsconfigHash - Hash of the current tsconfig.json content.
 * @param cache - The BuildCache to save.
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
    await mkdir(dirname(cachePath), { recursive: true });
    await Bun.write(cachePath, JSON.stringify(payload));
  } catch {
    /* cache write failure — non-fatal */
  }
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
