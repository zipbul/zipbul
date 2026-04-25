import { parseSource, type ParsedFile } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';
import { ZIPBUL_CALL } from '@zipbul/common';

import type {
  Node as AstNode,
  CallExpression,
  ArrowFunctionExpression,
  Function as OxcFunction,
  ImportDeclaration,
  VariableDeclaration,
} from 'oxc-parser';

import type { FileAnalysis } from '../graph/interfaces';
import type { AdapterStaticSchema } from '../interfaces';
import type { AnalyzerValueRecord } from '../types';
import type { ContextAdapterMap } from '../../generator/context-types-generator';
import type {
  MiddlewareContextAugment,
  MiddlewareProducerInfo,
} from './middleware-context-types';

import type { PropAugment } from '../parser/middleware-augment-extractor';
import { extractMiddlewareAugments } from '../parser/middleware-augment-extractor';
import { extractMiddlewareContextOps } from '../parser/context-operation-extractor';
import { AstParser } from '../parser';
import { toRecord, isAnalyzerValueArray } from '../type-guards';
import {
  collectPackageEntryFiles,
  getFileAnalysis,
} from './config-extractor';
import { Logger } from '@zipbul/logger';

const logger = new Logger('MiddlewareAugmentCollector');

/**
 * Result of middleware augment collection across the project.
 *
 * @public
 */
export interface MiddlewareAugmentCollectionResult {
  /** Augmentations extracted from registered middleware factory bodies (type augmentation). */
  readonly augments: readonly MiddlewareContextAugment[];
  /** Producer/consumer ops per middleware (runtime data flow — separate concern from augments). */
  readonly producerInfos: readonly MiddlewareProducerInfo[];
  /** Adapter-provided namespace → interface mapping for declaration merging. */
  readonly adapterMap: ContextAdapterMap;
}

/**
 * Collects middleware context augmentations from both project source files
 * and external npm packages.
 *
 * For project files: scans the fileMap directly.
 * For npm packages: discovers package entry points via `collectPackageEntryFiles()`,
 * uses `getFileAnalysis()` for on-demand parsing, and follows re-exports.
 *
 * @public
 */
export class MiddlewareAugmentCollector {
  private parser = new AstParser();

  /**
   * Collects augmentations from all `defineMiddleware()` exports.
   *
   * Scans both the project fileMap and npm package entry points.
   *
   * @param fileMap - Map of file paths to their analysis results.
   * @param adapterStaticSchemas - Adapter static schemas keyed by adapter ID.
   * @param registeredMiddlewareRefs - Optional set of middleware ref names to filter.
   * @returns Collected augments and the adapter map.
   */
  async collect(
    fileMap: Map<string, FileAnalysis>,
    adapterStaticSchemas: Record<string, AdapterStaticSchema>,
    registeredMiddlewareRefs?: ReadonlySet<string>,
  ): Promise<MiddlewareAugmentCollectionResult> {
    const adapterMap = buildContextAdapterMap(adapterStaticSchemas);
    const augments: MiddlewareContextAugment[] = [];
    const producerInfos: MiddlewareProducerInfo[] = [];

    // 1. Collect from project source files (already in fileMap)
    const localExports = collectMiddlewareExports(fileMap, registeredMiddlewareRefs);

    // 2. Collect from npm package entry points (on-demand parsing)
    const packageExports = await this.collectPackageMiddlewareExports(
      fileMap,
      registeredMiddlewareRefs,
    );

    const allExports = [...localExports, ...packageExports];

    for (const ref of allExports) {
      // Priority 1: __augments IR field (from zb build --lib output) — type augmentation only.
      // IR does not carry contextOps; producerInfo is empty for these.
      const irAugment = extractAugmentFromIR(ref);

      if (irAugment !== null) {
        augments.push(irAugment);
        continue;
      }

      // Priority 2: factory body AST parsing (source available) — both augments and ops.
      const ast = await extractFromFile(ref.name, ref.filePath);

      if (ast !== null) {
        if (ast.augment !== null) {
          augments.push(ast.augment);
        }
        if (ast.producerInfo !== null) {
          producerInfos.push(ast.producerInfo);
        }
      }
    }

    return { augments, producerInfos, adapterMap };
  }

