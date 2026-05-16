import { describe, expect, test } from 'bun:test';

import type { CodeRelation } from '@zipbul/gildash';

import {
  buildImportState,
  buildExportState,
  collectExportNames,
  resolveExportDefaultForDefineModuleInline,
  type ImportTrackingState,
} from './import-export-extractor';
import type { ImportEntry } from '../interfaces';
import type { DefineModuleCall, ReExport } from '../parser-models';
import type { ReExportName } from '../types';

const FILE = '/app/src/index.ts';

function makeTrackingState(): ImportTrackingState {
  return {
    currentImports: {},
    currentImportSources: {},
    currentOriginalNames: {},
  };
}

function call(filename: string, relations: readonly CodeRelation[]): {
  imports: Record<string, string>;
  importEntries: ImportEntry[];
  reExports: ReExport[];
  createApplicationAliases: Set<string>;
  createApplicationNamespaces: Set<string>;
  defineModuleAliases: Set<string>;
  defineModuleNamespaces: Set<string>;
  tracking: ImportTrackingState;
} {
  const imports: Record<string, string> = {};
  const importEntries: ImportEntry[] = [];
  const reExports: ReExport[] = [];
  const createApplicationAliases = new Set<string>();
  const createApplicationNamespaces = new Set<string>();
  const defineModuleAliases = new Set<string>();
  const defineModuleNamespaces = new Set<string>();
  const tracking = makeTrackingState();

  buildImportState(
    relations,
    filename,
    imports,
    importEntries,
    createApplicationAliases,
    createApplicationNamespaces,
    defineModuleAliases,
    defineModuleNamespaces,
    (_src, importPath) => importPath.startsWith('.')
      ? `/app/src/${importPath.replace(/^\.\//, '')}.ts`
      : `/app/node_modules/${importPath}/dist/index.js`,
    tracking,
  );

  buildExportState(
    relations,
    filename,
    reExports,
    (_src, importPath) => importPath.startsWith('.')
      ? `/app/src/${importPath.replace(/^\.\//, '')}.ts`
      : `/app/node_modules/${importPath}/dist/index.js`,
  );

  return { imports, importEntries, reExports, createApplicationAliases, createApplicationNamespaces, defineModuleAliases, defineModuleNamespaces, tracking };
}

describe('buildImportState', () => {
  test('external named import populates imports + tracking + entries', () => {
    const result = call(FILE, [
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'Foo', dstFilePath: null, specifier: 'lib', dstSymbolName: 'Foo' },
    ]);
    expect(result.imports.Foo).toBe('/app/node_modules/lib/dist/index.js');
    expect(result.tracking.currentImports.Foo).toBe('/app/node_modules/lib/dist/index.js');
    expect(result.tracking.currentImportSources.Foo).toBe('lib');
    expect(result.importEntries).toEqual([
      { source: 'lib', resolvedSource: '/app/node_modules/lib/dist/index.js', isRelative: false },
    ]);
  });

  test('aliased import preserves originalName in tracking', () => {
    const result = call(FILE, [
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'Bar', dstFilePath: null, specifier: 'lib', dstSymbolName: 'Foo' },
    ]);
    expect(result.tracking.currentOriginalNames.Bar).toBe('Foo');
    expect(result.imports.Bar).toBe('/app/node_modules/lib/dist/index.js');
  });

  test('multiple bindings of same source produce single importEntry', () => {
    const result = call(FILE, [
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'A', dstFilePath: null, specifier: 'lib', dstSymbolName: 'A' },
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'B', dstFilePath: null, specifier: 'lib', dstSymbolName: 'B' },
    ]);
    expect(result.importEntries).toHaveLength(1);
    expect(result.imports.A).toBeDefined();
    expect(result.imports.B).toBeDefined();
  });

  test('type-only import is skipped from tracking but still adds importEntry', () => {
    const result = call(FILE, [
      { type: 'type-references', srcFilePath: FILE, srcSymbolName: 'Foo', dstFilePath: null, specifier: 'lib', dstSymbolName: 'Foo', metaJson: '{"isType":true,"isExternal":true}' },
    ]);
    expect(result.imports.Foo).toBeUndefined();
    expect(result.tracking.currentImports.Foo).toBeUndefined();
    expect(result.importEntries).toHaveLength(1); // statement still observed
  });

  test('namespace import (* as ns) sets namespace sets when from @zipbul/core', () => {
    const result = call(FILE, [
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'core', dstFilePath: null, specifier: '@zipbul/core', dstSymbolName: '*', metaJson: '{"isExternal":true,"importKind":"namespace"}' },
    ]);
    expect(result.createApplicationNamespaces.has('core')).toBe(true);
    expect(result.defineModuleNamespaces.has('core')).toBe(true);
    expect(result.imports.core).toBe('/app/node_modules/@zipbul/core/dist/index.js');
  });

  test('namespace import from non-core module does not populate framework sets', () => {
    const result = call(FILE, [
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'lib', dstFilePath: null, specifier: 'somelib', dstSymbolName: '*', metaJson: '{"isExternal":true,"importKind":"namespace"}' },
    ]);
    expect(result.createApplicationNamespaces.size).toBe(0);
    expect(result.defineModuleNamespaces.size).toBe(0);
  });

  test('createApplication / defineModule named imports register aliases', () => {
    const result = call(FILE, [
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'createApp', dstFilePath: null, specifier: '@zipbul/core', dstSymbolName: 'createApplication' },
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'defineModule', dstFilePath: null, specifier: '@zipbul/core', dstSymbolName: 'defineModule' },
    ]);
    expect(result.createApplicationAliases.has('createApp')).toBe(true);
    expect(result.defineModuleAliases.has('defineModule')).toBe(true);
  });

  test('internal import (specifier missing, dstFilePath set) uses dstFilePath as resolved', () => {
    const result = call(FILE, [
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'Local', dstFilePath: '/app/src/local.ts', dstSymbolName: 'Local' },
    ]);
    expect(result.imports.Local).toBe('/app/src/local.ts');
    expect(result.importEntries).toHaveLength(1);
    expect(result.importEntries[0]?.resolvedSource).toBe('/app/src/local.ts');
    expect(result.importEntries[0]?.isRelative).toBe(true);
  });

  test('re-export type-references are not treated as imports', () => {
    const result = call(FILE, [
      { type: 'type-references', srcFilePath: FILE, srcSymbolName: 'Foo', dstFilePath: '/app/src/local.ts', dstSymbolName: 'Foo', metaJson: '{"isReExport":true,"isType":true}' },
    ]);
    expect(result.imports.Foo).toBeUndefined();
    expect(result.importEntries).toHaveLength(0);
  });
});

