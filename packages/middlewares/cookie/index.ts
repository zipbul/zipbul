import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { CookieParser } from './src/cookie-parser';
export { CookieJar } from './src/cookie-jar';
export { CookieError } from './src/interfaces';
export type { CookieAttributes, CookieErrorData, CookieParserOptions, SerializeContext } from './src/interfaces';
export { CookieErrorReason, CookiePriority, SameSite, SigningAlgorithm } from './src/enums';
export { cookieMiddleware } from './src/middleware';
export type { CookieMiddleware } from './src/middleware';
export { cookieJarKey } from './src/context-keys';

// Re-export the Result primitives so consumers can narrow the Err arm of every Result-returning
// method (jar.get/set/delete, parser.*) without a separate @zipbul/result import.
export { isErr } from '@zipbul/result';
export type { Result, ResultAsync, Err } from '@zipbul/result';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
