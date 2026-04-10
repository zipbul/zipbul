import type { ParsedFile, ExtractedSymbol } from '@zipbul/gildash';
import type {
  Node as AstNode, Class, PropertyDefinition,
  Function as OxcFunction,
} from 'oxc-parser';
import type { Result } from '@zipbul/result';
import { err, isErr } from '@zipbul/result';
import { ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, TS_UTILITY_TYPES } from '@zipbul/common';

import type { ClassMetadata, DecoratorMetadata } from '../interfaces';
import type { AnalyzerValue } from '../types';
import type { ImportMap } from '../expression-converter';
import {
  convertDecorator, convertExpression, resolveTypeString,
  parseTypeAnnotation,
} from '../expression-converter';
import { isNonEmptyString } from '../type-guards';
import type { Diagnostic } from '../../../diagnostics';
import { buildDiagnostic } from '../../../diagnostics';

const UNKNOWN_TYPE_NAME = 'Unknown';

/**
 * Callback interface for AST node location functions.
 *
 * These functions are provided by the caller (ast-parser or ast-node-locator)
 * to locate raw AST nodes within a parsed class.
 */
export interface AstNodeLocatorCallbacks {
  /** Finds the raw Class AST node for the given class name. */
  findClassAstNode(parsed: ParsedFile, className: string): Class | null;
  /** Finds the Function AST node for a method body within a class. */
  findMethodBodyAstNode(classNode: Class, methodName: string): OxcFunction | null;
  /** Finds the PropertyDefinition AST node for a named property within a class. */
  findPropertyAstNode(classNode: Class, propName: string): PropertyDefinition | null;
  /** Returns computed/private metadata for a method within a class. */
  getMethodAstMeta(
    classNode: Class,
    methodName: string,
  ): { isComputed: boolean; isPrivateName: boolean; start: number } | null;
}

/**
 * Callback interface for method-level metadata extraction functions.
 *
 * These functions are provided by the caller (ast-parser or method-metadata-extractor)
 * to extract metadata from method bodies.
 */
export interface MethodMetadataCallbacks {
  /** Extracts middleware usages from a `configure` method body. */
  extractMiddlewaresFromConfigure(funcNode: OxcFunction): Result<ClassMetadata['middlewares'], Diagnostic>;
  /** Extracts exception filter usages from a `configure` method body. */
  extractExceptionFiltersFromConfigure(funcNode: OxcFunction): Result<ClassMetadata['exceptionFilters'], Diagnostic>;
  /** Extracts context member-access chains from a handler method body. */
  extractHandlerContextUsages(funcNode: OxcFunction): ClassMetadata['methods'][number]['contextUsages'];
}

/**
 * Callback interface for anonymous class detection.
 *
 * Provided by the caller to check whether a symbol represents an anonymous class.
 */
export interface AnonymousClassCallback {
  /** Checks whether the given symbol is an anonymous class. */
  isAnonymousClassSymbol(parsed: ParsedFile, symbol: ExtractedSymbol): boolean;
}

/**
 * Aggregated context parameters that replace `this.*` state from the original
 * AstParser class. These represent the per-file parsing state.
 */
export interface ClassMetadataContext {
  currentFilePath: string;
  currentOriginalNames: Record<string, string>;
  resolvePath: (sourcePath: string, importPath: string) => string;
}

/**
 * Converts an extracted class symbol into structured ClassMetadata.
 *
 * This is the primary entry point for class metadata extraction. It processes
 * the symbol's decorators, constructor parameters, methods, properties, and
 * heritage clauses into a normalized ClassMetadata structure suitable for
 * AOT compilation.
 *
 * @param symbol - Extracted class symbol from gildash
 * @param parsed - Parsed file containing the class
 * @param currentImports - Resolved import map for the current file
 * @param importMap - Import map for type resolution
 * @param context - Per-file parsing context (file path, original names, path resolver)
 * @param astLocators - Callbacks for locating raw AST nodes
 * @param methodCallbacks - Callbacks for method-level metadata extraction
 * @param anonymousCheck - Callback for anonymous class detection
 * @returns ClassMetadata on success, or a Diagnostic error for anonymous classes
 */
