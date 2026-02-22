import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { join } from 'path';
import type { FileAnalysis } from './graph/interfaces';
import type { FileSetup } from '../../../test/shared/interfaces';


import type { AstParseResult } from './test/types';

import { createBunFileStub } from '../../../test/shared/stubs';

import { PathResolver } from '../../common';
import { AstParser } from './ast-parser';
import { AdapterSpecResolver } from './adapter-spec-resolver';

const applyParseToAnalysis = (analysis: FileAnalysis, parseResult: AstParseResult): FileAnalysis => {
  if (parseResult.imports !== undefined) {
    analysis.imports = parseResult.imports;
  }

  if (parseResult.exportedValues !== undefined) {
    analysis.exportedValues = parseResult.exportedValues;
  }

  if (parseResult.localValues !== undefined) {
    analysis.localValues = parseResult.localValues;
  }

  if (parseResult.moduleDefinition !== undefined) {
    analysis.moduleDefinition = parseResult.moduleDefinition;
  }

  return analysis;
};

describe('adapter-spec-resolver', () => {
  const projectRoot = '/project';
  const srcDir = join(projectRoot, 'src');
  const adapterDir = join(projectRoot, 'adapters', 'test-adapter');
  const controllerFile = join(srcDir, 'controllers.ts');
  const entryFile = join(adapterDir, 'index.ts');
  let setup: FileSetup;
  let bunFileSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    setup = {
      existsByPath: new Map<string, boolean>(),
      textByPath: new Map<string, string>(),
    };

    bunFileSpy = spyOn(Bun, 'file').mockImplementation(((path: string) => {
      return createBunFileStub(setup, path) as any;
    }) as typeof Bun.file);
  });

  afterEach(() => {
    bunFileSpy?.mockRestore();
  });

  it('should resolve adapterStaticSpecs and handlerIndex when adapterSpec is exported in entry file', async () => {
    // Arrange
    const entryCode = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      'function startAdapter() {}',
      'function stopAdapter() {}',
      'function dispatchBefore() {}',
      'function dispatchHandler() {}',
      '',
      'export class TestAdapter {',
      "  static adapterId = 'test';",
      "  static middlewarePhaseOrder = ['Before'];",
      '  static supportedMiddlewarePhases = { Before: true };',
      '  static entryDecorators = { controller: Controller, handler: [Get] };',
      '  static runtime = { start: startAdapter, stop: stopAdapter };',
      '  static pipeline = { middlewares: [dispatchBefore], guards: [], pipes: [], handler: dispatchHandler };',
      '}',
      '',
      'export const adapterSpec = defineAdapter(TestAdapter);',
      '',
    ].join('\n');
    const controllerCode = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      'function Middlewares() { return () => {}; }',
      'function mwOne() {}',
      '',
      '@Controller()',
      'class SampleController {',
      '  @Get()',
      "  @Middlewares('Before', [mwOne])",
      '  handle() {}',
      '}',
    ].join('\n');

    setup.existsByPath.set(entryFile, true);
    setup.textByPath.set(entryFile, entryCode);

    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [
        {
          source: '@test/adapter',
          resolvedSource: entryFile,
          isRelative: false,
        },
      ],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryParse = parser.parse(entryFile, entryCode);
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
    };

    applyParseToAnalysis(entryAnalysis, entryParse);

    entryAnalysis.exportedValues = {
      ...entryAnalysis.exportedValues,
      adapterSpec: {
        __zipbul_call: 'defineAdapter',
        args: [{ __zipbul_ref: 'TestAdapter' }],
      } as any,
    };

    fileMap.set(entryFile, entryAnalysis);

    // Act
    const resolver = new AdapterSpecResolver();
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSpecs)).toEqual(['test']);

    const expectedFile = PathResolver.normalize('src/controllers.ts');
    const expectedId = `test:${expectedFile}#SampleController.handle`;

    expect(result.handlerIndex.map(entry => entry.id)).toEqual([expectedId]);
  });

  it('should fail when adapterSpec export is missing in entry files', async () => {
    // Arrange
    const controllerCode = 'class SampleController {}';
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [
        {
          source: '@test/missing',
          resolvedSource: entryFile,
          isRelative: false,
        },
      ],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryParse = parser.parse(entryFile, 'export const notAdapterSpec = 123;');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { notAdapterSpec: 123 } as any,
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act
    const act = async () => {
      await resolver.resolve({ fileMap, projectRoot });
    };

    // Assert
    await expect(act()).rejects.toThrow(/No adapterSpec exports found/);
  });
});
