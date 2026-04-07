import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'path';

import { parseSource, extractSymbols, patternSearch, buildLineOffsets, visitorKeys } from '@zipbul/gildash';
import type { ParsedFile, ExtractedSymbol, ExpressionObject, PatternMatch } from '@zipbul/gildash';
import type {
  StaticImport, StaticExport,
  Node as AstNode, Directive, Statement, Expression,
  Class, MethodDefinition, PropertyDefinition,
  VariableDeclaration,
  ExportNamedDeclaration, ExportDefaultDeclaration, ModuleExportName,
  CallExpression, ArrayExpression,
  Function as OxcFunction, TSTypeReference,
} from 'oxc-parser';

import type { ClassMetadata, DecoratorMetadata, ImportEntry, CallArgRef } from './interfaces';
import type { CreateApplicationCall, DefineModuleCall, InjectCall, ModuleDefinition, ParseResult, ReExport } from './parser-models';
import type {
  AnalyzerValue,
  AnalyzerValueRecord,
  FactoryInjectCall,
  FactoryDependency,
  ReExportName,
} from './types';

import type { Result } from '@zipbul/result';
import { err, isErr } from '@zipbul/result';
import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE,
  ZIPBUL_FACTORY_CODE,
  FRAMEWORK_CREATE_APPLICATION, FRAMEWORK_DEFINE_MODULE,
  TS_UTILITY_TYPES,
} from '@zipbul/common';
import type { Diagnostic } from '../../diagnostics';
import { buildDiagnostic } from '../../diagnostics';
import {
  convertExpression, convertExpressionDeep, convertDecorator, resolveTypeString, buildImportMap,
  parseTypeAnnotation,
} from './expression-converter';
import type { ImportMap, ConversionResult } from './expression-converter';
import { isRecordValue, isNonEmptyString } from './type-guards';
import { compareCodePoint } from '../../common';

const UNKNOWN_TYPE_NAME = 'Unknown';

/**
 * Extended PatternMatch with byte offset fields.
 *
 * The runtime API includes `startOffset`/`endOffset`/`startColumn`/`endColumn`
 * but the published type declarations may omit them. This type ensures
 * safe access.
 */
type PatternMatchWithOffsets = PatternMatch & {
  readonly startOffset?: number;
  readonly endOffset?: number;
};

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && 'type' in value
    && typeof (value as Record<string, unknown>).type === 'string';
}

/**
 * Walks child AST nodes of a parent node using oxc-parser's `visitorKeys`.
 *
 * Unlike manual `Object.keys()` enumeration, this only traverses keys that
 * are known to contain AST children — avoiding structural fields like `type`,
 * `start`, `end`, and `parent`.
 */
function walkChildren(node: AstNode, visitor: (child: AstNode) => void): void {
  const keys = visitorKeys[node.type];

  if (!keys) {
    return;
  }

  for (const key of keys) {
    const child = (node as Record<string, unknown>)[key];

    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item)) {
          visitor(item);
        }
      }
    } else if (isAstNode(child)) {
      visitor(child);
    }
  }
}

function getExportName(node: ModuleExportName): string {
  return node.type === 'Literal' ? String(node.value) : node.name;
}

export class AstParser {
  private currentCode: string = '';
  private currentFilePath: string = '';
  private currentImports: Record<string, string> = {};
  private currentImportSources: Record<string, string> = {};
  private currentOriginalNames: Record<string, string> = {};
  private currentInjectCalls: InjectCall[] = [];

