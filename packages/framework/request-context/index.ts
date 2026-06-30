import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { RequestContext } from './src/request-context';
export type { RequestContextData } from './src/interfaces';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
