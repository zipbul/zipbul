import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };
import { configure, seal } from '@zipbul/baker';

import './src/cors-options';

configure({ stopAtFirstError: true });
seal();

export { Cors } from './src/cors';
export { corsMiddleware } from './src/middleware';
export { CorsAction, CorsRejectionReason, CorsErrorReason } from './src/enums';
export { CorsError } from './src/interfaces';
export { CorsOptions, type CorsOptionsInput } from './src/cors-options';
export type {
  CorsErrorData,
  CorsContinueResult,
  CorsPreflightResult,
  CorsRejectResult,
} from './src/interfaces';
export type { CorsResult, OriginFn, OriginOptions } from './src/types';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