  /**
   * Discovers and parses npm package entry points for `defineMiddleware()` exports.
   *
   * Uses the same on-demand resolution mechanism as adapter definition resolution:
   * 1. `collectPackageEntryFiles()` finds non-relative import targets
   * 2. `getFileAnalysis()` parses each on demand (with dist→source resolution)
   * 3. Re-exports are followed to find the actual middleware declarations
   */
  private async collectPackageMiddlewareExports(
    fileMap: Map<string, FileAnalysis>,
    registeredRefs?: ReadonlySet<string>,
  ): Promise<MiddlewareExportRef[]> {
    const entryFiles = collectPackageEntryFiles(fileMap);
    const refs: MiddlewareExportRef[] = [];
    const visited = new Set<string>();

    for (const entryFile of entryFiles) {
      const found = await this.resolveMiddlewareExports(
        entryFile,
        fileMap,
        visited,
        registeredRefs,
      );

      refs.push(...found);
    }

    return refs;
  }

  /**
   * Recursively resolves `defineMiddleware()` exports from a file,
   * following re-exports until the actual declaration is found.
   */
  private async resolveMiddlewareExports(
    filePath: string,
    fileMap: Map<string, FileAnalysis>,
    visited: Set<string>,
    registeredRefs?: ReadonlySet<string>,
  ): Promise<MiddlewareExportRef[]> {
    if (visited.has(filePath)) return [];

    visited.add(filePath);

    const analysis = await getFileAnalysis(filePath, fileMap, this.parser);

    if (analysis === null) return [];

    const refs: MiddlewareExportRef[] = [];

    // Check exported values for defineMiddleware calls
    const exportedValues = analysis.exportedValues;

    if (exportedValues !== undefined) {
      for (const [name, value] of Object.entries(exportedValues)) {
        if (registeredRefs !== undefined && !registeredRefs.has(name)) continue;

        const rec = toRecord(value);

        if (rec === null) continue;

        if (!isDefineMiddlewareCall(rec)) continue;

        // Already found in local scan — skip duplicate
        if (isInLocalScan(filePath)) continue;

        refs.push({ name, filePath, irValue: rec });
      }
    }

    // Follow re-exports
    const reExports = analysis.reExports ?? [];

    for (const entry of reExports) {
      const modulePath = entry.module;

      if (typeof modulePath !== 'string') continue;

      if (entry.exportAll) {
        const found = await this.resolveMiddlewareExports(
          modulePath,
          fileMap,
          visited,
          registeredRefs,
        );

        refs.push(...found);
        continue;
      }

      const names = entry.names ?? [];
      const hasMiddlewareReExport = names.some(
        nameEntry => registeredRefs === undefined || registeredRefs.has(nameEntry.exported),
      );

      if (hasMiddlewareReExport) {
        const found = await this.resolveMiddlewareExports(
          modulePath,
          fileMap,
          visited,
          registeredRefs,
        );

        refs.push(...found);
      }
    }

    return refs;
  }
}

/**
 * Checks if a file is a local source file (not from node_modules).
 */
function isInLocalScan(filePath: string): boolean {
  return !filePath.includes('/node_modules/');
}

/**
 * Builds the `ContextAdapterMap` from adapter schemas' `contextNamespaces`.
 *
 * `contextNamespaces` is auto-derived by the config-extractor from the
 * context class's getter return types (e.g. `get request(): HttpRequest`).
 */
function buildContextAdapterMap(
  adapterStaticSchemas: Record<string, AdapterStaticSchema>,
): ContextAdapterMap {
  const map: Record<string, Record<string, { interface: string; module: string }>> = {};

  for (const schema of Object.values(adapterStaticSchemas)) {
    if (schema.contextNamespaces === undefined) continue;

    const { contextType, module: moduleSpecifier, namespaces } = schema.contextNamespaces;
    const targets: Record<string, { interface: string; module: string }> = {};

    for (const [getterName, typeName] of Object.entries(namespaces)) {
      targets[getterName] = { interface: typeName, module: moduleSpecifier };
    }

    map[contextType] = targets;
  }

  return map;
}

interface MiddlewareExportRef {
  readonly name: string;
  readonly filePath: string;
  /** The AnalyzerValueRecord of the defineMiddleware() call, for __augments extraction. */
  readonly irValue?: AnalyzerValueRecord;
}

/**
 * Scans the file map for exported `defineMiddleware()` calls (project-local files only).
 */
function collectMiddlewareExports(
  fileMap: Map<string, FileAnalysis>,
  registeredRefs?: ReadonlySet<string>,
): MiddlewareExportRef[] {
  const refs: MiddlewareExportRef[] = [];

  for (const [filePath, analysis] of fileMap) {
    const exportedValues = analysis.exportedValues;

    if (exportedValues === undefined) continue;

    for (const [name, value] of Object.entries(exportedValues)) {
      if (registeredRefs !== undefined && !registeredRefs.has(name)) continue;

      const rec = toRecord(value);

      if (rec === null) continue;

      if (!isDefineMiddlewareCall(rec)) continue;

      refs.push({ name, filePath, irValue: rec });
    }
  }

  return refs;
}

