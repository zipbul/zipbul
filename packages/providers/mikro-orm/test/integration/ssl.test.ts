import { test, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_SSL_URL, describePgSsl } from './helpers';

// SSL/TLS is a pass-through: the sslmode (and other ssl/tls) parameters on the connection
// URL are honoured by Bun.SQL; this driver does not strip or alter them. Provide an
// SSL-enabled endpoint via DB_URL_PG_SSL (e.g. `postgres://.../db?sslmode=require`).
@Entity()
class SslDummy {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;
}

describePgSsl('SSL / TLS connection (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_SSL_URL, entities: [SslDummy] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });

  test('the backend connection is actually encrypted (pg_stat_ssl)', async () => {
    const rows = (await orm.em
      .getConnection()
      .execute('select ssl from pg_stat_ssl where pid = pg_backend_pid()')) as Array<{ ssl: boolean }>;
    expect(rows[0]?.ssl).toBe(true);
  });
});
