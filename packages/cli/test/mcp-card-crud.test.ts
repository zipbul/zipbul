import { afterEach, describe, expect, it } from 'bun:test';

import type { ResolvedZipbulConfig } from '../src/config/interfaces';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'path';

import { cardCreate, cardDelete, cardRename, cardUpdate, cardUpdateStatus } from '../src/mcp/card/card-crud';

const config: ResolvedZipbulConfig = {
  module: { fileName: 'module.ts' },
  sourceDir: './src',
  entry: './src/main.ts',
  mcp: {
    card: { relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'] },
    exclude: [],
  },
} as any;

describe('mcp/card — card CRUD (integration)', () => {
  let root: string | null = null;

  async function makeRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'zipbul_p3_'));
    root = dir;
    return dir;
  }

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = null;
    }
  });

  it('creates then updates then deletes a card file', async () => {
    const projectRoot = await makeRoot();

    const created = await cardCreate({
      projectRoot,
      config,
      slug: 'auth/login',
      summary: 'Login',
      body: 'Body\n',
      keywords: ['auth', 'mvp'],
    } as any);

    const createdText = await Bun.file(created.filePath).text();
    expect(createdText).toContain('key: auth/login');
    expect(createdText).not.toContain('type:');

    const updated = await cardUpdate(projectRoot, 'auth/login', {
      summary: 'Login2',
      body: 'Body2\n',
      keywords: ['auth'],
    } as any);

    const updatedText = await Bun.file(updated.filePath).text();
    expect(updatedText).toContain('summary: Login2');
    expect(updatedText).toContain('Body2');

    await cardUpdateStatus(projectRoot, 'auth/login', 'accepted');
    const statusText = await Bun.file(updated.filePath).text();
    expect(statusText).toContain('status: accepted');

    await cardDelete(projectRoot, 'auth/login');
    const exists = await Bun.file(updated.filePath).exists();
    expect(exists).toBe(false);
  });

  it('renames a card file and updates its key', async () => {
    const projectRoot = await makeRoot();

    const created = await cardCreate({
      projectRoot,
      config,
      slug: 'auth/login',
      summary: 'Login',
      body: 'Body\n',
    } as any);

    const renamed = await cardRename(projectRoot, 'auth/login', 'auth/new-login');

    expect(renamed.oldFilePath).toBe(created.filePath);
    expect(renamed.newFilePath).toBe(join(projectRoot, '.zipbul', 'cards', 'auth/new-login.card.md'));

    const oldExists = await Bun.file(created.filePath).exists();
    expect(oldExists).toBe(false);

    const newText = await Bun.file(renamed.newFilePath).text();
    expect(newText).toContain('key: auth/new-login');
  });
});
