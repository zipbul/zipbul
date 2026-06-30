/**
 * `zb build middleware` 통합 테스트 — kind 강제 + defineX shape + JS/d.ts 산출
 * + context augments. middleware-build 자체의 augment 추출 흐름은
 * middleware-augment-injector.spec.ts 가 cover.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { Logger, TestTransport } from '@zipbul/logger';

import type { MiddlewareBuildDeps } from '../../src/bin/build/middleware-build';
import { runMiddlewareBuild } from '../../src/bin/build/middleware-build';
import { Glob } from 'bun';
import { scanGlobSorted } from '../../src/common';

/**
 * Make tsc + workspace deps available inside an isolated package fixture by
 * symlinking the monorepo's hoisted typescript installation and the `@zipbul`
 * workspace packages the fixture sources import (directly or transitively)
 * into `<pkgRoot>/node_modules/`. Without this, the fixture's tsc invocation
 * fails module resolution and exits non-zero before emitting any `.d.ts`.
 */
async function linkFixtureDeps(pkgRoot: string): Promise<void> {
  const monorepoRoot = resolve(__dirname, '../../../../..');
  await mkdir(join(pkgRoot, 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(pkgRoot, 'node_modules', '@zipbul'), { recursive: true });
  await symlink(join(monorepoRoot, 'node_modules', 'typescript'),
    join(pkgRoot, 'node_modules', 'typescript')).catch(() => {});
  await symlink(join(monorepoRoot, 'node_modules', '.bin', 'tsc'),
    join(pkgRoot, 'node_modules', '.bin', 'tsc')).catch(() => {});

  const workspacePackages: ReadonlyArray<readonly [string, string]> = [
    ['packages/framework/common', 'common'],
    ['packages/framework/logger', 'logger'],
    ['packages/framework/core', 'core'],
    ['packages/libs/result', 'result'],
  ];

  for (const [sourcePath, name] of workspacePackages) {
    await symlink(join(monorepoRoot, sourcePath),
      join(pkgRoot, 'node_modules', '@zipbul', name)).catch(() => {});
  }
}

/**
 * Writes a minimal adapter package stub (types + optional
 * `context-namespaces.json` manifest) into the fixture's node_modules.
 */
async function writeAdapterStub(pkgRoot: string, params: {
  packageName: string;
  adapterClass: string;
  contextClass: string;
  namespace: string;
  namespaceInterface: string;
  withManifest: boolean;
}): Promise<void> {
  const { packageName, adapterClass, contextClass, namespace, namespaceInterface, withManifest } = params;
  const adapterDir = join(pkgRoot, 'node_modules', ...packageName.split('/'));

  await mkdir(join(adapterDir, 'dist'), { recursive: true });
  await Bun.write(join(adapterDir, 'package.json'), JSON.stringify({
    name: packageName, version: '0.0.0', type: 'module',
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
  }));
  await Bun.write(join(adapterDir, 'dist/index.js'),
    `export class ${adapterClass} {} export class ${contextClass} {}`);
  await Bun.write(join(adapterDir, 'dist/index.d.ts'), [
    `export declare class ${adapterClass} {}`,
    `export declare class ${contextClass} { ${namespace}: ${namespaceInterface} }`,
    `export interface ${namespaceInterface} {}`,
  ].join('\n'));

  if (withManifest) {
    await Bun.write(join(adapterDir, 'dist/context-namespaces.json'), JSON.stringify({
      $schemaName: 'adapter.context-namespaces',
      contextType: contextClass,
      methods: [],
      namespaces: [{ name: namespace, type: namespaceInterface }],
    }));
  }
}

/**
 * Writes the middleware package skeleton: package.json (kind=middleware) and a
 * tsconfig whose include matches the build's source set (entry + src).
 */
async function writeMiddlewarePackage(pkgRoot: string, params: {
  name: string;
  strict?: boolean;
}): Promise<void> {
  await Bun.write(
    join(pkgRoot, 'package.json'),
    JSON.stringify({
      name: params.name,
      type: 'module',
      module: 'dist/index.js',
      types: 'dist/index.d.ts',
      zipbul: { kind: 'middleware' },
    }),
  );
  await Bun.write(
    join(pkgRoot, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'esnext', target: 'esnext', moduleResolution: 'bundler',
        declaration: true, strict: params.strict ?? true, skipLibCheck: true,
      },
      include: ['index.ts', 'src'],
    }),
  );
  // tsgo build config — `zb build middleware` compiles JS + .d.ts via tsgo
  // driven by tsconfig.build.json (it requires this file to exist).
  await Bun.write(
    join(pkgRoot, 'tsconfig.build.json'),
    JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: {
        noEmit: false, declaration: true, emitDeclarationOnly: false,
        outDir: 'dist', rootDir: '.',
      },
      include: ['index.ts', 'src'],
    }),
  );
}

