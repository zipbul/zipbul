import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export {
  Test,
  TestApplication,
  create,
  type TestCreateOptions,
  type AttachRecorder,
  type DiOverrideRegistry,
  type RouteOverrideRegistration,
  type SurfaceOf,
  type ControllerClassRef,
} from './src/test-application';

export { TEST_SURFACE } from '@zipbul/core';

export {
  type ProviderOverrideBuilder,
  type ProviderOverrideRecord,
} from './src/overrides';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
