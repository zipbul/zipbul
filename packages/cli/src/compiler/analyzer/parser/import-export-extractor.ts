import type {
  StaticImport, StaticExport,
  ExportNamedDeclaration, ExportDefaultDeclaration, ModuleExportName,
} from 'oxc-parser';

import type { ImportEntry } from '../interfaces';
import type { DefineModuleCall, ReExport } from '../parser-models';
import type { ReExportName } from '../types';
import { isNonEmptyString } from '../type-guards';
import { FRAMEWORK_CREATE_APPLICATION, FRAMEWORK_DEFINE_MODULE } from '@zipbul/common';

/**
 * Extracts the exported name from an `ExportNamedDeclaration` specifier's
 * `local` or `exported` node.
 *
 * @param node - The module export name node
 * @returns The string name (identifier name or literal value)
 */
function getExportName(node: ModuleExportName): string {
  return node.type === 'Literal' ? String(node.value) : node.name;
}

/** Callback that resolves a raw import specifier to an absolute path. */
interface ImportPathResolver {
  (sourcePath: string, importPath: string): string;
}

/** Mutable import-tracking state that lives on the parser instance. */
export interface ImportTrackingState {
  currentImports: Record<string, string>;
  currentImportSources: Record<string, string>;
  currentOriginalNames: Record<string, string>;
}

/**
 * Populates import tracking state from oxc-parser `StaticImport` entries.
 *
 * Produces the same `imports`, `importEntries`, `currentImports`,
 * `currentImportSources`, `currentOriginalNames`, and alias/namespace sets
 * that the monolithic parser previously built internally.
 *
 * @param staticImports - Import entries from `ParsedFile.module.staticImports`
 * @param filename - Current file path for resolving relative imports
 * @param imports - Output map of local name to resolved path
 * @param importEntries - Output list of import entries
 * @param createApplicationAliases - Aliases for `createApplication`
 * @param createApplicationNamespaces - Namespace imports from `@zipbul/core`
 * @param defineModuleAliases - Aliases for `defineModule`
 * @param defineModuleNamespaces - Namespace imports from `@zipbul/core`
 * @param resolvePath - Callback to resolve an import specifier to an absolute path
 * @param tracking - Mutable import-tracking state (currentImports, currentImportSources, currentOriginalNames)
 */
export function buildImportState(
  staticImports: readonly StaticImport[],
  filename: string,
  imports: Record<string, string>,
  importEntries: ImportEntry[],
  createApplicationAliases: Set<string>,
  createApplicationNamespaces: Set<string>,
  defineModuleAliases: Set<string>,
  defineModuleNamespaces: Set<string>,
  resolvePath: ImportPathResolver,
  tracking: ImportTrackingState,
): void {
  for (const imp of staticImports) {
    const sourceValue = imp.moduleRequest.value;
    const resolvedSource = resolvePath(filename, sourceValue);
    const isCoreImport = sourceValue === '@zipbul/core';

    importEntries.push({ source: sourceValue, resolvedSource, isRelative: sourceValue.startsWith('.') });

    for (const entry of imp.entries) {
      if (entry.isType) {
        continue;
      }

      const localName = entry.localName.value;

      imports[localName] = resolvedSource;
      tracking.currentImports[localName] = resolvedSource;
      tracking.currentImportSources[localName] = sourceValue;

      if (entry.importName.kind === 'Name') {
        const importedName = entry.importName.name;

        if (importedName !== null && importedName !== localName) {
          tracking.currentOriginalNames[localName] = importedName;
        }

        if (isCoreImport) {
          if (importedName === FRAMEWORK_CREATE_APPLICATION) {
            createApplicationAliases.add(localName);
          }

          if (importedName === FRAMEWORK_DEFINE_MODULE) {
            defineModuleAliases.add(localName);
          }
        }
      }

      if (entry.importName.kind === 'NamespaceObject' && isCoreImport) {
        createApplicationNamespaces.add(localName);
        defineModuleNamespaces.add(localName);
      }
    }
  }
}

