import { MySqlPlatform } from '@mikro-orm/mysql';

/**
 * MySQL/MariaDB platform for the Bun.SQL backend.
 *
 * The official {@link MySqlPlatform} inherits `convertsJsonAutomatically() === true`, which is
 * correct for `mysql2` (it parses JSON columns into JS objects before MikroORM sees them). Bun.SQL
 * does NOT auto-parse JSON — it returns the raw string (verified against MySQL 8 and MariaDB 11).
 * When the platform claims auto-parsing, MikroORM's {@link JsonType} trusts the driver and skips
 * its own `JSON.parse`, so `entity.jsonProp` round-trips as a string instead of an object.
 *
 * Returning `false` makes MikroORM parse JSON values itself (via `convertJsonToJSValue`), matching
 * the object shape the official driver delivers.
 */
export class BunMySqlPlatform extends MySqlPlatform {
  override convertsJsonAutomatically(): boolean {
    return false;
  }
}
