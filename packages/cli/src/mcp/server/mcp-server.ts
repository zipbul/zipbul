import type { ResolvedBunnerConfig } from '../../config';

import { relative } from 'node:path';

import { CARD_RELATION_TYPES } from '../../config';

import { declareTool, ToolRegistry } from './tool-registry';

import * as z from 'zod/v3';

import { verifyProject } from '../verify/verify-project';
import { indexProject } from '../index/index-project';
import {
  cardCreate,
  cardDelete,
  cardRename,
  cardUpdate,
  cardUpdateStatus,
} from '../card/card-crud';

import { parseSync } from 'oxc-parser';

import { bunnerCacheDirPath, bunnerCacheFilePath } from '../../common/bunner-paths';
import { closeDb, createDb } from '../../store/connection';
import { OwnerElection } from '../../watcher/owner-election';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  card,
  cardCodeLink,
  cardFts,
  cardKeyword,
  cardTag,
  cardRelation,
  codeEntity,
  codeFts,
  codeRelation,
  keyword,
  tag,
} from '../../store/schema';

import { cardPathFromFullKey, parseFullKey } from '../card/card-key';
import { readCardFile, writeCardFile } from '../card/card-fs';
import type { CardRelation as CardRelationModel } from '../card/types';

type StoreDb = ReturnType<typeof createDb>;

function normalizeSourceDirRel(value: string): string {
  const trimmed = value.trim();
  const withoutDotSlash = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
  const withoutTrailing = withoutDotSlash.replace(/\/+$/, '');
  return withoutTrailing.length === 0 ? 'src' : withoutTrailing;
}

function withDbTransaction<T>(db: StoreDb, fn: () => T): T {
  db.run(sql`BEGIN`);
  try {
    const out = fn();
    db.run(sql`COMMIT`);
    return out;
  } catch (err) {
    try {
      db.run(sql`ROLLBACK`);
    } catch {
      // ignore
    }
    throw err;
  }
}

function listKeywordNamesForCard(db: StoreDb, cardKeyValue: string): string[] {
  const rows = db
    .select({ name: keyword.name })
    .from(cardKeyword)
    .innerJoin(keyword, eq(keyword.id, cardKeyword.keywordId))
    .where(eq(cardKeyword.cardKey, cardKeyValue))
    .orderBy(keyword.name)
    .all() as Array<{ name: string }>;

  return rows.map((r) => r.name);
}

export interface SearchCardsInput {
  projectRoot: string;
  query: string;
  limit: number;
}

export interface SearchCardsResult {
  results: Array<{ key: string; summary: string; status: string; score: number }>;
}

export interface SearchCodeInput {
  projectRoot: string;
  query: string;
  limit: number;
}

export interface SearchCodeResult {
  results: Array<{
    entityKey: string;
    symbolName: string | null;
    filePath: string;
    kind: string;
    score: number;
  }>;
}

export interface GetCardInput {
  projectRoot: string;
  key: string;
}

export interface GetCardResult {
  card: {
    key: string;
    summary: string;
    status: string;
    keywords: string[];
    constraintsJson?: string | null;
    body?: string | null;
    filePath?: string;
    updatedAt?: string;
  } | null;
}

export interface GetCodeEntityInput {
  projectRoot: string;
  entityKey: string;
}

export interface GetCodeEntityResult {
  entity: {
    entityKey: string;
    filePath: string;
    symbolName: string | null;
    kind: string;
    signature?: string | null;
    fingerprint?: string | null;
    contentHash?: string;
    updatedAt?: string;
  } | null;
}

export interface ListCardRelationsInput {
  projectRoot: string;
  cardKey: string;
}

export interface ListCardRelationsResult {
  relations: Array<{
    type: string;
    srcCardKey: string;
    dstCardKey: string;
    isReverse: boolean;
    metaJson: string | null;
  }>;
}

export interface ListCardCodeLinksInput {
  projectRoot: string;
  cardKey: string;
}

export interface ListCardCodeLinksResult {
  links: Array<{
    type: string;
    cardKey: string;
    entityKey: string;
    filePath: string;
    symbolName: string | null;
    metaJson: string | null;
  }>;
}

export interface SearchInput {
  projectRoot: string;
  query: string;
  limit: number;
}

export interface SearchResult {
  cards: SearchCardsResult['results'];
  code: SearchCodeResult['results'];
}

export type ContextTarget =
  | { kind: 'card'; key: string }
  | { kind: 'code'; entityKey: string };

export interface GetContextInput {
  projectRoot: string;
  target: ContextTarget;
}

export interface GetContextResult {
  target: ContextTarget;
  card: GetCardResult['card'];
  codeEntity: GetCodeEntityResult['entity'];
  relations: ListCardRelationsResult['relations'];
  codeLinks: ListCardCodeLinksResult['links'];
  linkedCards: Array<{ key: string; summary: string; status: string }>;
  linkedCode: Array<{ entityKey: string; filePath: string; symbolName: string | null; kind: string }>;
  codeRelations: Array<{ type: string; srcEntityKey: string; dstEntityKey: string; metaJson: string | null }>;
}

export interface GetSubgraphInput {
  projectRoot: string;
  centerKey: string;
  hops: number;
}

export interface GetSubgraphResult {
  nodes: Array<{ key: string; kind: 'card' | 'code' }>;
  edges: Array<{ type: string; from: string; to: string }>;
}

export interface ImpactAnalysisInput {
  projectRoot: string;
  cardKey: string;
  depth: number;
}

export interface ImpactAnalysisResult {
  affectedCards: Array<{ key: string; summary: string; status: string }>;
  affectedCode: Array<{ entityKey: string; filePath: string; symbolName: string | null; kind: string }>;
}

export interface TraceChainInput {
  projectRoot: string;
  fromKey: string;
  toKey: string;
  maxHops: number;
}

export interface TraceChainResult {
  path: string[] | null;
}

export interface CoverageReportInput {
  projectRoot: string;
  cardKey: string;
}

export interface CoverageReportResult {
  card: GetCardResult['card'];
  codeLinks: ListCardCodeLinksResult['links'];
  linkedEntityCount: number;
}

export interface ListUnlinkedInput {
  projectRoot: string;
  status?: string;
  limit: number;
}

export interface ListUnlinkedResult {
  cards: Array<{ key: string; summary: string; status: string; linkCount: number }>;
}

export interface ListCardsInput {
  projectRoot: string;
  status?: string;
  keyword?: string;
  tags?: string[];
  limit: number;
}

export interface ListCardsResult {
  cards: Array<{ key: string; summary: string; status: string }>;
}

export interface GetRelationsInput {
  projectRoot: string;
  cardKey: string;
  direction: 'outgoing' | 'incoming' | 'both';
}

export interface GetRelationsResult {
  relations: ListCardRelationsResult['relations'];
}

export interface CardCreateToolInput {
  slug: string;
  summary: string;
  body?: string;
  keywords?: string[];
  tags?: string[];
}

export interface CardUpdateToolInput {
  fullKey: string;
  summary?: string;
  body?: string;
  keywords?: string[] | null;
  tags?: string[] | null;
  constraints?: unknown;
  relations?: Array<{ type: string; target: string }> | null;
}

export interface CardDeleteToolInput {
  fullKey: string;
}

export interface CardRenameToolInput {
  fullKey: string;
  newSlug: string;
}

export interface CardUpdateStatusToolInput {
  fullKey: string;
  status: 'draft' | 'accepted' | 'implementing' | 'implemented' | 'deprecated';
}

export interface LinkToolInput {
  filePath: string;
  cardKey: string;
}

export interface RelationToolInput {
  srcKey: string;
  dstKey: string;
  type: string;
}

function clampLimit(limit: unknown, fallback: number): number {
  const n = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < 1) return 1;
  if (i > 50) return 50;
  return i;
}

async function searchCardsDefault(input: SearchCardsInput, deps: { createDb: typeof createDb; closeDb: typeof closeDb }): Promise<SearchCardsResult> {
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);

  try {
    const scoreExpr = sql<number>`bm25(${cardFts})`;
    const rows = db
      .select({
        key: card.key,
        summary: card.summary,
        status: card.status,
        score: scoreExpr,
      })
      .from(cardFts)
      .innerJoin(card, eq(card.key, cardFts.key))
      .where(sql`${cardFts} MATCH ${input.query}`)
      .orderBy(scoreExpr)
      .limit(input.limit)
      .all() as Array<{ key: string; summary: string; status: string; score: number }>;

    return { results: rows ?? [] };
  } finally {
    deps.closeDb(db);
  }
}

