import type { EmberdeckDb } from './db/connection';
import type { CardRepository, RelationRepository, ClassificationRepository } from './db/repository';

export const DEFAULT_RELATION_TYPES = [
  'depends-on',
  'references',
  'related',
  'extends',
  'conflicts',
] as const;

export type DefaultRelationType = (typeof DEFAULT_RELATION_TYPES)[number];

export interface EmberdeckOptions {
  /** 카드 .card.md 파일이 저장되는 절대 경로 디렉토리 */
  cardsDir: string;
  /** SQLite DB 파일 절대 경로. ':memory:' 허용 */
  dbPath: string;
  /** 허용 관계 타입. 미지정 시 DEFAULT_RELATION_TYPES 사용 */
  allowedRelationTypes?: readonly string[];
}

export interface EmberdeckContext {
  cardsDir: string;
  db: EmberdeckDb;
  cardRepo: CardRepository;
  relationRepo: RelationRepository;
  classificationRepo: ClassificationRepository;
  allowedRelationTypes: readonly string[];
}