describe('buildExportState', () => {
  test('export * from X produces exportAll entry', () => {
    const result = call(FILE, [
      { type: 're-exports', srcFilePath: FILE, srcSymbolName: null, dstFilePath: '/app/src/utils.ts', dstSymbolName: null, metaJson: '{"isReExport":true}' },
    ]);
    expect(result.reExports).toHaveLength(1);
    expect(result.reExports[0]).toEqual({ module: '/app/src/utils.ts', exportAll: true });
  });

  test('export { Foo } from X produces named entry', () => {
    const result = call(FILE, [
      { type: 're-exports', srcFilePath: FILE, srcSymbolName: 'Foo', dstFilePath: '/app/src/local.ts', dstSymbolName: 'Foo', metaJson: '{"isReExport":true,"specifiers":[{"local":"Foo","exported":"Foo"}]}' },
    ]);
    expect(result.reExports).toHaveLength(1);
    expect(result.reExports[0]).toMatchObject({
      module: '/app/src/local.ts',
      exportAll: false,
      names: [{ local: 'Foo', exported: 'Foo' }],
    });
  });

  test('multiple named re-exports from same module merge into one ReExport', () => {
    const result = call(FILE, [
      { type: 're-exports', srcFilePath: FILE, srcSymbolName: 'A', dstFilePath: '/app/src/local.ts', dstSymbolName: 'A', metaJson: '{"isReExport":true}' },
      { type: 're-exports', srcFilePath: FILE, srcSymbolName: 'B', dstFilePath: '/app/src/local.ts', dstSymbolName: 'B', metaJson: '{"isReExport":true}' },
    ]);
    expect(result.reExports).toHaveLength(1);
    const entry = result.reExports[0];
    expect(entry?.exportAll).toBe(false);
    expect(entry?.names).toHaveLength(2);
  });

  test('type re-export (export { type Foo } from X) is included with type-references type', () => {
    const result = call(FILE, [
      { type: 'type-references', srcFilePath: FILE, srcSymbolName: 'TFoo', dstFilePath: '/app/src/local.ts', dstSymbolName: 'TFoo', metaJson: '{"isReExport":true,"isType":true}' },
    ]);
    expect(result.reExports).toHaveLength(1);
    expect(result.reExports[0]?.exportAll).toBe(false);
    expect(result.reExports[0]?.names).toHaveLength(1);
  });

  test('plain imports relation is ignored in re-exports output', () => {
    const result = call(FILE, [
      { type: 'imports', srcFilePath: FILE, srcSymbolName: 'X', dstFilePath: null, specifier: 'lib', dstSymbolName: 'X' },
    ]);
    expect(result.reExports).toHaveLength(0);
  });

  test('mixed: export * + named in same call produces 2 entries', () => {
    const result = call(FILE, [
      { type: 're-exports', srcFilePath: FILE, srcSymbolName: 'A', dstFilePath: '/app/src/named.ts', dstSymbolName: 'A', metaJson: '{"isReExport":true}' },
      { type: 're-exports', srcFilePath: FILE, srcSymbolName: null, dstFilePath: '/app/src/all.ts', dstSymbolName: null, metaJson: '{"isReExport":true}' },
    ]);
    expect(result.reExports).toHaveLength(2);
  });

  test('external re-export uses specifier resolved via callback', () => {
    const result = call(FILE, [
      { type: 're-exports', srcFilePath: FILE, srcSymbolName: 'Foo', dstFilePath: null, specifier: '@zipbul/core', dstSymbolName: 'Foo', metaJson: '{"isReExport":true,"isExternal":true}' },
    ]);
    expect(result.reExports[0]?.module).toBe('/app/node_modules/@zipbul/core/dist/index.js');
  });
});

