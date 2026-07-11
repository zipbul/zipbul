// Side-effect import: registers the @corsBaker.Recipe CorsOptions class so
// Cors.create's seal/validate sees the schema (mirrored by the package.json
// "sideEffects" entry for options.js).
// oxlint-disable-next-line import/no-unassigned-import
import './src/options';

export { Cors } from './src/cors';
export { corsMiddleware } from './src/middleware';
export { CorsAction, CorsRejectionReason, CorsErrorReason } from './src/enums';
export { CorsError } from './src/interfaces';
export type { CorsOptions } from './src/options';
export type {
  CorsContinueResult,
  CorsPreflightResult,
  CorsRejectResult,
} from './src/interfaces';
export type { CorsResult, OriginFn, OriginOptions } from './src/types';
