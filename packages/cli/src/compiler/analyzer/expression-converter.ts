import type { ExpressionValue, ExpressionCall, ExpressionIdentifier, ExpressionFunction } from '@zipbul/gildash';
import type { StaticImport } from 'oxc-parser';

import type { DecoratorMetadata } from './interfaces';
import type { AnalyzerValue, AnalyzerValueRecord } from './types';
import type { InjectCall } from './parser-models';

import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_NEW,
  ZIPBUL_FACTORY_CODE, ZIPBUL_SPREAD, ZIPBUL_COMPUTED_PREFIX, ZIPBUL_COMPUTED_KEY,
  ZIPBUL_COMPUTED_VALUE, ZIPBUL_UNRESOLVABLE, ZIPBUL_LAZY_REF,
} from '@zipbul/common';

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
 * Builds an import map from oxc-parser `StaticImport` entries.
 *
 * Each local binding is mapped to its module specifier and original
 * exported name (when aliased).
 *
 * @param staticImports - Import declarations from `ParsedFile.module.staticImports`
 * @returns A read-only map of local name → import metadata
 * @public
 */
export function buildImportMap(staticImports: readonly StaticImport[]): ImportMap {
  const map = new Map<string, ImportInfo>();

  for (const imp of staticImports) {
    const importSource = imp.moduleRequest.value;

    for (const entry of imp.entries) {
      if (entry.isType) {
        continue;
      }

      const localName = entry.localName.value;
      const originalName = entry.importName.kind === 'Name' && entry.importName.name !== localName
        ? entry.importName.name
        : null;

      map.set(localName, { importSource, originalName });
    }
  }

  return map;
}

/**
 * Converts a gildash `ExpressionValue` into the compiler's `AnalyzerValue` IR.
 *
 * Handles all 11 ExpressionValue kinds with recursive descent for
 * nested structures (objects, arrays, call arguments).
 *
 * @param expr - Structured expression from gildash extraction
 * @returns The equivalent AnalyzerValue representation
 * @public
 */
export function convertExpression(expr: ExpressionValue): AnalyzerValue {
  switch (expr.kind) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      return expr.value;

    case 'undefined':
      return undefined;

    case 'identifier':
      return {
        [ZIPBUL_REF]: expr.originalName ?? expr.name,
        [ZIPBUL_IMPORT_SOURCE]: expr.importSource,
      };

    case 'member':
      return {
        [ZIPBUL_REF]: `${expr.object}.${expr.property}`,
        [ZIPBUL_IMPORT_SOURCE]: expr.importSource,
      };

    case 'call':
      return convertCallExpression(expr);

    case 'new':
      return {
        [ZIPBUL_NEW]: expr.callee,
        args: expr.arguments.map(convertExpression),
      };

    case 'object':
      return convertObjectExpression(expr);

    case 'array':
      return expr.elements.map(convertExpression);

    case 'spread':
      return { [ZIPBUL_SPREAD]: convertExpression(expr.argument) };

    case 'function':
      return convertFunctionExpression(expr);

    case 'template':
    case 'unresolvable':
      return { [ZIPBUL_UNRESOLVABLE]: true, sourceText: expr.sourceText };
  }
}

/**
 * Converts a gildash `ExpressionCall` into an AnalyzerValue.
 *
 * Detects special patterns:
 * - `lazy(() => X)` → `{ ZIPBUL_LAZY_REF: 'X' }`
 * - Generic calls → `{ ZIPBUL_CALL: callee, ZIPBUL_IMPORT_SOURCE, args }`
 *
 * @param expr - A call expression from gildash extraction
 * @returns AnalyzerValue for the call
 */
function convertCallExpression(expr: ExpressionCall): AnalyzerValue {
  if (expr.callee === 'lazy' && expr.arguments.length > 0) {
    const firstArg = expr.arguments[0];

    if (firstArg !== undefined && firstArg.kind === 'function') {
      const refName = extractLazyRefName(firstArg.sourceText);

      if (refName !== null) {
        return { [ZIPBUL_LAZY_REF]: refName };
      }
    }
  }

  return {
    [ZIPBUL_CALL]: expr.callee,
    [ZIPBUL_IMPORT_SOURCE]: expr.importSource,
    args: expr.arguments.map(convertExpression),
  };
}

/**
 * Converts a gildash `ExpressionFunction` into an AnalyzerValue.
 *
 * Produces the `ZIPBUL_FACTORY_CODE` sentinel and, when the function has
 * typed parameters (gildash 0.23.0+), includes `__zipbul_factory_params`.
 *
 * @param expr - A function expression from gildash extraction
 * @returns AnalyzerValue for the function
 */
function convertFunctionExpression(expr: ExpressionFunction): AnalyzerValueRecord {
  const result: AnalyzerValueRecord = { [ZIPBUL_FACTORY_CODE]: expr.sourceText };

  if (expr.parameters !== undefined && expr.parameters.length > 0) {
    const params: AnalyzerValueRecord[] = expr.parameters.map(param => {
      const entry: AnalyzerValueRecord = {
        name: param.name,
        typeName: param.type ?? null,
      };

      if (param.typeImportSource !== undefined) {
        entry.importSource = param.typeImportSource;
      }

      return entry;
    });

    result.__zipbul_factory_params = params;
  }

  return result;
}

