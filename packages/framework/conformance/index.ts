import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { Tck } from './src/tck';
export type { TestApplication, TckApplicationOptions } from './src/test-application';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
