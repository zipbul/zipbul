import { test, expect, describe } from 'bun:test';
import { MariaDbPlatform } from '@mikro-orm/mariadb';

import { BunMariaDbPlatform } from './mariadb.platform';
import { BunUtcDateTimeType } from '../shared';

describe('BunMariaDbPlatform', () => {
  const platform = new BunMariaDbPlatform();

  test('extends the official MariaDbPlatform (keeps MariaDB SchemaHelper/JSON behavior)', () => {
    expect(platform).toBeInstanceOf(MariaDbPlatform);
  });

  test('does not auto-parse JSON (Bun.SQL returns raw strings; inherited from MariaDbPlatform)', () => {
    expect(platform.convertsJsonAutomatically()).toBe(false);
  });

  test('remaps no-tz datetime columns to BunUtcDateTimeType (the shared Bun.SQL fix)', () => {
    expect(platform.getMappedType('datetime')).toBeInstanceOf(BunUtcDateTimeType);
  });
});
