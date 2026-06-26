import { defineConfig } from 'tsdown';

// This package is built on `export *` re-export barrels (the root index + the `@mikro-orm/decorators/es`
// surface). Bun's bundler (bun build / bunup) has open, unfixed bugs with `export *` re-exports
// (oven-sh/bun #27709, #74, #18008) — its output crashes at runtime. tsdown (Rolldown) with `unbundle`
// preserves each module, so the barrels stay valid, .d.ts is emitted, and each driver subpath imports
// only its own `@mikro-orm/<db>` package.
export default defineConfig({
  entry: ['index.ts', 'src/driver/postgres/index.ts', 'src/driver/mysql/index.ts', 'src/driver/mariadb/index.ts', 'src/driver/sqlite/index.ts'],
  format: 'esm',
  platform: 'neutral',
  // Ship modern ESNext untouched. The package targets Bun >= 1.3, so no down-levelling — `false`
  // is explicit (the default would infer from a `engines.node` field we deliberately do not set).
  target: false,
  external: [/^@mikro-orm\//, 'kysely'],
  unbundle: true,
  dts: true,
  clean: true,
  // Build against the strict, src-only tsconfig. It enables `isolatedDeclarations`, which tsdown
  // auto-detects to drive .d.ts via oxc-transform (fast) AND fails the build on any unannotated
  // public API — so the declaration surface stays portable and regressions cannot ship.
  tsconfig: './tsconfig.build.json',
});
