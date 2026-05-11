import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

// ── Public API ──

export { Router } from './src/router';
export { RouterError } from './src/error';

export type {
  RouterOptions,
  OptionalParamBehavior,
  RegexSafetyOptions,
  RouteParams,
  RouterErrKind,
  RouterErrData,
  MatchMeta,
  MatchOutput,
  RouterWarning,
} from './src/types';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
