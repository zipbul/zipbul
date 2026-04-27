import type { CodeRelation, Node } from '@zipbul/gildash';

import type { ImportEntry } from '../interfaces';
import type { DefineModuleCall, ReExport } from '../parser-models';
import type { ReExportName } from '../types';
import { isNonEmptyString } from '../type-guards';
import { FRAMEWORK_CREATE_APPLICATION, FRAMEWORK_DEFINE_MODULE } from '@zipbul/common';

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

interface RelationMeta {
  readonly isType?: boolean;
  readonly isExternal?: boolean;
  readonly isReExport?: boolean;
  readonly importKind?: 'namespace' | 'default' | undefined;
  readonly specifiers?: ReadonlyArray<{ readonly local: string; readonly exported: string }>;
}

function parseRelationMeta(rel: CodeRelation): RelationMeta {
  if (rel.metaJson === undefined || rel.metaJson === null) {
    return rel.meta as RelationMeta ?? {};
  }

  try {
    return JSON.parse(rel.metaJson) as RelationMeta;
  } catch {
    return {};
  }
}

/**
 * Populates import tracking state from gildash `extractRelations` output.
 *
 * Replaces the previous `parsed.module.staticImports` (oxc-direct) walk
 * with a binding-level CodeRelation traversal — matches the maintainer's
 * confirmed contract that `import { Foo, type Bar }` splits into separate
 * `'imports'` and `'type-references'` relations per binding.
 *
 * Produces the same outputs the monolithic parser previously built:
 * `imports`, `importEntries`, `currentImports`, `currentImportSources`,
 * `currentOriginalNames`, framework alias/namespace sets.
 */
export function buildImportState(
  relations: readonly CodeRelation[],
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
  // 한 import statement 안의 여러 binding 은 같은 source 의 여러 relation 으로 split.
  // importEntries 는 source 당 1회 push 가 원본 동작.
  // 외부 모듈은 `specifier` 에 raw 가 들어오고 dstFilePath 는 null,
  // 내부 모듈은 `specifier` 가 없고 dstFilePath 에 절대 경로가 들어온다.
  const seenSources = new Map<string, string>(); // source key -> resolvedSource

  for (const rel of relations) {
    if (rel.type !== 'imports' && rel.type !== 'type-references') {
      continue;
    }

    const meta = parseRelationMeta(rel);

    // type-references 중 re-export 는 import 가 아니라 export 영역 — 여기서 제외.
    if (meta.isReExport === true) {
      continue;
    }

    const externalSpecifier = rel.specifier;
    const internalDst = rel.dstFilePath;
    const sourceKey = externalSpecifier ?? internalDst;

    if (sourceKey === null || sourceKey === undefined) {
      continue;
    }

    let resolvedSource = seenSources.get(sourceKey);

    if (resolvedSource === undefined) {
      resolvedSource = externalSpecifier !== undefined
        ? resolvePath(filename, externalSpecifier)
        : sourceKey;
      seenSources.set(sourceKey, resolvedSource);
      const sourceText = externalSpecifier ?? sourceKey;
      importEntries.push({
        source: sourceText,
        resolvedSource,
        isRelative: externalSpecifier === undefined || sourceText.startsWith('.'),
      });
    }

    const sourceValue = externalSpecifier ?? sourceKey;

    // type-only binding 은 추적 대상에서 제외 (기존 동작).
    if (rel.type === 'type-references') {
      continue;
    }

    const localName = rel.srcSymbolName;

    if (localName === null) {
      continue;
    }

    imports[localName] = resolvedSource;
    tracking.currentImports[localName] = resolvedSource;
    tracking.currentImportSources[localName] = sourceValue;

    const isCoreImport = sourceValue === '@zipbul/core';

    if (meta.importKind === 'namespace') {
      // `import * as ns` — alias 추적 무관, namespace 셋에 추가.
      if (isCoreImport) {
        createApplicationNamespaces.add(localName);
        defineModuleNamespaces.add(localName);
      }

      continue;
    }

    const importedName = rel.dstSymbolName;

    if (importedName !== null && importedName !== localName) {
      tracking.currentOriginalNames[localName] = importedName;
    }

    if (isCoreImport && importedName !== null) {
      if (importedName === FRAMEWORK_CREATE_APPLICATION) {
        createApplicationAliases.add(localName);
      }

      if (importedName === FRAMEWORK_DEFINE_MODULE) {
        defineModuleAliases.add(localName);
      }
    }
  }
}

/**
 * Populates re-export entries from gildash `extractRelations` output.
 *
 * Replaces the previous `parsed.module.staticExports` walk. Re-export-all
 * (`export * from 'X'`) produces a relation with `srcSymbolName === null`
 * and the meta carries `isReExport: true`. Named re-exports carry a
 * `specifiers` array.
 */
