import { test, expect, describe } from 'bun:test';
import { Configuration } from '@mikro-orm/core';

import { BunMariaDbDriver, BunMySqlDriver } from '../index';
import { BunMariaDbPlatform } from './mariadb.platform';

// No-DB unit coverage for the load-bearing MariaDB wiring (otherwise only proven in docker-gated
// integration lanes): it inherits the MySQL driver (Bun.SQL connection + batch back-fill), swaps in
// the MariaDB platform, and owns a createQueryBuilder override (the official MariaDbQueryBuilder).
describe('BunMariaDbDriver wiring', () => {
  const driver = new BunMariaDbDriver(new Configuration({ driver: BunMariaDbDriver, dbName: 'x', connect: false } as never, false));

  test('extends BunMySqlDriver (inherits Bun.SQL connection + batch PK back-fill)', () => {
    expect(driver).toBeInstanceOf(BunMySqlDriver);
  });

  test('uses BunMariaDbPlatform (MariaDB SchemaHelper/JSON + Bun.SQL datetime fix)', () => {
    expect((driver as unknown as { platform: unknown }).platform).toBeInstanceOf(BunMariaDbPlatform);
  });

  test('owns a createQueryBuilder override (the MariaDB json_arrayagg pagination builder)', () => {
    expect(Object.prototype.hasOwnProperty.call(driver, 'createQueryBuilder')).toBe(true);
  });
});
