import type { ExpressionValue, ExpressionCall, ExpressionIdentifier, CodeRelation } from '@zipbul/gildash';

import type { DecoratorMetadata } from './interfaces';
import type { AnalyzerValue } from './types';
import type { InjectCall } from './parser-models';

import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE,
} from '@zipbul/common';

// Pure ExpressionValue → IR conversion lives in expression-value-to-zipbul-ir.ts
// (Step 1 adapter). This module re-exports the primitives and layers
// inject-call collection / type-annotation parsing on top.
import {
  convertExpression as adapterConvertExpression,
  convertExpressionWithHooks,
  extractLazyRefName,
  type ExpressionConvertHooks,
} from './expression-value-to-zipbul-ir';

export const convertExpression: (expr: ExpressionValue) => AnalyzerValue = adapterConvertExpression;

/**
 * Resolved import information for a local binding.
 *
 * @public
 */
export interface ImportInfo {
  readonly importSource: string;
  readonly originalName: string | null;
}

/**
 * Import map: local binding name → import metadata.
 *
 * @public
 */
export type ImportMap = ReadonlyMap<string, ImportInfo>;

/**
 * Builds an import map from gildash `CodeRelation` tuples.
 *
 * Each value-level binding (`kind === 'imports'`) is mapped to its raw module
 * specifier (preserved as-written by gildash 0.26.1+) and original exported
 * name when aliased. Type-only relations (`kind === 'type-references'`) are
 * skipped — they do not produce runtime bindings.
 *
 * Aliased detection: `srcSymbolName !== dstSymbolName` and `dstSymbolName` is
 * not the kind sentinel (`'default'` for default imports, `'*'` for namespace
 * imports). Note: the rare idiom `import { default as Foo } from 'M'` — a
 * named alias of the default export — is indistinguishable from a bare default
 * import at this layer (both carry `dstSymbolName === 'default'`); it is
 * treated as non-aliased here. cli has no such usage.
 *
 * @param relations - Output of `extractRelations(parsed.program, filePath)`
 * @returns A read-only map of local name → import metadata
 * @public
 */
export function buildImportMap(relations: readonly CodeRelation[]): ImportMap {
  const map = new Map<string, ImportInfo>();

  for (const rel of relations) {
    if (rel.type !== 'imports') {
      continue;
    }

    if (rel.srcSymbolName === null || rel.specifier === undefined) {
      continue;
    }

    const localName = rel.srcSymbolName;
    const dstName = rel.dstSymbolName;
    const isAliasedNamed = dstName !== null
      && dstName !== localName
      && dstName !== 'default'
      && dstName !== '*';

    map.set(localName, {
      importSource: rel.specifier,
      originalName: isAliasedNamed ? dstName : null,
    });
  }

  return map;
}

/**
 * Converts a gildash `Decorator` into the compiler's `DecoratorMetadata`.
 *
 * @param decorator - Decorator from gildash extraction
 * @returns DecoratorMetadata with converted arguments
 * @public
 */
export function convertDecorator(decorator: { name: string; arguments?: ExpressionValue[] }): DecoratorMetadata {
  const args = decorator.arguments?.map(convertExpression) ?? [];

  return { name: decorator.name, arguments: args };
}

/**
 * Resolves a type annotation string into an AnalyzerValue using the import map.
 *
 * Primitives and unknown types pass through as-is. Imported type names
 * are resolved to `ZIPBUL_REF` + `ZIPBUL_IMPORT_SOURCE` records.
 *
 * @param typeText - Type annotation text (e.g. `"MyService"`, `"string"`, `"string[]"`)
 * @param importMap - Import map from `buildImportMap`
 * @returns AnalyzerValue representation of the type
 * @public
 */
export function resolveTypeString(typeText: string | undefined, importMap: ImportMap): AnalyzerValue {
  if (typeText === undefined || typeText.length === 0) {
    return 'any';
  }

  if (isBuiltinType(typeText)) {
    return typeText;
  }

  const arrayElement = extractArrayElement(typeText);

  if (arrayElement !== null) {
    return resolveTypeString(arrayElement, importMap);
  }

  const info = importMap.get(typeText);

  if (info !== undefined) {
    return {
      [ZIPBUL_REF]: info.originalName ?? typeText,
      [ZIPBUL_IMPORT_SOURCE]: info.importSource,
    };
  }

  return typeText;
}