export function buildExportState(
  relations: readonly CodeRelation[],
  filename: string,
  reExports: ReExport[],
  resolvePath: ImportPathResolver,
): void {
  // 외부 모듈 re-export 는 specifier 에 raw + dstFilePath null,
  // 내부 모듈 re-export 는 dstFilePath 에 resolved + specifier 없음.
  // 한 source 당 한 ReExport 객체로 묶기 위해 중간 캐시 사용.
  const groups = new Map<string, ReExport>();

  for (const rel of relations) {
    if (rel.type !== 're-exports' && rel.type !== 'type-references') {
      continue;
    }

    const meta = parseRelationMeta(rel);

    if (rel.type === 'type-references' && meta.isReExport !== true) {
      continue;
    }

    const externalSpecifier = rel.specifier;
    const internalDst = rel.dstFilePath;
    const resolvedSource = externalSpecifier !== undefined
      ? resolvePath(filename, externalSpecifier)
      : internalDst;

    if (resolvedSource === null || resolvedSource === undefined) {
      continue;
    }

    if (rel.srcSymbolName === null && rel.dstSymbolName === null) {
      // export * from 'X'
      reExports.push({ module: resolvedSource, exportAll: true });

      continue;
    }

    const localName = rel.dstSymbolName ?? rel.srcSymbolName;
    const exportedName = rel.srcSymbolName ?? rel.dstSymbolName;

    if (!isNonEmptyString(localName) || !isNonEmptyString(exportedName)) {
      continue;
    }

    let group = groups.get(resolvedSource);

    if (group === undefined) {
      group = { module: resolvedSource, exportAll: false, names: [] };
      groups.set(resolvedSource, group);
      reExports.push(group);
    }

    const names = group.names ?? [];

    names.push({ local: localName, exported: exportedName });
    group.names = names;
  }
}

/**
 * Structural shape of an `ExportNamedDeclaration` AST node — the subset
 * the cli touches. `Node` from gildash/oxc is the full union; we narrow
 * by `type` discriminator and access fields via `as` because gildash
 * does not re-export the named subtype.
 */
type ExportNamedDeclarationLike = {
  readonly type: 'ExportNamedDeclaration';
  readonly source: { readonly value: string } | null;
  readonly declaration: AnyDeclaration | null;
  readonly specifiers: ReadonlyArray<{
    readonly local: { readonly type: 'Identifier'; readonly name: string } | { readonly type: 'Literal'; readonly value: string | number };
    readonly exported: { readonly type: 'Identifier'; readonly name: string } | { readonly type: 'Literal'; readonly value: string | number };
  }>;
};

type ExportDefaultDeclarationLike = {
  readonly type: 'ExportDefaultDeclaration';
  readonly declaration: { readonly type: 'Identifier'; readonly name: string } | { readonly type: string };
};

type AnyDeclaration =
  | { readonly type: 'ClassDeclaration'; readonly id: { readonly name: string } | null }
  | { readonly type: 'TSEnumDeclaration'; readonly id: { readonly name: string } }
  | {
    readonly type: 'VariableDeclaration';
    readonly declarations: ReadonlyArray<{
      readonly id: { readonly type: 'Identifier'; readonly name: string } | { readonly type: string };
    }>;
  }
  | { readonly type: string };

/**
 * Collects exported names from an `ExportNamedDeclaration` node.
 *
 * Handles class declarations, enum declarations, variable declarations, and
 * named export specifiers. Skips re-exports (nodes with a `source`).
 */
export function collectExportNames(
  node: Node,
  localExports: string[],
  exportMappings: ReExportName[],
  _defineModuleCalls: DefineModuleCall[],
): void {
  if (node.type !== 'ExportNamedDeclaration') {
    return;
  }

  const named = node as unknown as ExportNamedDeclarationLike;

  if (named.source !== null) {
    return;
  }

  const declaration = named.declaration;

  if (declaration?.type === 'ClassDeclaration') {
    const classDecl = declaration as Extract<AnyDeclaration, { type: 'ClassDeclaration' }>;
    const name = classDecl.id?.name;

    if (isNonEmptyString(name)) {
      localExports.push(name);
    }

    return;
  }

  if (declaration?.type === 'TSEnumDeclaration') {
    const enumDecl = declaration as Extract<AnyDeclaration, { type: 'TSEnumDeclaration' }>;
    const name = enumDecl.id.name;

    if (isNonEmptyString(name)) {
      localExports.push(name);
    }

    return;
  }

  if (declaration?.type === 'VariableDeclaration') {
    const varDecl = declaration as Extract<AnyDeclaration, { type: 'VariableDeclaration' }>;

    for (const decl of varDecl.declarations) {
      const declName = decl.id.type === 'Identifier' ? (decl.id as { name: string }).name : null;

      if (isNonEmptyString(declName)) {
        localExports.push(declName);
      }
    }

    return;
  }

  for (const spec of named.specifiers) {
    const localName = spec.local.type === 'Literal' ? String(spec.local.value) : spec.local.name;
    const exportedName = spec.exported.type === 'Literal' ? String(spec.exported.value) : spec.exported.name;

    if (!isNonEmptyString(localName) || !isNonEmptyString(exportedName)) {
      continue;
    }

    localExports.push(exportedName);
    exportMappings.push({ local: localName, exported: exportedName });
  }
}

/**
 * Resolves `export default <identifier>` to a defineModule call.
 */
export function resolveExportDefaultForDefineModuleInline(
  node: Node,
  defineModuleCalls: DefineModuleCall[],
): void {
  if (node.type !== 'ExportDefaultDeclaration') {
    return;
  }

  const def = node as unknown as ExportDefaultDeclarationLike;
  const decl = def.declaration;

  if (decl.type === 'Identifier') {
    const ident = decl as { name: string };
    const name = ident.name;

    if (isNonEmptyString(name)) {
      const existing = defineModuleCalls.find(call => call.localName === name);

      if (existing) {
        existing.exportedName = 'default';
      }
    }
  }
}