export function convertClassSymbol(
  symbol: ExtractedSymbol,
  parsed: ParsedFile,
  currentImports: Record<string, string>,
  importMap: ImportMap,
  context: ClassMetadataContext,
  astLocators: AstNodeLocatorCallbacks,
  methodCallbacks: MethodMetadataCallbacks,
  anonymousCheck: AnonymousClassCallback,
): Result<ClassMetadata, Diagnostic> {
  const className = symbol.name;

  // gildash gives anonymous classes the name "default" — detect by checking
  // if any raw class AST node at this symbol's span lacks an explicit id.
  if (className.length === 0 || anonymousCheck.isAnonymousClassSymbol(parsed, symbol)) {
    return err(buildDiagnostic({
      reason: 'Anonymous classes cannot be used as providers. All classes must have explicit names.',
      file: context.currentFilePath,
    }));
  }

  // Decorators — resolve aliased names through currentOriginalNames
  const decorators: DecoratorMetadata[] = (symbol.decorators ?? []).map(decorator => {
    const converted = convertDecorator(decorator);

    return {
      ...converted,
      name: resolveOriginalName(converted.name, context.currentOriginalNames),
    };
  });

  // Constructor params
  const constructorParams: ClassMetadata['constructorParams'] = [];
  const methods: ClassMetadata['methods'] = [];
  const properties: ClassMetadata['properties'] = [];
  let middlewares: ClassMetadata['middlewares'] = [];
  let exceptionFilters: ClassMetadata['exceptionFilters'] = [];

  // Find the raw class AST node for body access
  const rawClassNode = astLocators.findClassAstNode(parsed, className);

  if (symbol.members) {
    for (const member of symbol.members) {
      if (member.methodKind === 'constructor' && member.parameters) {
        for (const param of member.parameters) {
          const paramType = resolveParameterType(
            param.type,
            param.typeImportSource,
            importMap,
            context,
          );
          const paramDecorators = (param.decorators ?? []).map(decorator => {
            const converted = convertDecorator(decorator);

            return { ...converted, name: resolveOriginalName(converted.name, context.currentOriginalNames) };
          });

          constructorParams.push({
            name: param.name,
            type: paramType,
            typeArgs: extractTypeArgs(param.type),
            decorators: paramDecorators,
          });
        }

        continue;
      }

      if (member.kind === 'method' && member.methodKind === 'method') {
        const isStatic = member.modifiers.includes('static');
        const memberName = member.name;

        // Check raw AST for computed/private
        const astMeta = rawClassNode !== null
          ? astLocators.getMethodAstMeta(rawClassNode, memberName)
          : null;
        const isComputed = astMeta?.isComputed ?? false;
        const isPrivateName = astMeta?.isPrivateName ?? false;

        // gildash gives "unknown" for computed/private methods — treat as unnamed
        const isUnresolvableName = memberName === 'unknown' && (isComputed || isPrivateName);
        let methodName = isUnresolvableName ? '' : memberName;

        const methodDecorators = (member.decorators ?? []).map(decorator => {
          const converted = convertDecorator(decorator);

          return { ...converted, name: resolveOriginalName(converted.name, context.currentOriginalNames) };
        });

        if (!isNonEmptyString(methodName)) {
          if (isComputed && methodDecorators.length > 0) {
            methodName = `__computed_${astMeta?.start ?? 0}__`;
          } else {
            continue;
          }
        }

        const methodParams: ClassMetadata['methods'][number]['parameters'] = [];

        if (member.parameters) {
          for (let index = 0; index < member.parameters.length; index += 1) {
            const param = member.parameters[index];

            if (param === undefined) {
              continue;
            }

            const paramType = resolveParameterType(
              param.type,
              param.typeImportSource,
              importMap,
              context,
            );
            const paramDecorators = (param.decorators ?? []).map(decorator => {
              const converted = convertDecorator(decorator);

              return { ...converted, name: resolveOriginalName(converted.name, context.currentOriginalNames) };
            });

            methodParams.push({
              name: param.name,
              type: paramType,
              typeArgs: extractTypeArgs(param.type),
              decorators: paramDecorators,
              index,
            });
          }
        }

        methodParams.sort((a, b) => a.index - b.index);

        if (methodName === 'configure' && rawClassNode !== null) {
          const funcNode = astLocators.findMethodBodyAstNode(rawClassNode, 'configure');

          if (funcNode !== null) {
            const mwResult = methodCallbacks.extractMiddlewaresFromConfigure(funcNode);

            if (isErr(mwResult)) {
              return mwResult;
            }

            middlewares = mwResult;

            const efResult = methodCallbacks.extractExceptionFiltersFromConfigure(funcNode);

            if (isErr(efResult)) {
              return efResult;
            }

            exceptionFilters = efResult;
          }
        }

        if (methodDecorators.length > 0 || methodParams.some(param => param.decorators.length > 0)) {
          let contextUsages: ClassMetadata['methods'][number]['contextUsages'] | undefined;

          if (rawClassNode !== null) {
            const funcNode = astLocators.findMethodBodyAstNode(rawClassNode, methodName);

            if (funcNode !== null) {
              contextUsages = methodCallbacks.extractHandlerContextUsages(funcNode);
            }
          }

          methods.push({
            name: methodName,
            decorators: methodDecorators,
            parameters: methodParams,
            ...(contextUsages !== undefined && contextUsages.length > 0 ? { contextUsages } : {}),
            isStatic: isStatic || undefined,
            isComputed: isComputed || undefined,
            isPrivateName: isPrivateName || undefined,
          });
        }

        continue;
      }

      if (member.kind === 'property') {
        const propName = member.name;

        if (!isNonEmptyString(propName)) {
          continue;
        }

        const propDecorators = (member.decorators ?? []).map(decorator => {
          const converted = convertDecorator(decorator);

          return { ...converted, name: resolveOriginalName(converted.name, context.currentOriginalNames) };
        });

        const initializer = member.initializer !== undefined
          ? convertExpression(member.initializer)
          : null;

        const typeInfo = parseTypeAnnotation(member.returnType, importMap);

        if (propDecorators.length > 0 || initializer !== null) {
          const isProtected = member.modifiers.includes('protected');
          const rawProperty = rawClassNode !== null
            ? astLocators.findPropertyAstNode(rawClassNode, propName)
            : null;
          const isOptionalRaw = rawProperty !== null ? Boolean(rawProperty.optional) : false;
          const optional = isOptionalRaw || isProtected;

          properties.push({
            name: propName,
            type: typeInfo.type,
            typeArgs: typeInfo.typeArgs,
            decorators: propDecorators,
            initializer: initializer ?? undefined,
            isOptional: optional,
            isArray: typeInfo.isArray,
            items: typeInfo.items,
          });
        }
      }
    }
  }

  // Heritage — use gildash heritage but augment with type args from raw AST for TS_UTILITY_TYPES
  let heritage: ClassMetadata['heritage'] = undefined;

  if (symbol.heritage && symbol.heritage.length > 0) {
    for (const clause of symbol.heritage) {
      if (heritage !== undefined) {
        break;
      }

      if (TS_UTILITY_TYPES.includes(clause.name)) {
        const typeArgs = clause.typeArguments ?? extractHeritageTypeArgs(rawClassNode, clause.kind, clause.name);

        heritage = {
          clause: clause.kind,
          typeName: clause.name,
          typeArgs: typeArgs.length > 0 ? typeArgs : undefined,
        };
      } else {
        heritage = {
          clause: clause.kind,
          typeName: clause.name,
        };
      }
    }
  }

  return {
    className,
    heritage,
    decorators,
    constructorParams,
    methods,
    properties,
    imports: { ...currentImports },
    middlewares,
    exceptionFilters,
  };
}

