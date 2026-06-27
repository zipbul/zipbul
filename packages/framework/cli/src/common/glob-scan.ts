import type { Glob } from 'bun';

import { compareCodePoint } from './codepoint-compare';

export interface GlobScanParams {
  readonly glob: Glob;
  readonly baseDir: string;
}

export async function scanGlobSorted(params: GlobScanParams): Promise<string[]> {
  const { glob, baseDir } = params;
  const results: string[] = [];

  for await (const file of glob.scan(baseDir)) {
    results.push(file);
  }

  results.sort(compareCodePoint);

  return results;
}
