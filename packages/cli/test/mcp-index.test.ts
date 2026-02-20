import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { mkdtemp, rm, mkdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'path';

import { createDb, closeDb } from '../src/store/connection';
import { codeEntity, codeRelation } from '../src/store/schema';

import type { ResolvedZipbulConfig } from '../src/config/interfaces';

import { indexProject } from '../src/mcp/index/index-project';

const config = {
  module: { fileName: 'module.ts' },
  sourceDir: './src',
  entry: './src/main.ts',
  mcp: {
    exclude: [],
  },
} as unknown as ResolvedZipbulConfig;

describe('mcp/index — indexProject (integration)', () => {
  let projectRoot: string | null = null;

  async function writeText(path: string, text: string) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
  }

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'zipbul_p4_'));

    await writeText(
      join(projectRoot, 'src', 'auth', 'session.ts'),
      `export function getSession() { return 's'; }\n`,
    );

    await writeText(
      join(projectRoot, 'src', 'auth', 'login.ts'),
      `/**\n * @see auth/login\n */\nimport { getSession } from './session';\n\nexport function login() {\n  return getSession();\n}\n`,
    );
  });

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('incremental index is a no-op when nothing changed', async () => {
    const db = createDb(':memory:');
    try {
      await indexProject({ projectRoot: projectRoot!, config, db, mode: 'full' });
      const res2 = await indexProject({ projectRoot: projectRoot!, config, db, mode: 'incremental' });

      expect(res2.stats.indexedCodeFiles).toBe(0);
      expect(res2.stats.removedFiles).toBe(0);
    } finally {
      closeDb(db);
    }
  });

  it('incremental removes stale code_relation rows for symbol-level sources in the same file', async () => {
    const db = createDb(':memory:');
    try {
      await indexProject({ projectRoot: projectRoot!, config, db, mode: 'full' });

      // Ensure we have a call relation from symbol source (login() -> getSession())
      const before = db.select().from(codeRelation).all();
      expect(before.some((r) => r.type === 'calls' && String(r.srcEntityKey).startsWith('symbol:src/auth/login.ts#'))).toBe(true);

      // Update login.ts to remove the function call
      await writeText(
        join(projectRoot!, 'src', 'auth', 'login.ts'),
        `/**\n * @see auth/login\n */\nimport { getSession } from './session';\n\nexport function login() {\n  return 'no-call';\n}\n`,
      );

      await indexProject({ projectRoot: projectRoot!, config, db, mode: 'incremental' });

      const after = db.select().from(codeRelation).all();
      expect(after.some((r) => r.type === 'calls' && String(r.srcEntityKey).startsWith('symbol:src/auth/login.ts#'))).toBe(false);
    } finally {
      closeDb(db);
    }
  });

  it('incremental preserves code_relation edges when a code file moves (fingerprint move tracking)', async () => {
    const db = createDb(':memory:');
    try {
      await indexProject({ projectRoot: projectRoot!, config, db, mode: 'full' });

      // Move session.ts -> moved-session.ts without touching login.ts (dependents unchanged)
      await rename(
        join(projectRoot!, 'src', 'auth', 'session.ts'),
        join(projectRoot!, 'src', 'auth', 'moved-session.ts'),
      );

      const res2 = await indexProject({ projectRoot: projectRoot!, config, db, mode: 'incremental' });
      expect(res2.stats.removedFiles).toBe(1);
      expect(res2.stats.indexedCodeFiles).toBe(1);

      const entities = db.select().from(codeEntity).all();
      expect(entities.some((e) => e.entityKey === 'module:src/auth/session.ts')).toBe(false);
      expect(entities.some((e) => e.entityKey === 'module:src/auth/moved-session.ts')).toBe(true);

      const rels = db.select().from(codeRelation).all();
      // imports edge (login -> session) should be retargeted to moved-session
      expect(
        rels.some(
          (r) =>
            r.type === 'imports' &&
            r.srcEntityKey === 'module:src/auth/login.ts' &&
            r.dstEntityKey === 'module:src/auth/moved-session.ts',
        ),
      ).toBe(true);

      // calls edge (login.login() -> session.getSession()) should be retargeted too
      expect(
        rels.some(
          (r) =>
            r.type === 'calls' &&
            String(r.srcEntityKey).startsWith('symbol:src/auth/login.ts#') &&
            r.dstEntityKey === 'symbol:src/auth/moved-session.ts#getSession',
        ),
      ).toBe(true);

      // No remaining edges to the old path
      expect(rels.some((r) => String(r.srcEntityKey).includes('src/auth/session.ts') || String(r.dstEntityKey).includes('src/auth/session.ts'))).toBe(false);
    } finally {
      closeDb(db);
    }
  });
});
