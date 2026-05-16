import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { err } from './src/err';
export { isErr } from './src/is-err';
export { safe } from './src/safe';
export { DEFAULT_MARKER_KEY, getMarkerKey, setMarkerKey } from './src/constants';
export type { Err, Result, ResultAsync } from './src/types';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