/**
 * Checks whether an AnalyzerValueRecord represents a `defineMiddleware()` call.
 */
function isDefineMiddlewareCall(rec: AnalyzerValueRecord): boolean {
  const callee = rec[ZIPBUL_CALL];

  if (typeof callee !== 'string') return false;

  if (callee === 'defineMiddleware') return true;

  if (callee.endsWith('.defineMiddleware')) return true;

  return false;
}

/** Well-known IR property name for pre-extracted augment metadata. */
const AUGMENTS_IR_KEY = '__augments';

/**
 * Extracts augment info from the `__augments` IR field of a defineMiddleware call.
 *
 * This field is injected by `zb build --lib` during library compilation.
 * It contains pre-extracted augment metadata so the consumer compiler
 * doesn't need to parse the factory body.
 *
 * Returns null if the IR has no `__augments` field.
 */
function extractAugmentFromIR(ref: MiddlewareExportRef): MiddlewareContextAugment | null {
  if (ref.irValue === undefined) return null;

  const args = isAnalyzerValueArray(ref.irValue.args) ? ref.irValue.args : null;

  if (args === null || args.length === 0) return null;

  const configObj = toRecord(args[0]);

  if (configObj === null) return null;

  const augmentsRaw = configObj[AUGMENTS_IR_KEY];

  if (!isAnalyzerValueArray(augmentsRaw)) return null;

  const augments: PropAugment[] = [];
  let contextType: string | null = null;

  for (const entry of augmentsRaw) {
    const rec = toRecord(entry);

    if (rec === null) continue;

    const context = rec.context;
    const path = isAnalyzerValueArray(rec.path) ? rec.path : null;
    const kind = rec.kind;
    const type = rec.type;

    if (typeof context !== 'string' || path === null || typeof kind !== 'string') continue;

    if (contextType === null) {
      contextType = context;
    }

    const pathStrings = path.filter((segment): segment is string => typeof segment === 'string');

    if (pathStrings.length !== path.length) continue;

    if (kind === 'class' && typeof type === 'string') {
      augments.push({
        path: pathStrings,
        rhs: { kind: 'class', identifier: type },
      });
    } else if (kind === 'method' && typeof rec.signature === 'string') {
      augments.push({
        path: pathStrings,
        rhs: parseMethodSignature(rec.signature as string),
      });
    }
  }

  if (contextType === null || augments.length === 0) return null;

  // For class augments, the import source is the package that exports the middleware.
  // The consumer imports the type from the same package.
  const classImports = new Map<string, string>();
  const packageName = resolvePackageNameFromFilePath(ref.filePath);

  for (const aug of augments) {
    if (aug.rhs.kind === 'class') {
      classImports.set(aug.rhs.identifier, packageName ?? ref.filePath);
    }
  }

  return {
    middlewareName: ref.name,
    contextType,
    sourceFilePath: ref.filePath,
    augments,
    classImports,
  };
}

/**
 * Parses a method signature string like `<T>(dto: Class<T>): T` into an AugmentRhs.
 */
function parseMethodSignature(signature: string): PropAugment['rhs'] {
  const typeParams: string[] = [];
  const params: { name: string; type: string | null }[] = [];
  let returnType: string | null = null;

  // Extract type params: <T, U>
  const typeParamMatch = signature.match(/^<([^>]+)>/);

  if (typeParamMatch !== null) {
    typeParams.push(...typeParamMatch[1]!.split(',').map(t => t.trim()));
  }

  // Extract params: (name: Type, name2: Type2)
  const paramsMatch = signature.match(/\(([^)]*)\)/);

  if (paramsMatch !== null && paramsMatch[1]!.length > 0) {
    const paramParts = paramsMatch[1]!.split(',');

    for (const part of paramParts) {
      const colonIdx = part.indexOf(':');

      if (colonIdx !== -1) {
        params.push({
          name: part.slice(0, colonIdx).trim(),
          type: part.slice(colonIdx + 1).trim(),
        });
      } else {
        params.push({ name: part.trim(), type: null });
      }
    }
  }

  // Extract return type: ): T
  const returnMatch = signature.match(/\):\s*(.+)$/);

  if (returnMatch !== null) {
    returnType = returnMatch[1]!.trim();
  }

  return { kind: 'method', typeParams, params, returnType };
}

