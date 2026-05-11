import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export { Cors } from './src/cors';
export { CorsAction, CorsRejectionReason, CorsErrorReason } from './src/enums';
export { CorsError } from './src/interfaces';
export type {
  CorsOptions,
  CorsErrorData,
  CorsContinueResult,
  CorsPreflightResult,
  CorsRejectResult,
} from './src/interfaces';
export type { CorsResult, OriginFn, OriginOptions } from './src/types';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
