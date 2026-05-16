import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { Multipart } from './src/multipart';
export { MultipartError } from './src/interfaces';
export type {
  MultipartErrorData,
  MultipartErrorContext,
  MultipartField,
  MultipartFile,
  MultipartOptions,
  MultipartPart,
  AllowedMimeTypes,
} from './src/interfaces';
export { MultipartErrorReason } from './src/enums';
export type { ParseAllResult, ResolvedMultipartOptions } from './src/types';
export { sanitizeFilename } from './src/sanitize';
export type { SanitizeFilenameOptions } from './src/sanitize';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