/**
 * Resolves a parameter type string from gildash into an AnalyzerValue.
 *
 * When gildash provides a `typeImportSource`, uses that directly.
 * Otherwise falls back to the import map resolution.
 *
 * @param typeText - Type annotation text from gildash
 * @param typeImportSource - Import source from gildash parameter
 * @param importMap - Import map for fallback resolution
 * @param context - Per-file parsing context for path resolution
 * @returns AnalyzerValue for the parameter type
 */
function resolveParameterType(
  typeText: string | undefined,
  typeImportSource: string | undefined,
  importMap: ImportMap,
  context: ClassMetadataContext,
): AnalyzerValue {
  if (typeText === undefined || typeText.length === 0) {
    return 'any';
  }

  if (typeImportSource !== undefined) {
    const resolvedSource = context.resolvePath(context.currentFilePath, typeImportSource);
    const originalName = resolveOriginalNameFromImportMap(typeText, importMap);

    return {
      [ZIPBUL_REF]: originalName,
      [ZIPBUL_IMPORT_SOURCE]: resolvedSource,
    };
  }

  return resolveTypeString(typeText, importMap);
}

/**
 * Resolves the original exported name for a type through the import map.
 *
 * @param typeText - Local type name
 * @param importMap - Import map
 * @returns Original name if aliased, otherwise the typeText itself
 */
