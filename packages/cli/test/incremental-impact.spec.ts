import { describe, expect, it, afterEach } from 'bun:test';
import { Glob } from 'bun';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import type { FileAnalysis } from '../src/compiler/analyzer/graph/interfaces';

import { AstParser } from '../src/compiler/analyzer/ast-parser';
import { buildModuleImpact } from '../src/compiler/analyzer/incremental/module-impact';

const writeFile = async (path: string, contents: string): Promise<void> => {
  await Bun.write(path, contents);
};

const buildFileMap = async (srcDir: string): Promise<Map<string, FileAnalysis>> => {
  const glob = new Glob('**/*.ts');
  const parser = new AstParser();
  const fileMap = new Map<string, FileAnalysis>();

  for await (const file of glob.scan(srcDir)) {
    const fullPath = join(srcDir, file);
    const code = await Bun.file(fullPath).text();
    const result = parser.parse(fullPath, code);
    const analysis: FileAnalysis = {
      filePath: fullPath,
      classes: result.classes,
      reExports: result.reExports,
      exports: result.exports,
      createApplicationCalls: result.createApplicationCalls,
      defineModuleCalls: result.defineModuleCalls,
      injectCalls: result.injectCalls,
    };

    if (result.imports !== undefined) {
      analysis.imports = result.imports;
    }

    if (result.importEntries !== undefined) {
      analysis.importEntries = result.importEntries;
    }

    if (result.exportedValues !== undefined) {
      analysis.exportedValues = result.exportedValues;
    }

    if (result.localValues !== undefined) {
      analysis.localValues = result.localValues;
    }

    if (result.moduleDefinition !== undefined) {
      analysis.moduleDefinition = result.moduleDefinition;
    }

    fileMap.set(fullPath, analysis);
  }

  return fileMap;
};

const sorted = (values: Iterable<string>): string[] => Array.from(values).sort();