/**
 * Extracts the returned identifier name from a lazy thunk source text.
 *
 * Matches patterns like `() => Foo` or `() => { return Foo; }`.
 *
 * @param sourceText - Raw source text of the arrow/function expression
 * @returns The identifier name or `null` if not extractable
 */
function extractLazyRefName(sourceText: string): string | null {
  const arrowMatch = sourceText.match(/^\s*\(.*?\)\s*=>\s*(\w+)\s*$/);

  if (arrowMatch?.[1] !== undefined) {
    return arrowMatch[1];
  }

  const blockMatch = sourceText.match(/return\s+(\w+)\s*;?\s*\}/);

  if (blockMatch?.[1] !== undefined) {
    return blockMatch[1];
  }

  return null;
}

/**
 * Converts a gildash `ExpressionObject` into an `AnalyzerValueRecord`.
 *
 * Handles computed properties using `ZIPBUL_COMPUTED_*` sentinel keys.
 *
 * @param expr - An object expression from gildash extraction
 * @returns AnalyzerValueRecord with converted property values
 */
function convertObjectExpression(expr: { kind: 'object'; properties: readonly { key: string; value: ExpressionValue; computed?: boolean; shorthand?: boolean }[] }): AnalyzerValueRecord {
  const result: AnalyzerValueRecord = {};
  let computedIndex = 0;

  for (const prop of expr.properties) {
    if (prop.computed === true) {
      const keyExpr = convertExpression({ kind: 'identifier', name: prop.key } as ExpressionIdentifier);
      const valExpr = convertExpression(prop.value);

      result[`${ZIPBUL_COMPUTED_PREFIX}${computedIndex}`] = {
        [ZIPBUL_COMPUTED_KEY]: keyExpr,
        [ZIPBUL_COMPUTED_VALUE]: valExpr,
      };
      computedIndex++;

      continue;
    }

    result[prop.key] = convertExpression(prop.value);
  }

  return result;
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
 * `injectCalls` and converted to the `__zipbul_inject` sentinel format.
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

  const importMap = mapOrOptions instanceof Map ? mapOrOptions : mapOrOptions?.importMap;
  const resolveImportSource = mapOrOptions instanceof Map ? undefined : mapOrOptions?.resolveImportSource;

  const resolveSource = (raw: string | undefined): string | undefined => {
    if (raw === undefined) {
      return undefined;
    }

    if (resolveImportSource !== undefined) {
      return resolveImportSource(raw);
    }

    return raw;
  };

  const resolveObjectImportSource = (objectText: string): string | undefined => {
    if (importMap === undefined) {
      return undefined;
    }

    const rootIdent = objectText.split('.')[0];

    if (rootIdent === undefined) {
      return undefined;
    }

    const raw = importMap.get(rootIdent)?.importSource;

    return resolveSource(raw);
  };

  const convert = (node: ExpressionValue): AnalyzerValue => {
    switch (node.kind) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'null':
        return node.value;

      case 'undefined':
        return undefined;

      case 'identifier':
        return {
          [ZIPBUL_REF]: node.originalName ?? node.name,
          [ZIPBUL_IMPORT_SOURCE]: resolveSource(node.importSource),
        };

      case 'member':
        return {
          [ZIPBUL_REF]: `${node.object}.${node.property}`,
          [ZIPBUL_IMPORT_SOURCE]: resolveSource(node.importSource) ?? resolveObjectImportSource(node.object),
        };

      case 'call': {
        const inject = detectInjectCall(node, filePath);

        if (inject !== null) {
          injectCalls.push(inject);

          return {
            __zipbul_inject: true,
            tokenKind: inject.tokenKind,
            token: inject.token,
          };
        }

        if (node.callee === 'lazy' && node.arguments.length > 0) {
          const firstArg = node.arguments[0];

          if (firstArg !== undefined && firstArg.kind === 'function') {
            const refName = extractLazyRefName(firstArg.sourceText);

            if (refName !== null) {
              const resolved = importMap?.get(refName);
              const originalName = resolved?.originalName ?? refName;

              return { [ZIPBUL_LAZY_REF]: originalName };
            }
          }
        }

        return {
          [ZIPBUL_CALL]: node.callee,
          [ZIPBUL_IMPORT_SOURCE]: resolveSource(node.importSource),
          args: node.arguments.map(convert),
        };
      }

      case 'new':
        return {
          [ZIPBUL_NEW]: node.callee,
          args: node.arguments.map(convert),
        };

      case 'object': {
        const result: AnalyzerValueRecord = {};
        let computedIndex = 0;

        for (const prop of node.properties) {
          if (prop.computed === true) {
            result[`${ZIPBUL_COMPUTED_PREFIX}${computedIndex}`] = {
              [ZIPBUL_COMPUTED_KEY]: convert({ kind: 'identifier', name: prop.key } as ExpressionIdentifier),
              [ZIPBUL_COMPUTED_VALUE]: convert(prop.value),
            };
            computedIndex++;

            continue;
          }

          result[prop.key] = convert(prop.value);
        }

        return result;
      }

      case 'array':
        return node.elements.map(convert);

      case 'spread':
        return { [ZIPBUL_SPREAD]: convert(node.argument) };

      case 'function': {
        factoryRefs.push({ sourceText: node.sourceText, path: [] });

        return convertFunctionExpression(node);
      }

      case 'template':
      case 'unresolvable':
        return { [ZIPBUL_UNRESOLVABLE]: true, sourceText: node.sourceText };
    }
  };

  return { value: convert(expr), injectCalls, factoryRefs };
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