function resolveOriginalNameFromImportMap(typeText: string, importMap: ImportMap): string {
  const info = importMap.get(typeText);

  if (info !== undefined && info.originalName !== null) {
    return info.originalName;
  }

  return typeText;
}

/**
 * Extracts type arguments from a type annotation string.
 *
 * Parses generic type syntax (e.g. `"Map<string, User>"`) and returns
 * the individual type argument strings.
 *
 * @param typeText - Type annotation text (e.g. `"Map<string, User>"`)
 * @returns Array of type argument strings, or undefined if no generics
 */
function extractTypeArgs(typeText: string | undefined): string[] | undefined {
  if (typeText === undefined) {
    return undefined;
  }

  const genericMatch = typeText.match(/^(\w+)<(.+)>$/);

  if (genericMatch !== null && genericMatch[2] !== undefined) {
    return genericMatch[2].split(',').map(a => a.trim());
  }

  return undefined;
}

/**
 * Extracts heritage type arguments from the raw AST for TS_UTILITY_TYPES.
 *
 * gildash does not include type arguments in heritage, so this function
 * falls back to the raw AST for classes that extend/implement utility types
 * like `Partial`, `Pick`, `Omit`, `Required`.
 *
 * @param classNode - Raw ClassDeclaration AST node
 * @param clauseKind - 'extends' or 'implements'
 * @param typeName - The utility type name
 * @returns Array of type argument name strings
 */
function extractHeritageTypeArgs(
  classNode: Class | null,
  clauseKind: 'extends' | 'implements',
  typeName: string,
): string[] {
  if (classNode === null) {
    return [];
  }

  const typeArgs: string[] = [];

  if (clauseKind === 'extends') {
    const superClass = classNode.superClass;

    if (superClass === null) {
      return [];
    }

    let baseName: string | null = null;

    if (superClass.type === 'Identifier') {
      baseName = superClass.name;
    }

    if (superClass.type === 'TSInstantiationExpression') {
      baseName = superClass.expression.type === 'Identifier'
        ? superClass.expression.name
        : null;

      if (baseName === typeName) {
        for (const param of superClass.typeArguments.params) {
          typeArgs.push(resolveTypeArgName(param));
        }

        return typeArgs;
      }
    }

    // Check superTypeArguments (oxc-parser puts them separately)
    const superTypeArgs = classNode.superTypeArguments;

    if (superTypeArgs !== null && superTypeArgs !== undefined && baseName === typeName) {
      for (const param of superTypeArgs.params) {
        typeArgs.push(resolveTypeArgName(param));
      }
    }

    return typeArgs;
  }

  // implements
  const implementsList = classNode.implements ?? [];

  for (const impl of implementsList) {
    const expression = impl.expression;
    const expressionName = expression.type === 'Identifier' ? expression.name : null;

    if (expressionName !== typeName) {
      continue;
    }

    const typeParameters = impl.typeArguments;

    if (typeParameters !== null) {
      for (const param of typeParameters.params) {
        typeArgs.push(resolveTypeArgName(param));
      }
    }

    return typeArgs;
  }

  return typeArgs;
}

/**
 * Extracts a type name from a type parameter AST node.
 *
 * Handles `TSTypeReference` with `Identifier` typeName, returning
 * `'Unknown'` for unrecognized patterns.
 *
 * @param typeNode - AST node for a type parameter
 * @returns The resolved type name string
 */
export function resolveTypeArgName(typeNode: AstNode): string {
  if (typeNode.type === 'TSTypeReference') {
    const typeName = typeNode.typeName;

    if (typeName.type === 'Identifier') {
      return typeName.name;
    }
  }

  return UNKNOWN_TYPE_NAME;
}

/**
 * Resolves the original name for a local identifier through the original names map.
 *
 * @param localName - Local identifier name
 * @param currentOriginalNames - Map of local names to their original exported names
 * @returns The original name if aliased, otherwise the localName itself
 */
function resolveOriginalName(localName: string, currentOriginalNames: Record<string, string>): string {
  return currentOriginalNames[localName] ?? localName;
}