describe('incremental impact integration', () => {
  let rootDir: string | undefined;

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('includes dependent modules when a shared module changes', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'zipbul-inc-'));
    const srcDir = join(rootDir, 'src');

    await mkdir(join(srcDir, 'a'), { recursive: true });
    await mkdir(join(srcDir, 'b'), { recursive: true });

    await writeFile(
      join(srcDir, 'a', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const aModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'b', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const bModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'b', 'b.service.ts'),
      'export const bService = () => "ok";\n',
    );
    await writeFile(
      join(srcDir, 'a', 'a.service.ts'),
      "import { bService } from '../b/b.service';\nexport const aService = bService();\n",
    );

    const fileMap = await buildFileMap(srcDir);
    const changedFile = join(srcDir, 'b', 'b.service.ts');
    const impact = buildModuleImpact(fileMap, 'module.ts', [changedFile]);

    const aModule = join(srcDir, 'a', 'module.ts');
    const bModule = join(srcDir, 'b', 'module.ts');

    expect(sorted(impact.changedModules)).toEqual([bModule]);
    expect(sorted(impact.affectedModules)).toEqual([aModule, bModule]);
  });

  it('propagates through export * re-exports (barrel files)', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'zipbul-inc-'));
    const srcDir = join(rootDir, 'src');

    await mkdir(join(srcDir, 'a'), { recursive: true });
    await mkdir(join(srcDir, 'b'), { recursive: true });

    await writeFile(
      join(srcDir, 'a', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const aModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'b', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const bModule = defineModule();\n",
    );

    await writeFile(join(srcDir, 'b', 'b.service.ts'), 'export const bService = 1;\n');
    await writeFile(join(srcDir, 'a', 'barrel.ts'), "export * from '../b/b.service';\n");
    await writeFile(join(srcDir, 'a', 'entry.ts'), "import { bService } from './barrel';\nexport const v = bService;\n");

    const fileMap = await buildFileMap(srcDir);
    const changedFile = join(srcDir, 'b', 'b.service.ts');
    const impact = buildModuleImpact(fileMap, 'module.ts', [changedFile]);

    const aModule = join(srcDir, 'a', 'module.ts');
    const bModule = join(srcDir, 'b', 'module.ts');

    expect(sorted(impact.changedModules)).toEqual([bModule]);
    expect(sorted(impact.affectedModules)).toEqual([aModule, bModule]);
  });

  it('propagates through named re-exports (export { x } from)', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'zipbul-inc-'));
    const srcDir = join(rootDir, 'src');

    await mkdir(join(srcDir, 'a'), { recursive: true });
    await mkdir(join(srcDir, 'b'), { recursive: true });

    await writeFile(
      join(srcDir, 'a', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const aModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'b', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const bModule = defineModule();\n",
    );

    await writeFile(join(srcDir, 'b', 'b.service.ts'), 'export const bService = 1;\n');
    await writeFile(
      join(srcDir, 'a', 'barrel.ts'),
      "export { bService as foo } from '../b/b.service';\n",
    );
    await writeFile(
      join(srcDir, 'a', 'entry.ts'),
      "import { foo } from './barrel';\nexport const v = foo;\n",
    );

    const fileMap = await buildFileMap(srcDir);
    const changedFile = join(srcDir, 'b', 'b.service.ts');
    const impact = buildModuleImpact(fileMap, 'module.ts', [changedFile]);

    const aModule = join(srcDir, 'a', 'module.ts');
    const bModule = join(srcDir, 'b', 'module.ts');

    expect(sorted(impact.changedModules)).toEqual([bModule]);
    expect(sorted(impact.affectedModules)).toEqual([aModule, bModule]);
  });

  it('does not propagate through non-relative imports (absolute path specifiers)', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'zipbul-inc-'));
    const srcDir = join(rootDir, 'src');

    await mkdir(join(srcDir, 'a'), { recursive: true });
    await mkdir(join(srcDir, 'b'), { recursive: true });

    await writeFile(
      join(srcDir, 'a', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const aModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'b', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const bModule = defineModule();\n",
    );

    const bServicePath = join(srcDir, 'b', 'b.service.ts');
    await writeFile(bServicePath, 'export const bService = 1;\n');

    await writeFile(
      join(srcDir, 'a', 'a.service.ts'),
      `import { bService } from '${bServicePath}';\nexport const a = bService;\n`,
    );

    const fileMap = await buildFileMap(srcDir);
    const impact = buildModuleImpact(fileMap, 'module.ts', [bServicePath]);

    const aModule = join(srcDir, 'a', 'module.ts');
    const bModule = join(srcDir, 'b', 'module.ts');

    expect(sorted(impact.changedModules)).toEqual([bModule]);
    expect(sorted(impact.affectedModules)).toEqual([bModule]);
    expect(sorted(impact.affectedModules)).not.toContain(aModule);
  });

  it('resolves directory imports via index.ts in real parsing', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'zipbul-inc-'));
    const srcDir = join(rootDir, 'src');

    await mkdir(join(srcDir, 'a'), { recursive: true });
    await mkdir(join(srcDir, 'b'), { recursive: true });

    await writeFile(
      join(srcDir, 'a', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const aModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'b', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const bModule = defineModule();\n",
    );

    await writeFile(join(srcDir, 'b', 'b.service.ts'), 'export const bService = () => "x";\n');
    await writeFile(join(srcDir, 'b', 'index.ts'), "export * from './b.service';\n");
    await writeFile(join(srcDir, 'a', 'a.service.ts'), "import { bService } from '../b';\nexport const a = bService();\n");

    const fileMap = await buildFileMap(srcDir);
    const changedFile = join(srcDir, 'b', 'b.service.ts');
    const impact = buildModuleImpact(fileMap, 'module.ts', [changedFile]);

    const aModule = join(srcDir, 'a', 'module.ts');
    const bModule = join(srcDir, 'b', 'module.ts');

    expect(sorted(impact.changedModules)).toEqual([bModule]);
    expect(sorted(impact.affectedModules)).toEqual([aModule, bModule]);
  });

  it('uses the closest module root for nested modules', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'zipbul-inc-'));
    const srcDir = join(rootDir, 'src');

    await mkdir(join(srcDir, 'a', 'feature'), { recursive: true });

    await writeFile(
      join(srcDir, 'a', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const aModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'a', 'feature', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const featureModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'a', 'feature', 'feature.service.ts'),
      'export const featureService = () => 123;\n',
    );

    const fileMap = await buildFileMap(srcDir);
    const changedFile = join(srcDir, 'a', 'feature', 'feature.service.ts');
    const impact = buildModuleImpact(fileMap, 'module.ts', [changedFile]);

    const featureModule = join(srcDir, 'a', 'feature', 'module.ts');

    expect(sorted(impact.changedModules)).toEqual([featureModule]);
    expect(sorted(impact.affectedModules)).toEqual([featureModule]);
  });

  it('includes transitive dependents in a multi-hop import chain', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'zipbul-inc-'));
    const srcDir = join(rootDir, 'src');

    await mkdir(join(srcDir, 'a'), { recursive: true });
    await mkdir(join(srcDir, 'b'), { recursive: true });
    await mkdir(join(srcDir, 'c'), { recursive: true });

    await writeFile(
      join(srcDir, 'a', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const aModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'b', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const bModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'c', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const cModule = defineModule();\n",
    );
    await writeFile(join(srcDir, 'c', 'c.service.ts'), 'export const cService = () => true;\n');
    await writeFile(
      join(srcDir, 'b', 'b.service.ts'),
      "import { cService } from '../c/c.service';\nexport const bService = () => cService();\n",
    );
    await writeFile(
      join(srcDir, 'a', 'a.service.ts'),
      "import { bService } from '../b/b.service';\nexport const aService = () => bService();\n",
    );

    const fileMap = await buildFileMap(srcDir);
    const changedFile = join(srcDir, 'c', 'c.service.ts');
    const impact = buildModuleImpact(fileMap, 'module.ts', [changedFile]);

    const aModule = join(srcDir, 'a', 'module.ts');
    const bModule = join(srcDir, 'b', 'module.ts');
    const cModule = join(srcDir, 'c', 'module.ts');

    expect(sorted(impact.changedModules)).toEqual([cModule]);
    expect(sorted(impact.affectedModules)).toEqual([aModule, bModule, cModule]);
  });

  it('unions impacts when multiple files change', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'zipbul-inc-'));
    const srcDir = join(rootDir, 'src');

    await mkdir(join(srcDir, 'a'), { recursive: true });
    await mkdir(join(srcDir, 'b'), { recursive: true });

    await writeFile(
      join(srcDir, 'a', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const aModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'b', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const bModule = defineModule();\n",
    );
    await writeFile(join(srcDir, 'a', 'a.service.ts'), 'export const aService = () => 1;\n');
    await writeFile(join(srcDir, 'b', 'b.service.ts'), 'export const bService = () => 2;\n');

    const fileMap = await buildFileMap(srcDir);
    const impact = buildModuleImpact(fileMap, 'module.ts', [
      join(srcDir, 'a', 'a.service.ts'),
      join(srcDir, 'b', 'b.service.ts'),
    ]);

    const aModule = join(srcDir, 'a', 'module.ts');
    const bModule = join(srcDir, 'b', 'module.ts');

    expect(sorted(impact.changedModules)).toEqual([aModule, bModule]);
    expect(sorted(impact.affectedModules)).toEqual([aModule, bModule]);
  });

  it('is deterministic regardless of file map insertion order', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'zipbul-inc-'));
    const srcDir = join(rootDir, 'src');

    await mkdir(join(srcDir, 'a'), { recursive: true });
    await mkdir(join(srcDir, 'b'), { recursive: true });

    await writeFile(
      join(srcDir, 'a', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const aModule = defineModule();\n",
    );
    await writeFile(
      join(srcDir, 'b', 'module.ts'),
      "import { defineModule } from '@zipbul/core';\nexport const bModule = defineModule();\n",
    );
    await writeFile(join(srcDir, 'b', 'b.service.ts'), 'export const bService = 1;\n');
    await writeFile(join(srcDir, 'a', 'a.service.ts'), "import { bService } from '../b/b.service';\nexport const a = bService;\n");

    const fileMap = await buildFileMap(srcDir);
    const changedFile = join(srcDir, 'b', 'b.service.ts');

    const entries = Array.from(fileMap.entries());
    const reversed = new Map<string, FileAnalysis>(entries.reverse());

    const impact1 = buildModuleImpact(fileMap, 'module.ts', [changedFile]);
    const impact2 = buildModuleImpact(reversed, 'module.ts', [changedFile]);

    expect(sorted(impact1.changedModules)).toEqual(sorted(impact2.changedModules));
    expect(sorted(impact1.affectedModules)).toEqual(sorted(impact2.affectedModules));
  });
});