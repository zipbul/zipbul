import type { ResolvedZipbulConfig } from '../../config';
import type { CardFile, CardFrontmatter, CardRelation, CardStatus } from './types';

import { dirname } from 'path';
import * as fsp from 'node:fs/promises';

import { parseFullKey, cardPathFromFullKey, normalizeSlug } from './card-key';
import { readCardFile, writeCardFile } from './card-fs';

export interface CardCreateInput {
  projectRoot: string;
  config: ResolvedZipbulConfig;
  slug: string;
  summary: string;
  body: string;
  keywords?: string[];
  tags?: string[];
}

export interface CardUpdateFields {
  summary?: string;
  body?: string;
  keywords?: string[] | null;
  tags?: string[] | null;
  constraints?: unknown;
  relations?: CardRelation[] | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (!isNonEmptyString(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function normalizeKeywordsInput(keywords: string[] | undefined): string[] | undefined {
  if (keywords === undefined) {
    return undefined;
  }

  if (!Array.isArray(keywords)) {
    throw new Error('Invalid keywords');
  }

  const out: string[] = [];
  for (const item of keywords) {
    if (!isNonEmptyString(item)) {
      throw new Error('Invalid keywords');
    }
    out.push(item);
  }

  return out.length > 0 ? out : undefined;
}

function normalizeTagsInput(tags: string[] | undefined): string[] | undefined {
  if (tags === undefined) {
    return undefined;
  }

  if (!Array.isArray(tags)) {
    throw new Error('Invalid tags');
  }

  const out: string[] = [];
  for (const item of tags) {
    if (!isNonEmptyString(item)) {
      throw new Error('Invalid tags');
    }
    out.push(item);
  }

  return out.length > 0 ? out : undefined;
}

export async function cardCreate(input: CardCreateInput): Promise<{ filePath: string; fullKey: string; card: CardFile }> {
  const { projectRoot, slug, summary, body } = input;

  assertNonEmptyString(projectRoot, 'projectRoot');
  assertNonEmptyString(slug, 'slug');
  assertNonEmptyString(summary, 'summary');

  const normalizedSlug = normalizeSlug(slug);
  const fullKey = normalizedSlug;
  const filePath = cardPathFromFullKey(projectRoot, fullKey);

  const keywords = normalizeKeywordsInput(input.keywords);
  const tags = normalizeTagsInput(input.tags);

  const frontmatter: CardFrontmatter = {
    key: fullKey,
    summary,
    status: 'draft',
  };

  if (keywords !== undefined) {
    frontmatter.keywords = keywords;
  }

  if (tags !== undefined) {
    frontmatter.tags = tags;
  }

  const exists = await Bun.file(filePath).exists();
  if (exists) {
    throw new Error(`Card already exists: ${fullKey}`);
  }

  await fsp.mkdir(dirname(filePath), { recursive: true });

  const card: CardFile = {
    filePath,
    frontmatter,
    body: body ?? '',
  };

  await writeCardFile(filePath, card);

  return { filePath, fullKey, card };
}

export async function cardUpdate(
  projectRoot: string,
  fullKey: string,
  fields: CardUpdateFields,
): Promise<{ filePath: string; card: CardFile }> {
  assertNonEmptyString(projectRoot, 'projectRoot');
  assertNonEmptyString(fullKey, 'fullKey');

  const filePath = cardPathFromFullKey(projectRoot, fullKey);
  const current = await readCardFile(filePath);

  if (current.frontmatter.key !== fullKey) {
    throw new Error('Card key mismatch');
  }

  const nextFrontmatter: CardFrontmatter = { ...current.frontmatter };

  if (fields.summary !== undefined) {
    assertNonEmptyString(fields.summary, 'summary');
    nextFrontmatter.summary = fields.summary;
  }

  if (fields.keywords !== undefined) {
    if (fields.keywords === null || fields.keywords.length === 0) {
      delete nextFrontmatter.keywords;
    } else {
      const normalized = normalizeKeywordsInput(fields.keywords);
      if (normalized === undefined) {
        delete nextFrontmatter.keywords;
      } else {
        nextFrontmatter.keywords = normalized;
      }
    }
  }

  if (fields.tags !== undefined) {
    if (fields.tags === null || fields.tags.length === 0) {
      delete nextFrontmatter.tags;
    } else {
      const normalized = normalizeTagsInput(fields.tags);
      if (normalized === undefined) {
        delete nextFrontmatter.tags;
      } else {
        nextFrontmatter.tags = normalized;
      }
    }
  }

  if (fields.constraints !== undefined) {
    nextFrontmatter.constraints = fields.constraints;
  }

  if (fields.relations !== undefined) {
    if (fields.relations === null || fields.relations.length === 0) {
      delete nextFrontmatter.relations;
    } else {
      nextFrontmatter.relations = fields.relations;
    }
  }

  const nextBody = fields.body !== undefined ? fields.body : current.body;

  const next: CardFile = {
    filePath,
    frontmatter: nextFrontmatter,
    body: nextBody,
  };

  await writeCardFile(filePath, next);
  return { filePath, card: next };
}

export async function cardUpdateStatus(
  projectRoot: string,
  fullKey: string,
  status: CardStatus,
): Promise<{ filePath: string; card: CardFile }> {
  assertNonEmptyString(projectRoot, 'projectRoot');
  assertNonEmptyString(fullKey, 'fullKey');

  const filePath = cardPathFromFullKey(projectRoot, fullKey);
  const current = await readCardFile(filePath);

  if (current.frontmatter.key !== fullKey) {
    throw new Error('Card key mismatch');
  }

  const next: CardFile = {
    filePath,
    frontmatter: {
      ...current.frontmatter,
      status,
    },
    body: current.body,
  };

  await writeCardFile(filePath, next);
  return { filePath, card: next };
}

export async function cardDelete(projectRoot: string, fullKey: string): Promise<{ filePath: string }> {
  assertNonEmptyString(projectRoot, 'projectRoot');
  assertNonEmptyString(fullKey, 'fullKey');

  const filePath = cardPathFromFullKey(projectRoot, fullKey);
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`Card not found: ${fullKey}`);
  }

  await file.delete();
  return { filePath };
}

export async function cardRename(
  projectRoot: string,
  fullKey: string,
  newSlug: string,
): Promise<{ oldFilePath: string; newFilePath: string; newFullKey: string; card: CardFile }> {
  assertNonEmptyString(projectRoot, 'projectRoot');
  assertNonEmptyString(fullKey, 'fullKey');
  assertNonEmptyString(newSlug, 'newSlug');

  // Validate current key and normalize the target slug.
  parseFullKey(fullKey);
  const normalizedNewSlug = normalizeSlug(newSlug);
  const newFullKey = normalizedNewSlug;

  const oldFilePath = cardPathFromFullKey(projectRoot, fullKey);
  const newFilePath = cardPathFromFullKey(projectRoot, newFullKey);

  if (oldFilePath === newFilePath) {
    throw new Error('No-op rename');
  }

  const existsOld = await Bun.file(oldFilePath).exists();
  if (!existsOld) {
    throw new Error(`Card not found: ${fullKey}`);
  }

  const existsNew = await Bun.file(newFilePath).exists();
  if (existsNew) {
    throw new Error(`Target card already exists: ${newFullKey}`);
  }

  await fsp.mkdir(dirname(newFilePath), { recursive: true });
  await fsp.rename(oldFilePath, newFilePath);

  const current = await readCardFile(newFilePath);
  const next: CardFile = {
    filePath: newFilePath,
    frontmatter: {
      ...current.frontmatter,
      key: newFullKey,
    },
    body: current.body,
  };

  await writeCardFile(newFilePath, next);
  return { oldFilePath, newFilePath, newFullKey, card: next };
}
