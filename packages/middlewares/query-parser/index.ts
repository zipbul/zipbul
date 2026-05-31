import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

import './src/options';

export { QueryParser } from './src/query-parser';
export { queryParser } from './src/middleware';
export { QueryParserError } from './src/interfaces';
export type { QueryParserErrorData, QueryParserOptions } from './src/interfaces';
export { QueryParserErrorReason } from './src/enums';
export type { QueryValue, QueryArray, QueryValueRecord } from './src/types';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
