import { contextKey, type ContextKey } from '@zipbul/common';
import type { EntityManager } from '@mikro-orm/sql';
export const RequestEm: ContextKey<EntityManager> = contextKey<EntityManager>('db.requestEm');
