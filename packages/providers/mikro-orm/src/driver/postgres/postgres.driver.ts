import { AbstractSqlDriver } from '@mikro-orm/sql';
import { BasePostgreSqlEntityManager } from '@mikro-orm/postgresql';
import type { PostgreSqlPlatform } from '@mikro-orm/postgresql';
import { EntityManagerType, type Configuration } from '@mikro-orm/core';

import { BunPostgreSqlConnection } from './postgres.connection';
import { BunPostgreSqlPlatform } from './postgres.platform';

/**
 * MikroORM PostgreSQL driver backed by Bun's native Bun.SQL (zero `pg` dependency).
 * Reuses the official {@link PostgreSqlPlatform} for SQL generation, schema helper,
 * exception converter, and quoting.
 *
 * Overrides createEntityManager so `orm.em` is a PostgreSQL-flavoured EntityManager (as the
 * official driver does), exposing pg-only helpers such as `refreshMaterializedView()`.
 */
export class BunPostgreSqlDriver extends AbstractSqlDriver<BunPostgreSqlConnection, PostgreSqlPlatform> {
  constructor(config: Configuration) {
    super(config, new BunPostgreSqlPlatform(), BunPostgreSqlConnection, ['kysely']);
  }

  override createEntityManager(useContext?: boolean): this[typeof EntityManagerType] {
    const EntityManagerClass = this.config.get(
      'entityManager',
      BasePostgreSqlEntityManager,
    ) as typeof BasePostgreSqlEntityManager;
    return new EntityManagerClass(
      this.config,
      this,
      this.metadata,
      useContext,
    ) as unknown as this[typeof EntityManagerType];
  }
}
