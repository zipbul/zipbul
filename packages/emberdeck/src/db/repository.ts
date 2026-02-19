import type { CardStatus } from '../card/types';

// ---- 행 타입 ----

export interface CardRow {
  key: string;
  summary: string;
  status: string;
  constraintsJson: string | null;
  body: string | null;
  filePath: string;
  updatedAt: string;
}

export interface RelationRow {
  id: number;
  type: string;
  srcCardKey: string;
  dstCardKey: string;
  isReverse: boolean;
  metaJson: string | null;
}

export interface CardListFilter {
  status?: CardStatus;
}

// ---- Repository 인터페이스 ----

export interface CardRepository {
  findByKey(key: string): CardRow | null;
  findByFilePath(filePath: string): CardRow | null;
  upsert(row: CardRow): void;
  deleteByKey(key: string): void;
  existsByKey(key: string): boolean;
  list(filter?: CardListFilter): CardRow[];
  search(query: string): CardRow[];
}

export interface RelationRepository {
  /** 카드의 관계를 전부 교체. isReverse 양방향 자동 처리. */
  replaceForCard(cardKey: string, relations: { type: string; target: string }[]): void;
  findByCardKey(cardKey: string): RelationRow[];
  deleteByCardKey(cardKey: string): void;
}

export interface ClassificationRepository {
  /** 카드의 keyword 매핑을 전부 교체. 미등록 keyword는 자동 생성. */
  replaceKeywords(cardKey: string, names: string[]): void;
  /** 카드의 tag 매핑을 전부 교체. 미등록 tag는 자동 생성. */
  replaceTags(cardKey: string, names: string[]): void;
  findKeywordsByCard(cardKey: string): string[];
  findTagsByCard(cardKey: string): string[];
  deleteByCardKey(cardKey: string): void;
}
