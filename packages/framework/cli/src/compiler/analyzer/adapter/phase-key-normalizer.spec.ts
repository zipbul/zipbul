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
import { normalizeModuleConfigPhaseKeys } from './phase-key-normalizer';

describe('normalizeModuleConfigPhaseKeys (module-config integration)', () => {
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

    const result = await normalizeModuleConfigPhaseKeys(graph, fileMap, parser);

    expect(isErr(result)).toBe(false);
    expect(generate(graph)).toContain("'OnRequest': [fooMw]");
  });
});
