import { name as __pkgName, version as __pkgVersion } from './package.json' with { type: 'json' };

export {
  Test,
  TestApplication,
  TestApplicationBuilder,
  TEST_SURFACE,
  type CreateTestApplicationConfig,
  type SurfaceOf,
} from './src/test-application';

export {
  type ProviderOverrideBuilder,
} from './src/overrides';

export const ZIPBUL_PACKAGE = { name: __pkgName, version: __pkgVersion } as const;