async function searchCodeDefault(input: SearchCodeInput, deps: { createDb: typeof createDb; closeDb: typeof closeDb }): Promise<SearchCodeResult> {
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);

  try {
    const scoreExpr = sql<number>`bm25(${codeFts})`;
    const rows = db
      .select({
        entityKey: codeEntity.entityKey,
        symbolName: codeEntity.symbolName,
        filePath: codeEntity.filePath,
        kind: codeEntity.kind,
        score: scoreExpr,
      })
      .from(codeFts)
      .innerJoin(codeEntity, eq(codeEntity.entityKey, codeFts.entityKey))
      .where(sql`${codeFts} MATCH ${input.query}`)
      .orderBy(scoreExpr)
      .limit(input.limit)
      .all() as Array<{ entityKey: string; symbolName: string | null; filePath: string; kind: string; score: number }>;

    return { results: rows ?? [] };
  } finally {
    deps.closeDb(db);
  }
}

async function getCardDefault(input: GetCardInput, deps: { createDb: typeof createDb; closeDb: typeof closeDb }): Promise<GetCardResult> {
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);

  try {
    const row = db
      .select({
        key: card.key,
        summary: card.summary,
        status: card.status,
        constraintsJson: card.constraintsJson,
        body: card.body,
        filePath: card.filePath,
        updatedAt: card.updatedAt,
      })
      .from(card)
      .where(eq(card.key, input.key))
      .limit(1)
      .get() as
      | {
          key: string;
          summary: string;
          status: string;
          constraintsJson: string | null;
          body: string | null;
          filePath: string;
          updatedAt: string;
        }
      | undefined;

    if (!row) {
      return { card: null };
    }

    const keywords = listKeywordNamesForCard(db as any, row.key);
    return { card: { ...row, keywords } };
  } finally {
    deps.closeDb(db);
  }
}

async function getCodeEntityDefault(
  input: GetCodeEntityInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<GetCodeEntityResult> {
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);

  try {
    const row = db
      .select({
        entityKey: codeEntity.entityKey,
        filePath: codeEntity.filePath,
        symbolName: codeEntity.symbolName,
        kind: codeEntity.kind,
        signature: codeEntity.signature,
        fingerprint: codeEntity.fingerprint,
        contentHash: codeEntity.contentHash,
        updatedAt: codeEntity.updatedAt,
      })
      .from(codeEntity)
      .where(eq(codeEntity.entityKey, input.entityKey))
      .limit(1)
      .get() as
      | {
          entityKey: string;
          filePath: string;
          symbolName: string | null;
          kind: string;
          signature: string | null;
          fingerprint: string | null;
          contentHash: string;
          updatedAt: string;
        }
      | undefined;

    return { entity: row ?? null };
  } finally {
    deps.closeDb(db);
  }
}

async function listCardRelationsDefault(
  input: ListCardRelationsInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<ListCardRelationsResult> {
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);

  try {
    const rows = db
      .select({
        type: cardRelation.type,
        srcCardKey: cardRelation.srcCardKey,
        dstCardKey: cardRelation.dstCardKey,
        isReverse: cardRelation.isReverse,
        metaJson: cardRelation.metaJson,
      })
      .from(cardRelation)
      .where(or(eq(cardRelation.srcCardKey, input.cardKey), eq(cardRelation.dstCardKey, input.cardKey)))
      .orderBy(cardRelation.id)
      .all() as Array<{
      type: string;
      srcCardKey: string;
      dstCardKey: string;
      isReverse: boolean;
      metaJson: string | null;
    }>;

    return { relations: rows ?? [] };
  } finally {
    deps.closeDb(db);
  }
}

async function listCardCodeLinksDefault(
  input: ListCardCodeLinksInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<ListCardCodeLinksResult> {
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);

  try {
    const rows = db
      .select({
        type: cardCodeLink.type,
        cardKey: cardCodeLink.cardKey,
        entityKey: cardCodeLink.entityKey,
        filePath: cardCodeLink.filePath,
        symbolName: cardCodeLink.symbolName,
        metaJson: cardCodeLink.metaJson,
      })
      .from(cardCodeLink)
      .where(eq(cardCodeLink.cardKey, input.cardKey))
      .orderBy(cardCodeLink.id)
      .all() as Array<{
      type: string;
      cardKey: string;
      entityKey: string;
      filePath: string;
      symbolName: string | null;
      metaJson: string | null;
    }>;

    return { links: rows ?? [] };
  } finally {
    deps.closeDb(db);
  }
}

async function searchDefault(
  input: SearchInput,
  deps: {
    searchCards: (input: SearchCardsInput) => Promise<SearchCardsResult>;
    searchCode: (input: SearchCodeInput) => Promise<SearchCodeResult>;
  },
): Promise<SearchResult> {
  const [cards, code] = await Promise.all([
    deps.searchCards({ projectRoot: input.projectRoot, query: input.query, limit: input.limit }),
    deps.searchCode({ projectRoot: input.projectRoot, query: input.query, limit: input.limit }),
  ]);
  return { cards: cards.results, code: code.results };
}

function isCardKey(value: string): boolean {
  // Card keys are slug-only. Code entities are prefixed (module:/symbol:).
  return !(value.startsWith('module:') || value.startsWith('symbol:'));
}

async function getContextDefault(
  input: GetContextInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<GetContextResult> {
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);
  try {
    if (input.target.kind === 'card') {
      const cardRow =
        (db
          .select({
            key: card.key,
            summary: card.summary,
            status: card.status,
            constraintsJson: card.constraintsJson,
            body: card.body,
            filePath: card.filePath,
            updatedAt: card.updatedAt,
          })
          .from(card)
          .where(eq(card.key, input.target.key))
          .limit(1)
          .get() as any) ?? null;

      const cardRowWithKeywords =
        cardRow === null
          ? null
          : {
              ...cardRow,
              keywords: listKeywordNamesForCard(db as any, String(cardRow.key)),
            };

      const relations = db
        .select({
          type: cardRelation.type,
          srcCardKey: cardRelation.srcCardKey,
          dstCardKey: cardRelation.dstCardKey,
          isReverse: cardRelation.isReverse,
          metaJson: cardRelation.metaJson,
        })
        .from(cardRelation)
        .where(or(eq(cardRelation.srcCardKey, input.target.key), eq(cardRelation.dstCardKey, input.target.key)))
        .orderBy(cardRelation.id)
        .all();

      const codeLinks = db
        .select({
          type: cardCodeLink.type,
          cardKey: cardCodeLink.cardKey,
          entityKey: cardCodeLink.entityKey,
          filePath: cardCodeLink.filePath,
          symbolName: cardCodeLink.symbolName,
          metaJson: cardCodeLink.metaJson,
        })
        .from(cardCodeLink)
        .where(eq(cardCodeLink.cardKey, input.target.key))
        .orderBy(cardCodeLink.id)
        .all();

      const entityKeys = codeLinks.map((l) => l.entityKey);
      const linkedCode =
        entityKeys.length === 0
          ? []
          : db
              .select({
                entityKey: codeEntity.entityKey,
                filePath: codeEntity.filePath,
                symbolName: codeEntity.symbolName,
                kind: codeEntity.kind,
              })
              .from(codeEntity)
              .where(inArray(codeEntity.entityKey, entityKeys))
              .all();

      const linkedCardKeys = new Set<string>();
      for (const r of relations) {
        if (r.srcCardKey !== input.target.key) linkedCardKeys.add(r.srcCardKey);
        if (r.dstCardKey !== input.target.key) linkedCardKeys.add(r.dstCardKey);
      }

      const linkedCards =
        linkedCardKeys.size === 0
          ? []
          : db
              .select({ key: card.key, summary: card.summary, status: card.status })
              .from(card)
              .where(inArray(card.key, Array.from(linkedCardKeys)))
              .all();

      return {
        target: input.target,
        card: cardRowWithKeywords,
        codeEntity: null,
        relations: relations as any,
        codeLinks: codeLinks as any,
        linkedCards,
        linkedCode,
        codeRelations: [],
      };
    }

    const entityRow =
      (db
        .select({
          entityKey: codeEntity.entityKey,
          filePath: codeEntity.filePath,
          symbolName: codeEntity.symbolName,
          kind: codeEntity.kind,
          signature: codeEntity.signature,
          fingerprint: codeEntity.fingerprint,
          contentHash: codeEntity.contentHash,
          updatedAt: codeEntity.updatedAt,
        })
        .from(codeEntity)
        .where(eq(codeEntity.entityKey, input.target.entityKey))
        .limit(1)
        .get() as any) ?? null;

    const codeLinks = db
      .select({
        type: cardCodeLink.type,
        cardKey: cardCodeLink.cardKey,
        entityKey: cardCodeLink.entityKey,
        filePath: cardCodeLink.filePath,
        symbolName: cardCodeLink.symbolName,
        metaJson: cardCodeLink.metaJson,
      })
      .from(cardCodeLink)
      .where(eq(cardCodeLink.entityKey, input.target.entityKey))
      .orderBy(cardCodeLink.id)
      .all();

    const linkedCardKeys = Array.from(new Set(codeLinks.map((l) => l.cardKey)));
    const linkedCards =
      linkedCardKeys.length === 0
        ? []
        : db
            .select({ key: card.key, summary: card.summary, status: card.status })
            .from(card)
            .where(inArray(card.key, linkedCardKeys))
            .all();

    const codeRelations = db
      .select({
        type: codeRelation.type,
        srcEntityKey: codeRelation.srcEntityKey,
        dstEntityKey: codeRelation.dstEntityKey,
        metaJson: codeRelation.metaJson,
      })
      .from(codeRelation)
      .where(or(eq(codeRelation.srcEntityKey, input.target.entityKey), eq(codeRelation.dstEntityKey, input.target.entityKey)))
      .orderBy(codeRelation.id)
      .all();

    return {
      target: input.target,
      card: null,
      codeEntity: entityRow,
      relations: [],
      codeLinks: codeLinks as any,
      linkedCards,
      linkedCode: [],
      codeRelations: codeRelations as any,
    };
  } finally {
    deps.closeDb(db);
  }
}

