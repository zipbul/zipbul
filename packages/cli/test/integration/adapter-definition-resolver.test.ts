/**
 * AdapterDefinitionResolver integration — manifest-only wiring (영역 2 step 2).
 *
 * The resolver no longer parses `.ts` source. Each test prepares a fixture
 * that mimics `node_modules/<adapter>/dist/...` (real `zb build adapter`
 * output via `buildAdapter()`), then drives the resolver through the same
 * `AdapterResolveParams` shape the user-app build uses.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isErr } from '@zipbul/result';

import { buildAdapter } from '../../src/compiler/adapter-build';
import { AdapterDefinitionResolver } from '../../src/compiler/analyzer/adapter/definition-resolver';
import type { FileAnalysis } from '../../src/compiler/analyzer/graph/interfaces';

let workspaceRoot: string;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'zb-adapter-resolver-'));
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

async function writeAndBuildAdapter(packageName: string): Promise<string> {
  const adapterRoot = join(workspaceRoot, 'packages', packageName.replace('@', '').replace('/', '-'));
  await mkdir(join(adapterRoot, 'src'), { recursive: true });

  await writeFile(
    join(adapterRoot, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.1',
      module: 'src/index.ts',
      zipbul: { kind: 'adapter' },
    }),
  );
  await writeFile(
    join(adapterRoot, 'src/index.ts'),
    `export { TestAdapter } from './adapter-definition';`,
  );
  await writeFile(
    join(adapterRoot, 'src/adapter-definition.ts'),
    [
      `import { defineAdapter } from '@zipbul/common';`,
      `import { CoreStep } from '@zipbul/core';`,
      `import { TestAdapter, TestContext, TestPhase, TestStep } from './adapter';`,
      `export const adapterDefinition = defineAdapter({`,
      `  adapter: TestAdapter,`,
      `  context: TestContext,`,
      `  phase: TestPhase,`,
      `  step: TestStep,`,
      `  pipeline: [TestPhase.OnRequest, CoreStep.Handler],`,
      `});`,
    ].join('\n'),
  );
  await writeFile(
    join(adapterRoot, 'src/adapter.ts'),
    [
      `import type { AdapterEntryDecorators } from '@zipbul/common';`,
      `export class TestAdapter {`,
      `  readonly decorators: AdapterEntryDecorators = { controller: TestController, handlers: [TestGet] };`,
      `}`,
      `export class TestContext {}`,
      `export const TestController = () => () => {};`,
      `export const TestGet = () => () => {};`,
      `export const TestPhase = { OnRequest: 'OnRequest' } as const;`,
      `export const TestStep = {} as const;`,
    ].join('\n'),
  );

  await buildAdapter({ packageRoot: adapterRoot });

  return adapterRoot;
}

function fileMapWithImport(adapterEntryPath: string): Map<string, FileAnalysis> {
  const userFile = join(workspaceRoot, 'src/main.ts');
  const fileMap = new Map<string, FileAnalysis>();
  fileMap.set(userFile, {
    filePath: userFile,
    classes: [],
    reExports: [],
    exports: [],
    importEntries: [{ source: '@example/test-adapter', resolvedSource: adapterEntryPath, isRelative: false }],
  });
  return fileMap;
}

describe('AdapterDefinitionResolver — manifest-only wiring', () => {
  it('resolves adapter from a compiled package by walking up to package.json', async () => {
    const adapterRoot = await writeAndBuildAdapter('@example/test-adapter');
    const fileMap = fileMapWithImport(join(adapterRoot, 'src/index.ts'));

    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['TestAdapter']);
    expect(result.adapterStaticSchemas.TestAdapter!.entryDecorators.controller).toBe('TestController');
    expect(result.adapterStaticSchemas.TestAdapter!.contextNamespaces!.module).toBe('@example/test-adapter');
  });

  it('hard error when adapter package has no compiled manifest (E1)', async () => {
    // Adapter package declared but never built.
    const adapterRoot = join(workspaceRoot, 'packages/test-adapter');
    await mkdir(adapterRoot, { recursive: true });
    await writeFile(
      join(adapterRoot, 'package.json'),
      JSON.stringify({ name: '@example/x', zipbul: { kind: 'adapter' } }),
    );

    const fileMap = fileMapWithImport(join(adapterRoot, 'src/index.ts'));

    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.data.why).toMatch(/no compiled manifest/);
  });

  it('skips packages whose zipbul.kind is not "adapter"', async () => {
    const nonAdapterRoot = join(workspaceRoot, 'packages/util');
    await mkdir(nonAdapterRoot, { recursive: true });
    await writeFile(
      join(nonAdapterRoot, 'package.json'),
      JSON.stringify({ name: '@example/util', version: '0.0.1' }),
    );

    const fileMap = fileMapWithImport(join(nonAdapterRoot, 'src/index.ts'));

    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    // After inline-adapter support: error mentions both external and inline forms.
    expect(result.data.why).toMatch(/No adapter found/);
  });

  it('hard error when adapter package.json is corrupt JSON', async () => {
    const adapterRoot = join(workspaceRoot, 'packages/broken');
    await mkdir(adapterRoot, { recursive: true });
    await writeFile(join(adapterRoot, 'package.json'), '{ this is not json');

    const fileMap = fileMapWithImport(join(adapterRoot, 'src/index.ts'));

    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.data.why).toMatch(/SYNTAX.+is not valid JSON/);
  });

  it('propagates DiagnosticError from readAdapterManifest (path-traversal in manifest index)', async () => {
    const adapterRoot = await writeAndBuildAdapter('@example/test-adapter');
    // Corrupt the root manifest's index to point outside dist/.
    const topPath = join(adapterRoot, 'dist', 'adapter.manifest.json');
    const top = JSON.parse(await Bun.file(topPath).text());
    top.manifests['pipeline-schema'] = '../../etc/passwd';
    await Bun.write(topPath, JSON.stringify(top));

    const fileMap = fileMapWithImport(join(adapterRoot, 'src/index.ts'));
    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.data.why).toMatch(/points outside dist/);
  });

  it('propagates DiagnosticError when sibling manifest has wrong $schemaName', async () => {
    const adapterRoot = await writeAndBuildAdapter('@example/test-adapter');
    // Corrupt one sibling manifest.
    await Bun.write(
      join(adapterRoot, 'dist', 'pipeline-schema.json'),
      JSON.stringify({ $schemaName: 'adapter.decorator-schema' }),
    );

    const fileMap = fileMapWithImport(join(adapterRoot, 'src/index.ts'));
    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.data.why).toMatch(/expected.+adapter\.pipeline-schema/);
  });

  it('propagates DiagnosticError when synthesizer hits null decorators', async () => {
    const adapterRoot = await writeAndBuildAdapter('@example/test-adapter');
    // Drop the index entry for decorator-schema.json so loadSibling returns null.
    const topPath = join(adapterRoot, 'dist', 'adapter.manifest.json');
    const top = JSON.parse(await Bun.file(topPath).text());
    delete top.manifests['decorator-schema'];
    await Bun.write(topPath, JSON.stringify(top));

    const fileMap = fileMapWithImport(join(adapterRoot, 'src/index.ts'));
    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.data.why).toMatch(/missing.+decorator-schema/);
  });

  it('dedupes same package root reached via multiple entry files', async () => {
    const adapterRoot = await writeAndBuildAdapter('@example/test-adapter');
    const userFile = join(workspaceRoot, 'src/main.ts');

    const fileMap = new Map<string, FileAnalysis>();
    fileMap.set(userFile, {
      filePath: userFile,
      classes: [],
      reExports: [],
      exports: [],
      importEntries: [
        { source: '@example/test-adapter', resolvedSource: join(adapterRoot, 'src/index.ts'), isRelative: false },
        { source: '@example/test-adapter/sub', resolvedSource: join(adapterRoot, 'src/adapter.ts'), isRelative: false },
      ],
    });

    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    // Even though two entry paths point at the same package, the resolver
    // visits the package root once → one extraction.
    expect(Object.keys(result.adapterStaticSchemas).length).toBe(1);
  });
});

describe('AdapterDefinitionResolver — inline (user-app) adapter', () => {
  it('compiles inline `defineAdapter(...)` from user-app source when no external adapter package exists', async () => {
    // Lay out a user-app project with an inline adapter — no external
    // adapter package, no compiled manifest. The resolver should fall
    // back to source-tree extraction and synthesize the same shape.
    const userSrc = join(workspaceRoot, 'src');
    await mkdir(userSrc, { recursive: true });

    await writeFile(
      join(userSrc, 'my-adapter.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        ``,
        `export class MyAdapter {`,
        `  readonly decorators: AdapterEntryDecorators = { controller: MyController, handlers: [MyGet] };`,
        `}`,
        `export class MyContext {}`,
        `export const MyController = () => () => {};`,
        `export const MyGet = () => () => {};`,
        `export const MyPhase = { OnRequest: 'OnRequest' } as const;`,
        `export const MyStep = {} as const;`,
        ``,
        `export const adapterDefinition = defineAdapter({`,
        `  adapter: MyAdapter,`,
        `  context: MyContext,`,
        `  phase: MyPhase,`,
        `  step: MyStep,`,
        `  pipeline: [MyPhase.OnRequest, CoreStep.Handler],`,
        `});`,
      ].join('\n'),
    );

    // No external adapter package — `importEntries` is empty so
    // `collectPackageEntryFiles` yields nothing.
    const userFile = join(userSrc, 'my-adapter.ts');
    const fileMap = new Map<string, FileAnalysis>();
    fileMap.set(userFile, {
      filePath: userFile,
      classes: [],
      reExports: [],
      exports: [],
      importEntries: [],
    });

    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(Object.keys(result.adapterStaticSchemas)).toContain('MyAdapter');
  });

  it('coexists with an external adapter package — both extractions appear', async () => {
    // External adapter package — built to dist/ via the real `buildAdapter`.
    const adapterRoot = await writeAndBuildAdapter('@example/test-adapter');

    // Plus an inline adapter in user-app source.
    const userSrc = join(workspaceRoot, 'src');
    await mkdir(userSrc, { recursive: true });
    await writeFile(
      join(userSrc, 'inline-adapter.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        `export class InlineAdapter { readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] }; }`,
        `export class InlineCtx {}`,
        `export const C = () => () => {};`,
        `export const H = () => () => {};`,
        `export const InlinePhase = { OnTick: 'OnTick' } as const;`,
        `export const InlineStep = {} as const;`,
        `export const inlineDefn = defineAdapter({ adapter: InlineAdapter, context: InlineCtx, phase: InlinePhase, step: InlineStep, pipeline: [InlinePhase.OnTick, CoreStep.Handler] });`,
      ].join('\n'),
    );

    const userFile = join(userSrc, 'main.ts');
    await writeFile(userFile, '// user app entry');
    const fileMap = new Map<string, FileAnalysis>();
    fileMap.set(userFile, {
      filePath: userFile,
      classes: [],
      reExports: [],
      exports: [],
      importEntries: [
        { source: '@example/test-adapter', resolvedSource: join(adapterRoot, 'src/index.ts'), isRelative: false },
      ],
    });
    const inlineFile = join(userSrc, 'inline-adapter.ts');
    fileMap.set(inlineFile, {
      filePath: inlineFile,
      classes: [],
      reExports: [],
      exports: [],
      importEntries: [],
    });

    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;

    // Both extractions wired — external TestAdapter + inline InlineAdapter.
    const ids = Object.keys(result.adapterStaticSchemas).sort();
    expect(ids).toEqual(['InlineAdapter', 'TestAdapter']);
  });

  it('rejects multiple inline `defineAdapter(...)` calls', async () => {
    const userSrc = join(workspaceRoot, 'src');
    await mkdir(userSrc, { recursive: true });

    const inlineSource = (name: string) => [
      `import { defineAdapter } from '@zipbul/common';`,
      `import { CoreStep } from '@zipbul/core';`,
      `import type { AdapterEntryDecorators } from '@zipbul/common';`,
      `export class ${name} { readonly decorators: AdapterEntryDecorators = { controller: C, handlers: [H] }; }`,
      `export class Ctx {}`,
      `export const C = () => () => {};`,
      `export const H = () => () => {};`,
      `export const Ph = { OnRequest: 'OnRequest' } as const;`,
      `export const St = {} as const;`,
      `export const def_${name} = defineAdapter({ adapter: ${name}, context: Ctx, phase: Ph, step: St, pipeline: [Ph.OnRequest, CoreStep.Handler] });`,
    ].join('\n');

    await writeFile(join(userSrc, 'a.ts'), inlineSource('AdapterA'));
    await writeFile(join(userSrc, 'b.ts'), inlineSource('AdapterB'));

    const fileMap = new Map<string, FileAnalysis>();
    for (const f of ['a.ts', 'b.ts']) {
      const fp = join(userSrc, f);
      fileMap.set(fp, { filePath: fp, classes: [], reExports: [], exports: [], importEntries: [] });
    }

    const result = await new AdapterDefinitionResolver().resolve({
      fileMap,
      projectRoot: workspaceRoot,
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.data.why).toMatch(/Multiple inline `defineAdapter/);
  });
});
