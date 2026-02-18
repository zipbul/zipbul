import { describe, expect, it, mock } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as ops from './store-ops';
import * as schema from './schema';

describe('store/store-ops (unit)', () => {
  describe('deleteSqliteFilesSync', () => {
    it('deletes base, -wal, -shm files with force: true', () => {
      const dir = join(tmpdir(), `zipbul_store_ops_${Date.now()}`);
      mkdirSync(dir, { recursive: true });

      const path = join(dir, 'a.sqlite');
      const wal = `${path}-wal`;
      const shm = `${path}-shm`;

      writeFileSync(path, 'x');
      writeFileSync(wal, 'x');
      writeFileSync(shm, 'x');

      expect(existsSync(path)).toBe(true);
      expect(existsSync(wal)).toBe(true);
      expect(existsSync(shm)).toBe(true);

      ops.deleteSqliteFilesSync(path);

      expect(existsSync(path)).toBe(false);
      expect(existsSync(wal)).toBe(false);
      expect(existsSync(shm)).toBe(false);
    });
  });

  describe('openDb', () => {
    it('opens in-memory db via bun:sqlite Database client', () => {
      const db = ops.openDb(':memory:') as any;

      expect(db).toBeDefined();
      expect(typeof db.select).toBe('function');
      expect(db.$client).toBeDefined();
      expect(typeof db.$client.run).toBe('function');
    });

    it('opens file db via bun:sqlite Database client', () => {
      const dir = join(tmpdir(), `zipbul_store_ops_${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'x.sqlite');

      const db = ops.openDb(path) as any;
      expect(db).toBeDefined();
      expect(typeof db.select).toBe('function');
      expect(db.$client).toBeDefined();
      expect(db.$client.filename).toBe(path);
      db.$client.close();
    });
  });

  describe('runMigrations', () => {
    it('runs migrations on an empty in-memory db', () => {
      const db = ops.openDb(':memory:') as any;
      ops.runMigrations(db, join(import.meta.dir, '../../drizzle'));

      // sanity: a migrated DB should allow selecting from metadata
      const rows = db.select().from(schema.metadata).all();
      expect(Array.isArray(rows)).toBe(true);
      db.$client.close();
    });
  });

  describe('readExistingSchemaVersion', () => {
    it('returns null when row missing', () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              get: () => undefined,
            }),
          }),
        }),
      };

      expect(ops.readExistingSchemaVersion(db)).toBe(null);
    });

    it('returns null when value is not a string', () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              get: () => ({ value: 123 }),
            }),
          }),
        }),
      };

      expect(ops.readExistingSchemaVersion(db)).toBe(null);
    });

    it('returns null when value is not finite number', () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              get: () => ({ value: 'NaN' }),
            }),
          }),
        }),
      };

      expect(ops.readExistingSchemaVersion(db)).toBe(null);
    });

    it('returns parsed number when value is numeric string', () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              get: () => ({ value: '2' }),
            }),
          }),
        }),
      };

      expect(ops.readExistingSchemaVersion(db)).toBe(2);
    });

    it('returns null when underlying query throws', () => {
      const db = {
        select: () => {
          throw new Error('no table');
        },
      };

      expect(ops.readExistingSchemaVersion(db)).toBe(null);
    });
  });

  describe('hasAnyUserObjects', () => {
    it('returns true when sqlite_master has a non sqlite_% object', () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => ({
                get: () => ({ name: 'card' }),
              }),
            }),
          }),
        }),
      };

      expect(ops.hasAnyUserObjects(db)).toBe(true);
    });

    it('returns false when sqlite_master returns no row', () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => ({
                get: () => undefined,
              }),
            }),
          }),
        }),
      };

      expect(ops.hasAnyUserObjects(db)).toBe(false);
    });
  });

  describe('ensureSchemaVersion', () => {
    it('does nothing when schema_version already exists', () => {
      const insertMock = mock(() => ({
        values: mock(() => ({
          run: mock(() => {}),
        })),
      }));

      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              all: () => [{ key: 'schema_version', value: '2' }],
            }),
          }),
        }),
        insert: insertMock,
      };

      ops.ensureSchemaVersion(db, 2);
      expect(insertMock).toHaveBeenCalledTimes(0);
    });

    it('inserts schema_version when missing', () => {
      const runMock = mock(() => {});
      const valuesMock = mock((_v: any) => ({ run: runMock }));
      const insertMock = mock((_t: any) => ({ values: valuesMock }));

      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              all: () => [],
            }),
          }),
        }),
        insert: insertMock,
      };

      ops.ensureSchemaVersion(db, 7);

      expect(insertMock).toHaveBeenCalledTimes(1);
      expect(valuesMock).toHaveBeenCalledTimes(1);
      expect(valuesMock.mock.calls[0]![0]).toEqual({ key: 'schema_version', value: '7' });
      expect(runMock).toHaveBeenCalledTimes(1);
    });
  });
});