async function getRelationsDefault(
  input: GetRelationsInput,
  deps: { listCardRelations: (input: ListCardRelationsInput) => Promise<ListCardRelationsResult> },
): Promise<GetRelationsResult> {
  const all = await deps.listCardRelations({ projectRoot: input.projectRoot, cardKey: input.cardKey });
  const filtered = all.relations.filter((r) => {
    if (r.isReverse) return false;
    if (input.direction === 'both') return true;
    if (input.direction === 'outgoing') return r.srcCardKey === input.cardKey;
    return r.dstCardKey === input.cardKey;
  });
  return { relations: filtered };
}

async function listCardsDefault(
  input: ListCardsInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<ListCardsResult> {
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);
  try {
    const limit = input.limit;
    const tags = input.tags?.map((t) => t.trim()).filter((t) => t.length > 0);
    const hasTags = !!tags && tags.length > 0;
    if (input.keyword) {
      if (hasTags) {
        const rows = db
          .select({ key: card.key, summary: card.summary, status: card.status })
          .from(card)
          .innerJoin(cardKeyword, eq(cardKeyword.cardKey, card.key))
          .innerJoin(keyword, eq(keyword.id, cardKeyword.keywordId))
          .innerJoin(cardTag, eq(cardTag.cardKey, card.key))
          .innerJoin(tag, eq(tag.id, cardTag.tagId))
          .where(
            and(
              eq(keyword.name, input.keyword),
              inArray(tag.name, tags),
              input.status ? eq(card.status, input.status) : sql`1=1`,
              sql`1=1`,
            ),
          )
          .groupBy(card.key, card.summary, card.status)
          .orderBy(card.key)
          .limit(limit)
          .all();
        return { cards: rows as any };
      }

      const rows = db
        .select({ key: card.key, summary: card.summary, status: card.status })
        .from(card)
        .innerJoin(cardKeyword, eq(cardKeyword.cardKey, card.key))
        .innerJoin(keyword, eq(keyword.id, cardKeyword.keywordId))
        .where(
          and(
            eq(keyword.name, input.keyword),
            input.status ? eq(card.status, input.status) : sql`1=1`,
            sql`1=1`,
          ),
        )
        .limit(limit)
        .all();
      return { cards: rows as any };
    }

    if (hasTags) {
      const rows = db
        .select({ key: card.key, summary: card.summary, status: card.status })
        .from(card)
        .innerJoin(cardTag, eq(cardTag.cardKey, card.key))
        .innerJoin(tag, eq(tag.id, cardTag.tagId))
        .where(
          and(
            inArray(tag.name, tags),
            input.status ? eq(card.status, input.status) : sql`1=1`,
            sql`1=1`,
          ),
        )
        .groupBy(card.key, card.summary, card.status)
        .orderBy(card.key)
        .limit(limit)
        .all();
      return { cards: rows as any };
    }

    const whereParts: any[] = [];
    if (input.status) whereParts.push(eq(card.status, input.status));

    const where = whereParts.length === 0 ? undefined : whereParts.reduce((acc, cur) => (acc ? and(acc, cur) : cur), null);

    const rows = (where ? db.select({ key: card.key, summary: card.summary, status: card.status }).from(card).where(where) :
      db.select({ key: card.key, summary: card.summary, status: card.status }).from(card)
    )
      .limit(limit)
      .all();

    return { cards: rows as any };
  } finally {
    deps.closeDb(db);
  }
}

async function listUnlinkedDefault(
  input: ListUnlinkedInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<ListUnlinkedResult> {
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);
  try {
    const linkCountExpr = sql<number>`count(${cardCodeLink.id})`;
    const base = db
      .select({
        key: card.key,
        summary: card.summary,
        status: card.status,
        linkCount: linkCountExpr,
      })
      .from(card)
      .leftJoin(cardCodeLink, eq(cardCodeLink.cardKey, card.key))
      .groupBy(card.key, card.summary, card.status)
      .having(sql`${linkCountExpr} = 0`);

    const rows = (input.status ? base.where(eq(card.status, input.status)) : base).limit(input.limit).all();
    return { cards: rows as any };
  } finally {
    deps.closeDb(db);
  }
}

async function coverageReportDefault(
  input: CoverageReportInput,
  deps: {
    getCard: (input: GetCardInput) => Promise<GetCardResult>;
    listCardCodeLinks: (input: ListCardCodeLinksInput) => Promise<ListCardCodeLinksResult>;
  },
): Promise<CoverageReportResult> {
  const [c, links] = await Promise.all([
    deps.getCard({ projectRoot: input.projectRoot, key: input.cardKey }),
    deps.listCardCodeLinks({ projectRoot: input.projectRoot, cardKey: input.cardKey }),
  ]);

  return { card: c.card, codeLinks: links.links, linkedEntityCount: links.links.length };
}

async function getSubgraphDefault(
  input: GetSubgraphInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<GetSubgraphResult> {
  const hops = Math.max(0, Math.min(5, Math.trunc(input.hops)));
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);
  try {
    const nodes = new Map<string, { key: string; kind: 'card' | 'code' }>();
    const edges: Array<{ type: string; from: string; to: string }> = [];

    const queue: Array<{ key: string; depth: number }> = [{ key: input.centerKey, depth: 0 }];
    const visited = new Set<string>([input.centerKey]);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const kind: 'card' | 'code' = isCardKey(cur.key) ? 'card' : 'code';
      nodes.set(cur.key, { key: cur.key, kind });
      if (cur.depth >= hops) continue;

      if (kind === 'card') {
        const rels = db
          .select({ type: cardRelation.type, src: cardRelation.srcCardKey, dst: cardRelation.dstCardKey, isReverse: cardRelation.isReverse })
          .from(cardRelation)
          .where(or(eq(cardRelation.srcCardKey, cur.key), eq(cardRelation.dstCardKey, cur.key)))
          .all();

        for (const r of rels) {
          const other = r.src === cur.key ? r.dst : r.src;
          edges.push({ type: `card_relation:${r.type}`, from: cur.key, to: other });
          if (!visited.has(other)) {
            visited.add(other);
            queue.push({ key: other, depth: cur.depth + 1 });
          }
        }

        const links = db
          .select({ entityKey: cardCodeLink.entityKey })
          .from(cardCodeLink)
          .where(eq(cardCodeLink.cardKey, cur.key))
          .all();

        for (const l of links) {
          edges.push({ type: 'card_code_link:see', from: cur.key, to: l.entityKey });
          if (!visited.has(l.entityKey)) {
            visited.add(l.entityKey);
            queue.push({ key: l.entityKey, depth: cur.depth + 1 });
          }
        }
      } else {
        const links = db
          .select({ cardKey: cardCodeLink.cardKey })
          .from(cardCodeLink)
          .where(eq(cardCodeLink.entityKey, cur.key))
          .all();
        for (const l of links) {
          edges.push({ type: 'card_code_link:see', from: cur.key, to: l.cardKey });
          if (!visited.has(l.cardKey)) {
            visited.add(l.cardKey);
            queue.push({ key: l.cardKey, depth: cur.depth + 1 });
          }
        }

        const rels = db
          .select({ type: codeRelation.type, src: codeRelation.srcEntityKey, dst: codeRelation.dstEntityKey })
          .from(codeRelation)
          .where(or(eq(codeRelation.srcEntityKey, cur.key), eq(codeRelation.dstEntityKey, cur.key)))
          .all();
        for (const r of rels) {
          const other = r.src === cur.key ? r.dst : r.src;
          edges.push({ type: `code_relation:${r.type}`, from: cur.key, to: other });
          if (!visited.has(other)) {
            visited.add(other);
            queue.push({ key: other, depth: cur.depth + 1 });
          }
        }
      }
    }

    return { nodes: Array.from(nodes.values()), edges };
  } finally {
    deps.closeDb(db);
  }
}

