import { SqliteDialect } from 'kysely';
import { Database } from 'bun:sqlite';

/** Kysely dialect bridging bun:sqlite (synchronous, better-sqlite3-compatible) to Kysely. */
export class BunSqliteDialect extends SqliteDialect {
  constructor(dbName: string) {
    super({
      database: () => {
        const db = new Database(dbName);
        return {
          prepare(sql: string) {
            const stmt = db.query(sql);
            return {
              reader: /^\s*(select|pragma|explain|with)/i.test(sql) || /\breturning\b/i.test(sql),
              all: (params: unknown[]) => stmt.all(...(params as any)),
              run: (params: unknown[]) => {
                const r = stmt.run(...(params as any));
                return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
              },
              get: (params: unknown[]) => stmt.get(...(params as any)),
            };
          },
          close() { db.close(); },
        } as any;
      },
    });
  }
}
