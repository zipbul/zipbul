import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

// Root barrel — re-exports ONLY from domain barrels (no direct-file re-exports).
export * from './src/error';
export * from './src/entity';
export * from './src/bun-sql';
export * from './src/driver';
export * from './src/connection';
export * from './src/context';
export * from './src/orm';
export * from './src/repository';

// Per-request DB constraint violations are MikroORM's own typed exceptions (produced by its
// ExceptionConverter, never constructed here). Re-exported unchanged as the catchTypes surface for
// consumers' exception filters — do NOT wrap (wrapping would break MikroORM's `instanceof`).
export {
  UniqueConstraintViolationException,
  ForeignKeyConstraintViolationException,
  NotNullConstraintViolationException,
  CheckConstraintViolationException,
} from '@mikro-orm/core';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