/**
 * Populates re-export entries from oxc-parser `StaticExport` entries.
 *
 * Replaces the manual `ExportAllDeclaration` and `ExportNamedDeclaration`
 * with-source traversal.
 *
 * @param staticExports - Export entries from `ParsedFile.module.staticExports`
 * @param filename - Current file path for resolving relative imports
 * @param reExports - Output list of re-export entries
 * @param resolvePath - Callback to resolve an import specifier to an absolute path
 */
export function buildExportState(
  staticExports: readonly StaticExport[],
  filename: string,
  reExports: ReExport[],
  resolvePath: ImportPathResolver,
): void {
  for (const exp of staticExports) {
    for (const entry of exp.entries) {
      if (entry.moduleRequest === null) {
        continue;
      }

      const sourceValue = entry.moduleRequest.value;
      const resolvedSource = resolvePath(filename, sourceValue);

      if (entry.importName.kind === 'AllButDefault' || entry.importName.kind === 'All') {
        reExports.push({
          module: resolvedSource,
          exportAll: true,
        });

        continue;
      }

      if (entry.importName.kind === 'Name' && entry.exportName.kind === 'Name') {
        const localName = entry.importName.name ?? '';
        const exportedName = entry.exportName.name ?? '';

        if (localName.length > 0 && exportedName.length > 0) {
          const existing = reExports.find(
            re => re.module === resolvedSource && !re.exportAll,
          );

          if (existing) {
            const names = existing.names ?? [];

            names.push({ local: localName, exported: exportedName });
            existing.names = names;
          } else {
            reExports.push({
              module: resolvedSource,
              exportAll: false,
              names: [{ local: localName, exported: exportedName }],
            });
          }
        }
      }
    }
  }
}

/**
 * Collects exported names from an `ExportNamedDeclaration` node.
 *
 * Handles class declarations, enum declarations, variable declarations, and
 * named export specifiers. Skips re-exports (nodes with a `source`).
 *
 * @param node - The export named declaration AST node
 * @param localExports - Output list of exported names (mutated)
 * @param exportMappings - Output list of local-to-exported name mappings (mutated)
 * @param _defineModuleCalls - List of defineModule calls (unused in body, kept for call-site compatibility)
 */
export function collectExportNames(
  node: ExportNamedDeclaration,
  localExports: string[],
  exportMappings: ReExportName[],
  _defineModuleCalls: DefineModuleCall[],
): void {
  if (node.source !== null) {
    return;
  }

  const declaration = node.declaration;

  if (declaration?.type === 'ClassDeclaration') {
    const name = declaration.id?.name;

    if (isNonEmptyString(name)) {
      localExports.push(name);
    }

    return;
  }

  if (declaration?.type === 'TSEnumDeclaration') {
    const name = declaration.id.name;

    if (isNonEmptyString(name)) {
      localExports.push(name);
    }

    return;
  }

  if (declaration?.type === 'VariableDeclaration') {
    for (const decl of declaration.declarations) {
      const declName = decl.id.type === 'Identifier' ? decl.id.name : null;

      if (isNonEmptyString(declName)) {
        localExports.push(declName);
      }
    }

    return;
  }

  for (const spec of node.specifiers) {
    const localName = getExportName(spec.local);
    const exportedName = getExportName(spec.exported);

    if (!isNonEmptyString(localName) || !isNonEmptyString(exportedName)) {
      continue;
    }

    localExports.push(exportedName);
    exportMappings.push({ local: localName, exported: exportedName });
  }
}

/**
 * Resolves `export default <identifier>` to a defineModule call.
 *
 * When the default export is an identifier that matches a known defineModule
 * call's local name, marks that call as the default export.
 *
 * @param node - The export default declaration AST node
 * @param defineModuleCalls - List of defineModule calls to search and mutate
 */
export function resolveExportDefaultForDefineModuleInline(
  node: ExportDefaultDeclaration,
  defineModuleCalls: DefineModuleCall[],
): void {
  const decl = node.declaration;

  if (decl.type === 'Identifier') {
    const name = decl.name;

    if (isNonEmptyString(name)) {
      const existing = defineModuleCalls.find(call => call.localName === name);

      if (existing) {
        existing.exportedName = 'default';
      }
    }
  }
}