/**
 * Extracts the npm package name from a file path in node_modules.
 * e.g. `/path/node_modules/@zipbul/cookie/dist/index.js` → `@zipbul/cookie`
 */
function resolvePackageNameFromFilePath(filePath: string): string | null {
  const nodeModulesIdx = filePath.lastIndexOf('/node_modules/');

  if (nodeModulesIdx === -1) return null;

  const afterNodeModules = filePath.slice(nodeModulesIdx + '/node_modules/'.length);

  // Scoped package: @scope/name/...
  if (afterNodeModules.startsWith('@')) {
    const parts = afterNodeModules.split('/');

    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
  }

  // Unscoped package: name/...
  const slashIdx = afterNodeModules.indexOf('/');

  return slashIdx === -1 ? afterNodeModules : afterNodeModules.slice(0, slashIdx);
}

/**
 * Source-AST extraction result for a single middleware export.
 *
 * `augment` and `producerInfo` are independent concerns extracted from the same
 * factory body in one parse pass — they are returned together for efficiency
 * but consumed by separate downstream processors (type generator vs validator).
 */
interface MiddlewareSourceExtraction {
  readonly augment: MiddlewareContextAugment | null;
  readonly producerInfo: MiddlewareProducerInfo | null;
}

/**
 * Parses a source file and extracts BOTH middleware augmentations and
 * producer/consumer ops from a named export.
 *
 * Uses `parseSource()` for raw AST access to extract factory function bodies.
 * Works with TypeScript source files — for npm packages, relies on
 * `resolveDistToSource()` in the parser to find the original `.ts` source.
 */
async function extractFromFile(
  name: string,
  filePath: string,
): Promise<MiddlewareSourceExtraction | null> {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    logger.warn(`Middleware source file not found: ${filePath}`);
    return null;
  }

  const sourceText = await file.text();
  const parseResult = parseSource(filePath, sourceText);

  if (isErr(parseResult)) {
    logger.warn(`Failed to parse middleware source: ${filePath}`);
    return null;
  }

  const parsed: ParsedFile = parseResult;
  const factory = findDefineMiddlewareFactory(parsed.program.body, name);

  if (factory === null) {
    return null;
  }

  const augmentResult = extractMiddlewareAugments(factory);
  const contextOps = extractMiddlewareContextOps(factory);


  const augment = augmentResult !== null
    ? buildContextAugment(name, filePath, augmentResult, parsed.program.body)
    : null;

  const producerInfo = contextOps.length > 0
    ? { middlewareName: name, sourceFilePath: filePath, contextOps }
    : null;

  if (augment === null && producerInfo === null) {
    return null;
  }

  return { augment, producerInfo };
}

function buildContextAugment(
  name: string,
  filePath: string,
  result: { contextType: string; augments: readonly PropAugment[] },
  programBody: readonly AstNode[],
): MiddlewareContextAugment {
  const importMap = buildFileImportMap(programBody, filePath);
  const localDeclarations = collectLocalClassDeclarations(programBody);
  const classImports = new Map<string, string>();

  for (const augment of result.augments) {
    if (augment.rhs.kind === 'class') {
      const importPath = importMap.get(augment.rhs.identifier);

      if (importPath !== undefined) {
        const resolvedPath = resolvePackageNameFromFilePath(importPath) ?? importPath;
        classImports.set(augment.rhs.identifier, resolvedPath);
      } else if (localDeclarations.has(augment.rhs.identifier)) {
        classImports.set(augment.rhs.identifier, filePath);
      }
    }
  }

  return {
    middlewareName: name,
    contextType: result.contextType,
    sourceFilePath: filePath,
    augments: result.augments,
    classImports,
  };
}

/**
 * Finds the factory function argument of a `defineMiddleware(factory)` call
 * for a specific named export in the AST.
 *
 * Handles:
 * - `export const name = defineMiddleware(() => ...)` (ExportNamedDeclaration)
 * - `const name = defineMiddleware(() => ...)` (top-level VariableDeclaration)
 *
 * For the config object overload `defineMiddleware({ factory: () => ... })`,
 * extracts the `factory` property.
 */
