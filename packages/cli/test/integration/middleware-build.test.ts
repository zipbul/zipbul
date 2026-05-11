/**
 * `zb build middleware` 통합 테스트 — kind 강제 + defineX shape + mutual exclusion.
 * middleware-build 자체의 augment 추출 흐름은 middleware-augment-injector.spec.ts 가 cover.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { Logger, TestTransport } from '@zipbul/logger';


import { runMiddlewareBuild } from '../../src/bin/build/middleware-build';
import { Glob } from 'bun';
import { scanGlobSorted } from '../../src/common';

/**
 * Make tsc + workspace deps available inside an isolated package fixture by
 * symlinking the monorepo's hoisted typescript installation and the
 * `@zipbul/common` source into `<pkgRoot>/node_modules/`. Without this, the
 * fixture's tsc invocation fails on `import { defineMiddleware } from '@zipbul/common'`
 * resolution and exits non-zero with no observable output.
 */
async function linkFixtureDeps(pkgRoot: string): Promise<void> {
  const monorepoRoot = resolve(__dirname, '../../../..');
  await mkdir(join(pkgRoot, 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(pkgRoot, 'node_modules', '@zipbul'), { recursive: true });
  await symlink(join(monorepoRoot, 'node_modules', 'typescript'),
    join(pkgRoot, 'node_modules', 'typescript')).catch(() => {});
  await symlink(join(monorepoRoot, 'node_modules', '.bin', 'tsc'),
    join(pkgRoot, 'node_modules', '.bin', 'tsc')).catch(() => {});
  await symlink(join(monorepoRoot, 'packages', 'common'),
    join(pkgRoot, 'node_modules', '@zipbul', 'common')).catch(() => {});
  await symlink(join(monorepoRoot, 'packages', 'logger'),
    join(pkgRoot, 'node_modules', '@zipbul', 'logger')).catch(() => {});
}
void dirname; // Keep import side-effect free if helper grows later.

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



const deps = {
  scanFiles: ({ glob, baseDir }: { glob: Glob; baseDir: string }) => scanGlobSorted({ glob, baseDir }),
  buildBundle: (...args: Parameters<typeof Bun.build>) => Bun.build(...args),
} as Parameters<typeof runMiddlewareBuild>[0];

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
    await Bun.write(join(pkgRoot, 'src/index.ts'), 'export const x = 1;');

    const restore = realRun(pkgRoot);
    try {
      await expect(runMiddlewareBuild(deps)).rejects.toThrow(/zipbul.+kind.+middleware/);
    } finally {
      restore();
    }
  });

  it('rejects when kind is "adapter" (mutual exclusion)', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/adapter', type: 'module', zipbul: { kind: 'adapter' } }),
    );
    await Bun.write(join(pkgRoot, 'src/index.ts'), 'export const x = 1;');

    const restore = realRun(pkgRoot);
    try {
      await expect(runMiddlewareBuild(deps)).rejects.toThrow(/zipbul.+kind.+middleware/);
    } finally {
      restore();
    }
  });
});