async function impactAnalysisDefault(
  input: ImpactAnalysisInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<ImpactAnalysisResult> {
  const depth = Math.max(1, Math.min(10, Math.trunc(input.depth)));
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);
  try {
    const affected = new Set<string>([input.cardKey]);
    const queue: Array<{ key: string; d: number }> = [{ key: input.cardKey, d: 0 }];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.d >= depth) continue;
      // dependents: reverse edges for depends-on
      const dependents = db
        .select({ dst: cardRelation.dstCardKey })
        .from(cardRelation)
        .where(and(eq(cardRelation.srcCardKey, cur.key), eq(cardRelation.type, 'depends-on'), eq(cardRelation.isReverse, true)))
        .all()
        .map((r) => r.dst);

      for (const next of dependents) {
        if (!affected.has(next)) {
          affected.add(next);
          queue.push({ key: next, d: cur.d + 1 });
        }
      }
    }

    const affectedKeys = Array.from(affected);
    const affectedCards = db
      .select({ key: card.key, summary: card.summary, status: card.status })
      .from(card)
      .where(inArray(card.key, affectedKeys))
      .all();

    const links = db
      .select({ entityKey: cardCodeLink.entityKey })
      .from(cardCodeLink)
      .where(inArray(cardCodeLink.cardKey, affectedKeys))
      .all();
    const entityKeys = Array.from(new Set(links.map((l) => l.entityKey)));
    const affectedCode =
      entityKeys.length === 0
        ? []
        : db
            .select({ entityKey: codeEntity.entityKey, filePath: codeEntity.filePath, symbolName: codeEntity.symbolName, kind: codeEntity.kind })
            .from(codeEntity)
            .where(inArray(codeEntity.entityKey, entityKeys))
            .all();

    return { affectedCards: affectedCards as any, affectedCode: affectedCode as any };
  } finally {
    deps.closeDb(db);
  }
}

async function traceChainDefault(
  input: TraceChainInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<TraceChainResult> {
  const maxHops = Math.max(1, Math.min(10, Math.trunc(input.maxHops)));
  const dbPath = bunnerCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);
  try {
    const from = input.fromKey;
    const to = input.toKey;
    if (from === to) return { path: [from] };

    const prev = new Map<string, string>();
    const depth = new Map<string, number>();
    const q: string[] = [from];
    depth.set(from, 0);

    const enqueue = (n: string, p: string, d: number) => {
      if (depth.has(n)) return;
      depth.set(n, d);
      prev.set(n, p);
      q.push(n);
    };

    while (q.length > 0) {
      const cur = q.shift()!;
      const d = depth.get(cur) ?? 0;
      if (d >= maxHops) continue;

      if (isCardKey(cur)) {
        const rels = db
          .select({ src: cardRelation.srcCardKey, dst: cardRelation.dstCardKey })
          .from(cardRelation)
          .where(or(eq(cardRelation.srcCardKey, cur), eq(cardRelation.dstCardKey, cur)))
          .all();
        for (const r of rels) {
          const other = r.src === cur ? r.dst : r.src;
          enqueue(other, cur, d + 1);
          if (other === to) break;
        }

        const links = db
          .select({ entityKey: cardCodeLink.entityKey })
          .from(cardCodeLink)
          .where(eq(cardCodeLink.cardKey, cur))
          .all();
        for (const l of links) {
          enqueue(l.entityKey, cur, d + 1);
          if (l.entityKey === to) break;
        }
      } else {
        const links = db
          .select({ cardKey: cardCodeLink.cardKey })
          .from(cardCodeLink)
          .where(eq(cardCodeLink.entityKey, cur))
          .all();
        for (const l of links) {
          enqueue(l.cardKey, cur, d + 1);
          if (l.cardKey === to) break;
        }

        const rels = db
          .select({ src: codeRelation.srcEntityKey, dst: codeRelation.dstEntityKey })
          .from(codeRelation)
          .where(or(eq(codeRelation.srcEntityKey, cur), eq(codeRelation.dstEntityKey, cur)))
          .all();
        for (const r of rels) {
          const other = r.src === cur ? r.dst : r.src;
          enqueue(other, cur, d + 1);
          if (other === to) break;
        }
      }

      if (depth.has(to)) break;
    }

    if (!depth.has(to)) return { path: null };
    const out: string[] = [];
    let cur: string | undefined = to;
    while (cur) {
      out.push(cur);
      if (cur === from) break;
      cur = prev.get(cur);
    }
    out.reverse();
    return { path: out[0] === from ? out : null };
  } finally {
    deps.closeDb(db);
  }
}

function toAbsPathInProject(projectRoot: string, rel: string): string {
  return joinPath(projectRoot, rel);
}

function normalizePosixRelativePath(input: string): string {
  const raw = input.replace(/\\/g, '/').trim();
  if (raw.length === 0) throw new Error('Invalid path: empty');
  if (raw.startsWith('/')) throw new Error('Invalid path: must be relative');
  if (/^[a-zA-Z]:\//.test(raw)) throw new Error('Invalid path: must be relative');

  const parts = raw.replace(/^\.\//, '').split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (out.length === 0) throw new Error('Invalid path: traversal not allowed');
      out.pop();
      continue;
    }
    out.push(p);
  }
  if (out.length === 0) throw new Error('Invalid path: empty after normalization');
  return out.join('/');
}

