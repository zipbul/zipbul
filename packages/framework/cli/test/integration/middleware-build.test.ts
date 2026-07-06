/**
 * `zb build middleware` 통합 테스트 — kind 강제 + shape grammar v2 + JS/d.ts 산출
 * + 선언적 augments (`dist/context-augments.d.ts` + `dist/context-augments.json`).
 * grammar/extractor 단위 동작은 middleware-shape.spec.ts /
 * augments-slot-extractor.spec.ts 가 cover.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { Logger } from '@zipbul/logger';

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
  /** Members of the namespace interface (e.g. `queryString: string | null;`). */
  namespaceInterfaceBody?: string;
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
    // Typed as AdapterClass so `adapters: [X]` in fixtures type-checks
    // without stubbing the full Adapter surface.
    `import type { AdapterClass } from '@zipbul/common';`,
    `export declare const ${adapterClass}: AdapterClass;`,
    `export declare class ${contextClass} { ${namespace}: ${namespaceInterface} }`,
    `export interface ${namespaceInterface} { ${params.namespaceInterfaceBody ?? ''} }`,
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

/** HTTP adapter stub with a `request.queryString` member (validatedAccessor fixtures). */
async function writeHttpAdapterStub(pkgRoot: string, withManifest = true): Promise<void> {
  await writeAdapterStub(pkgRoot, {
    packageName: '@zipbul/http-adapter',
    adapterClass: 'HttpAdapter', contextClass: 'HttpContext',
    namespace: 'request', namespaceInterface: 'HttpRequest',
    namespaceInterfaceBody: 'queryString: string | null;',
    withManifest,
  });
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

describe('zb build middleware — shape grammar v2 강제', () => {
  it('rejects defineMiddleware inside a non-exported function', async () => {
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
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/shape grammar/);
    } finally {
      restore();
    }
  });

  it('rejects aliased defineMiddleware inside a non-exported arrow factory', async () => {
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
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/shape grammar/);
    } finally {
      restore();
    }
  });

  it('accepts FORM 2 exported factory functions (no violation before compile)', async () => {
    // No node_modules wiring — the build must fail at the tsconfig check
    // (i.e. AFTER shape validation passed), not with a grammar error.
    await writeMiddlewarePackage(pkgRoot, { name: '@example/form2-ok' });
    await rm(join(pkgRoot, 'tsconfig.build.json'), { force: true });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { makeMw } from './src/mw';`);
    await Bun.write(
      join(pkgRoot, 'src/mw.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        ``,
        `export function makeMw(options?: { name?: string }) {`,
        `  void options;`,
        `  return defineMiddleware(() => () => {});`,
        `}`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/tsconfig\.build\.json/);
    } finally {
      restore();
    }
  });
});

describe('zb build middleware — 선언적 augments hard errors', () => {
  it('rejects assignment-style context augments with a fix-it pointing at the augments slot', async () => {
    await writeMiddlewarePackage(pkgRoot, { name: '@example/legacy-assign' });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { cookieMiddleware, CookieJar } from './src/middleware';`);
    await Bun.write(
      join(pkgRoot, 'src/middleware.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpContext } from '@zipbul/http-adapter';`,
        ``,
        `export class CookieJar {}`,
        ``,
        `export const cookieMiddleware = defineMiddleware(() => (ctx) => {`,
        `  const http = ctx.to(HttpContext);`,
        `  http.request.cookie = new CookieJar();`,
        `});`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/assignment-style/);
    } finally {
      restore();
    }
  });

  it('hard-errors when the adapter ships no context-namespaces.json (was a warn)', async () => {
    await writeHttpAdapterStub(pkgRoot, /* withManifest */ false);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/missing-manifest' });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { traceMw, Trace } from './src/middleware';`);
    await Bun.write(
      join(pkgRoot, 'src/middleware.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpAdapter } from '@zipbul/http-adapter';`,
        ``,
        `export class Trace { id = ''; }`,
        ``,
        `export const traceMw = defineMiddleware({`,
        `  adapters: [HttpAdapter],`,
        `  augments: { request: { trace: (ctx) => new Trace() } },`,
        `});`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/context-namespaces\.json/);
    } finally {
      restore();
    }
  });

  it('hard-errors on duplicate (ns, prop) across a FORM 2 object return', async () => {
    await writeHttpAdapterStub(pkgRoot);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/dup-ns-prop' });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { pair, Tag } from './src/middleware';`);
    await Bun.write(
      join(pkgRoot, 'src/middleware.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpAdapter } from '@zipbul/http-adapter';`,
        ``,
        `export class Tag { id = ''; }`,
        ``,
        `export function pair() {`,
        `  const a = defineMiddleware({`,
        `    adapters: [HttpAdapter],`,
        `    augments: { request: { tag: (ctx) => new Tag() } },`,
        `  });`,
        `  const b = defineMiddleware({`,
        `    adapters: [HttpAdapter],`,
        `    augments: { request: { tag: (ctx) => new Tag() } },`,
        `  });`,
        `  return { a, b };`,
        `}`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      expect(runMiddlewareBuild(deps)).rejects.toThrow(/more than one definition/);
    } finally {
      restore();
    }
  });
});