describe('collectExportNames', () => {
  test('class declaration export adds class name', () => {
    const localExports: string[] = [];
    const exportMappings: ReExportName[] = [];
    const node = {
      type: 'ExportNamedDeclaration',
      source: null,
      declaration: { type: 'ClassDeclaration', id: { name: 'Foo' } },
      specifiers: [],
    };
    collectExportNames(node as never, localExports, exportMappings, []);
    expect(localExports).toEqual(['Foo']);
    expect(exportMappings).toEqual([]);
  });

  test('enum declaration export adds enum name', () => {
    const localExports: string[] = [];
    const node = {
      type: 'ExportNamedDeclaration',
      source: null,
      declaration: { type: 'TSEnumDeclaration', id: { name: 'Color' } },
      specifiers: [],
    };
    collectExportNames(node as never, localExports, [], []);
    expect(localExports).toEqual(['Color']);
  });

  test('variable declaration export adds each declarator name', () => {
    const localExports: string[] = [];
    const node = {
      type: 'ExportNamedDeclaration',
      source: null,
      declaration: {
        type: 'VariableDeclaration',
        declarations: [
          { id: { type: 'Identifier', name: 'a' } },
          { id: { type: 'Identifier', name: 'b' } },
        ],
      },
      specifiers: [],
    };
    collectExportNames(node as never, localExports, [], []);
    expect(localExports).toEqual(['a', 'b']);
  });

  test('named specifier with export alias adds exported name + mapping', () => {
    const localExports: string[] = [];
    const exportMappings: ReExportName[] = [];
    const node = {
      type: 'ExportNamedDeclaration',
      source: null,
      declaration: null,
      specifiers: [
        {
          local: { type: 'Identifier', name: 'foo' },
          exported: { type: 'Identifier', name: 'Foo' },
        },
      ],
    };
    collectExportNames(node as never, localExports, exportMappings, []);
    expect(localExports).toEqual(['Foo']);
    expect(exportMappings).toEqual([{ local: 'foo', exported: 'Foo' }]);
  });

  test('node with source (re-export) is ignored', () => {
    const localExports: string[] = [];
    const node = {
      type: 'ExportNamedDeclaration',
      source: { value: './local' },
      declaration: null,
      specifiers: [
        { local: { type: 'Identifier', name: 'Foo' }, exported: { type: 'Identifier', name: 'Foo' } },
      ],
    };
    collectExportNames(node as never, localExports, [], []);
    expect(localExports).toEqual([]);
  });

  test('non-ExportNamedDeclaration node is ignored', () => {
    const localExports: string[] = [];
    const node = { type: 'VariableDeclaration', declarations: [] };
    collectExportNames(node as never, localExports, [], []);
    expect(localExports).toEqual([]);
  });
});

describe('resolveExportDefaultForDefineModuleInline', () => {
  test('matching identifier sets exportedName=default on existing call', () => {
    const calls: DefineModuleCall[] = [
      { localName: 'appModule', exportedName: undefined } as DefineModuleCall,
    ];
    const node = { type: 'ExportDefaultDeclaration', declaration: { type: 'Identifier', name: 'appModule' } };
    resolveExportDefaultForDefineModuleInline(node as never, calls);
    expect(calls[0]?.exportedName).toBe('default');
  });

  test('non-matching identifier leaves exportedName untouched', () => {
    const calls: DefineModuleCall[] = [
      { localName: 'a', exportedName: undefined } as DefineModuleCall,
    ];
    const node = { type: 'ExportDefaultDeclaration', declaration: { type: 'Identifier', name: 'b' } };
    resolveExportDefaultForDefineModuleInline(node as never, calls);
    expect(calls[0]?.exportedName).toBeUndefined();
  });

  test('non-ExportDefaultDeclaration is ignored', () => {
    const calls: DefineModuleCall[] = [
      { localName: 'a', exportedName: undefined } as DefineModuleCall,
    ];
    const node = { type: 'ClassDeclaration' };
    resolveExportDefaultForDefineModuleInline(node as never, calls);
    expect(calls[0]?.exportedName).toBeUndefined();
  });

  test('default declaration with non-identifier (class expression etc.) is ignored', () => {
    const calls: DefineModuleCall[] = [
      { localName: 'a', exportedName: undefined } as DefineModuleCall,
    ];
    const node = { type: 'ExportDefaultDeclaration', declaration: { type: 'ClassExpression' } };
    resolveExportDefaultForDefineModuleInline(node as never, calls);
    expect(calls[0]?.exportedName).toBeUndefined();
  });
});
