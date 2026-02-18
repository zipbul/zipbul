import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import type { ResolvedZipbulConfig } from '../../config';
import type { CardFile } from './types';

import * as fsp from 'node:fs/promises';

import * as crud from './card-crud';
import * as fs from './card-fs';
import { zipbulCardMarkdownPath } from '../../common/zipbul-paths';

describe('mcp/card — card CRUD (unit)', () => {
  const config: ResolvedZipbulConfig = {
    module: { fileName: 'module.ts' },
    sourceDir: './src',
    entry: './src/main.ts',
    mcp: {
      card: { relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'] },
      exclude: [],
    },
  } as any;

  let bunFileSpy: ReturnType<typeof spyOn> | undefined;
  let mkdirSpy: ReturnType<typeof spyOn> | undefined;
  let renameSpy: ReturnType<typeof spyOn> | undefined;
  let readCardFileSpy: ReturnType<typeof spyOn> | undefined;
  let writeCardFileSpy: ReturnType<typeof spyOn> | undefined;

  type FakeBunFile = {
    exists: () => Promise<boolean>;
    delete: () => Promise<void>;
  };

  const fakeExists = new Map<string, boolean>();

  function setExists(path: string, exists: boolean) {
    fakeExists.set(path, exists);
  }

  function makeFakeBunFile(path: string): FakeBunFile {
    return {
      exists: async () => fakeExists.get(path) ?? false,
      delete: async () => {
        setExists(path, false);
      },
    };
  }

  beforeEach(() => {
    fakeExists.clear();
    bunFileSpy = spyOn(Bun as any, 'file').mockImplementation((path: string) => makeFakeBunFile(path));
    mkdirSpy = spyOn(fsp, 'mkdir').mockResolvedValue(undefined as any);
    renameSpy = spyOn(fsp, 'rename').mockResolvedValue(undefined as any);

    readCardFileSpy = spyOn(fs, 'readCardFile').mockResolvedValue({
      filePath: zipbulCardMarkdownPath('/repo', 'auth/login'),
      frontmatter: {
        key: 'auth/login',
        summary: 'S',
        status: 'draft',
      },
      body: 'Body\n',
    } satisfies CardFile as any);

    writeCardFileSpy = spyOn(fs, 'writeCardFile').mockResolvedValue();
  });

  afterEach(() => {
    bunFileSpy?.mockRestore();
    mkdirSpy?.mockRestore();
    renameSpy?.mockRestore();
    readCardFileSpy?.mockRestore();
    writeCardFileSpy?.mockRestore();
  });

  it('cardCreate writes file with slug-only key', async () => {
    // Arrange
    setExists(zipbulCardMarkdownPath('/repo', 'auth/login'), false);

    // Act
    const out = await crud.cardCreate({
      projectRoot: '/repo',
      config,
      slug: 'auth/login',
      summary: 'Login',
      body: 'B\n',
      keywords: ['auth'],
    } as any);

    // Assert
    expect(out.fullKey).toBe('auth/login');
    expect(out.filePath).toBe(zipbulCardMarkdownPath('/repo', 'auth/login'));
    expect(mkdirSpy!).toHaveBeenCalledTimes(1);
    expect(writeCardFileSpy!).toHaveBeenCalledTimes(1);
  });

  it('cardCreate writes tags when provided', async () => {
    // Arrange
    setExists(zipbulCardMarkdownPath('/repo', 'auth/login'), false);

    // Act
    await crud.cardCreate({
      projectRoot: '/repo',
      config,
      slug: 'auth/login',
      summary: 'Login',
      body: 'B\n',
      tags: ['auth-module', 'user-facing'],
    } as any);

    // Assert
    expect(writeCardFileSpy!).toHaveBeenCalledTimes(1);
    const call = (writeCardFileSpy as any).mock.calls[0] as any[];
    const card = call?.[1];
    expect(card?.frontmatter?.tags).toEqual(['auth-module', 'user-facing']);
  });

  it('cardCreate rejects unsafe slugs', async () => {
    await expect(() =>
      crud.cardCreate({
        projectRoot: '/repo',
        config,
        slug: '../x',
        summary: 'S',
        body: '',
      } as any),
    ).toThrow();
  });

  it('cardUpdate updates summary/body/keywords', async () => {
    // Arrange
    readCardFileSpy!.mockResolvedValueOnce({
      filePath: zipbulCardMarkdownPath('/repo', 'auth/login'),
      frontmatter: { key: 'auth/login', summary: 'Old', status: 'draft' },
      body: 'OldBody\n',
    } as any);

    // Act
    const out = await crud.cardUpdate('/repo', 'auth/login', {
      summary: 'New',
      body: 'NewBody\n',
      keywords: ['k1', 'k2'],
    } as any);

    // Assert
    expect(out.card.frontmatter.summary).toBe('New');
    expect(out.card.frontmatter.keywords).toEqual(['k1', 'k2']);
    expect(out.card.body).toBe('NewBody\n');
    expect(writeCardFileSpy!).toHaveBeenCalledTimes(1);
  });

  it('cardUpdate updates tags', async () => {
    // Arrange
    readCardFileSpy!.mockResolvedValueOnce({
      filePath: zipbulCardMarkdownPath('/repo', 'auth/login'),
      frontmatter: { key: 'auth/login', summary: 'Old', status: 'draft' },
      body: 'OldBody\n',
    } as any);

    // Act
    const out = await crud.cardUpdate('/repo', 'auth/login', {
      tags: ['t1', 't2'],
    } as any);

    // Assert
    expect(out.card.frontmatter.tags).toEqual(['t1', 't2']);
    expect(writeCardFileSpy!).toHaveBeenCalledTimes(1);
  });

  it('cardDelete deletes when exists', async () => {
    // Arrange
    setExists(zipbulCardMarkdownPath('/repo', 'auth/login'), true);

    // Act
    const out = await crud.cardDelete('/repo', 'auth/login');

    // Assert
    expect(out.filePath).toBe(zipbulCardMarkdownPath('/repo', 'auth/login'));
    expect(bunFileSpy!).toHaveBeenCalledWith(zipbulCardMarkdownPath('/repo', 'auth/login'));
    expect(await Bun.file(zipbulCardMarkdownPath('/repo', 'auth/login')).exists()).toBe(false);
  });

  it('cardRename renames file and updates key', async () => {
    // Arrange
    setExists(zipbulCardMarkdownPath('/repo', 'auth/login'), true);
    setExists(zipbulCardMarkdownPath('/repo', 'auth/new'), false);

    readCardFileSpy!.mockResolvedValueOnce({
      filePath: zipbulCardMarkdownPath('/repo', 'auth/new'),
      frontmatter: { key: 'auth/login', summary: 'S', status: 'draft' },
      body: 'Body\n',
    } as any);

    // Act
    const out = await crud.cardRename('/repo', 'auth/login', 'auth/new');

    // Assert
    expect(out.newFullKey).toBe('auth/new');
    expect(renameSpy!).toHaveBeenCalledTimes(1);
    expect(writeCardFileSpy!).toHaveBeenCalledTimes(1);
    expect(out.card.frontmatter.key).toBe('auth/new');
  });
});
