export { compressionMiddleware } from './src/middleware.ts';
export { CompressionError } from './src/interfaces.ts';
export type { CompressionOptions, CompressionErrorData, BreachOptions } from './src/interfaces.ts';
export { CompressionErrorReason } from './src/enums.ts';
export { ContentEncoding } from '@zipbul/http-adapter';
export { parseAcceptEncoding, negotiateEncoding } from './src/encoding.ts';
export type { EncodingPreference } from './src/encoding.ts';