  async parse(filename: string, code: string): Promise<Result<ParseResult, Diagnostic>> {
    this.currentFilePath = filename;
    this.currentCode = code;
    this.currentInjectCalls = [];

    // 1. parseSource → ParsedFile (error → diagnostic)
    const parseResult = parseSource(filename, code);

    if (isErr(parseResult)) {
      return err(buildDiagnostic({
        reason: `Parse error in ${filename}: ${parseResult.reason}`,
        file: filename,
      }));
    }

    const parsed: ParsedFile = parseResult;

    const classes: ClassMetadata[] = [];
    const reExports: ReExport[] = [];
    const localExports: string[] = [];
    const exportMappings: ReExportName[] = [];
    const imports: Record<string, string> = {};
    const importEntries: ImportEntry[] = [];
    const localValues: AnalyzerValueRecord = {};
    const exportedValues: AnalyzerValueRecord = {};
    const createApplicationCalls: CreateApplicationCall[] = [];
    const createApplicationAliases = new Set<string>();
    const createApplicationNamespaces = new Set<string>();
    const defineModuleCalls: DefineModuleCall[] = [];
    const defineModuleAliases = new Set<string>();
    const defineModuleNamespaces = new Set<string>();

    this.currentImports = {};
    this.currentImportSources = {};
    this.currentOriginalNames = {};
    const enumDeclarations = new Map<string, Map<string, string>>();

    let moduleDefinition: ModuleDefinition | undefined;
    let parseError: ReturnType<typeof err<Diagnostic>> | null = null;

    // 2. buildImportState from staticImports
    this.buildImportState(
      parsed.module.staticImports,
      filename,
      imports,
      importEntries,
      createApplicationAliases,
      createApplicationNamespaces,
      defineModuleAliases,
      defineModuleNamespaces,
    );

    // 3. buildExportState from staticExports
    this.buildExportState(parsed.module.staticExports, filename, reExports);

    // 4. extractSymbols
    const symbols = extractSymbols(parsed);

    // 5. buildImportMap for type resolution
    const importMap = buildImportMap(parsed.module.staticImports);

    // 5b. Run patternSearch for inject() detection
    // Collect all inject aliases and namespace prefixes
    const injectAliases = new Set<string>();
    const injectNamespaces = new Set<string>();

    for (const imp of parsed.module.staticImports) {
      if (imp.moduleRequest.value !== '@zipbul/common') {
        continue;
      }

      for (const entry of imp.entries) {
        if (entry.isType) {
          continue;
        }

        if (entry.importName.kind === 'Name' && entry.importName.name === 'inject') {
          injectAliases.add(entry.localName.value);
        }

        if (entry.importName.kind === 'NamespaceObject') {
          injectNamespaces.add(entry.localName.value);
        }
      }
    }

    const injectPatterns: string[] = [];

    for (const alias of injectAliases) {
      injectPatterns.push(`${alias}($$$ARGS)`);
    }

    for (const ns of injectNamespaces) {
      injectPatterns.push(`${ns}.inject($$$ARGS)`);
    }

    const allInjectMatches: PatternMatch[] = [];

    for (const pattern of injectPatterns) {
      const matches = await this.runPatternSearch(filename, code, pattern);

      allInjectMatches.push(...matches);
    }

    // Sort by source position to maintain document order
    allInjectMatches.sort((a, b) => a.startLine - b.startLine);

    const lineOffsets = buildLineOffsets(code);

    for (const match of allInjectMatches) {
      const calleeName = this.resolveInjectCallee(match.matchedText);
      const resolvedCallee = this.resolveOriginalName(calleeName);
      const importSource = this.findImportSourceForCallee(calleeName);

      if (importSource !== '@zipbul/common') {
        continue;
      }

      if (resolvedCallee !== 'inject' && !resolvedCallee.endsWith('.inject')) {
        continue;
      }

      const argsCapture = match.captures?.['$$$ARGS'];
      const injectCall = this.buildInjectCallFromCapture(argsCapture, resolvedCallee, importSource);

      this.currentInjectCalls.push(injectCall);
    }

    // 5c. Run patternSearch for createApplication bare calls
    const caPatterns: string[] = [];

    for (const alias of createApplicationAliases) {
      caPatterns.push(`${alias}($$$ARGS)`);
    }

    for (const ns of createApplicationNamespaces) {
      caPatterns.push(`${ns}.${FRAMEWORK_CREATE_APPLICATION}($$$ARGS)`);
    }

    const allCaMatches: PatternMatch[] = [];

    for (const pattern of caPatterns) {
      const matches = await this.runPatternSearch(filename, code, pattern);

      allCaMatches.push(...matches);
    }

    // 5d. Run patternSearch for defineModule bare calls
    const dmPatterns: string[] = [];

    for (const alias of defineModuleAliases) {
      dmPatterns.push(`${alias}($$$ARGS)`);
    }

    for (const ns of defineModuleNamespaces) {
      dmPatterns.push(`${ns}.${FRAMEWORK_DEFINE_MODULE}($$$ARGS)`);
    }

    const allDmMatches: PatternMatch[] = [];

    for (const pattern of dmPatterns) {
      const matches = await this.runPatternSearch(filename, code, pattern);

      allDmMatches.push(...matches);
    }

    // 6. Traverse raw AST — export specifiers, export default only
    for (const stmt of parsed.program.body) {
      if (parseError) {
        break;
      }

      if (stmt.type === 'ExportNamedDeclaration') {
        this.collectExportNames(stmt, localExports, exportMappings, defineModuleCalls);

        continue;
      }

      if (stmt.type === 'ExportDefaultDeclaration') {
        this.resolveExportDefaultForDefineModuleInline(stmt, defineModuleCalls);
      }
    }

    if (parseError) {
      return parseError;
    }

    // 7. Process symbols: class, enum, variable, function
    // Track line ranges of variable-assigned framework calls for deduplication with patternSearch
    const symbolFrameworkCallRanges: Array<{ startLine: number; endLine: number }> = [];

    const conversionOptions = {
      importMap,
      resolveImportSource: (raw: string) => this.resolvePath(filename, raw),
    };

    for (const symbol of symbols) {
      if (symbol.kind === 'class') {
        const classResult = this.convertClassSymbol(symbol, parsed, imports, importMap);

        if (isErr(classResult)) {
          return classResult;
        }

        classes.push(classResult);
      }

      if (symbol.kind === 'enum') {
        const members = new Map<string, string>();

        if (symbol.members) {
          for (const member of symbol.members) {
            if (member.initializer !== undefined) {
              const initValue = member.initializer;

              if (initValue.kind === 'string' || initValue.kind === 'number') {
                members.set(member.name, String(initValue.value));
              }
            }
          }
        }

        if (members.size > 0) {
          enumDeclarations.set(symbol.name, members);
        }
      }

      if (symbol.kind === 'variable' && symbol.initializer !== undefined) {
        const conversionResult = convertExpressionDeep(
          symbol.initializer,
          filename,
          conversionOptions,
        );

        const symbolValue = this.enrichFactoryValues(
          conversionResult,
          parsed,
          symbol.name,
          allInjectMatches,
          lineOffsets,
        );

        localValues[symbol.name] = symbolValue;

        if (symbol.isExported) {
          exportedValues[symbol.name] = symbolValue;
        }

        for (const inject of conversionResult.injectCalls) {
          this.currentInjectCalls.push(inject);
        }

        const caCountBefore = createApplicationCalls.length;
        const dmCountBefore = defineModuleCalls.length;

        this.detectFrameworkCallsFromInitializer(
          symbol, conversionResult, createApplicationAliases, createApplicationNamespaces,
          defineModuleAliases, defineModuleNamespaces, createApplicationCalls, defineModuleCalls,
        );

        // Track symbol line ranges of variable-assigned framework calls for deduplication
        if (createApplicationCalls.length > caCountBefore || defineModuleCalls.length > dmCountBefore) {
          symbolFrameworkCallRanges.push({
            startLine: symbol.span.start.line,
            endLine: symbol.span.end.line,
          });
        }

        if (symbol.name === 'module' && symbol.initializer.kind === 'object') {
          moduleDefinition = this.convertModuleDefinition(symbol.initializer, importMap);
        }
      }

      if (symbol.kind === 'function') {
        const funcExpr = symbol.initializer ?? {
          kind: 'function' as const,
          sourceText: this.extractFunctionSourceText(parsed, symbol.name),
          parameters: symbol.parameters,
        };
        const conversionResult = convertExpressionDeep(funcExpr, filename, conversionOptions);

        const symbolValue = this.enrichFactoryValues(
          conversionResult,
          parsed,
          symbol.name,
          allInjectMatches,
          lineOffsets,
        );

        localValues[symbol.name] = symbolValue;

        if (symbol.isExported) {
          exportedValues[symbol.name] = symbolValue;
        }

        for (const inject of conversionResult.injectCalls) {
          this.currentInjectCalls.push(inject);
        }
      }
    }

    // 7a. Process patternSearch matches for bare createApplication/defineModule calls
    // Symbol processing (step 7) already populated calls from variable initializers.
    // patternSearch finds ALL calls (including variable-assigned), so deduplicate by line.
    const isWithinSymbolRange = (matchLine: number): boolean =>
      symbolFrameworkCallRanges.some(range => matchLine >= range.startLine && matchLine <= range.endLine);

    for (const match of allCaMatches) {
      if (isWithinSymbolRange(match.startLine)) {
        continue;
      }

      const extMatch = match as PatternMatchWithOffsets;
      const callee = match.matchedText.slice(0, match.matchedText.indexOf('('));
      const importSource = this.findImportSourceForCallee(callee);

      if (importSource !== '@zipbul/core') {
        continue;
      }

      const argsCapture = match.captures?.['$$$ARGS'];
      const args = this.parsePatternCaptureArgs(argsCapture?.text ?? '', importMap);

      createApplicationCalls.push({
        callee,
        importSource,
        args,
        start: extMatch.startOffset,
        end: extMatch.endOffset,
      });
    }

    for (const match of allDmMatches) {
      if (isWithinSymbolRange(match.startLine)) {
        continue;
      }

      const extMatch = match as PatternMatchWithOffsets;
      const callee = match.matchedText.slice(0, match.matchedText.indexOf('('));
      const importSource = this.findImportSourceForCallee(callee);

      if (importSource !== '@zipbul/core') {
        continue;
      }

      const argsCapture = match.captures?.['$$$ARGS'];
      const args = this.parsePatternCaptureArgs(argsCapture?.text ?? '', importMap);

      const defineCall: DefineModuleCall = {
        callee,
        importSource,
        args,
        start: extMatch.startOffset,
        end: extMatch.endOffset,
      };

      this.upsertDefineModuleCall(defineModuleCalls, defineCall);
    }

    // Handle export default for defineModule calls detected via patternSearch
    this.resolveExportDefaultDefineModule(parsed, defineModuleCalls);

    // 7b. Resolve export specifier mappings (local → exported values)
    for (const mapping of exportMappings) {
      if (Object.prototype.hasOwnProperty.call(localValues, mapping.local)) {
        exportedValues[mapping.exported] = localValues[mapping.local];
      }
    }

    // 8. Resolve defineModule export names
    if (defineModuleCalls.length > 0 && exportMappings.length > 0) {
      const exportMap = new Map<string, string[]>();

      exportMappings.forEach(mapping => {
        const entries = exportMap.get(mapping.local) ?? [];

        entries.push(mapping.exported);
        exportMap.set(mapping.local, entries);
      });

      defineModuleCalls.forEach(call => {
        if (typeof call.exportedName === 'string') {
          return;
        }

        if (!isNonEmptyString(call.localName)) {
          return;
        }

        const exportedNames = exportMap.get(call.localName);

        if (!exportedNames || exportedNames.length === 0) {
          return;
        }

        const sorted = Array.from(new Set(exportedNames)).sort(compareCodePoint);

        call.exportedName = sorted[0];
      });
    }

    // 9. Return ParseResult
    return {
      classes,
      reExports,
      exports: localExports,
      imports,
      importEntries,
      exportedValues,
      localValues,
      moduleDefinition,
      createApplicationCalls,
      defineModuleCalls,
      injectCalls: this.currentInjectCalls,
      ...(enumDeclarations.size > 0 ? { enums: enumDeclarations } : {}),
    };
  }

