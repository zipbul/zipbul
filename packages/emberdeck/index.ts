// ---- Setup ----
export { setupEmberdeck, teardownEmberdeck } from './src/setup';
export type { EmberdeckOptions, EmberdeckContext } from './src/config';
export { DEFAULT_RELATION_TYPES } from './src/config';

// ---- Types ----
export type { CardStatus, CardRelation, CardFrontmatter, CardFile } from './src/card/types';
export {
  CardKeyError,
  CardValidationError,
  CardNotFoundError,
  CardAlreadyExistsError,
  CardRenameSamePathError,
  RelationTypeError,
} from './src/card/errors';

// ---- Operations ----
export { createCard, type CreateCardInput, type CreateCardResult } from './src/ops/create';
export {
  updateCard,
  updateCardStatus,
  type UpdateCardFields,
  type UpdateCardResult,
} from './src/ops/update';
export { deleteCard } from './src/ops/delete';
export { renameCard, type RenameCardResult } from './src/ops/rename';
export { getCard, listCards, searchCards, listCardRelations } from './src/ops/query';
export { syncCardFromFile, removeCardByFile } from './src/ops/sync';

// ---- Repository interfaces (테스트/목킹용) ----
export type {
  CardRepository,
  RelationRepository,
  ClassificationRepository,
  CardRow,
  RelationRow,
} from './src/db/repository';

// ---- Pure utilities (CLI에서 키 검증만 필요할 때) ----
export { normalizeSlug, parseFullKey, buildCardPath } from './src/card/card-key';
export { parseCardMarkdown, serializeCardMarkdown } from './src/card/markdown';

// ---- DB (CLI 통합용) ----
export { migrateEmberdeck, type EmberdeckDb } from './src/db/connection';
