import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { HttpHeader, HttpStatus } from './src/enums';
export type { HttpMethod } from './src/types';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
