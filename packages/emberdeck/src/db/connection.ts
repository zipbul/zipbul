import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import * as schema from './schema';

export type EmberdeckDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * 마이그레이션 폴더 절대 경로.
 * import.meta.dirname = src/db/ → ../../drizzle = packages/emberdeck/drizzle/
 */
function getMigrationsFolder(): string {
  return resolve(import.meta.dirname, '../../drizzle');
}

function configurePragmas(db: EmberdeckDb): void {
  const client = db.$client;
  client.run('PRAGMA journal_mode = WAL');
  client.run('PRAGMA foreign_keys = ON');
  client.run('PRAGMA busy_timeout = 5000');
}

/**
 * 새 DB 열기 + pragma + migration.
 */
export function createEmberdeckDb(path: string): EmberdeckDb {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const client = new Database(path);
  const db = drizzle(client, { schema, casing: 'snake_case' });
  configurePragmas(db);
  migrateEmberdeck(db);
  return db;
}

/**
 * 기존 DB에 emberdeck 마이그레이션만 실행 (CLI 통합용).
 */
export function migrateEmberdeck(db: EmberdeckDb): void {
  migrate(db, { migrationsFolder: getMigrationsFolder() });
}

export function closeDb(db: EmberdeckDb): void {
  db.$client.close();
}
