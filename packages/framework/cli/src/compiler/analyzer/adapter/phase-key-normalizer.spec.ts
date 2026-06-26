import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isErr } from '@zipbul/result';

import type { FileAnalysis } from '../graph/interfaces';

import { AstParser } from '../parser';
import { ModuleGraph } from '../graph/module-graph';
import { ImportRegistry } from '../../generator/import-registry';
import { InjectorGenerator } from '../../generator/injector-generator';
import { normalizePhaseKeys } from './phase-key-normalizer';

describe('normalizePhaseKeys (module-config integration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zb-pkn-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function buildGraph(): Promise<{ graph: ModuleGraph; fileMap: Map<string, FileAnalysis>; parser: AstParser }> {
    writeFileSync(join(dir, 'phase.ts'), "export enum MyPhase { OnRequest = 'OnRequest' }\n");
    const modulePath = join(dir, '__module__.ts');
    const moduleSrc = [
      "import { defineModule } from '@zipbul/core';",
      "import { HttpAdapter } from '@zipbul/http-adapter';",
      "import { MyPhase } from './phase';",
      "import { fooMw } from './foo';",
      'export const appModule = defineModule({',
      '  adapters: [{ adapter: HttpAdapter, middlewares: { [MyPhase.OnRequest]: [fooMw] } }],',
      '});',
    ].join('\n');

    const parser = new AstParser();
    const pr = await parser.parse(modulePath, moduleSrc);

    if (isErr(pr)) {
      throw new Error('parse failed');
    }

    const fileMap = new Map<string, FileAnalysis>();
    fileMap.set(modulePath, { filePath: modulePath, ...pr } as unknown as FileAnalysis);

    const graph = new ModuleGraph(fileMap, '__module__.ts');
    graph.build();

    return { graph, fileMap, parser };
  }

  function generate(graph: ModuleGraph): string {
    const result = new InjectorGenerator().generate(graph, new ImportRegistry(join(dir, 'out')));
    const code = typeof result === 'string' ? result : ((result as { value?: string }).value ?? '');
    const idx = code.indexOf('adapterConfig');

    return code.slice(idx, idx + 300);
  }

  it('drops a computed enum phase key without normalization (documents the bug)', async () => {
    const { graph } = await buildGraph();

    expect(generate(graph)).not.toContain("'OnRequest'");
  });

  it('resolves a computed enum phase key to its value after normalization', async () => {
    const { graph, fileMap, parser } = await buildGraph();

    const result = await normalizePhaseKeys(graph, fileMap, parser);

    expect(isErr(result)).toBe(false);
    expect(generate(graph)).toContain("'OnRequest': [fooMw]");
  });
});

describe('normalizePhaseKeys (@UseMiddlewares decorators)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zb-pkd-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function buildControllerGraph(decoratorLine: string): Promise<{
    graph: ModuleGraph; fileMap: Map<string, FileAnalysis>; parser: AstParser; ctrlPath: string;
  }> {
    writeFileSync(join(dir, 'phase.ts'), "export enum HttpPhase { OnRequest = 'OnRequest', BeforeHandle = 'BeforeHandle' }\n");
    const ctrlPath = join(dir, 'ctrl.ts');
    const src = [
      "import { Controller, Get, UseMiddlewares } from '@zipbul/http-adapter';",
      "import { HttpPhase } from './phase';",
      "import { mw } from './mw';",
      "@Controller('/x')",
      'export class C {',
      `  @Get('/') ${decoratorLine} handler() {}`,
      '}',
    ].join('\n');

    const parser = new AstParser();
    const pr = await parser.parse(ctrlPath, src);

    if (isErr(pr)) {
      throw new Error('parse failed');
    }

    const fileMap = new Map<string, FileAnalysis>();
    fileMap.set(ctrlPath, { filePath: ctrlPath, ...pr } as unknown as FileAnalysis);

    // Decorator normalization walks fileMap, not the graph; an unbuilt graph
    // (empty modules) keeps the module-config pass a no-op without tripping the
    // orphan-file check graph.build() runs.
    const graph = new ModuleGraph(fileMap, '__module__.ts');

    return { graph, fileMap, parser, ctrlPath };
  }

  function useMiddlewaresArgs(fileMap: Map<string, FileAnalysis>, ctrlPath: string): readonly unknown[] {
    const cls = fileMap.get(ctrlPath)!.classes.find(c => c.className === 'C')!;
    const method = cls.methods.find(m => m.name === 'handler')!;
    const decorator = method.decorators.find(d => d.name === 'UseMiddlewares')!;

    return decorator.arguments;
  }

  it('resolves the positional enum phase argument to its value', async () => {
    const { graph, fileMap, parser, ctrlPath } = await buildControllerGraph('@UseMiddlewares(HttpPhase.OnRequest, [mw])');

    const result = await normalizePhaseKeys(graph, fileMap, parser);

    expect(isErr(result)).toBe(false);
    expect(useMiddlewaresArgs(fileMap, ctrlPath)[0]).toBe('OnRequest');
  });

  it('resolves a computed enum key in the object-map form', async () => {
    const { graph, fileMap, parser, ctrlPath } = await buildControllerGraph('@UseMiddlewares({ [HttpPhase.BeforeHandle]: [mw] })');

    const result = await normalizePhaseKeys(graph, fileMap, parser);

    expect(isErr(result)).toBe(false);
    expect(Object.keys(useMiddlewaresArgs(fileMap, ctrlPath)[0] as Record<string, unknown>)).toEqual(['BeforeHandle']);
  });

  it('leaves a string positional phase unchanged', async () => {
    const { graph, fileMap, parser, ctrlPath } = await buildControllerGraph("@UseMiddlewares('OnRequest', [mw])");

    const result = await normalizePhaseKeys(graph, fileMap, parser);

    expect(isErr(result)).toBe(false);
    expect(useMiddlewaresArgs(fileMap, ctrlPath)[0]).toBe('OnRequest');
  });
});