describe('zb build middleware — 산출물 (JS + d.ts + manifest)', () => {
  /**
   * Kitchen-sink success path over all shape-grammar forms:
   *
   * - FORM 1 augment (`cookie: (ctx) => new CookieJar()`)
   * - FORM 2 factory-with-options (§7 query-parser shape, bare supply fn)
   * - FORM 2 object-return with const locals (cookie shape, contextOps)
   * - FORM 2 err() early-return guard
   *
   * One tsgo run; asserts JS entry, `.d.ts` reference, `context-augments.d.ts`
   * content, and the versioned `context-augments.json` manifest.
   */
  it('emits dist JS + context-augments.d.ts + context-augments.json for all legal forms', async () => {
    await writeHttpAdapterStub(pkgRoot);
    await linkFixtureDeps(pkgRoot);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/kitchen-sink' });
    await Bun.write(join(pkgRoot, 'index.ts'), [
      `export { cookieAugmentMw, CookieJar } from './src/form1';`,
      `export { queryParser } from './src/query-parser';`,
      `export type { QueryParserOptions } from './src/query-parser';`,
      `export { cookieMiddleware } from './src/cookie';`,
      `export { guarded } from './src/guarded';`,
    ].join('\n'));

    // FORM 1 — bare supply function augment.
    await Bun.write(
      join(pkgRoot, 'src/form1.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpAdapter } from '@zipbul/http-adapter';`,
        ``,
        `export class CookieJar { get(name: string): string | undefined { void name; return undefined; } }`,
        ``,
        `export const cookieAugmentMw = defineMiddleware({`,
        `  adapters: [HttpAdapter],`,
        `  augments: { request: { cookie: (ctx) => new CookieJar() } },`,
        `});`,
      ].join('\n'),
    );

    // FORM 2 — §7 query-parser shape (factory with options + bare supply).
    await Bun.write(
      join(pkgRoot, 'src/query-parser.ts'),
      [
        `import type { MiddlewareDefinition } from '@zipbul/common';`,
        ``,
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';`,
        ``,
        `export interface QueryParserOptions { depth?: number }`,
        ``,
        `export function queryParser(options?: QueryParserOptions): MiddlewareDefinition {`,
        `  const parser = { parse: (qs: string): Record<string, unknown> => ({ qs, depth: options?.depth }) };`,
        ``,
        `  return defineMiddleware({`,
        `    adapters: [HttpAdapter],`,
        `    augments: {`,
        `      request: {`,
        `        getQuery: (ctx) => {`,
        `          const queryString = ctx.to(HttpContext).request.queryString;`,
        ``,
        `          return queryString === null ? {} : parser.parse(queryString);`,
        `        },`,
        `      },`,
        `    },`,
        `  });`,
        `}`,
      ].join('\n'),
    );

    // FORM 2 — cookie object-return with const locals + ctx.set/get ops.
    await Bun.write(
      join(pkgRoot, 'src/cookie.ts'),
      [
        `import type { MiddlewareDefinition } from '@zipbul/common';`,
        ``,
        `import { defineMiddleware, contextKey } from '@zipbul/common';`,
        `import { HttpAdapter } from '@zipbul/http-adapter';`,
        ``,
        `const cookieJarKey = contextKey<string>('cookie.jar');`,
        ``,
        `export function cookieMiddleware(): { onRequest: MiddlewareDefinition; beforeResponse: MiddlewareDefinition } {`,
        `  const onRequest = defineMiddleware({`,
        `    adapters: [HttpAdapter],`,
        `    factory: () => (ctx) => {`,
        `      ctx.set(cookieJarKey, 'jar');`,
        `    },`,
        `  });`,
        `  const beforeResponse = defineMiddleware([HttpAdapter], () => (ctx) => {`,
        `    const jar = ctx.get(cookieJarKey);`,
        ``,
        `    void jar;`,
        `  });`,
        ``,
        `  return { onRequest, beforeResponse };`,
        `}`,
      ].join('\n'),
    );

    // FORM 2 — non-definition early return (boot-guard idiom stays general).
    await Bun.write(
      join(pkgRoot, 'src/guarded.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { err } from '@zipbul/result';`,
        ``,
        `export function guarded(options?: { bad?: boolean }) {`,
        `  if (options?.bad === true) {`,
        `    return err('invalid options');`,
        `  }`,
        ``,
        `  return defineMiddleware(() => () => {});`,
        `}`,
      ].join('\n'),
    );

    const restore = realRun(pkgRoot);
    try {
      await runMiddlewareBuild(deps);
    } finally {
      restore();
    }

    // 1) dist/index.js exists and is consumable at runtime.
    const entryJsPath = join(pkgRoot, 'dist', 'index.js');
    expect(await Bun.file(entryJsPath).exists()).toBe(true);
    const mod: Record<string, unknown> = await import(entryJsPath);
    expect(typeof mod.queryParser).toBe('function');
    expect(typeof mod.cookieMiddleware).toBe('function');
    expect(typeof mod.CookieJar).toBe('function');

    // 2) context-augments.d.ts — declaration merging with the standardized
    //    validatedAccessor signature + relative sibling type imports.
    const augmentsContent = await Bun.file(join(pkgRoot, 'dist', 'context-augments.d.ts')).text();
    expect(augmentsContent).toContain(`declare module '@zipbul/http-adapter'`);
    expect(augmentsContent).toContain('interface HttpRequest');
    expect(augmentsContent).toContain('cookie<T>(dto: Class<T>): T;');
    expect(augmentsContent).toContain('getQuery<T>(dto: Class<T>): T;');
    expect(augmentsContent).toContain('import type { Class } from "@zipbul/common";');
    expect(augmentsContent).not.toContain('@example/kitchen-sink'); // never self-name imports

    // 3) Every emitted `.d.ts` references the augments file.
    const indexDtsContent = await Bun.file(join(pkgRoot, 'dist', 'index.d.ts')).text();
    expect(indexDtsContent).toMatch(/\/\/\/\s*<reference path="\.\/context-augments\.d\.ts"\s*\/>/);

    // 4) context-augments.json — versioned manifest with mandatory contextOps.
    const manifest = await Bun.file(join(pkgRoot, 'dist', 'context-augments.json')).json() as {
      version: number;
      middlewares: Array<{
        exportName: string; form: number; contextType: string | null;
        augments: Array<{ ns: string; prop: string; kind: string }>;
        contextOps: Array<{ kind: string; keyIdentifier: string | null }>;
      }>;
    };
    expect(manifest.version).toBe(2);
    expect(manifest.middlewares.length).toBe(4);

    const byName = new Map(manifest.middlewares.map(m => [m.exportName, m]));

    const form1 = byName.get('cookieAugmentMw')!;
    expect(form1.form).toBe(1);
    expect(form1.contextType).toBe('HttpContext');
    expect(form1.augments).toEqual([{ ns: 'request', prop: 'cookie', kind: 'validated-accessor' }]);
    expect(form1.contextOps).toEqual([]);

    const qp = byName.get('queryParser')!;
    expect(qp.form).toBe(2);
    expect(qp.contextType).toBe('HttpContext');
    expect(qp.augments).toEqual([{ ns: 'request', prop: 'getQuery', kind: 'validated-accessor' }]);
    expect(qp.contextOps).toEqual([]);

    const cookie = byName.get('cookieMiddleware')!;
    expect(cookie.form).toBe(2);
    expect(cookie.augments).toEqual([]);
    expect(cookie.contextOps).toEqual([
      { kind: 'set', keyIdentifier: 'cookieJarKey' },
      { kind: 'get', keyIdentifier: 'cookieJarKey' },
    ]);

    const guarded = byName.get('guarded')!;
    expect(guarded.form).toBe(2);
    expect(guarded.augments).toEqual([]);
    expect(guarded.contextOps).toEqual([]);
  });

  /**
   * Idempotency: running `runMiddlewareBuild` twice over the same source must
   * produce exactly one `/// <reference path>` directive per `.d.ts`. The
   * `existingRefRegex` in `prependReferenceToAllDts` is the only thing
   * keeping us from stacking duplicates on every rebuild — guard it.
   */
  it('does not stack /// reference directives when build runs twice', async () => {
    await writeHttpAdapterStub(pkgRoot);
    await linkFixtureDeps(pkgRoot);
    await writeMiddlewarePackage(pkgRoot, { name: '@example/cookie-2x' });
    await Bun.write(join(pkgRoot, 'index.ts'), `export { cookieMiddleware, CookieJar } from './src/middleware';`);
    await Bun.write(
      join(pkgRoot, 'src/middleware.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpAdapter } from '@zipbul/http-adapter';`,
        ``,
        `export class CookieJar { get(name: string): string | undefined { void name; return undefined; } }`,
        ``,
        `export const cookieMiddleware = defineMiddleware({`,
        `  adapters: [HttpAdapter],`,
        `  augments: { request: { cookie: (ctx) => new CookieJar() } },`,
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
   * Multi-adapter: augments targeting two different adapter contexts must
   * produce one augments file with `declare module` blocks for both adapters.
   * Guards the per-adapter namespace resolution in `extractPackageMiddlewares`.
   */
  it('merges augments for two distinct adapter contexts into one augments file', async () => {
    await writeHttpAdapterStub(pkgRoot);
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
        `export { httpTrace, Trace } from './src/http-mw';`,
        `export { kafkaMark, Marker } from './src/kafka-mw';`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/http-mw.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { HttpAdapter } from '@zipbul/http-adapter';`,
        ``,
        `export class Trace { id = ''; }`,
        ``,
        `export const httpTrace = defineMiddleware({`,
        `  adapters: [HttpAdapter],`,
        `  augments: { request: { trace: (ctx) => new Trace() } },`,
        `});`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'src/kafka-mw.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `import { KafkaAdapter } from '@zipbul/kafka-adapter';`,
        ``,
        `export class Marker { name = ''; }`,
        ``,
        `export const kafkaMark = defineMiddleware({`,
        `  adapters: [KafkaAdapter],`,
        `  augments: { message: { marker: (ctx) => new Marker() } },`,
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
    expect(augmentsContent).toContain('trace<T>(dto: Class<T>): T;');
    expect(augmentsContent).toContain('marker<T>(dto: Class<T>): T;');
  });

  /**
   * No-augment case: middleware without an `augments` slot must NOT emit
   * `context-augments.d.ts` and must NOT touch `.d.ts` files — but the
   * manifest is still written (contextOps channel is mandatory).
   */
  it('emits manifest but no context-augments.d.ts when middleware has no augments', async () => {
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
    expect(indexDts).not.toMatch(/<reference path="[^"]*context-augments\.d\.ts/);

    const manifest = await Bun.file(join(pkgRoot, 'dist', 'context-augments.json')).json() as {
      version: number;
      middlewares: Array<{ exportName: string; augments: unknown[]; contextOps: unknown[] }>;
    };
    expect(manifest.version).toBe(2);
    expect(manifest.middlewares.length).toBe(1);
    expect(manifest.middlewares[0]!.exportName).toBe('noopMiddleware');
    expect(manifest.middlewares[0]!.augments).toEqual([]);
    expect(manifest.middlewares[0]!.contextOps).toEqual([]);
  });
});
