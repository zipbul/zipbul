import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'path';

import type { ResolvedZipbulConfig } from '../src/config/interfaces';

import { createDb, closeDb } from '../src/store/connection';
import { keyword, tag } from '../src/store/schema';

import { verifyProject } from '../src/mcp/verify/verify-project';

const config = {
  module: { fileName: 'module.ts' },
  sourceDir: './src',
  entry: './src/main.ts',
  mcp: {
    card: { relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'] },
    exclude: [],
  },
} as unknown as ResolvedZipbulConfig;

describe('mcp/verify — verifyProject (P5)', () => {
  let projectRoot: string | null = null;

  async function writeText(path: string, text: string) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
  }

  async function seedRegistry(items: { keywords?: string[]; tags?: string[] }) {
    const dbPath = join(projectRoot!, '.zipbul', 'cache', 'index.sqlite');
    await mkdir(dirname(dbPath), { recursive: true });
    const db = createDb(dbPath);
    try {
      for (const name of items.keywords ?? []) {
        db.insert(keyword).values({ name }).onConflictDoNothing().run();
      }
      for (const name of items.tags ?? []) {
        db.insert(tag).values({ name }).onConflictDoNothing().run();
      }
    } finally {
      closeDb(db);
    }
  }

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'zipbul_p5_'));
  });

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('errors when code references a non-existent card via @see', async () => {
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'auth', 'login.card.md'),
      `---\nkey: auth/login\nsummary: Login\nstatus: draft\n---\nBody\n`,
    );

    await writeText(
      join(projectRoot!, 'src', 'x.ts'),
      `/**\n * @see does/not-exist\n */\nexport function x() {}\n`,
    );

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'SEE_TARGET_MISSING')).toBe(true);
  });

  it('errors when @see uses an invalid key', async () => {
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'a.card.md'),
      `---\nkey: a\nsummary: A\nstatus: draft\n---\nBody\n`,
    );
    await writeText(
      join(projectRoot!, 'src', 'a.ts'),
      `/**\n * @see a::b\n */\nexport function a() {}\n`,
    );

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'SEE_KEY_INVALID')).toBe(true);
  });

  it('errors when a card has status implemented but has no @see references', async () => {
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'impl.card.md'),
      `---\nkey: impl\nsummary: Impl\nstatus: implemented\n---\nBody\n`,
    );
    await writeText(join(projectRoot!, 'src', 'noop.ts'), `export const noop = 1;\n`);

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'IMPLEMENTED_CARD_NO_CODE_LINKS')).toBe(true);
  });

  it('warns when a card is accepted/implementing but has no @see references', async () => {
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'acc.card.md'),
      `---\nkey: acc\nsummary: Acc\nstatus: accepted\n---\nBody\n`,
    );
    await writeText(join(projectRoot!, 'src', 'noop.ts'), `export const noop = 1;\n`);

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => w.code === 'CONFIRMED_CARD_NO_CODE_LINKS')).toBe(true);
  });

  it('errors when a card uses an invalid key', async () => {
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'bad-type.card.md'),
      `---\nkey: x::y\nsummary: X\nstatus: draft\n---\nBody\n`,
    );

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'CARD_KEY_INVALID')).toBe(true);
  });

  it('errors when a frontmatter relation targets a missing card or uses disallowed relation type', async () => {
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'a.card.md'),
      `---\nkey: a\nsummary: A\nstatus: draft\nrelations:\n  - type: depends-on\n    target: missing\n  - type: not-allowed\n    target: a\n---\nBody\n`,
    );

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'RELATION_TARGET_MISSING')).toBe(true);
    expect(res.errors.some((e) => e.code === 'RELATION_TYPE_NOT_ALLOWED')).toBe(true);
  });

  it('warns on depends-on cycles', async () => {
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'a.card.md'),
      `---\nkey: a\nsummary: A\nstatus: draft\nrelations:\n  - type: depends-on\n    target: b\n---\nBody\n`,
    );
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'b.card.md'),
      `---\nkey: b\nsummary: B\nstatus: draft\nrelations:\n  - type: depends-on\n    target: a\n---\nBody\n`,
    );

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => w.code === 'DEPENDS_ON_CYCLE')).toBe(true);
  });

  it('warns on references to deprecated cards (via @see or relations)', async () => {
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'dep.card.md'),
      `---\nkey: dep\nsummary: Dep\nstatus: deprecated\n---\nBody\n`,
    );
    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'a.card.md'),
      `---\nkey: a\nsummary: A\nstatus: draft\nrelations:\n  - type: references\n    target: dep\n---\nBody\n`,
    );
    await writeText(
      join(projectRoot!, 'src', 'a.ts'),
      `/**\n * @see dep\n */\nexport function a() {}\n`,
    );

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => w.code === 'REFERENCES_DEPRECATED_CARD')).toBe(true);
  });

  it('errors when a card uses unregistered keywords/tags', async () => {
    await seedRegistry({ keywords: ['auth'], tags: ['core'] });

    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'a.card.md'),
      `---\nkey: a\nsummary: A\nstatus: draft\nkeywords:\n  - auth\n  - not-registered\ntags:\n  - core\n  - unknown-tag\n---\nBody\n`,
    );

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'CARD_CLASSIFICATION_NOT_REGISTERED')).toBe(true);
  });

  it('passes when a card uses only registered keywords/tags', async () => {
    await seedRegistry({ keywords: ['auth', 'jwt'], tags: ['core', 'auth-module'] });

    await writeText(
      join(projectRoot!, '.zipbul', 'cards', 'a.card.md'),
      `---\nkey: a\nsummary: A\nstatus: draft\nkeywords:\n  - auth\n  - jwt\ntags:\n  - core\n  - auth-module\n---\nBody\n`,
    );

    const res = await verifyProject({ projectRoot: projectRoot!, config });
    expect(res.ok).toBe(true);
    expect(res.errors.some((e) => e.code === 'CARD_CLASSIFICATION_NOT_REGISTERED')).toBe(false);
  });
});