function joinPath(projectRoot: string, rel: string): string {
  const root = projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
  const norm = normalizePosixRelativePath(rel);
  return `${root}/${norm}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureSeeBlock(text: string, cardKey: string): string {
  const re = new RegExp(`@see\\s+${escapeRegExp(cardKey)}(\\s|$)`, 'm');
  if (re.test(text)) return text;

  const header = `/**\n * @see ${cardKey}\n */\n`;
  return header + text;
}

function removeSee(text: string, cardKey: string): string {
  const re = new RegExp(`\\n?\\s*\\*?\\s*@see\\s+${escapeRegExp(cardKey)}\\s*\\r?`, 'g');
  return text.replace(re, '\n');
}

async function linkAddDefault(
  input: { projectRoot: string; filePath: string; cardKey: string },
  deps: { parse: (fileName: string, code: string) => unknown },
): Promise<{ filePath: string; changed: boolean }> {
  const abs = toAbsPathInProject(input.projectRoot, input.filePath);
  const file = Bun.file(abs);
  const exists = await file.exists();
  if (!exists) throw new Error(`File not found: ${input.filePath}`);

  const before = await file.text();
  deps.parse(abs, before);
  const after = ensureSeeBlock(before, input.cardKey);
  if (after === before) return { filePath: input.filePath, changed: false };
  deps.parse(abs, after);
  await Bun.write(abs, after);
  return { filePath: input.filePath, changed: true };
}

async function linkRemoveDefault(
  input: { projectRoot: string; filePath: string; cardKey: string },
  deps: { parse: (fileName: string, code: string) => unknown },
): Promise<{ filePath: string; changed: boolean }> {
  const abs = toAbsPathInProject(input.projectRoot, input.filePath);
  const file = Bun.file(abs);
  const exists = await file.exists();
  if (!exists) throw new Error(`File not found: ${input.filePath}`);

  const before = await file.text();
  deps.parse(abs, before);
  const after = removeSee(before, input.cardKey);
  if (after === before) return { filePath: input.filePath, changed: false };
  deps.parse(abs, after);
  await Bun.write(abs, after);
  return { filePath: input.filePath, changed: true };
}

function normalizeRelations(rels: CardRelationModel[] | undefined): CardRelationModel[] {
  if (!rels || rels.length === 0) return [];
  return rels.slice();
}

async function relationAddDefault(input: { projectRoot: string; srcKey: string; dstKey: string; type: string; config: ResolvedBunnerConfig }) {
  if (!input.config.mcp.card.relations.includes(input.type)) {
    throw new Error(`Invalid relation type: ${input.type}`);
  }

  parseFullKey(input.srcKey);
  parseFullKey(input.dstKey);

  const srcPath = cardPathFromFullKey(input.projectRoot, input.srcKey);
  const parsed = await readCardFile(srcPath);
  const current = normalizeRelations(parsed.frontmatter.relations);
  const exists = current.some((r) => r.type === input.type && r.target === input.dstKey);
  if (!exists) {
    current.push({ type: input.type, target: input.dstKey });
  }

  const next = {
    ...parsed,
    frontmatter: {
      ...parsed.frontmatter,
      ...(current.length > 0 ? { relations: current } : {}),
    },
  };
  await writeCardFile(srcPath, next);
  return { filePath: srcPath, changed: !exists };
}

async function relationRemoveDefault(input: { projectRoot: string; srcKey: string; dstKey: string; type: string }) {
  parseFullKey(input.srcKey);
  parseFullKey(input.dstKey);
  const srcPath = cardPathFromFullKey(input.projectRoot, input.srcKey);
  const parsed = await readCardFile(srcPath);
  const current = normalizeRelations(parsed.frontmatter.relations);
  const nextRels = current.filter((r) => !(r.type === input.type && r.target === input.dstKey));
  const changed = nextRels.length !== current.length;
  const next = {
    ...parsed,
    frontmatter: {
      ...parsed.frontmatter,
      ...(nextRels.length > 0 ? { relations: nextRels } : {}),
    },
  };
  if (changed) {
    await writeCardFile(srcPath, next);
  }
  return { filePath: srcPath, changed };
}

async function cardRenameEverywhereDefault(input: {
  projectRoot: string;
  config: ResolvedBunnerConfig;
  oldKey: string;
  newKey: string;
}): Promise<{ updatedCodeFiles: number; updatedCardFiles: number }> {
  const oldKey = input.oldKey;
  const newKey = input.newKey;

  // update card relations across all cards
  const cardGlob = new Bun.Glob('.bunner/cards/**/*.card.md');
  let updatedCardFiles = 0;
  for await (const rel of cardGlob.scan({ cwd: input.projectRoot, onlyFiles: true, dot: true })) {
    const abs = joinPath(input.projectRoot, String(rel));
    const parsed = await readCardFile(abs);
    const rels = parsed.frontmatter.relations ?? [];
    const nextRels = rels.map((r) => (r.target === oldKey ? { ...r, target: newKey } : r));
    const changed = nextRels.some((r, i) => r.target !== rels[i]?.target);
    if (changed) {
      await writeCardFile(abs, {
        ...parsed,
        frontmatter: {
          ...parsed.frontmatter,
          relations: nextRels,
        },
      });
      updatedCardFiles += 1;
    }
  }

  // update code @see references
  const sourceDir = input.config.sourceDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '') || 'src';
  const codeGlob = new Bun.Glob(`${sourceDir}/**/*.ts`);
  let updatedCodeFiles = 0;
  const re = new RegExp(`(@see\\s+)${escapeRegExp(oldKey)}(\\s|$)`, 'g');
  for await (const rel of codeGlob.scan({ cwd: input.projectRoot, onlyFiles: true, dot: true })) {
    const relPath = String(rel);
    if (input.config.mcp.exclude.includes(relPath)) {
      continue;
    }
    const abs = joinPath(input.projectRoot, relPath);
    const file = Bun.file(abs);
    const text = await file.text();
    const next = text.replace(re, `$1${newKey}$2`);
    if (next !== text) {
      await Bun.write(abs, next);
      updatedCodeFiles += 1;
    }
  }

  return { updatedCodeFiles, updatedCardFiles };
}

export interface BunnerMcpContext {
  projectRoot: string;
  config: ResolvedBunnerConfig;
  role?: 'owner' | 'reader';
}

export interface BunnerMcpDeps {
  verifyProject?: typeof verifyProject;
  indexProject?: typeof indexProject;

  searchCards?: (input: SearchCardsInput) => Promise<SearchCardsResult>;
  searchCode?: (input: SearchCodeInput) => Promise<SearchCodeResult>;

  getCard?: (input: GetCardInput) => Promise<GetCardResult>;
  getCodeEntity?: (input: GetCodeEntityInput) => Promise<GetCodeEntityResult>;
  listCardRelations?: (input: ListCardRelationsInput) => Promise<ListCardRelationsResult>;
  listCardCodeLinks?: (input: ListCardCodeLinksInput) => Promise<ListCardCodeLinksResult>;

  search?: (input: SearchInput) => Promise<SearchResult>;
  getContext?: (input: GetContextInput) => Promise<GetContextResult>;
  getSubgraph?: (input: GetSubgraphInput) => Promise<GetSubgraphResult>;
  impactAnalysis?: (input: ImpactAnalysisInput) => Promise<ImpactAnalysisResult>;
  traceChain?: (input: TraceChainInput) => Promise<TraceChainResult>;
  coverageReport?: (input: CoverageReportInput) => Promise<CoverageReportResult>;
  listUnlinked?: (input: ListUnlinkedInput) => Promise<ListUnlinkedResult>;
  listCards?: (input: ListCardsInput) => Promise<ListCardsResult>;
  getRelations?: (input: GetRelationsInput) => Promise<GetRelationsResult>;

  linkAdd?: (input: { projectRoot: string; filePath: string; cardKey: string }) => Promise<{ filePath: string; changed: boolean }>;
  linkRemove?: (input: { projectRoot: string; filePath: string; cardKey: string }) => Promise<{ filePath: string; changed: boolean }>;
  relationAdd?: (input: { projectRoot: string; srcKey: string; dstKey: string; type: string; config: ResolvedBunnerConfig }) => Promise<{ filePath: string; changed: boolean }>;
  relationRemove?: (input: { projectRoot: string; srcKey: string; dstKey: string; type: string }) => Promise<{ filePath: string; changed: boolean }>;
  cardRenameEverywhere?: (input: { projectRoot: string; config: ResolvedBunnerConfig; oldKey: string; newKey: string }) => Promise<{ updatedCodeFiles: number; updatedCardFiles: number }>;

  cardCreate?: typeof cardCreate;
  cardUpdate?: typeof cardUpdate;
  cardUpdateStatus?: typeof cardUpdateStatus;
  cardDelete?: typeof cardDelete;
  cardRename?: typeof cardRename;

  createDb?: typeof createDb;
  closeDb?: typeof closeDb;
}

export function createBunnerToolRegistry(_ctx: BunnerMcpContext, deps?: BunnerMcpDeps): ToolRegistry {
  const registry = new ToolRegistry();

  const ownerOnly = (ctx: BunnerMcpContext) => ctx.role === 'owner';

  const verifyProjectFn = deps?.verifyProject ?? verifyProject;
  const indexProjectFn = deps?.indexProject ?? indexProject;
  const cardCreateFn = deps?.cardCreate ?? cardCreate;
  const cardUpdateFn = deps?.cardUpdate ?? cardUpdate;
  const cardUpdateStatusFn = deps?.cardUpdateStatus ?? cardUpdateStatus;
  const cardDeleteFn = deps?.cardDelete ?? cardDelete;
  const cardRenameFn = deps?.cardRename ?? cardRename;

  const createDbFn = deps?.createDb ?? createDb;
  const closeDbFn = deps?.closeDb ?? closeDb;

  const searchCardsFn =
    deps?.searchCards ?? ((input: SearchCardsInput) => searchCardsDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const searchCodeFn =
    deps?.searchCode ?? ((input: SearchCodeInput) => searchCodeDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));

  const getCardFn = deps?.getCard ?? ((input: GetCardInput) => getCardDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const getCodeEntityFn =
    deps?.getCodeEntity ??
    ((input: GetCodeEntityInput) => getCodeEntityDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const listCardRelationsFn =
    deps?.listCardRelations ??
    ((input: ListCardRelationsInput) => listCardRelationsDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const listCardCodeLinksFn =
    deps?.listCardCodeLinks ??
    ((input: ListCardCodeLinksInput) => listCardCodeLinksDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));

  const searchFn =
    deps?.search ??
    ((input: SearchInput) =>
      searchDefault(input, {
        searchCards: searchCardsFn,
        searchCode: searchCodeFn,
      }));

  const getContextFn =
    deps?.getContext ??
    ((input: GetContextInput) => getContextDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const getSubgraphFn =
    deps?.getSubgraph ??
    ((input: GetSubgraphInput) => getSubgraphDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const impactAnalysisFn =
    deps?.impactAnalysis ??
    ((input: ImpactAnalysisInput) => impactAnalysisDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const traceChainFn =
    deps?.traceChain ??
    ((input: TraceChainInput) => traceChainDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const coverageReportFn =
    deps?.coverageReport ??
    ((input: CoverageReportInput) =>
      coverageReportDefault(input, {
        getCard: getCardFn,
        listCardCodeLinks: listCardCodeLinksFn,
      }));
  const listUnlinkedFn =
    deps?.listUnlinked ??
    ((input: ListUnlinkedInput) => listUnlinkedDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const listCardsFn =
    deps?.listCards ??
    ((input: ListCardsInput) => listCardsDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const getRelationsFn =
    deps?.getRelations ??
    ((input: GetRelationsInput) => getRelationsDefault(input, { listCardRelations: listCardRelationsFn }));

  const linkAddFn = deps?.linkAdd ?? ((input: { projectRoot: string; filePath: string; cardKey: string }) => linkAddDefault(input, { parse: (f, c) => { parseSync(f, c); } }));
  const linkRemoveFn = deps?.linkRemove ?? ((input: { projectRoot: string; filePath: string; cardKey: string }) => linkRemoveDefault(input, { parse: (f, c) => { parseSync(f, c); } }));
  const relationAddFn = deps?.relationAdd ?? ((input: { projectRoot: string; srcKey: string; dstKey: string; type: string; config: ResolvedBunnerConfig }) => relationAddDefault(input));
  const relationRemoveFn = deps?.relationRemove ?? ((input: { projectRoot: string; srcKey: string; dstKey: string; type: string }) => relationRemoveDefault(input));
  const cardRenameEverywhereFn = deps?.cardRenameEverywhere ?? ((input: { projectRoot: string; config: ResolvedBunnerConfig; oldKey: string; newKey: string }) => cardRenameEverywhereDefault(input));

  async function reindexAfterWrite(ctx: BunnerMcpContext, mode: 'incremental' | 'full' = 'incremental') {
    const dbPath = bunnerCacheFilePath(ctx.projectRoot, 'index.sqlite');
    const db = createDbFn(dbPath);
    try {
      await indexProjectFn({ projectRoot: ctx.projectRoot, config: ctx.config, db, mode });
    } finally {
      closeDbFn(db);
    }
  }

  registry.register(
    declareTool({
      name: 'bunner_verify_project',
      title: 'Verify project',
      description: 'Verify MCP invariants for the project',
      inputSchema: {},
      run: async (ctx) => verifyProjectFn({ projectRoot: ctx.projectRoot, config: ctx.config }),
    }),
  );

  // --- P7 read tools (PLAN names) ---

  registry.register(
    declareTool({
      name: 'bunner_search',
      title: 'Search (cards + code)',
      description: 'Full-text search across cards and code entities via the local SQLite index',
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().max(50).optional(),
      },
      run: async (ctx, input) => {
        const limit = clampLimit((input as any)?.limit, 10);
        return searchFn({ projectRoot: ctx.projectRoot, query: String((input as any).query), limit });
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_get_context',
      title: 'Get context',
      description: 'Fetch a card/code entity and its immediate linked context (relations, links)',
      inputSchema: {
        target: z
          .union([
            z.object({ kind: z.literal('card'), key: z.string() }),
            z.object({ kind: z.literal('code'), entityKey: z.string() }),
          ])
          .describe('Context target'),
      },
      run: async (ctx, input) => {
        const target = (input as any).target as ContextTarget;
        return getContextFn({ projectRoot: ctx.projectRoot, target });
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_get_subgraph',
      title: 'Get subgraph',
      description: 'Traverse N-hop graph from a center key (card or code entity)',
      inputSchema: {
        centerKey: z.string(),
        hops: z.number().int().min(0).max(5).optional(),
      },
      run: async (ctx, input) =>
        getSubgraphFn({
          projectRoot: ctx.projectRoot,
          centerKey: String((input as any).centerKey),
          hops: typeof (input as any).hops === 'number' ? (input as any).hops : 2,
        }),
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_analyze_impact',
      title: 'Impact analysis',
      description: 'Find cards/code impacted by a card change (reverse depends-on traversal)',
      inputSchema: {
        cardKey: z.string(),
        depth: z.number().int().min(1).max(10).optional(),
      },
      run: async (ctx, input) =>
        impactAnalysisFn({
          projectRoot: ctx.projectRoot,
          cardKey: String((input as any).cardKey),
          depth: typeof (input as any).depth === 'number' ? (input as any).depth : 3,
        }),
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_trace_chain',
      title: 'Trace chain',
      description: 'Find a shortest path between two entities (card or code entity)',
      inputSchema: {
        fromKey: z.string(),
        toKey: z.string(),
        maxHops: z.number().int().min(1).max(10).optional(),
      },
      run: async (ctx, input) =>
        traceChainFn({
          projectRoot: ctx.projectRoot,
          fromKey: String((input as any).fromKey),
          toKey: String((input as any).toKey),
          maxHops: typeof (input as any).maxHops === 'number' ? (input as any).maxHops : 6,
        }),
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_report_coverage',
      title: 'Coverage report',
      description: 'Report @see coverage for a card',
      inputSchema: {
        cardKey: z.string(),
      },
      run: async (ctx, input) => coverageReportFn({ projectRoot: ctx.projectRoot, cardKey: String((input as any).cardKey) }),
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_list_unlinked_cards',
      title: 'List unlinked cards',
      description: 'List cards with no @see code links',
      inputSchema: {
        status: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
      run: async (ctx, input) =>
        listUnlinkedFn({
          projectRoot: ctx.projectRoot,
          status: typeof (input as any).status === 'string' ? (input as any).status : undefined,
          limit: clampLimit((input as any)?.limit, 50),
        }),
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_list_cards',
      title: 'List cards',
      description: 'List cards by filters (status/tags/keywords)',
      inputSchema: {
        status: z.string().optional(),
        keyword: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
      run: async (ctx, input) =>
        listCardsFn({
          projectRoot: ctx.projectRoot,
          status: typeof (input as any).status === 'string' ? (input as any).status : undefined,
          keyword: typeof (input as any).keyword === 'string' ? (input as any).keyword : undefined,
          tags: Array.isArray((input as any).tags) ? (input as any).tags.map((v: any) => String(v)) : undefined,
          limit: clampLimit((input as any)?.limit, 50),
        }),
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_get_relations',
      title: 'Get relations',
      description: 'Get card relations by direction (outgoing/incoming/both)',
      inputSchema: {
        cardKey: z.string(),
        direction: z.enum(['outgoing', 'incoming', 'both']).optional(),
      },
      run: async (ctx, input) =>
        getRelationsFn({
          projectRoot: ctx.projectRoot,
          cardKey: String((input as any).cardKey),
          direction: (input as any).direction ?? 'both',
        }),
    }),
  );

  // --- P7 write tools (PLAN names) ---

  registry.register(
    declareTool({
      name: 'bunner_create_card',
      title: 'Create card',
      description: 'Create a new card file and re-index',
      shouldRegister: ownerOnly,
      inputSchema: {
        slug: z.string(),
        summary: z.string(),
        body: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      },
      run: async (ctx, input) => {
        const out = await cardCreateFn({
          projectRoot: ctx.projectRoot,
          config: ctx.config,
          slug: String((input as any).slug),
          summary: String((input as any).summary),
          body: typeof (input as any).body === 'string' ? (input as any).body : '',
          keywords: (input as any).keywords as any,
          tags: (input as any).tags as any,
        });
        await reindexAfterWrite(ctx, 'incremental');
        return out;
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_update_card',
      title: 'Update card',
      description: 'Update an existing card file and re-index',
      shouldRegister: ownerOnly,
      inputSchema: {
        fullKey: z.string(),
        summary: z.string().optional(),
        body: z.string().optional(),
        keywords: z.array(z.string()).nullable().optional(),
        tags: z.array(z.string()).nullable().optional(),
        constraints: z.any().optional(),
        relations: z
          .array(
            z.object({
              type: z.string(),
              target: z.string(),
            }),
          )
          .nullable()
          .optional(),
      },
      run: async (ctx, input) => {
        const out = await cardUpdateFn(ctx.projectRoot, String((input as any).fullKey), {
          summary: (input as any).summary,
          body: (input as any).body,
          keywords: (input as any).keywords,
          tags: (input as any).tags,
          constraints: (input as any).constraints,
          relations: (input as any).relations,
        });
        await reindexAfterWrite(ctx, 'incremental');
        return out;
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_create_keyword',
      title: 'Create keyword',
      description: 'Create (register) a keyword name in the local SQLite index',
      shouldRegister: ownerOnly,
      inputSchema: {
        name: z.string(),
      },
      run: async (ctx, input) => {
        const name = String((input as any).name);
        const dbPath = bunnerCacheFilePath(ctx.projectRoot, 'index.sqlite');
        const db = createDbFn(dbPath);
        try {
          db.insert(keyword).values({ name }).onConflictDoNothing().run();
          const row = db.select({ id: keyword.id, name: keyword.name }).from(keyword).where(eq(keyword.name, name)).get();
          return { name: row?.name ?? name };
        } finally {
          closeDbFn(db);
        }
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_delete_keyword',
      title: 'Delete keyword',
      description: 'Delete a keyword name and cascade-remove its card mappings (card_keyword)',
      shouldRegister: ownerOnly,
      inputSchema: {
        name: z.string(),
      },
      run: async (ctx, input) => {
        const name = String((input as any).name);
        const dbPath = bunnerCacheFilePath(ctx.projectRoot, 'index.sqlite');
        const db = createDbFn(dbPath);
        try {
          const row = db.select({ id: keyword.id }).from(keyword).where(eq(keyword.name, name)).get();
          if (!row?.id) {
            return { name, deleted: false };
          }

          withDbTransaction(db, () => {
            db.delete(cardKeyword).where(eq(cardKeyword.keywordId, row.id)).run();
            db.delete(keyword).where(eq(keyword.id, row.id)).run();
          });

          return { name, deleted: true };
        } finally {
          closeDbFn(db);
        }
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_create_tag',
      title: 'Create tag',
      description: 'Create (register) a tag name in the local SQLite index',
      shouldRegister: ownerOnly,
      inputSchema: {
        name: z.string(),
      },
      run: async (ctx, input) => {
        const name = String((input as any).name);
        const dbPath = bunnerCacheFilePath(ctx.projectRoot, 'index.sqlite');
        const db = createDbFn(dbPath);
        try {
          db.insert(tag).values({ name }).onConflictDoNothing().run();
          const row = db.select({ id: tag.id, name: tag.name }).from(tag).where(eq(tag.name, name)).get();
          return { name: row?.name ?? name };
        } finally {
          closeDbFn(db);
        }
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_delete_tag',
      title: 'Delete tag',
      description: 'Delete a tag name and cascade-remove its card mappings (card_tag)',
      shouldRegister: ownerOnly,
      inputSchema: {
        name: z.string(),
      },
      run: async (ctx, input) => {
        const name = String((input as any).name);
        const dbPath = bunnerCacheFilePath(ctx.projectRoot, 'index.sqlite');
        const db = createDbFn(dbPath);
        try {
          const row = db.select({ id: tag.id }).from(tag).where(eq(tag.name, name)).get();
          if (!row?.id) {
            return { name, deleted: false };
          }

          withDbTransaction(db, () => {
            db.delete(cardTag).where(eq(cardTag.tagId, row.id)).run();
            db.delete(tag).where(eq(tag.id, row.id)).run();
          });

          return { name, deleted: true };
        } finally {
          closeDbFn(db);
        }
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_update_card_status',
      title: 'Update card status',
      description: 'Update a card status and re-index',
      shouldRegister: ownerOnly,
      inputSchema: {
        fullKey: z.string(),
        status: z.enum(['draft', 'accepted', 'implementing', 'implemented', 'deprecated']),
      },
      run: async (ctx, input) => {
        const out = await cardUpdateStatusFn(ctx.projectRoot, String((input as any).fullKey), (input as any).status);
        await reindexAfterWrite(ctx, 'incremental');
        return out;
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_delete_card',
      title: 'Delete card',
      description: 'Delete a card file if no references exist, then re-index',
      shouldRegister: ownerOnly,
      inputSchema: {
        fullKey: z.string(),
      },
      run: async (ctx, input) => {
        const fullKey = String((input as any).fullKey);
        // reference checks via local index
        const dbPath = bunnerCacheFilePath(ctx.projectRoot, 'index.sqlite');
        const db = createDbFn(dbPath);
        try {
          const relRef = db
            .select({ id: cardRelation.id })
            .from(cardRelation)
            .where(and(eq(cardRelation.dstCardKey, fullKey), eq(cardRelation.isReverse, false)))
            .limit(1)
            .get();
          const linkRef = db
            .select({ id: cardCodeLink.id })
            .from(cardCodeLink)
            .where(eq(cardCodeLink.cardKey, fullKey))
            .limit(1)
            .get();
          if (relRef || linkRef) {
            throw new Error('Cannot delete card: references exist (relations or @see links)');
          }
        } finally {
          closeDbFn(db);
        }
        const out = await cardDeleteFn(ctx.projectRoot, fullKey);
        await reindexAfterWrite(ctx, 'incremental');
        return out;
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_rename_card',
      title: 'Rename card',
      description: 'Rename a card key and update all references (@see + relations), then re-index',
      shouldRegister: ownerOnly,
      inputSchema: {
        fullKey: z.string(),
        newSlug: z.string(),
      },
      run: async (ctx, input) => {
        const fullKey = String((input as any).fullKey);
        const newSlug = String((input as any).newSlug);
        const out = await cardRenameFn(ctx.projectRoot, fullKey, newSlug);
        await cardRenameEverywhereFn({
          projectRoot: ctx.projectRoot,
          config: ctx.config,
          oldKey: fullKey,
          newKey: out.newFullKey,
        });
        await reindexAfterWrite(ctx, 'full');
        return out;
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_add_link',
      title: 'Add @see link',
      description: 'Insert a JSDoc @see cardKey annotation and re-index',
      shouldRegister: ownerOnly,
      inputSchema: {
        filePath: z.string(),
        cardKey: z.string(),
      },
      run: async (ctx, input) => {
        const out = await linkAddFn({
          projectRoot: ctx.projectRoot,
          filePath: String((input as any).filePath),
          cardKey: String((input as any).cardKey),
        });
        await reindexAfterWrite(ctx, 'incremental');
        return out;
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_remove_link',
      title: 'Remove @see link',
      description: 'Remove a JSDoc @see cardKey annotation and re-index',
      shouldRegister: ownerOnly,
      inputSchema: {
        filePath: z.string(),
        cardKey: z.string(),
      },
      run: async (ctx, input) => {
        const out = await linkRemoveFn({
          projectRoot: ctx.projectRoot,
          filePath: String((input as any).filePath),
          cardKey: String((input as any).cardKey),
        });
        await reindexAfterWrite(ctx, 'incremental');
        return out;
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_add_relation',
      title: 'Add relation',
      description: 'Add a typed relation edge to a card frontmatter and re-index',
      shouldRegister: ownerOnly,
      inputSchema: {
        srcKey: z.string(),
        dstKey: z.string(),
        type: z.enum(CARD_RELATION_TYPES),
      },
      run: async (ctx, input) => {
        const out = await relationAddFn({
          projectRoot: ctx.projectRoot,
          srcKey: String((input as any).srcKey),
          dstKey: String((input as any).dstKey),
          type: String((input as any).type),
          config: ctx.config,
        });
        await reindexAfterWrite(ctx, 'incremental');
        return out;
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_remove_relation',
      title: 'Remove relation',
      description: 'Remove a typed relation edge from a card frontmatter and re-index',
      shouldRegister: ownerOnly,
      inputSchema: {
        srcKey: z.string(),
        dstKey: z.string(),
        type: z.enum(CARD_RELATION_TYPES),
      },
      run: async (ctx, input) => {
        const out = await relationRemoveFn({
          projectRoot: ctx.projectRoot,
          srcKey: String((input as any).srcKey),
          dstKey: String((input as any).dstKey),
          type: String((input as any).type),
        });
        await reindexAfterWrite(ctx, 'incremental');
        return out;
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_index_project',
      title: 'Index project',
      description: 'Build or update the local SQLite index for MCP reads',
      shouldRegister: ownerOnly,
      inputSchema: {
        mode: z.enum(['full', 'incremental']).optional(),
      },
      run: async (ctx, input) => {
        const mode = (input as any)?.mode === 'full' ? 'full' : 'incremental';
        const dbPath = bunnerCacheFilePath(ctx.projectRoot, 'index.sqlite');
        const db = createDbFn(dbPath);
        try {
          return await indexProjectFn({
            projectRoot: ctx.projectRoot,
            config: ctx.config,
            db,
            mode,
          });
        } finally {
          closeDbFn(db);
        }
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_rebuild_index',
      title: 'Rebuild index',
      description: 'Rebuild the local SQLite index (defaults to full)',
      shouldRegister: ownerOnly,
      inputSchema: {
        mode: z.enum(['full', 'incremental']).optional(),
      },
      run: async (ctx, input) => {
        const mode = (input as any)?.mode === 'incremental' ? 'incremental' : 'full';
        const dbPath = bunnerCacheFilePath(ctx.projectRoot, 'index.sqlite');
        const db = createDbFn(dbPath);
        try {
          return await indexProjectFn({
            projectRoot: ctx.projectRoot,
            config: ctx.config,
            db,
            mode,
          });
        } finally {
          closeDbFn(db);
        }
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_search_cards',
      title: 'Search cards',
      description: 'Search cards via the local SQLite FTS index',
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().max(50).optional(),
      },
      run: async (ctx, input) => {
        const limit = clampLimit((input as any)?.limit, 10);
        return searchCardsFn({ projectRoot: ctx.projectRoot, query: String((input as any).query), limit });
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_search_code',
      title: 'Search code',
      description: 'Search code entities via the local SQLite FTS index',
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().max(50).optional(),
      },
      run: async (ctx, input) => {
        const limit = clampLimit((input as any)?.limit, 10);
        return searchCodeFn({ projectRoot: ctx.projectRoot, query: String((input as any).query), limit });
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_get_card',
      title: 'Get card',
      description: 'Get a card by full key from the local SQLite index',
      inputSchema: {
        key: z.string(),
      },
      run: async (ctx, input) => getCardFn({ projectRoot: ctx.projectRoot, key: String((input as any).key) }),
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_get_code_entity',
      title: 'Get code entity',
      description: 'Get a code entity by entity_key from the local SQLite index',
      inputSchema: {
        entityKey: z.string(),
      },
      run: async (ctx, input) =>
        getCodeEntityFn({ projectRoot: ctx.projectRoot, entityKey: String((input as any).entityKey) }),
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_list_card_relations',
      title: 'List card relations',
      description: 'List card relations (incoming/outgoing) from the local SQLite index',
      inputSchema: {
        cardKey: z.string(),
      },
      run: async (ctx, input) =>
        listCardRelationsFn({ projectRoot: ctx.projectRoot, cardKey: String((input as any).cardKey) }),
    }),
  );

  registry.register(
    declareTool({
      name: 'bunner_list_card_code_links',
      title: 'List card code links',
      description: 'List code links for a card from the local SQLite index',
      inputSchema: {
        cardKey: z.string(),
      },
      run: async (ctx, input) =>
        listCardCodeLinksFn({ projectRoot: ctx.projectRoot, cardKey: String((input as any).cardKey) }),
    }),
  );

  return registry;
}

export interface McpServerLike {
  registerTool: (name: string, config: unknown, cb: (args: unknown) => Promise<unknown>) => unknown;
  connect: (transport: unknown) => Promise<void>;
}

export interface StartBunnerMcpServerDeps extends BunnerMcpDeps {
  createServer?: () => McpServerLike;
  createTransport?: () => unknown;

  createOwnerElection?: (input: { projectRoot: string; pid: number }) => { acquire: () => { role: 'owner' | 'reader' }; release: () => void };
  fileExists?: (path: string) => Promise<boolean>;
  subscribe?: (
    rootPath: string,
    cb: (err: Error | null, events: Array<{ type: string; path: string }>) => void,
    opts?: { ignore?: string[] },
  ) => Promise<{ unsubscribe: () => Promise<void> }>;

  createDb?: typeof createDb;
  closeDb?: typeof closeDb;
  loadConfig?: (projectRoot: string) => Promise<{ config: ResolvedBunnerConfig }>;
}

function toCallToolResult(structuredContent: unknown): unknown {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

async function createDefaultServer(): Promise<McpServerLike> {
  const mod = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new mod.McpServer({ name: 'bunner', version: '0.0.1' });
  return server as unknown as McpServerLike;
}

async function createDefaultTransport(): Promise<unknown> {
  const mod = await import('@modelcontextprotocol/sdk/server/stdio.js');
  return new mod.StdioServerTransport();
}

export async function startBunnerMcpServerStdio(
  ctx: BunnerMcpContext,
  deps?: StartBunnerMcpServerDeps,
): Promise<void> {
  const fileExists = deps?.fileExists ?? (async (path: string) => Bun.file(path).exists());
  const createDbFn = deps?.createDb ?? createDb;
  const closeDbFn = deps?.closeDb ?? closeDb;
  const indexProjectFn = deps?.indexProject ?? indexProject;

  const election = deps?.createOwnerElection
    ? deps.createOwnerElection({ projectRoot: ctx.projectRoot, pid: process.pid })
    : new OwnerElection({ projectRoot: ctx.projectRoot, pid: process.pid });
  const electionRes = election.acquire();
  ctx.role = electionRes.role;

  // Ensure index is ready (build if missing) — owner only.
  const dbPath = bunnerCacheFilePath(ctx.projectRoot, 'index.sqlite');
  if (electionRes.role === 'owner') {
    const exists = await fileExists(dbPath);
    if (!exists) {
      const db = createDbFn(dbPath);
      try {
        await indexProjectFn({ projectRoot: ctx.projectRoot, config: ctx.config as any, db: db as any, mode: 'full' });
      } finally {
        closeDbFn(db as any);
      }
    }
  }

  // Watch mode incremental re-index — owner only.
  if (electionRes.role === 'owner') {
    const subscribeFn = deps?.subscribe
      ? deps.subscribe
      : async (
          rootPath: string,
          cb: (err: Error | null, events: Array<{ type: string; path: string }>) => void,
          opts?: { ignore?: string[] },
        ) => {
          const mod = await import('@parcel/watcher');
          return (mod as any).subscribe(rootPath, cb, opts);
        };

    let queue = Promise.resolve();
    const enqueue = (fn: () => Promise<void>) => {
      queue = queue.then(fn).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mcp] watch reindex failed: ${msg}`);
      });
    };

    const runReindex = async (mode: 'incremental' | 'full') => {
      const db = createDbFn(dbPath);
      try {
        await indexProjectFn({ projectRoot: ctx.projectRoot, config: ctx.config as any, db: db as any, mode });
      } finally {
        closeDbFn(db as any);
      }
    };

    const projectSubscription = await subscribeFn(
      ctx.projectRoot,
      (_err: Error | null, events: Array<{ type: string; path: string }>) => {
        for (const evt of events) {
          const relPath = relative(ctx.projectRoot, evt.path).replaceAll('\\', '/');
          if (relPath.startsWith('..')) continue;

          // Prevent indexing loops.
          if (relPath.startsWith('.bunner/cache/') || relPath.startsWith('.bunner/build/')) continue;

          const isConfig = relPath === 'bunner.jsonc' || relPath === 'bunner.json';
          const isCard = relPath.startsWith('.bunner/cards/') && relPath.endsWith('.card.md');
          const sourceDirRel = normalizeSourceDirRel(ctx.config.sourceDir);
          const isCode = relPath.startsWith(`${sourceDirRel}/`) && relPath.endsWith('.ts') && !relPath.endsWith('.d.ts');

          if (isConfig) {
            enqueue(async () => {
              const loader = deps?.loadConfig ?? (async () => ({ config: ctx.config }));
              const loaded = await loader(ctx.projectRoot);
              ctx.config = loaded.config;
              await runReindex('full');
            });
            continue;
          }

          if (isCard || isCode) {
            enqueue(async () => {
              await runReindex('incremental');
            });
          }
        }
      },
      {
        ignore: ['**/.git/**', '**/dist/**', '**/node_modules/**', '**/.bunner/cache/**', '**/.bunner/build/**'],
      },
    );

    const cacheDir = bunnerCacheDirPath(ctx.projectRoot);
    const signalPath = bunnerCacheFilePath(ctx.projectRoot, 'reindex.signal');
    const cacheSubscription = await subscribeFn(
      cacheDir,
      (_err: Error | null, events: Array<{ type: string; path: string }>) => {
        for (const evt of events) {
          if (evt.path !== signalPath) continue;
          enqueue(async () => {
            await runReindex('full');
          });
          break;
        }
      },
      {
        ignore: ['**/.git/**', '**/node_modules/**'],
      },
    );

    process.on('SIGINT', () => {
      void projectSubscription.unsubscribe();
      void cacheSubscription.unsubscribe();
      election.release();
    });
  }

  const server = deps?.createServer ? deps.createServer() : await createDefaultServer();
  const transport = deps?.createTransport ? deps.createTransport() : await createDefaultTransport();

  const registry = createBunnerToolRegistry(ctx, deps);

  for (const tool of registry.listForContext(ctx)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
      },
      async (args: unknown) => {
        const structured = await tool.run(ctx, args as any);
        return toCallToolResult(structured);
      },
    );
  }

  await server.connect(transport);
}