function findDefineMiddlewareFactory(
  programBody: readonly AstNode[],
  name: string,
): OxcFunction | ArrowFunctionExpression | null {
  for (const stmt of programBody) {
    let varDecl: VariableDeclaration | null = null;

    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
      varDecl = stmt.declaration;
    } else if (stmt.type === 'VariableDeclaration') {
      varDecl = stmt;
    }

    if (varDecl === null) continue;

    for (const decl of varDecl.declarations) {
      if (decl.id.type !== 'Identifier' || decl.id.name !== name) continue;
      if (decl.init === null || decl.init === undefined || decl.init.type !== 'CallExpression') continue;

      const call = decl.init as CallExpression;

      return extractFactoryFromCallArgs(call);
    }
  }

  return null;
}

/**
 * Extracts the factory function from `defineMiddleware()` call arguments.
 *
 * Supports three overloads:
 * 1. `defineMiddleware(() => ...)` — factory-only
 * 2. `defineMiddleware([HttpAdapter], () => ...)` — adapters + factory
 * 3. `defineMiddleware({ factory: () => ... })` — config object
 */
function extractFactoryFromCallArgs(
  call: CallExpression,
): OxcFunction | ArrowFunctionExpression | null {
  const args = call.arguments;

  if (args.length === 0) return null;

  // Overload 1: factory-only — first arg is function
  const firstArg = args[0]!;

  if (isFunctionNode(firstArg)) {
    return firstArg as ArrowFunctionExpression | OxcFunction;
  }

  // Overload 2: adapters + factory — second arg is function
  if (args.length >= 2) {
    const secondArg = args[1]!;

    if (isFunctionNode(secondArg)) {
      return secondArg as ArrowFunctionExpression | OxcFunction;
    }
  }

  // Overload 3: config object — { factory: () => ... }
  if (firstArg.type === 'ObjectExpression') {
    for (const prop of firstArg.properties) {
      if (prop.type !== 'Property') continue;
      if (prop.key.type !== 'Identifier' || prop.key.name !== 'factory') continue;

      if (isFunctionNode(prop.value)) {
        return prop.value as ArrowFunctionExpression | OxcFunction;
      }
    }
  }

  return null;
}

function isFunctionNode(node: AstNode): boolean {
  return node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';
}

/**
 * Builds an import map from a file's import declarations.
 * Maps local binding name → resolved file path.
 */
function buildFileImportMap(
  programBody: readonly AstNode[],
  sourceFilePath: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const sourceDir = sourceFilePath.replace(/\/[^/]+$/, '');

  for (const stmt of programBody) {
    if (stmt.type !== 'ImportDeclaration') continue;

    const imp = stmt as ImportDeclaration;
    const source = imp.source.value;

    if (typeof source !== 'string') continue;

    // Resolve relative imports against the source file's directory
    const resolved = source.startsWith('.')
      ? resolveRelativeImport(sourceDir, source)
      : source;

    if (imp.specifiers === undefined) continue;

    for (const spec of imp.specifiers) {
      if (spec.type === 'ImportSpecifier' && spec.local.type === 'Identifier') {
        map.set(spec.local.name, resolved);
      }
    }
  }

  return map;
}

/**
 * Collects locally declared class names from a file's top-level statements.
 * Handles both `class Foo {}` and `export class Foo {}`.
 */
function collectLocalClassDeclarations(programBody: readonly AstNode[]): Set<string> {
  const names = new Set<string>();

  for (const stmt of programBody) {
    if (stmt.type === 'ClassDeclaration') {
      const id = (stmt as AstNode & { id?: AstNode }).id;

      if (id !== undefined && id.type === 'Identifier') {
        names.add((id as AstNode & { name: string }).name);
      }
    } else if (stmt.type === 'ExportNamedDeclaration') {
      const decl = (stmt as AstNode & { declaration?: AstNode }).declaration;

      if (decl !== undefined && decl.type === 'ClassDeclaration') {
        const id = (decl as AstNode & { id?: AstNode }).id;

        if (id !== undefined && id.type === 'Identifier') {
          names.add((id as AstNode & { name: string }).name);
        }
      }
    }
  }

  return names;
}

/**
 * Resolves a relative import path against a directory.
 * Appends `.ts` if the result doesn't end with an extension.
 */
function resolveRelativeImport(dir: string, relativePath: string): string {
  const segments = dir.split('/');
  const parts = relativePath.split('/');

  for (const part of parts) {
    if (part === '.') continue;

    if (part === '..') {
      segments.pop();
      continue;
    }

    segments.push(part);
  }

  const resolved = segments.join('/');

  if (resolved.endsWith('.ts') || resolved.endsWith('.js')) {
    return resolved;
  }

  return `${resolved}.ts`;
}