const BUILTIN_TYPES = new Set(['string', 'number', 'boolean', 'void', 'any', 'unknown', 'never', 'object', 'undefined', 'null', 'bigint', 'symbol']);

/**
 * Checks whether a type text represents a TypeScript built-in type.
 *
 * @param typeText - Type annotation text
 * @returns `true` if the type is a built-in primitive/keyword
 */
function isBuiltinType(typeText: string): boolean {
  return BUILTIN_TYPES.has(typeText);
}

/**
 * Extracts the element type from an array type annotation.
 *
 * Handles both `T[]` and `Array<T>` syntax.
 *
 * @param typeText - Type annotation text
 * @returns The element type text or `null` if not an array type
 */
function extractArrayElement(typeText: string): string | null {
  if (typeText.endsWith('[]')) {
    return typeText.slice(0, -2);
  }

  if (typeText.startsWith('Array<') && typeText.endsWith('>')) {
    return typeText.slice(6, -1);
  }

  return null;
}

/**
 * Parsed type information from a type annotation string.
 *
 * @public
 */
export interface ParsedTypeInfo {
  readonly type: AnalyzerValue;
  readonly typeArgs?: string[];
  readonly isArray?: boolean;
  readonly items?: AnalyzerValue;
}

/**
 * Parses a type annotation string into full type information for PropertyMetadata.
 *
 * Extracts array/generic structure and resolves import references.
 *
 * @param typeText - Type annotation text from gildash
 * @param importMap - Import map for resolving references
 * @returns Parsed type info with array/generic metadata
 * @public
 */
export function parseTypeAnnotation(typeText: string | undefined, importMap: ImportMap): ParsedTypeInfo {
  if (typeText === undefined || typeText.length === 0) {
    return { type: 'any' };
  }

  if (isBuiltinType(typeText)) {
    return { type: typeText };
  }

  if (typeText.endsWith('[]')) {
    const elementText = typeText.slice(0, -2);
    const elementType = resolveTypeString(elementText, importMap);

    return {
      type: resolveTypeString(typeText, importMap),
      isArray: true,
      items: elementType,
    };
  }

  if (typeText.startsWith('Array<') && typeText.endsWith('>')) {
    const elementText = typeText.slice(6, -1);
    const elementType = resolveTypeString(elementText, importMap);

    return {
      type: resolveTypeString(typeText, importMap),
      typeArgs: [elementText],
      isArray: true,
      items: elementType,
    };
  }

  const genericMatch = typeText.match(/^(\w+)<(.+)>$/);

  if (genericMatch !== null && genericMatch[1] !== undefined && genericMatch[2] !== undefined) {
    const baseName = genericMatch[1];
    const argText = genericMatch[2];
    const typeArgs = argText.split(',').map(a => a.trim());

    return {
      type: resolveTypeString(baseName, importMap),
      typeArgs,
    };
  }

  return { type: resolveTypeString(typeText, importMap) };
}

/**
 * Result of converting an ExpressionValue tree with inject call collection.
 *
 * @public
 */
/**
 * Tracks a factory function found during deep conversion.
 *
 * The caller can use the sourceText to locate the function in the raw AST
 * and run factory-specific analysis (deps, inject calls, param types).
 *
 * @public
 */
export interface FactoryFunctionRef {
  readonly sourceText: string;
  readonly path: readonly string[];
}

export interface ConversionResult {
  readonly value: AnalyzerValue;
  readonly injectCalls: readonly InjectCall[];
  readonly factoryRefs: readonly FactoryFunctionRef[];
}

/**
 * Converts an ExpressionValue tree to AnalyzerValue while collecting inject() calls.
 *
 * Walks the entire ExpressionValue tree recursively. Any `ExpressionCall`
 * matching the `inject()` pattern from `@zipbul/common` is collected into
 * `injectCalls`. The call itself converts to the standard `ZIPBUL_CALL`
 * shape — downstream consumers read `injectCalls` (not the IR shape).
 *
 * @param expr - Root expression to convert
 * @param filePath - Current file path for inject call context
 * @returns Converted value and collected inject calls
 * @public
 */
