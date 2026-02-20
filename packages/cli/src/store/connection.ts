import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import * as ops from './store-ops';

/**
 * Current schema version. Compared against metadata.schema_version on open.
 * Mismatch → DROP ALL + rebuild (disposable DB).
 */
// NOTE: bumped after removing card.type (PLAN v6.0)
// NOTE: bumped after adding tag/card_tag tables
// NOTE: bumped after enforcing card_relation.type CHECK constraint
// NOTE: bumped after removing denormalized card.keywords (classification is via keyword/tag registry + mapping tables)
export const SCHEMA_VERSION = 7;

export type StoreDb = ReturnType<typeof createDb>;

function configureConnection(db: any) {
  const client = db?.$client;
  if (client?.run) {
    client.run('PRAGMA journal_mode = WAL');
    client.run('PRAGMA busy_timeout = 5000');
  }
}

function canDeleteDbFiles(path: string): boolean {
  return path !== ':memory:';
}

/**
 * Create the SQLite store connection.
 *
 * - Opens SQLite via Drizzle (bun-sqlite driver)
 * - Sets WAL journal mode + busy_timeout
 * - Runs migrations
 * - Ensures schema_version is set
 */
export function createDb(path: string) {
  const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

  const open = () => {
    const db = ops.openDb(path);
    configureConnection(db);
    return { db };
  };

  let { db } = open();

  const existingVersion = ops.readExistingSchemaVersion(db);
  const shouldRebuildByVersion = existingVersion !== null && existingVersion !== SCHEMA_VERSION;
  const shouldRebuildByUnknown =
    existingVersion === null && canDeleteDbFiles(path) && ops.hasAnyUserObjects(db);

  if ((shouldRebuildByVersion || shouldRebuildByUnknown) && canDeleteDbFiles(path)) {
    db.$client.close();
    ops.deleteSqliteFilesSync(path);
    ({ db } = open());
  }

  try {
    ops.runMigrations(db, migrationsFolder);
  } catch (err) {
    // If the DB exists but is not compatible with our migrations (e.g. tables already exist),
    // treat it as disposable cache corruption and rebuild from scratch.
    if (!canDeleteDbFiles(path)) {
      throw err;
    }

    db.$client.close();
    ops.deleteSqliteFilesSync(path);
    ({ db } = open());
    ops.runMigrations(db, migrationsFolder);
  }

  ops.ensureSchemaVersion(db, SCHEMA_VERSION);

  return db;
}

/**
 * Close the database connection.
 */
export function closeDb(db: StoreDb) {
  db.$client.close();
}