  /**
   * Populates import tracking state from oxc-parser `StaticImport` entries.
   *
   * Replaces the manual `ImportDeclaration` AST traversal from the original
   * parser. Produces the same `imports`, `importEntries`, `currentImports`,
   * `currentImportSources`, `currentOriginalNames`, and alias/namespace sets.
   *
   * @param staticImports - Import entries from `ParsedFile.module.staticImports`
   * @param filename - Current file path for resolving relative imports
   * @param imports - Output map of local name → resolved path
   * @param importEntries - Output list of import entries
   * @param createApplicationAliases - Aliases for `createApplication`
   * @param createApplicationNamespaces - Namespace imports from `@zipbul/core`
   * @param defineModuleAliases - Aliases for `defineModule`
   * @param defineModuleNamespaces - Namespace imports from `@zipbul/core`
   */
  private buildImportState(
    staticImports: readonly StaticImport[],
    filename: string,
    imports: Record<string, string>,
    importEntries: ImportEntry[],
    createApplicationAliases: Set<string>,
    createApplicationNamespaces: Set<string>,
    defineModuleAliases: Set<string>,
    defineModuleNamespaces: Set<string>,
  ): void {
    for (const imp of staticImports) {
      const sourceValue = imp.moduleRequest.value;
      const resolvedSource = this.resolvePath(filename, sourceValue);
      const isCoreImport = sourceValue === '@zipbul/core';

      importEntries.push({ source: sourceValue, resolvedSource, isRelative: sourceValue.startsWith('.') });

      for (const entry of imp.entries) {
        if (entry.isType) {
          continue;
        }

        const localName = entry.localName.value;

        imports[localName] = resolvedSource;
        this.currentImports[localName] = resolvedSource;
        this.currentImportSources[localName] = sourceValue;

        if (entry.importName.kind === 'Name') {
          const importedName = entry.importName.name;

          if (importedName !== null && importedName !== localName) {
            this.currentOriginalNames[localName] = importedName;
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
   * with source traversal.
   *
   * @param staticExports - Export entries from `ParsedFile.module.staticExports`
   * @param filename - Current file path for resolving relative imports
   * @param reExports - Output list of re-export entries
   */
  private buildExportState(
    staticExports: readonly StaticExport[],
    filename: string,
    reExports: ReExport[],
  ): void {
    for (const exp of staticExports) {
      for (const entry of exp.entries) {
        if (entry.moduleRequest === null) {
          continue;
        }

        const sourceValue = entry.moduleRequest.value;
        const resolvedSource = this.resolvePath(filename, sourceValue);

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
   * Converts a gildash `ExtractedSymbol` of kind `'class'` into the compiler's
   * `ClassMetadata` format.
   *
   * Uses gildash symbol data for decorators, constructor params, method
   * decorators, property types, and heritage. Falls back to raw AST for:
   * - configure() method body (middleware/exception filter extraction)
   * - typed calls in handler methods
   * - computed/private method detection
   *
   * @param symbol - Class symbol from `extractSymbols`
   * @param parsed - Full parsed file for raw AST access
   * @param currentImports - Import map snapshot at parse time
   * @param importMap - Import map from `buildImportMap`
   * @returns ClassMetadata or diagnostic error
   */
  private convertClassSymbol(
    symbol: ExtractedSymbol,
    parsed: ParsedFile,
    currentImports: Record<string, string>,
    importMap: ImportMap,
  ): Result<ClassMetadata, Diagnostic> {
    const className = symbol.name;

    // gildash gives anonymous classes the name "default" — detect by checking
    // if any raw class AST node at this symbol's span lacks an explicit id.
    if (className.length === 0 || this.isAnonymousClassSymbol(parsed, symbol)) {
      return err(buildDiagnostic({
        reason: 'Anonymous classes cannot be used as providers. All classes must have explicit names.',
        file: this.currentFilePath,
      }));
    }

    // Decorators — resolve aliased names through currentOriginalNames
    const decorators: DecoratorMetadata[] = (symbol.decorators ?? []).map(decorator => {
      const converted = convertDecorator(decorator);

      return {
        ...converted,
        name: this.resolveOriginalName(converted.name),
      };
    });

    // Constructor params
    const constructorParams: ClassMetadata['constructorParams'] = [];
    const methods: ClassMetadata['methods'] = [];
    const properties: ClassMetadata['properties'] = [];
    let middlewares: ClassMetadata['middlewares'] = [];
    let exceptionFilters: ClassMetadata['exceptionFilters'] = [];

    // Find the raw class AST node for body access
    const rawClassNode = this.findClassAstNode(parsed, className);

    if (symbol.members) {
      for (const member of symbol.members) {
        if (member.methodKind === 'constructor' && member.parameters) {
          for (const param of member.parameters) {
            const paramType = this.resolveParameterType(param.type, param.typeImportSource, importMap);
            const paramDecorators = (param.decorators ?? []).map(decorator => {
              const converted = convertDecorator(decorator);

              return { ...converted, name: this.resolveOriginalName(converted.name) };
            });

            constructorParams.push({
              name: param.name,
              type: paramType,
              typeArgs: this.extractTypeArgs(param.type),
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
            ? this.getMethodAstMeta(rawClassNode, memberName)
            : null;
          const isComputed = astMeta?.isComputed ?? false;
          const isPrivateName = astMeta?.isPrivateName ?? false;

          // gildash gives "unknown" for computed/private methods — treat as unnamed
          const isUnresolvableName = memberName === 'unknown' && (isComputed || isPrivateName);
          let methodName = isUnresolvableName ? '' : memberName;

          const methodDecorators = (member.decorators ?? []).map(decorator => {
            const converted = convertDecorator(decorator);

            return { ...converted, name: this.resolveOriginalName(converted.name) };
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

              const paramType = this.resolveParameterType(param.type, param.typeImportSource, importMap);
              const paramDecorators = (param.decorators ?? []).map(decorator => {
                const converted = convertDecorator(decorator);

                return { ...converted, name: this.resolveOriginalName(converted.name) };
              });

              methodParams.push({
                name: param.name,
                type: paramType,
                typeArgs: this.extractTypeArgs(param.type),
                decorators: paramDecorators,
                index,
              });
            }
          }

          methodParams.sort((a, b) => a.index - b.index);

          if (methodName === 'configure' && rawClassNode !== null) {
            const funcNode = this.findMethodBodyAstNode(rawClassNode, 'configure');

            if (funcNode !== null) {
              const mwResult = this.extractMiddlewaresFromConfigure(funcNode);

              if (isErr(mwResult)) {
                return mwResult;
              }

              middlewares = mwResult;

              const efResult = this.extractExceptionFiltersFromConfigure(funcNode);

              if (isErr(efResult)) {
                return efResult;
              }

              exceptionFilters = efResult;
            }
          }

          if (methodDecorators.length > 0 || methodParams.some(param => param.decorators.length > 0)) {
            let typedCalls: ClassMetadata['methods'][number]['typedCalls'] | undefined;

            if (rawClassNode !== null) {
              const funcNode = this.findMethodBodyAstNode(rawClassNode, methodName);

              if (funcNode !== null) {
                typedCalls = this.extractTypedCalls(funcNode);
              }
            }

            methods.push({
              name: methodName,
              decorators: methodDecorators,
              parameters: methodParams,
              ...(typedCalls !== undefined ? { typedCalls } : {}),
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

            return { ...converted, name: this.resolveOriginalName(converted.name) };
          });

          const initializer = member.initializer !== undefined
            ? convertExpression(member.initializer)
            : null;

          const typeInfo = parseTypeAnnotation(member.returnType, importMap);

          if (propDecorators.length > 0 || initializer !== null) {
            const isProtected = member.modifiers.includes('protected');
            const rawProperty = rawClassNode !== null
              ? this.findPropertyAstNode(rawClassNode, propName)
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
          const typeArgs = clause.typeArguments ?? this.extractHeritageTypeArgs(rawClassNode, clause.kind, clause.name);

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
   * @returns AnalyzerValue for the parameter type
   */
  private resolveParameterType(
    typeText: string | undefined,
    typeImportSource: string | undefined,
    importMap: ImportMap,
  ): AnalyzerValue {
    if (typeText === undefined || typeText.length === 0) {
      return 'any';
    }

    if (typeImportSource !== undefined) {
      const resolvedSource = this.resolvePath(this.currentFilePath, typeImportSource);
      const originalName = this.resolveOriginalNameFromImportMap(typeText, importMap);

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
  private resolveOriginalNameFromImportMap(typeText: string, importMap: ImportMap): string {
    const info = importMap.get(typeText);

    if (info !== undefined && info.originalName !== null) {
      return info.originalName;
    }

    return typeText;
  }

  /**
   * Extracts type arguments from a type annotation string.
   *
   * @param typeText - Type annotation text (e.g. `"Map<string, User>"`)
   * @returns Array of type argument strings, or undefined
   */
  private extractTypeArgs(typeText: string | undefined): string[] | undefined {
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
   * Enriches factory function values in a ConversionResult with dependency
   * and inject call analysis from the raw AST.
   *
   * When the converted value contains `ZIPBUL_FACTORY_CODE`, finds the
   * corresponding raw AST function node and runs `extractDependencies`.
   * Inject calls within the factory are collected from pre-computed
   * patternSearch results filtered by the function's line range.
   *
   * @param conversionResult - Result from `convertExpressionDeep`
   * @param parsed - Parsed file for raw AST access
   * @param variableName - Name of the variable being processed
   * @param injectMatches - Pre-computed inject pattern matches from patternSearch
   * @param lineOffsets - Line offset table from `buildLineOffsets`
   * @returns The enriched AnalyzerValue
   */
  private enrichFactoryValues(
    conversionResult: ConversionResult,
    parsed: ParsedFile,
    variableName: string,
    injectMatches: readonly PatternMatch[],
    lineOffsets: readonly number[],
  ): AnalyzerValue {
    if (conversionResult.factoryRefs.length === 0) {
      return conversionResult.value;
    }

    // For top-level factory (the value itself is a factory)
    const record = isRecordValue(conversionResult.value) ? conversionResult.value : null;

    if (record !== null && typeof record[ZIPBUL_FACTORY_CODE] === 'string') {
      const funcNode = this.findVariableInitAstNode(parsed, variableName);

      if (funcNode !== null) {
        const funcStart = funcNode.start;
        const funcEnd = funcNode.end;
        const deps = this.extractDependencies(funcNode, funcStart);
        const injectCalls = this.collectFactoryInjectCalls(
          injectMatches, lineOffsets, funcStart, funcEnd,
        );

        return {
          ...record,
          __zipbul_factory_deps: deps,
          __zipbul_factory_injects: injectCalls,
        };
      }
    }

    return conversionResult.value;
  }

  /**
   * Detects `createApplication` and `defineModule` calls from a variable's
   * gildash ExpressionCall initializer.
   *
   * @param symbol - The variable symbol
   * @param conversionResult - Result from `convertExpressionDeep`
   * @param createApplicationAliases - Aliases for `createApplication`
   * @param createApplicationNamespaces - Namespace imports from `@zipbul/core`
   * @param defineModuleAliases - Aliases for `defineModule`
   * @param defineModuleNamespaces - Namespace imports from `@zipbul/core`
   * @param createApplicationCalls - Output array
   * @param defineModuleCalls - Output array
   */
  private detectFrameworkCallsFromInitializer(
    symbol: ExtractedSymbol,
    conversionResult: ConversionResult,
    createApplicationAliases: Set<string>,
    createApplicationNamespaces: Set<string>,
    defineModuleAliases: Set<string>,
    defineModuleNamespaces: Set<string>,
    createApplicationCalls: CreateApplicationCall[],
    defineModuleCalls: DefineModuleCall[],
  ): void {
    const init = symbol.initializer;

    if (init === undefined || init.kind !== 'call') {
      return;
    }

    const callee = init.callee;
    const importSource = init.importSource;

    if (importSource !== '@zipbul/core') {
      return;
    }

    const record = isRecordValue(conversionResult.value) ? conversionResult.value : null;
    const args = record !== null && Array.isArray(record.args) ? record.args as AnalyzerValue[] : [];

    if (this.isCreateApplicationCallee(callee, createApplicationAliases, createApplicationNamespaces)) {
      createApplicationCalls.push({
        callee,
        importSource,
        args,
      });
    }

    if (this.isDefineModuleCallee(callee, defineModuleAliases, defineModuleNamespaces)) {
      const defineCall: DefineModuleCall = {
        callee,
        importSource,
        args,
        localName: symbol.name,
        exportedName: symbol.isExported ? symbol.name : undefined,
      };

      this.upsertDefineModuleCall(defineModuleCalls, defineCall);
    }
  }

  /**
   * Checks whether a callee name matches `createApplication` or an alias/namespace.
   *
   * @param callee - Callee name from ExpressionCall
   * @param aliases - Direct aliases for `createApplication`
   * @param namespaces - Namespace imports from `@zipbul/core`
   * @returns `true` if this is a createApplication call
   */
  private isCreateApplicationCallee(
    callee: string,
    aliases: Set<string>,
    namespaces: Set<string>,
  ): boolean {
    if (callee === FRAMEWORK_CREATE_APPLICATION || aliases.has(callee)) {
      return true;
    }

    const dotIndex = callee.indexOf('.');

    if (dotIndex > 0) {
      const ns = callee.slice(0, dotIndex);
      const method = callee.slice(dotIndex + 1);

      return namespaces.has(ns) && method === FRAMEWORK_CREATE_APPLICATION;
    }

    return false;
  }

  /**
   * Checks whether a callee name matches `defineModule` or an alias/namespace.
   *
   * @param callee - Callee name from ExpressionCall
   * @param aliases - Direct aliases for `defineModule`
   * @param namespaces - Namespace imports from `@zipbul/core`
   * @returns `true` if this is a defineModule call
   */
  private isDefineModuleCallee(
    callee: string,
    aliases: Set<string>,
    namespaces: Set<string>,
  ): boolean {
    if (callee === FRAMEWORK_DEFINE_MODULE || aliases.has(callee)) {
      return true;
    }

    const dotIndex = callee.indexOf('.');

    if (dotIndex > 0) {
      const ns = callee.slice(0, dotIndex);
      const method = callee.slice(dotIndex + 1);

      return namespaces.has(ns) && method === FRAMEWORK_DEFINE_MODULE;
    }

    return false;
  }

  /**
   * Converts a gildash `ExpressionObject` into a `ModuleDefinition`.
   *
   * Used when a variable named `module` has an object literal initializer.
   *
   * @param expr - The object expression from gildash
   * @param importMap - Import map for type resolution
   * @returns ModuleDefinition with name, providers, adapters, and imports
   */
  private convertModuleDefinition(expr: ExpressionObject, importMap: ImportMap): ModuleDefinition {
    let name: string | undefined;
    let nameDeclared = false;
    const providers: AnalyzerValue[] = [];
    let adapters: AnalyzerValue | undefined = undefined;

    for (const prop of expr.properties) {
      if (prop.key === 'name') {
        nameDeclared = true;

        if (prop.value.kind === 'string' && typeof prop.value.value === 'string') {
          name = prop.value.value;
        }

        continue;
      }

      if (prop.key === 'providers' && prop.value.kind === 'array') {
        for (const element of prop.value.elements) {
          providers.push(convertExpression(element));
        }

        continue;
      }

      if (prop.key === 'adapters') {
        adapters = convertExpression(prop.value);
      }
    }

    return {
      name,
      nameDeclared,
      providers,
      adapters,
      imports: { ...this.currentImports },
    };
  }

  /**
   * Finds the initializer AST node for a variable declaration by name.
   *
   * Searches the program body for VariableDeclaration containing the
   * named variable and returns its init node (the function expression).
   *
   * @param parsed - Parsed file
   * @param variableName - Name of the variable
   * @returns The init AST node or null
   */
  private findVariableInitAstNode(parsed: ParsedFile, variableName: string): Expression | null {
    for (const stmt of parsed.program.body) {
      const varDecl = this.extractVariableDeclaration(stmt);

      if (varDecl === null) {
        continue;
      }

      for (const decl of varDecl.declarations) {
        const declName = decl.id.type === 'Identifier' ? decl.id.name : null;

        if (declName === variableName && decl.init !== null) {
          return decl.init;
        }
      }
    }

    return null;
  }

  /**
   * Extracts the source text of a function declaration by name from the raw AST.
   *
   * Used for gildash `kind: 'function'` symbols that don't have an initializer
   * (standalone function declarations vs arrow function variables).
   *
   * @param parsed - Parsed file
   * @param functionName - Name of the function
   * @returns Source text of the function body, or empty string
   */
  private extractFunctionSourceText(parsed: ParsedFile, functionName: string): string {
    for (const stmt of parsed.program.body) {
      const funcDecl = this.extractFunctionDeclaration(stmt);

      if (funcDecl !== null) {
        if (funcDecl.id?.name === functionName) {
          return this.currentCode.slice(funcDecl.start, funcDecl.end);
        }

        continue;
      }

      // Arrow function assigned to variable: const name = () => ...
      const varDecl = this.extractVariableDeclaration(stmt);

      if (varDecl !== null) {
        for (const decl of varDecl.declarations) {
          const declName = decl.id.type === 'Identifier' ? decl.id.name : null;

          if (declName === functionName && decl.init !== null) {
            const initNode = decl.init;

            if (initNode.type === 'ArrowFunctionExpression' || initNode.type === 'FunctionExpression') {
              return this.currentCode.slice(initNode.start, initNode.end);
            }
          }
        }
      }
    }

    return '';
  }

  /**
   * Finds the raw `ClassDeclaration` AST node for a given class name.
   *
   * @param parsed - Parsed file
   * @param className - Name of the class to find
   * @returns Raw ClassDeclaration node or null
   */
  private isAnonymousClassSymbol(parsed: ParsedFile, _symbol: ExtractedSymbol): boolean {
    for (const stmt of parsed.program.body) {
      const classNode = this.extractClassFromStatement(stmt);

      if (classNode === null) {
        continue;
      }

      if (classNode.id === null) {
        return true;
      }
    }

    return false;
  }

  private findClassAstNode(parsed: ParsedFile, className: string): Class | null {
    for (const stmt of parsed.program.body) {
      if (stmt.type === 'ClassDeclaration') {
        if (stmt.id?.name === className) {
          return stmt;
        }
      }

      if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
        const declaration = stmt.declaration;

        if (declaration?.type === 'ClassDeclaration' && declaration.id?.name === className) {
          return declaration;
        }
      }
    }

    return null;
  }

  /**
   * Finds the function body AST node for a named method in a class.
   *
   * @param classNode - Raw ClassDeclaration AST node
   * @param methodName - Name of the method
   * @returns The method's function value node (containing body), or null
   */
  private findMethodBodyAstNode(classNode: Class, methodName: string): OxcFunction | null {
    for (const member of classNode.body.body) {
      if (member.type !== 'MethodDefinition') {
        continue;
      }

      if (member.kind !== 'method') {
        continue;
      }

      const name = this.getPropertyKeyName(member.key);

      if (name === methodName) {
        return member.value;
      }
    }

    return null;
  }

  /**
   * Finds a PropertyDefinition AST node for a named property in a class.
   *
   * @param classNode - Raw ClassDeclaration AST node
   * @param propName - Name of the property
   * @returns The PropertyDefinition node, or null
   */
  private findPropertyAstNode(classNode: Class, propName: string): PropertyDefinition | null {
    for (const member of classNode.body.body) {
      if (member.type !== 'PropertyDefinition') {
        continue;
      }

      const name = this.getPropertyKeyName(member.key);

      if (name === propName) {
        return member;
      }
    }

    return null;
  }

  /**
   * Gets computed/private/static metadata for a method from the raw AST.
   *
   * @param classNode - Raw ClassDeclaration AST node
   * @param methodName - Method name to look up
   * @returns Object with isComputed, isPrivateName, start, or null if not found
   */
  private getMethodAstMeta(
    classNode: Class,
    methodName: string,
  ): { isComputed: boolean; isPrivateName: boolean; start: number } | null {
    for (const member of classNode.body.body) {
      if (member.type !== 'MethodDefinition') {
        continue;
      }

      if (member.kind !== 'method') {
        continue;
      }

      const isComputed = member.computed;
      const isPrivateName = member.key.type === 'PrivateIdentifier';
      const name = this.getPropertyKeyName(member.key);

      if (name === methodName) {
        return { isComputed, isPrivateName, start: member.start };
      }

      // gildash gives "unknown" for computed methods — match by checking
      // if this is a computed/unresolvable method and the requested name
      // is also "unknown"
      if (methodName === 'unknown' && name === null && (isComputed || isPrivateName)) {
        return { isComputed, isPrivateName, start: member.start };
      }
    }

    return null;
  }

  /**
   * Extracts heritage type arguments from the raw AST for TS_UTILITY_TYPES.
   *
   * gildash does not include type arguments in heritage, so we fall back
   * to the raw AST for classes that extend/implement utility types like
   * `Partial`, `Pick`, `Omit`, `Required`.
   *
   * @param classNode - Raw ClassDeclaration AST node
   * @param clauseKind - 'extends' or 'implements'
   * @param typeName - The utility type name
   * @returns Array of type argument name strings
   */
  private extractHeritageTypeArgs(
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
            typeArgs.push(this.resolveTypeArgName(param));
          }

          return typeArgs;
        }
      }

      // Check superTypeArguments (oxc-parser puts them separately)
      const superTypeArgs = classNode.superTypeArguments;

      if (superTypeArgs !== null && superTypeArgs !== undefined && baseName === typeName) {
        for (const param of superTypeArgs.params) {
          typeArgs.push(this.resolveTypeArgName(param));
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
          typeArgs.push(this.resolveTypeArgName(param));
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
  private resolveTypeArgName(typeNode: AstNode): string {
    if (typeNode.type === 'TSTypeReference') {
      const typeName = typeNode.typeName;

      if (typeName.type === 'Identifier') {
        return typeName.name;
      }
    }

    return UNKNOWN_TYPE_NAME;
  }

  private upsertDefineModuleCall(calls: DefineModuleCall[], call: DefineModuleCall): void {
    const start = call.start;
    const end = call.end;

    if (typeof start !== 'number' || typeof end !== 'number') {
      calls.push(call);

      return;
    }

    const existing = calls.find(entry => entry.start === start && entry.end === end);

    if (!existing) {
      calls.push(call);

      return;
    }

    if (typeof call.localName === 'string') {
      existing.localName = call.localName;
    }

    if (typeof call.exportedName === 'string') {
      existing.exportedName = call.exportedName;
    }
  }

  /**
   * Parses captured argument text from patternSearch into AnalyzerValue[].
   *
   * For simple identifiers, resolves through the import map. For complex
   * expressions (objects, arrays), wraps the text in a variable declaration,
   * parses with gildash, and converts via `convertExpression`.
   *
   * @param argsText - Raw argument text captured by `$$$ARGS`
   * @param importMap - Import map for identifier resolution
   * @returns Parsed arguments as AnalyzerValue array
   */
  private parsePatternCaptureArgs(argsText: string, importMap: ImportMap): AnalyzerValue[] {
    const trimmed = argsText.trim();

    if (trimmed.length === 0) {
      return [];
    }

    // Simple identifier: look up in import map
    if (/^\w+$/.test(trimmed)) {
      const info = importMap.get(trimmed);

      if (info !== undefined) {
        return [{
          [ZIPBUL_REF]: info.originalName ?? trimmed,
          [ZIPBUL_IMPORT_SOURCE]: info.importSource,
        }];
      }

      return [{
        [ZIPBUL_REF]: this.resolveOriginalName(trimmed),
        [ZIPBUL_IMPORT_SOURCE]: this.currentImports[trimmed],
      }];
    }

    // Member expression: ns.Something
    const memberMatch = trimmed.match(/^(\w+)\.(\w+)$/);

    if (memberMatch?.[1] !== undefined && memberMatch[2] !== undefined) {
      const objName = memberMatch[1];
      const propName = memberMatch[2];

      return [{
        [ZIPBUL_REF]: `${this.resolveOriginalName(objName)}.${propName}`,
        [ZIPBUL_IMPORT_SOURCE]: this.currentImports[objName],
      }];
    }

    // Complex args: parse via gildash
    const wrappedCode = `const __args = [${argsText}];`;
    const parsedArgs = parseSource('__args.ts', wrappedCode);

    if (isErr(parsedArgs)) {
      return [];
    }

    const argSymbols = extractSymbols(parsedArgs);
    const argsSymbol = argSymbols.find(symbol => symbol.name === '__args');

    if (argsSymbol?.initializer?.kind === 'array') {
      return argsSymbol.initializer.elements.map(element => convertExpression(element));
    }

    return [];
  }

  /**
   * Resolves `export default defineModule(...)` by walking the AST for
   * ExportDefaultDeclaration nodes and setting `exportedName = 'default'`
   * on matching defineModule calls by offset.
   *
   * @param parsed - Parsed file for AST access
   * @param defineModuleCalls - defineModule calls to annotate
   */
  private resolveExportDefaultDefineModule(
    parsed: ParsedFile,
    defineModuleCalls: DefineModuleCall[],
  ): void {
    if (defineModuleCalls.length === 0) {
      return;
    }

    for (const stmt of parsed.program.body) {
      if (stmt.type !== 'ExportDefaultDeclaration') {
        continue;
      }

      const decl = stmt.declaration;

      if (decl.type === 'CallExpression') {
        const existing = defineModuleCalls.find(
          call => call.start === decl.start && call.end === decl.end,
        );

        if (existing) {
          existing.exportedName = 'default';
        }
      }

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
  }

  private resolveOriginalName(localName: string): string {
    return this.currentOriginalNames[localName] ?? localName;
  }

  private resolvePath(sourcePath: string, importPath: string): string {
    if (importPath.startsWith('.')) {
      const absolute = resolve(dirname(sourcePath), importPath);

      return absolute;
    }

    try {
      const resolved = Bun.resolveSync(importPath, dirname(sourcePath));

      return this.resolveDistToSource(resolved) ?? resolved;
    } catch {
      return importPath;
    }
  }

  /**
   * Maps a dist/ build output path back to the original TypeScript source.
   *
   * When a package.json `exports` field points to `./dist/index.js`,
   * `Bun.resolveSync` returns the dist path. The AOT compiler needs
   * the TypeScript source, so we check the package root and `src/`
   * for a matching `.ts` file.
   *
   * @param resolvedPath - Absolute path returned by Bun.resolveSync
   * @returns The source `.ts` path if found, or `null`
   */
  private resolveDistToSource(resolvedPath: string): string | null {
    if (resolvedPath.endsWith('.ts') || resolvedPath.endsWith('.d.ts')) {
      return null;
    }

    const distSegmentIndex = resolvedPath.lastIndexOf('/dist/');

    if (distSegmentIndex === -1) {
      return null;
    }

    const packageRoot = resolvedPath.slice(0, distSegmentIndex);
    const relative = resolvedPath.slice(distSegmentIndex + 6).replace(/\.js$/, '.ts');

    const rootCandidate = join(packageRoot, relative);

    if (existsSync(rootCandidate)) {
      return rootCandidate;
    }

    const srcCandidate = join(packageRoot, 'src', relative);

    if (existsSync(srcCandidate)) {
      return srcCandidate;
    }

    return null;
  }

  /**
   * Runs `patternSearch` for a given pattern against a source file.
   *
   * When the file does not exist on disk (e.g. in-memory test sources),
   * writes a temporary file, runs the search, and cleans up.
   *
   * @param filename - Logical file path
   * @param code - Source code content
   * @param pattern - ast-grep pattern string
   * @returns Array of pattern matches
   */
  private async runPatternSearch(filename: string, code: string, pattern: string): Promise<PatternMatch[]> {
    let searchFilePath = filename;
    let tempFileCreated = false;

    if (!existsSync(filename)) {
      searchFilePath = join(tmpdir(), `__zipbul_parse_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`);
      writeFileSync(searchFilePath, code);
      tempFileCreated = true;
    }

    try {
      return await patternSearch({ pattern, filePaths: [searchFilePath] });
    } finally {
      if (tempFileCreated) {
        try { unlinkSync(searchFilePath); } catch { /* best effort */ }
      }
    }
  }

  /**
   * Extracts the callee name from a matched inject call text.
   *
   * For `inject(TokenA)` returns `'inject'`.
   * For `zipbul.inject(TokenA)` returns `'zipbul.inject'`.
   *
   * @param matchedText - Full matched text from patternSearch
   * @returns The callee portion before the opening parenthesis
   */
  private resolveInjectCallee(matchedText: string): string {
    const parenIndex = matchedText.indexOf('(');

    if (parenIndex < 0) {
      return matchedText;
    }

    return matchedText.slice(0, parenIndex).trim();
  }

  /**
   * Finds the import source for a callee name (direct or namespace.method).
   *
   * @param calleeName - Callee name (e.g. `'inject'` or `'zipbul.inject'`)
   * @returns The raw import source string, or undefined
   */
  private findImportSourceForCallee(calleeName: string): string | undefined {
    const directSource = this.currentImportSources[calleeName];

    if (directSource !== undefined) {
      return directSource;
    }

    const dotIndex = calleeName.indexOf('.');

    if (dotIndex > 0) {
      const ns = calleeName.slice(0, dotIndex);

      return this.currentImportSources[ns];
    }

    return undefined;
  }

  /**
   * Builds an `InjectCall` from a patternSearch capture.
   *
   * @param capture - The `$$ARGS` capture from patternSearch, or undefined
   * @param callee - Resolved callee name
   * @param importSource - Import source string
   * @returns The constructed InjectCall
   */
  private buildInjectCallFromCapture(
    capture: { text: string } | undefined,
    callee: string,
    importSource: string,
  ): InjectCall {
    if (capture === undefined) {
      return {
        tokenKind: 'invalid',
        token: null,
        callee,
        importSource,
        filePath: this.currentFilePath,
      };
    }

    const argText = capture.text.trim();

    // Multi-arg detection: if capture contains a comma at the top level, it's invalid
    if (this.hasMultipleArgs(argText)) {
      return {
        tokenKind: 'invalid',
        token: null,
        callee,
        importSource,
        filePath: this.currentFilePath,
      };
    }

    // Empty args
    if (argText.length === 0) {
      return {
        tokenKind: 'invalid',
        token: null,
        callee,
        importSource,
        filePath: this.currentFilePath,
      };
    }

    // Check for thunk patterns: () => X, function() { return X; }
    const thunkMatch = argText.match(/^\(\s*\)\s*=>\s*(\w+)\s*$/)
      ?? argText.match(/^function\s*\(\s*\)\s*\{\s*return\s+(\w+)\s*;?\s*\}$/);

    if (thunkMatch?.[1] !== undefined) {
      const refName = thunkMatch[1];
      const resolvedName = this.resolveOriginalName(refName);

      return {
        tokenKind: 'thunk',
        token: {
          [ZIPBUL_REF]: resolvedName,
          [ZIPBUL_IMPORT_SOURCE]: this.currentImports[refName],
        },
        callee,
        importSource,
        filePath: this.currentFilePath,
      };
    }

    // Check for identifier token
    if (/^\w+$/.test(argText)) {
      const resolvedName = this.resolveOriginalName(argText);

      return {
        tokenKind: 'token',
        token: {
          [ZIPBUL_REF]: resolvedName,
          [ZIPBUL_IMPORT_SOURCE]: this.currentImports[argText],
        },
        callee,
        importSource,
        filePath: this.currentFilePath,
      };
    }

    // Check for member expression (e.g., ns.Token)
    const memberMatch = argText.match(/^(\w+)\.(\w+)$/);

    if (memberMatch?.[1] !== undefined && memberMatch[2] !== undefined) {
      const objName = memberMatch[1];
      const propName = memberMatch[2];

      return {
        tokenKind: 'token',
        token: {
          [ZIPBUL_REF]: `${this.resolveOriginalName(objName)}.${propName}`,
          [ZIPBUL_IMPORT_SOURCE]: this.currentImports[objName],
        },
        callee,
        importSource,
        filePath: this.currentFilePath,
      };
    }

    return {
      tokenKind: 'invalid',
      token: null,
      callee,
      importSource,
      filePath: this.currentFilePath,
    };
  }

  /**
   * Collects inject calls that fall within a factory function's byte range
   * from pre-computed patternSearch results.
   *
   * Uses byte offsets from patternSearch matches to compute positions
   * relative to the factory function start for code replacement by the
   * injector generator.
   *
   * @param injectMatches - All inject pattern matches from patternSearch
   * @param _lineOffsets - Line offset table (unused, kept for call-site consistency)
   * @param funcStart - Factory function start byte offset
   * @param funcEnd - Factory function end byte offset
   * @returns Array of factory inject calls with relative byte offsets
   */
  private collectFactoryInjectCalls(
    injectMatches: readonly PatternMatch[],
    _lineOffsets: readonly number[],
    funcStart: number,
    funcEnd: number,
  ): FactoryInjectCall[] {
    const result: FactoryInjectCall[] = [];

    for (const match of injectMatches) {
      const extMatch = match as PatternMatchWithOffsets;
      const matchByteStart = extMatch.startOffset;
      const matchByteEnd = extMatch.endOffset;

      if (matchByteStart === undefined || matchByteEnd === undefined) {
        continue;
      }

      // Filter: must be within factory function range
      if (matchByteStart < funcStart || matchByteEnd > funcEnd) {
        continue;
      }

      const calleeName = this.resolveInjectCallee(match.matchedText);
      const resolvedCallee = this.resolveOriginalName(calleeName);
      const importSource = this.findImportSourceForCallee(calleeName);

      if (importSource !== '@zipbul/common') {
        continue;
      }

      if (resolvedCallee !== 'inject' && !resolvedCallee.endsWith('.inject')) {
        continue;
      }

      const capture = match.captures?.['$$$ARGS'];
      const injectCall = this.buildInjectCallFromCapture(capture, resolvedCallee, importSource);

      this.currentInjectCalls.push(injectCall);

      result.push({
        start: matchByteStart - funcStart,
        end: matchByteEnd - funcStart,
        token: injectCall.token,
        tokenKind: injectCall.tokenKind,
      });
    }

    return result;
  }

  /**
   * Checks whether a capture text represents multiple arguments.
   *
   * Scans for commas at the top level (not inside parentheses, brackets,
   * or braces) to determine if the captured text is multi-argument.
   *
   * @param text - Captured argument text from patternSearch
   * @returns `true` if the text contains multiple top-level arguments
   */
  private hasMultipleArgs(text: string): boolean {
    let depth = 0;

    for (const char of text) {
      if (char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
      } else if (char === ',' && depth === 0) {
        return true;
      }
    }

    return false;
  }

  private extractExceptionFiltersFromConfigure(funcNode: OxcFunction): Result<ClassMetadata['exceptionFilters'], Diagnostic> {
    const exceptionFilters: ClassMetadata['exceptionFilters'] = [];

    if (funcNode.body === null) {
      return exceptionFilters;
    }

    const error = (): never => {
      throw new Error('[Zipbul AOT] addErrorFilters only supports literal arrays and Identifiers.');
    };

    const visit = (node: AstNode): void => {
      if (node.type === 'CallExpression') {
        const methodName = this.getCalleeMethodName(node);

        if (methodName === 'addErrorFilters') {
          const args = node.arguments;
          const arrayArg = args.length > 0 ? args[0] : null;

          if (!arrayArg || arrayArg.type !== 'ArrayExpression') {
            error();

            return;
          }

          for (let index = 0; index < arrayArg.elements.length; index += 1) {
            const el = arrayArg.elements[index];

            if (el === null) {
              error();

              return;
            }

            if (el.type === 'SpreadElement') {
              error();

              return;
            }

            if (el.type === 'Identifier') {
              const name = el.name;

              if (!isNonEmptyString(name)) {
                error();

                return;
              }

              exceptionFilters.push({ name, index });

              continue;
            }

            error();

            return;
          }

          return;
        }
      }

      walkChildren(node, visit);
    };

    try {
      visit(funcNode.body);
    } catch {
      return err(buildDiagnostic({
        reason: 'addErrorFilters only supports literal arrays and Identifiers.',
      }));
    }

    return exceptionFilters;
  }

  /**
   * Scans a method body for member-access call expressions with type arguments.
   * Extracts calls like `ctx.getBody<UserDto>()` → `{ methodName: 'getBody', typeArgs: ['UserDto'] }`.
   *
   * @param funcNode - The method's function AST node.
   * @returns Array of typed call metadata found in the body.
   */
  private extractTypedCalls(funcNode: OxcFunction): ClassMetadata['methods'][number]['typedCalls'] {
    if (funcNode.body === null) {
      return undefined;
    }

    const calls: NonNullable<ClassMetadata['methods'][number]['typedCalls']> = [];

    const visit = (node: AstNode): void => {
      if (node.type === 'CallExpression') {
        const callee = node.callee;

        if (callee.type === 'MemberExpression' && !callee.computed) {
          const methodName = callee.property.name;

          if (isNonEmptyString(methodName)) {
            const typeParams = node.typeArguments?.params ?? [];
            const typeArgs: string[] = [];

            for (const param of typeParams) {
              typeArgs.push(this.resolveTypeArgName(param));
            }

            if (methodName === 'validated') {
              const callArgs: CallArgRef[] = [];

              for (const arg of node.arguments) {
                if (arg.type === 'Identifier') {
                  if (isNonEmptyString(arg.name)) {
                    callArgs.push({ ref: arg.name });
                  }
                }
              }

              calls.push({ methodName, typeArgs, ...(callArgs.length > 0 ? { callArgs } : {}) });
            } else if (typeArgs.length > 0) {
              calls.push({ methodName, typeArgs });
            }
          }
        }
      }

      walkChildren(node, visit);
    };

    visit(funcNode.body);

    return calls.length > 0 ? calls : undefined;
  }

  private extractMiddlewaresFromConfigure(funcNode: OxcFunction): Result<ClassMetadata['middlewares'], Diagnostic> {
    const middlewares: ClassMetadata['middlewares'] = [];

    if (funcNode.body === null) {
      return middlewares;
    }

    const error = (): never => {
      throw new Error('[Zipbul AOT] addMiddlewares only supports literal arrays and Identifier/withOptions.');
    };

    const visit = (node: AstNode): void => {
      if (node.type === 'CallExpression') {
        const methodName = this.getCalleeMethodName(node);

        if (methodName === 'addMiddlewares') {
          const args = node.arguments;
          const lifecycleArg = args.length > 0 ? args[0] : null;
          const lifecycle = lifecycleArg?.type === 'Identifier' ? lifecycleArg.name : undefined;
          const arrayArg = args.length > 1 ? args[1] : null;

          if (!arrayArg || arrayArg.type !== 'ArrayExpression') {
            error();

            return;
          }

          for (let index = 0; index < arrayArg.elements.length; index += 1) {
            const el = arrayArg.elements[index];

            if (el === null) {
              error();

              return;
            }

            if (el.type === 'SpreadElement') {
              error();

              return;
            }

            if (el.type === 'Identifier') {
              const name = el.name;

              if (!isNonEmptyString(name)) {
                error();

                return;
              }

              if (isNonEmptyString(lifecycle)) {
                middlewares.push({ name, lifecycle, index });

                continue;
              }

              middlewares.push({ name, index });

              continue;
            }

            if (el.type === 'CallExpression') {
              const innerCallee = el.callee;

              if (innerCallee.type === 'MemberExpression' && !innerCallee.computed) {
                const propName = innerCallee.property.name;

                if (innerCallee.object.type === 'Identifier' && propName === 'withOptions') {
                  const name = innerCallee.object.name;

                  if (!isNonEmptyString(name)) {
                    error();

                    return;
                  }

                  if (isNonEmptyString(lifecycle)) {
                    middlewares.push({ name, lifecycle, index });

                    continue;
                  }

                  middlewares.push({ name, index });

                  continue;
                }
              }
            }

            error();

            return;
          }

          return;
        }
      }

      walkChildren(node, visit);
    };

    try {
      visit(funcNode.body);
    } catch {
      return err(buildDiagnostic({
        reason: 'addMiddlewares only supports literal arrays and Identifier/withOptions.',
      }));
    }

    return middlewares;
  }

  private extractDependencies(funcExpression: Expression, offset: number): FactoryDependency[] {
    const deps: FactoryDependency[] = [];
    const defined = new Set<string>();

    const visit = (node: AstNode): void => {
      if (node.type === 'Identifier') {
        const name = node.name;
        const path = isNonEmptyString(name) ? this.currentImports[name] : undefined;

        if (isNonEmptyString(name) && isNonEmptyString(path) && !defined.has(name)) {
          deps.push({
            name: this.resolveOriginalName(name),
            path,
            start: node.start - offset,
            end: node.end - offset,
          });
        }
      }

      if (node.type === 'FunctionExpression') {
        for (const param of node.params) {
          if (param.type === 'Identifier') {
            if (isNonEmptyString(param.name)) {
              defined.add(param.name);
            }
          }
        }

        if (node.body !== null) {
          visit(node.body);
        }

        return;
      }

      walkChildren(node, visit);
    };

    if (funcExpression.type === 'ArrowFunctionExpression' || funcExpression.type === 'FunctionExpression') {
      visit(funcExpression.body);
    } else {
      visit(funcExpression);
    }

    return deps;
  }

  /**
   * Extracts the name from a `PropertyKey` AST node.
   *
   * Handles `Identifier`, `PrivateIdentifier`, and string `Literal` keys.
   * Returns `null` for computed or non-string keys.
   */
  private getPropertyKeyName(key: AstNode): string | null {
    if (key.type === 'Identifier') {
      return key.name;
    }

    if (key.type === 'PrivateIdentifier') {
      return key.name;
    }

    if (key.type === 'Literal' && typeof key.value === 'string') {
      return key.value;
    }

    return null;
  }

  /**
   * Extracts the method name from a `CallExpression` callee that is a
   * static `MemberExpression` (e.g., `this.addMiddlewares(...)`).
   *
   * @returns The property name string, or `null` if not a static member call.
   */
  private getCalleeMethodName(node: CallExpression): string | null {
    const callee = node.callee;

    if (callee.type === 'MemberExpression' && !callee.computed) {
      return callee.property.name;
    }

    return null;
  }

  /**
   * Extracts a `VariableDeclaration` from a statement, unwrapping export wrappers.
   */
  private extractVariableDeclaration(stmt: Directive | Statement): VariableDeclaration | null {
    if (stmt.type === 'VariableDeclaration') {
      return stmt;
    }

    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
      const decl = stmt.declaration;

      if (decl?.type === 'VariableDeclaration') {
        return decl;
      }
    }

    return null;
  }

  /**
   * Extracts a `FunctionDeclaration` from a statement, unwrapping export wrappers.
   */
  private extractFunctionDeclaration(stmt: Directive | Statement): OxcFunction | null {
    if (stmt.type === 'FunctionDeclaration') {
      return stmt;
    }

    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
      const decl = stmt.declaration;

      if (decl?.type === 'FunctionDeclaration') {
        return decl;
      }
    }

    return null;
  }

  /**
   * Extracts a `Class` node from a statement, unwrapping export wrappers.
   */
  private extractClassFromStatement(stmt: Directive | Statement): Class | null {
    if (stmt.type === 'ClassDeclaration') {
      return stmt;
    }

    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
      const decl = stmt.declaration;

      if (decl?.type === 'ClassDeclaration') {
        return decl;
      }
    }

    return null;
  }

  private collectExportNames(
    node: ExportNamedDeclaration,
    localExports: string[],
    exportMappings: ReExportName[],
    defineModuleCalls: DefineModuleCall[],
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
   */
  private resolveExportDefaultForDefineModuleInline(
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

}
