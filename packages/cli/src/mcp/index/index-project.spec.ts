import { afterEach, describe, expect, it } from 'bun:test';

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { ResolvedZipbulConfig } from '../../config';

import { createDb, closeDb } from '../../store/connection';
import { indexProject } from './index-project';

function tmpDir(name: string): string {
  return join('/tmp', `zipbul-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

describe('indexProject (full transaction)', () => {
  const createdPaths: string[] = [];

  afterEach(async () => {
    for (const p of createdPaths) {
      // eslint-disable-next-line no-await-in-loop
      await rm(p, { recursive: true, force: true });
    }
    createdPaths.length = 0;
  });

  it('should wrap full rebuild in a single top-level transaction', async () => {
    // Arrange
    const projectRoot = tmpDir('index-full-tx');
    createdPaths.push(projectRoot);

    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await mkdir(join(projectRoot, '.zipbul', 'cache'), { recursive: true });

    await Bun.write(join(projectRoot, 'src', 'a.ts'), `export const x = 1;\n`);

    const config: ResolvedZipbulConfig = {
      sourceDir: './src',
      entry: './src/a.ts',
      module: { fileName: 'module.ts' },
      mcp: { exclude: [] },
    };

    const dbPath = join(projectRoot, '.zipbul', 'cache', 'index.sqlite');

    const db = createDb(dbPath);

    const seen: string[] = [];
    const originalRun = db.run.bind(db);
    (db as any).run = (q: any) => {
      const text =
        typeof q === 'string'
          ? q
          : q && typeof q.toQuery === 'function'
            ? (q.toQuery({}) as { sql: string }).sql
            : String(q);
      if (
        text.includes('BEGIN') ||
        text.includes('COMMIT') ||
        text.includes('SAVEPOINT') ||
        text.includes('RELEASE SAVEPOINT')
      ) {
        seen.push(text);
      }
      return originalRun(q);
    };

    // Act
    try {
      await indexProject({ projectRoot, config, db: db as any, mode: 'full' });
    } finally {
      closeDb(db);
    }

    // Assert
    const beginCount = seen.filter((s) => s.includes('BEGIN')).length;
    const commitCount = seen.filter((s) => s.includes('COMMIT')).length;

    expect(beginCount).toBe(1);
    expect(commitCount).toBe(1);
  });
});