let pkgRoot: string;

beforeEach(async () => {
  pkgRoot = await mkdtemp(join(tmpdir(), 'zb-middleware-build-'));
  await mkdir(join(pkgRoot, 'src'), { recursive: true });
});

afterEach(async () => {
  await rm(pkgRoot, { recursive: true, force: true });
  // Restore Logger to a clean default — individual tests install custom
  // TestTransports and we don't want them leaking into the next test.
  Logger.configure({ level: 'info' });
});

const deps: MiddlewareBuildDeps = {
  scanFiles: ({ glob, baseDir }: { glob: Glob; baseDir: string }) => scanGlobSorted({ glob, baseDir }),
};

const realRun = (cwd: string) => {
  const originalCwd = process.cwd();
  process.chdir(cwd);
  return () => process.chdir(originalCwd);
};

describe('zb build middleware — kind 강제', () => {
  it('rejects when zipbul.kind is missing', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/no-kind', type: 'module' }),
    );

    const restore = realRun(pkgRoot);
    try {
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/kind/);
    } finally {
      restore();
    }
  });

  it('rejects when kind is "adapter" (mutual exclusion)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/adapter', type: 'module', zipbul: { kind: 'adapter' } }),
    );

    const restore = realRun(pkgRoot);
    try {
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/middleware/);
    } finally {
      restore();
    }
  });
});

describe('zb build middleware — defineX shape 강제', () => {
  it('rejects when defineMiddleware is not at top-level export const', async () => {
    await writeMiddlewarePackage(pkgRoot, { name: '@example/bad-shape' });
    await Bun.write(join(pkgRoot, 'index.ts'), `export * from './src/mw';`);
    await Bun.write(
      join(pkgRoot, 'src/mw.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        ``,
        `function hidden() {`,
        `  return defineMiddleware(() => () => {});`,
        `}`,
        ``,
        `export const mw = hidden();`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/export const/);
    } finally {
      restore();
    }
  });

  it('rejects aliased defineMiddleware not at top-level export', async () => {
    await writeMiddlewarePackage(pkgRoot, { name: '@example/bad-alias' });
    await Bun.write(join(pkgRoot, 'index.ts'), `export * from './src/mw';`);
    await Bun.write(
      join(pkgRoot, 'src/mw.ts'),
      [
        `import { defineMiddleware as dm } from '@zipbul/common';`,
        ``,
        `const make = () => dm(() => () => {});`,
        ``,
        `export const mw = make();`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/export const/);
    } finally {
      restore();
    }
  });
});

