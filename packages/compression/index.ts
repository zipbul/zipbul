import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { compressionMiddleware } from './src/middleware.ts';
export { CompressionError } from './src/interfaces.ts';
export type { CompressionOptions, CompressionErrorData, BreachOptions } from './src/interfaces.ts';
export { Encoding, CompressionErrorReason } from './src/enums.ts';
export { parseAcceptEncoding, negotiateEncoding } from './src/encoding.ts';
export type { EncodingPreference } from './src/encoding.ts';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