/**
 * Optional configuration for `convertExpressionDeep`.
 *
 * @public
 */
export interface ConversionOptions {
  readonly importMap?: ImportMap | undefined;
  readonly resolveImportSource?: ((raw: string) => string) | undefined;
}

export function convertExpressionDeep(expr: ExpressionValue, filePath: string, importMap?: ImportMap): ConversionResult;
export function convertExpressionDeep(expr: ExpressionValue, filePath: string, options?: ConversionOptions): ConversionResult;
export function convertExpressionDeep(expr: ExpressionValue, filePath: string, mapOrOptions?: ImportMap | ConversionOptions): ConversionResult {
  const injectCalls: InjectCall[] = [];
  const factoryRefs: FactoryFunctionRef[] = [];

  const isOptions = (value: ImportMap | ConversionOptions | undefined): value is ConversionOptions =>
    value !== undefined && !(value instanceof Map);
  const importMap = isOptions(mapOrOptions) ? mapOrOptions.importMap : mapOrOptions;
  const resolveImportSource = isOptions(mapOrOptions) ? mapOrOptions.resolveImportSource : undefined;

  // Build hooks once and delegate the entire tree walk to the shared
  // `convertExpressionWithHooks` in expression-value-to-zipbul-ir.ts. This
  // is the single source of truth for case dispatch — no parallel switch
  // statement lives here.
  const hooks: ExpressionConvertHooks = {
    resolveSource: (raw) => raw === undefined ? undefined : resolveImportSource?.(raw) ?? raw,
    resolveObjectSource: (objectText) => {
      if (importMap === undefined) return undefined;
      const rootIdent = objectText.split('.')[0];
      if (rootIdent === undefined) return undefined;
      const raw = importMap.get(rootIdent)?.importSource;
      return raw === undefined ? undefined : resolveImportSource?.(raw) ?? raw;
    },
    onCall: (node) => {
      const inject = detectInjectCall(node, filePath);
      if (inject !== null) {
        injectCalls.push(inject);
      }
    },
    transformLazyRefName: (refName) => {
      const resolved = importMap?.get(refName);
      return resolved?.originalName ?? refName;
    },
    onFunction: (node) => {
      factoryRefs.push({ sourceText: node.sourceText, path: [] });
    },
  };

  return { value: convertExpressionWithHooks(expr, hooks), injectCalls, factoryRefs };
}

/**
 * Detects whether a gildash `ExpressionCall` is an `inject()` call
 * from `@zipbul/common` and builds an `InjectCall` record.
 *
 * @param expr - Call expression to check
 * @param filePath - Current file path for diagnostic context
 * @returns An InjectCall if this is an inject() call, or `null`
 * @public
 */
export function detectInjectCall(expr: ExpressionCall, filePath: string): InjectCall | null {
  if (expr.importSource !== '@zipbul/common') {
    return null;
  }

  if (expr.callee !== 'inject' && !expr.callee.endsWith('.inject')) {
    return null;
  }

  if (expr.arguments.length !== 1) {
    return {
      tokenKind: 'invalid',
      token: null,
      callee: expr.callee,
      importSource: expr.importSource,
      filePath,
    };
  }

  const arg = expr.arguments[0];

  if (arg === undefined) {
    return {
      tokenKind: 'invalid',
      token: null,
      callee: expr.callee,
      importSource: expr.importSource,
      filePath,
    };
  }

  if (arg.kind === 'identifier' || arg.kind === 'member') {
    return {
      tokenKind: 'token',
      token: convertExpression(arg),
      callee: expr.callee,
      importSource: expr.importSource,
      filePath,
    };
  }

  if (arg.kind === 'function') {
    const refName = extractLazyRefName(arg.sourceText);

    if (refName !== null) {
      return {
        tokenKind: 'thunk',
        token: convertExpression({ kind: 'identifier', name: refName } as ExpressionIdentifier),
        callee: expr.callee,
        importSource: expr.importSource,
        filePath,
      };
    }
  }

  return {
    tokenKind: 'invalid',
    token: null,
    callee: expr.callee,
    importSource: expr.importSource,
    filePath,
  };
}
