import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { mkdtemp, rm, mkdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'path';

import { createDb, closeDb } from '../src/store/connection';
import { card, cardCodeLink, cardRelation, codeEntity, codeRelation } from '../src/store/schema';

import type { ResolvedZipbulConfig } from '../src/config/interfaces';

import { indexProject } from '../src/mcp/index/index-project';

const config = {
  module: { fileName: 'module.ts' },
  sourceDir: './src',
  entry: './src/main.ts',
  mcp: {
    card: { relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'] },
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
      join(projectRoot, '.zipbul', 'cards', 'auth', 'login.card.md'),
      `---\nkey: auth/login\nsummary: Login\nstatus: accepted\nrelations:\n  - type: depends-on\n    target: auth/session\n---\nBody\n`,
    );

    await writeText(
      join(projectRoot, '.zipbul', 'cards', 'auth', 'session.card.md'),
      `---\nkey: auth/session\nsummary: Session\nstatus: accepted\n---\nBody\n`,
    );

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

  it('full index inserts cards, relations (with reverse), code entities/relations, and card_code_link', async () => {
    const db = createDb(':memory:');
    try {
      const res = await indexProject({ projectRoot: projectRoot!, config, db, mode: 'full' });
      expect(res.stats.indexedCardFiles).toBe(2);
      expect(res.stats.indexedCodeFiles).toBe(2);

      const cards = db.select().from(card).all();
      expect(cards).toHaveLength(2);

      const rels = db.select().from(cardRelation).all();
      // login depends-on session + reverse
      expect(rels).toHaveLength(2);
      expect(rels.some((r) => r.type === 'depends-on' && r.srcCardKey === 'auth/login' && r.dstCardKey === 'auth/session' && r.isReverse === false)).toBe(true);
      expect(rels.some((r) => r.type === 'depends-on' && r.srcCardKey === 'auth/session' && r.dstCardKey === 'auth/login' && r.isReverse === true)).toBe(true);

      const entities = db.select().from(codeEntity).all();
      expect(entities.some((e) => e.entityKey === 'module:src/auth/login.ts')).toBe(true);
      expect(entities.some((e) => e.entityKey === 'module:src/auth/session.ts')).toBe(true);

      const codeRels = db.select().from(codeRelation).all();
      expect(codeRels.some((r) => r.type === 'imports' && r.srcEntityKey === 'module:src/auth/login.ts' && r.dstEntityKey === 'module:src/auth/session.ts')).toBe(true);

      const links = db.select().from(cardCodeLink).all();
      expect(links).toHaveLength(1);
      expect(links[0]!.cardKey).toBe('auth/login');
      expect(links[0]!.entityKey).toBe('module:src/auth/login.ts');
    } finally {
      closeDb(db);
    }
  });

  it('incremental index is a no-op when nothing changed', async () => {
    const db = createDb(':memory:');
    try {
      await indexProject({ projectRoot: projectRoot!, config, db, mode: 'full' });
      const res2 = await indexProject({ projectRoot: projectRoot!, config, db, mode: 'incremental' });

      expect(res2.stats.indexedCardFiles).toBe(0);
      expect(res2.stats.indexedCodeFiles).toBe(0);
      expect(res2.stats.removedFiles).toBe(0);
    } finally {
      closeDb(db);
    }
  });

  it('incremental updates relations when a card changes', async () => {
    const db = createDb(':memory:');
    try {
      await indexProject({ projectRoot: projectRoot!, config, db, mode: 'full' });

      // Remove the relation from login -> session
      await writeText(
        join(projectRoot!, '.zipbul', 'cards', 'auth', 'login.card.md'),
        `---\nkey: auth/login\nsummary: Login\nstatus: accepted\n---\nBody\n`,
      );

      const res2 = await indexProject({ projectRoot: projectRoot!, config, db, mode: 'incremental' });
      expect(res2.stats.indexedCardFiles).toBe(1);

      const rels = db.select().from(cardRelation).all();
      expect(rels).toHaveLength(0);
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

  it('full rebuild clears existing rows even when file_state is empty/missing', async () => {
    const db = createDb(':memory:');
    try {
      // Seed a bogus row without any file_state tracking
      db.insert(card)
        .values({
          key: 'bogus',
          summary: 'Bogus',
          status: 'draft',
          keywords: null,
          constraintsJson: null,
          body: 'X',
          filePath: '.zipbul/cards/bogus.card.md',
          updatedAt: new Date().toISOString(),
        } as any)
        .run();

      expect(db.select().from(card).all().some((c) => c.key === 'bogus')).toBe(true);

      await indexProject({ projectRoot: projectRoot!, config, db, mode: 'full' });

      const cards = db.select().from(card).all();
      expect(cards.some((c) => c.key === 'bogus')).toBe(false);
      expect(cards).toHaveLength(2);
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