describe('zb build middleware — defineX shape 강제', () => {
  it('rejects when defineMiddleware is not at top-level export const', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/bad-shape', type: 'module', zipbul: { kind: 'middleware' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
      [
        `import { defineMiddleware } from '@zipbul/common';`,
        `const mw = defineMiddleware(() => () => {});`,
        `export { mw };`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { module: 'esnext', target: 'esnext' }, include: ['src'] }),
    );

    const restore = realRun(pkgRoot);
    try {
      await expect(runMiddlewareBuild(deps)).rejects.toThrow(/top-level exported `const`/);
    } finally {
      restore();
    }
  });

  it('rejects aliased defineMiddleware not at top-level export', async () => {
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/bad-alias', type: 'module', zipbul: { kind: 'middleware' } }),
    );
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
      [
        `import { defineMiddleware as mw } from '@zipbul/common';`,
        `const cookie = mw(() => () => {});`,
        `export { cookie };`,
      ].join('\n'),
    );
    await Bun.write(
      join(pkgRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { module: 'esnext', target: 'esnext' }, include: ['src'] }),
    );

    const restore = realRun(pkgRoot);
    try {
      await expect(runMiddlewareBuild(deps)).rejects.toThrow(/top-level exported `const`/);
    } finally {
      restore();
    }
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
    // Adapter manifest stub — minimal `context-namespaces.json` with the
    // namespace mapping the augment file needs (request → HttpRequest).
    const adapterDir = join(pkgRoot, 'node_modules', '@zipbul', 'http-adapter');
    await mkdir(join(adapterDir, 'dist'), { recursive: true });
    await Bun.write(join(adapterDir, 'package.json'), JSON.stringify({
      name: '@zipbul/http-adapter', version: '0.0.0', type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    }));
    await Bun.write(join(adapterDir, 'dist/index.js'), 'export class HttpAdapter {} export class HttpContext {}');
    await Bun.write(join(adapterDir, 'dist/index.d.ts'),
      'export declare class HttpAdapter {}\nexport declare class HttpContext { request: HttpRequest }\nexport interface HttpRequest {}');
    await Bun.write(join(adapterDir, 'dist/context-namespaces.json'), JSON.stringify({
      $schemaName: 'adapter.context-namespaces',
      contextType: 'HttpContext',
      methods: [],
      namespaces: [{ name: 'request', type: 'HttpRequest' }],
    }));

    await linkFixtureDeps(pkgRoot);

    // Middleware package source with augment + locally declared class.
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/cookie', type: 'module', zipbul: { kind: 'middleware' } }),
    );
    await Bun.write(
      join(pkgRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'esnext', target: 'esnext', moduleResolution: 'bundler', declaration: true, strict: true, skipLibCheck: true },
        include: ['src'],
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
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
   * No-augment case: middleware that only sets headers / calls existing
   * methods (no `http.<ns>.<prop> = ...` assignments) must NOT emit
   * `context-augments.d.ts` and must NOT touch `.d.ts` files. This
   * preserves the standard tsc-only output for non-augmenting middlewares.
   */
  /**
   * Idempotency: running `runMiddlewareBuild` twice over the same source must produce
   * exactly one `/// <reference path>` directive per `.d.ts`. The
   * `existingRefRegex` in `prependReferenceToAllDts` is the only thing
   * keeping us from stacking duplicates on every rebuild — guard it.
   */
  it('does not stack /// reference directives when build runs twice', async () => {
    const adapterDir = join(pkgRoot, 'node_modules', '@zipbul', 'http-adapter');
    await mkdir(join(adapterDir, 'dist'), { recursive: true });
    await Bun.write(join(adapterDir, 'package.json'), JSON.stringify({
      name: '@zipbul/http-adapter', version: '0.0.0', type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    }));
    await Bun.write(join(adapterDir, 'dist/index.js'), 'export class HttpAdapter {} export class HttpContext {}');
    await Bun.write(join(adapterDir, 'dist/index.d.ts'),
      'export declare class HttpAdapter {}\nexport declare class HttpContext { request: HttpRequest }\nexport interface HttpRequest {}');
    await Bun.write(join(adapterDir, 'dist/context-namespaces.json'), JSON.stringify({
      $schemaName: 'adapter.context-namespaces',
      contextType: 'HttpContext',
      methods: [],
      namespaces: [{ name: 'request', type: 'HttpRequest' }],
    }));

    await linkFixtureDeps(pkgRoot);
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/cookie-2x', type: 'module', zipbul: { kind: 'middleware' } }),
    );
    await Bun.write(
      join(pkgRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'esnext', target: 'esnext', moduleResolution: 'bundler', declaration: true, strict: true, skipLibCheck: true },
        include: ['src'],
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
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
    const httpDir = join(pkgRoot, 'node_modules', '@zipbul', 'http-adapter');
    const kafkaDir = join(pkgRoot, 'node_modules', '@zipbul', 'kafka-adapter');
    await mkdir(join(httpDir, 'dist'), { recursive: true });
    await mkdir(join(kafkaDir, 'dist'), { recursive: true });

    await Bun.write(join(httpDir, 'package.json'), JSON.stringify({
      name: '@zipbul/http-adapter', version: '0.0.0', type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    }));
    await Bun.write(join(httpDir, 'dist/index.js'), 'export class HttpAdapter {} export class HttpContext {}');
    await Bun.write(join(httpDir, 'dist/index.d.ts'),
      'export declare class HttpAdapter {}\nexport declare class HttpContext { request: HttpRequest }\nexport interface HttpRequest {}');
    await Bun.write(join(httpDir, 'dist/context-namespaces.json'), JSON.stringify({
      $schemaName: 'adapter.context-namespaces',
      contextType: 'HttpContext',
      methods: [],
      namespaces: [{ name: 'request', type: 'HttpRequest' }],
    }));

    await Bun.write(join(kafkaDir, 'package.json'), JSON.stringify({
      name: '@zipbul/kafka-adapter', version: '0.0.0', type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    }));
    await Bun.write(join(kafkaDir, 'dist/index.js'), 'export class KafkaAdapter {} export class KafkaContext {}');
    await Bun.write(join(kafkaDir, 'dist/index.d.ts'),
      'export declare class KafkaAdapter {}\nexport declare class KafkaContext { message: KafkaMessage }\nexport interface KafkaMessage {}');
    await Bun.write(join(kafkaDir, 'dist/context-namespaces.json'), JSON.stringify({
      $schemaName: 'adapter.context-namespaces',
      contextType: 'KafkaContext',
      methods: [],
      namespaces: [{ name: 'message', type: 'KafkaMessage' }],
    }));

    await linkFixtureDeps(pkgRoot);
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/cross-adapter', type: 'module', zipbul: { kind: 'middleware' } }),
    );
    await Bun.write(
      join(pkgRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'esnext', target: 'esnext', moduleResolution: 'bundler', declaration: true, strict: true, skipLibCheck: true },
        include: ['src'],
      }),
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
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
      [
        `export { httpTrace } from './http-mw';`,
        `export { kafkaMark } from './kafka-mw';`,
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
    // Adapter exists but ships only types; no `context-namespaces.json`.
    const adapterDir = join(pkgRoot, 'node_modules', '@zipbul', 'http-adapter');
    await mkdir(join(adapterDir, 'dist'), { recursive: true });
    await Bun.write(join(adapterDir, 'package.json'), JSON.stringify({
      name: '@zipbul/http-adapter', version: '0.0.0', type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    }));
    await Bun.write(join(adapterDir, 'dist/index.js'), 'export class HttpContext {}');
    await Bun.write(join(adapterDir, 'dist/index.d.ts'),
      'export declare class HttpContext { request: HttpRequest }\nexport interface HttpRequest {}');
    // NOTE: dist/context-namespaces.json deliberately absent.

    await linkFixtureDeps(pkgRoot);
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/missing-manifest', type: 'module', zipbul: { kind: 'middleware' } }),
    );
    await Bun.write(
      join(pkgRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'esnext', target: 'esnext', moduleResolution: 'bundler', declaration: true, strict: false, skipLibCheck: true },
        include: ['src'],
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
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

  it('does not emit context-augments.d.ts when middleware has no augments', async () => {
    await linkFixtureDeps(pkgRoot);
    await Bun.write(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@example/no-augment', type: 'module', zipbul: { kind: 'middleware' } }),
    );
    await Bun.write(
      join(pkgRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'esnext', target: 'esnext', moduleResolution: 'bundler', declaration: true, strict: false, skipLibCheck: true },
        include: ['src'],
      }),
    );
    await Bun.write(
      join(pkgRoot, 'src/index.ts'),
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