describe('zb build middleware — JS entry emission', () => {
  /**
   * The package entry (root `index.ts` — the layout of every zipbul middleware
   * package) must be bundled to `dist/index.js`, the exact file package.json
   * `module`/`exports` point at. This is the consumer-facing runtime artifact;
   * its absence breaks every app that imports the middleware. Guarded by
   * actually importing the built file.
   */
  it('emits an importable dist/index.js + .d.ts for the package entry', async () => {
    await writeAdapterStub(pkgRoot, {
      packageName: '@zipbul/http-adapter',
      adapterClass: 'HttpAdapter', contextClass: 'HttpContext',
      namespace: 'request', namespaceInterface: 'HttpRequest',
      withManifest: true,
    });
    await linkFixtureDeps(pkgRoot);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/entry-emission' });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { cookieMiddleware, CookieJar } from './src/middleware';`);
    await Bun.write(
      join(pkgRoot, 'src/middleware.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpContext } from '@zipbul/http-adapter';`,
        ``,
        `export class CookieJar { get(name: string): string | undefined { void name; return undefined; } }`,
        ``,
        `export const cookieMiddleware = defineMiddleware(() => (ctx) => {`,
        `  const http = ctx.to(HttpContext);`,
        `  http.request.cookie = new CookieJar();`,
        `});`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      await runMiddlewareBuild(deps);
    } finally {
      restore();
    }

    // 1) dist/index.js exists — the file package.json module/exports point at.
    const entryJsPath = join(pkgRoot, 'dist', 'index.js');
    expect(await Bun.file(entryJsPath).exists()).toBe(true);

    // 2) The built entry is actually consumable at runtime.
    const mod: Record<string, unknown> = await import(entryJsPath);
    expect(typeof mod.cookieMiddleware).toBe('object');
    expect(typeof mod.CookieJar).toBe('function');

    // 3) The matching type entry exists alongside (tsgo emits JS + .d.ts in one
    //    pass; augment metadata is no longer injected into the JS — the augment
    //    contract lives in dist/context-augments.d.ts, covered below).
    expect(await Bun.file(join(pkgRoot, 'dist', 'index.d.ts')).exists()).toBe(true);
  });
});

describe('zb build middleware — context augments .d.ts emission', () => {
  /**
   * End-to-end check: a middleware library with `ctx.to(<Type>)` augments
   * must produce `dist/context-augments.d.ts` containing `declare module`
   * declarations + every emitted `.d.ts` must reference it via a
   * `/// <reference path>` directive. This guards the "import-only"
   * augment contract — consumers should never need to touch tsconfig.
   */
  it('emits dist/context-augments.d.ts with declare module + prepends /// reference to all .d.ts', async () => {
    await writeAdapterStub(pkgRoot, {
      packageName: '@zipbul/http-adapter',
      adapterClass: 'HttpAdapter', contextClass: 'HttpContext',
      namespace: 'request', namespaceInterface: 'HttpRequest',
      withManifest: true,
    });
    await linkFixtureDeps(pkgRoot);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/cookie' });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { cookieMiddleware, CookieJar } from './src/middleware';`);
    await Bun.write(
      join(pkgRoot, 'src/middleware.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpContext } from '@zipbul/http-adapter';`,
        ``,
        `export class CookieJar { get(name: string): string | undefined { void name; return undefined; } }`,
        ``,
        `export const cookieMiddleware = defineMiddleware(() => (ctx) => {`,
        `  const http = ctx.to(HttpContext);`,
        `  http.request.cookie = new CookieJar();`,
        `});`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      await runMiddlewareBuild(deps);
    } finally {
      restore();
    }

    // 1) `dist/context-augments.d.ts` exists and contains the declare module.
    const augmentsPath = join(pkgRoot, 'dist', 'context-augments.d.ts');
    const augmentsContent = await Bun.file(augmentsPath).text();
    expect(augmentsContent).toContain(`declare module '@zipbul/http-adapter'`);
    expect(augmentsContent).toContain('interface HttpRequest');
    expect(augmentsContent).toContain('cookie: CookieJar');
    expect(augmentsContent).toContain('import type { CookieJar }');

    // 2) Every emitted `.d.ts` (other than augments itself) references it.
    const indexDtsContent = await Bun.file(join(pkgRoot, 'dist', 'index.d.ts')).text();
    expect(indexDtsContent).toMatch(/\/\/\/\s*<reference path="\.\/context-augments\.d\.ts"\s*\/>/);

    // 3) The temporary in-src placeholder is cleaned up.
    const placeholder = join(pkgRoot, 'src', '__zipbul_context_augments__.d.ts');
    expect(await Bun.file(placeholder).exists()).toBe(false);
  });

  /**
   * Idempotency: running `runMiddlewareBuild` twice over the same source must
   * produce exactly one `/// <reference path>` directive per `.d.ts`. The
   * `existingRefRegex` in `prependReferenceToAllDts` is the only thing
   * keeping us from stacking duplicates on every rebuild — guard it.
   */
  it('does not stack /// reference directives when build runs twice', async () => {
    await writeAdapterStub(pkgRoot, {
      packageName: '@zipbul/http-adapter',
      adapterClass: 'HttpAdapter', contextClass: 'HttpContext',
      namespace: 'request', namespaceInterface: 'HttpRequest',
      withManifest: true,
    });
    await linkFixtureDeps(pkgRoot);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/cookie-2x' });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { cookieMiddleware, CookieJar } from './src/middleware';`);
    await Bun.write(
      join(pkgRoot, 'src/middleware.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpContext } from '@zipbul/http-adapter';`,
        ``,
        `export class CookieJar { get(name: string): string | undefined { void name; return undefined; } }`,
        ``,
        `export const cookieMiddleware = defineMiddleware(() => (ctx) => {`,
        `  const http = ctx.to(HttpContext);`,
        `  http.request.cookie = new CookieJar();`,
        `});`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      await runMiddlewareBuild(deps);
      await runMiddlewareBuild(deps);
    } finally {
      restore();
    }

    const indexDts = await Bun.file(join(pkgRoot, 'dist', 'index.d.ts')).text();
    const refMatches = indexDts.match(/\/\/\/\s*<\s*reference\s+path\s*=\s*["'][^"']*context-augments\.d\.ts["']\s*\/\s*>/g);
    expect(refMatches).not.toBeNull();
    expect(refMatches!.length).toBe(1);
  });

  /**
   * Multi-adapter: a middleware that augments two different adapter contexts
   * (e.g. `ctx.to(HttpContext)` and `ctx.to(KafkaContext)`) must produce one
   * augments file with `declare module` blocks for both adapters. Guards the
   * `adapterMap` keyed-by-contextType code path in `buildContextAugmentsDtsContent`.
   */
  it('merges augments for two distinct adapter contexts into one augments file', async () => {
    await writeAdapterStub(pkgRoot, {
      packageName: '@zipbul/http-adapter',
      adapterClass: 'HttpAdapter', contextClass: 'HttpContext',
      namespace: 'request', namespaceInterface: 'HttpRequest',
      withManifest: true,
    });
    await writeAdapterStub(pkgRoot, {
      packageName: '@zipbul/kafka-adapter',
      adapterClass: 'KafkaAdapter', contextClass: 'KafkaContext',
      namespace: 'message', namespaceInterface: 'KafkaMessage',
      withManifest: true,
    });
    await linkFixtureDeps(pkgRoot);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/cross-adapter' });
    await Bun.write(
      join(pkgRoot, 'index.ts'),
      [
        `export { httpTrace } from './src/http-mw';`,
        `export { kafkaMark } from './src/kafka-mw';`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/http-mw.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpContext } from '@zipbul/http-adapter';`,
        ``,
        `export class Trace { id = ''; }`,
        ``,
        `export const httpTrace = defineMiddleware(() => (ctx) => {`,
        `  const http = ctx.to(HttpContext);`,
        `  http.request.trace = new Trace();`,
        `});`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/kafka-mw.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { KafkaContext } from '@zipbul/kafka-adapter';`,
        ``,
        `export class Marker { name = ''; }`,
        ``,
        `export const kafkaMark = defineMiddleware(() => (ctx) => {`,
        `  const kafka = ctx.to(KafkaContext);`,
        `  kafka.message.marker = new Marker();`,
        `});`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      await runMiddlewareBuild(deps);
    } finally {
      restore();
    }

    const augmentsContent = await Bun.file(join(pkgRoot, 'dist', 'context-augments.d.ts')).text();
    expect(augmentsContent).toContain(`declare module '@zipbul/http-adapter'`);
    expect(augmentsContent).toContain(`declare module '@zipbul/kafka-adapter'`);
    expect(augmentsContent).toContain('interface HttpRequest');
    expect(augmentsContent).toContain('interface KafkaMessage');
    expect(augmentsContent).toContain('trace: Trace');
    expect(augmentsContent).toContain('marker: Marker');
  });

  /**
   * Silent-failure regression: when a middleware augments a context whose
   * adapter package ships no `dist/context-namespaces.json` (missing or old
   * version), `loadAdapterNamespaces` returns null and the augment used to
   * be dropped without any user-visible signal. The build now emits a
   * warning naming the unresolved package — guard that contract.
   */
  it('warns and drops augments when adapter context-namespaces.json is missing', async () => {
    await writeAdapterStub(pkgRoot, {
      packageName: '@zipbul/http-adapter',
      adapterClass: 'HttpAdapter', contextClass: 'HttpContext',
      namespace: 'request', namespaceInterface: 'HttpRequest',
      withManifest: false,
    });
    await linkFixtureDeps(pkgRoot);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/missing-manifest', strict: false });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { traceMw } from './src/middleware';`);
    await Bun.write(
      join(pkgRoot, 'src/middleware.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpContext } from '@zipbul/http-adapter';`,
        ``,
        `export class Trace { id = ''; }`,
        ``,
        `export const traceMw = defineMiddleware(() => (ctx) => {`,
        `  const http = ctx.to(HttpContext);`,
        `  http.request.trace = new Trace();`,
        `});`,
      ].join('\n'),
    );

    const transport = new TestTransport();
    Logger.configure({ level: 'trace', transports: [transport] });

    const restore = realRun(pkgRoot);
    // Without the augment file, tsc will reject the property assignment
    // (`http.request.trace = ...`) since `HttpRequest` lacks the field. That
    // failure is expected and orthogonal to the warning we're verifying —
    // catch it so the assertion below can still run.
    try {
      try {
        await runMiddlewareBuild(deps);
      } catch { /* tsc-side failure expected when augment file is suppressed */ }
    } finally {
      restore();
    }

    const warnMatch = transport.messages.find((m) =>
      m.level === 'warn'
      && typeof m.msg === 'string'
      && m.msg.includes('@zipbul/http-adapter')
      && /manifest not found/i.test(m.msg));
    expect(warnMatch).toBeDefined();
  });

  /**
   * No-augment case: middleware that only sets headers / calls existing
   * methods (no `http.<ns>.<prop> = ...` assignments) must NOT emit
   * `context-augments.d.ts` and must NOT touch `.d.ts` files. This
   * preserves the standard tsc-only output for non-augmenting middlewares.
   */
  it('does not emit context-augments.d.ts when middleware has no augments', async () => {
    await linkFixtureDeps(pkgRoot);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/no-augment', strict: false });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { noopMiddleware } from './src/middleware';`);
    await Bun.write(
      join(pkgRoot, 'src/middleware.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        ``,
        `export const noopMiddleware = defineMiddleware(() => () => {});`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      await runMiddlewareBuild(deps);
    } finally {
      restore();
    }

    expect(await Bun.file(join(pkgRoot, 'dist', 'context-augments.d.ts')).exists()).toBe(false);
    const indexDts = await Bun.file(join(pkgRoot, 'dist', 'index.d.ts')).text();
    expect(indexDts).not.toMatch(/<reference path="[^"]*context-augments/);
  });
});
