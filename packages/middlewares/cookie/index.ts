import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { CookieParser } from './src/cookie-parser';
export { CookieJar } from './src/cookie-jar';
export { CookieError } from './src/interfaces';
export type { CookieAttributes, CookieParserOptions, SerializeContext } from './src/interfaces';
export { CookieErrorReason } from './src/enums';
export type { SigningAlgorithm } from './src/types';
export { cookieMiddleware } from './src/middleware';
export type { CookieMiddleware } from './src/middleware';
export { cookieJarKey } from './src/context-keys';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
