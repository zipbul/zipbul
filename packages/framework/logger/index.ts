import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export * from './src/interfaces';
export * from './src/logger';
export * from './src/transports/console';
export * from './src/transports/test';
export * from './src/async-storage';
export * from './src/trace';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
