import { Glob } from 'bun';
import { resolve, join } from 'path';

import { isErr } from '@zipbul/result';

import type { FileAnalysis } from '../src/compiler/analyzer/graph/interfaces';

import { AstParser } from '../src/compiler/analyzer/ast-parser';
import { ModuleGraph } from '../src/compiler/analyzer/graph/module-graph';
import { ImportRegistry } from '../src/compiler/generator/import-registry';
import { InjectorGenerator } from '../src/compiler/generator/injector-generator';

async function run() {
  const appDir = resolve(new URL('../../../examples/src', import.meta.url).pathname);

  console.log('Verifying app at:', appDir);

  const glob = new Glob('**/*.ts');
  const files: string[] = [];

  for await (const file of glob.scan(appDir)) {
    files.push(join(appDir, file));
  }

  console.log(`Found ${files.length} files.`);

  const parser = new AstParser();
  const fileMap = new Map<string, FileAnalysis>();

  console.log('Parsing files...');

  for (const file of files) {
    const code = await Bun.file(file).text();
    const parseResult = parser.parse(file, code);

    if (isErr(parseResult)) {
      console.error(`Parse failed for ${file}: ${parseResult.data.why}`);
      continue;
    }

    const result = parseResult;
    const analysis: FileAnalysis = {
      filePath: file,
      classes: result.classes,
      reExports: result.reExports,
      exports: result.exports,
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

    fileMap.set(file, analysis);
  }

  console.log('Building Module Graph...');

  const moduleFileName = '__module__.ts';
  const graph = new ModuleGraph(fileMap, moduleFileName);

  try {
    const modules = graph.build();

    console.log(`Graph built successfully. Found ${modules.size} modules.`);

    modules.forEach(node => {
      console.log(`- Module: ${node.name} (${node.providers.size} providers, ${node.dynamicProviderBundles.size} bundles)`);

      if (node.dynamicProviderBundles.size > 0) {
        console.log('  Has dynamic bundles!');
      }

      if (node.moduleDefinition?.adapters !== undefined) {
        console.log('  Has Adapters:', JSON.stringify(node.moduleDefinition.adapters, null, 2));
      }
    });

    const registry = new ImportRegistry(appDir);
    const generator = new InjectorGenerator();

    console.log('Generating Code...');

    const code = generator.generate(graph, registry);

    console.log('Generated Code Length:', code.length);
    console.log('--- GENERATED CODE START ---');
    console.log(code);
    console.log('--- GENERATED CODE END ---');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    console.error('AOT Validation Failed:', message);

    process.exit(1);
  }
}

void run();
