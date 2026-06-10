import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

// Root barrel — re-exports ONLY from domain barrels (no direct-file re-exports).
export * from './src/entity';
export * from './src/bun-sql';
export * from './src/driver';
export * from './src/connection';
export * from './src/context';
export * from './src/orm';
export * from './src/repository';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
