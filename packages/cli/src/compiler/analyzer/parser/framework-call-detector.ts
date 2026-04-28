import { parseSource, extractSymbols } from '@zipbul/gildash';
import type { ParsedFile, ExtractedSymbol, ExpressionObject, PatternMatch } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';
import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE,
  ZIPBUL_FACTORY_CODE,
  FRAMEWORK_CREATE_APPLICATION, FRAMEWORK_DEFINE_MODULE,
} from '@zipbul/common';

import type { ModuleDefinition, CreateApplicationCall, DefineModuleCall, InjectCall } from '../parser-models';
import type { AnalyzerValue } from '../types';
import type { ImportMap, ConversionResult } from '../expression-converter';
import { convertExpression } from '../expression-converter';
import { isRecordValue, isNonEmptyString } from '../type-guards';
import { findVariableInitAstNode } from './ast-node-locator';
import { extractDependencies } from './method-metadata-extractor';
import { collectFactoryInjectCalls } from './inject-call-analyzer';

/**
 * Enriches a factory value with dependency and inject-call metadata.
 *
 * When the conversion result contains factory references, this function
 * locates the corresponding raw AST function node and attaches extracted
 * dependency information and inject calls to the record value.
 *
 * @param conversionResult - Result from `convertExpressionDeep`
 * @param parsed - Parsed file for AST access
 * @param variableName - Name of the variable to look up
 * @param injectMatches - Pattern matches for inject calls
 * @param lineOffsets - Byte offsets per line
 * @param currentFilePath - Current file path for diagnostics
 * @param currentImportSources - Import source map for inject resolution
 * @param currentImports - Import source map (localName -> module path)
 * @param currentOriginalNames - Original name map (localName -> originalName)
 * @param currentInjectCalls - Mutable array to collect inject calls
 * @returns The enriched AnalyzerValue with factory metadata, or the original value
 */
export function enrichFactoryValues(
  conversionResult: ConversionResult,
  parsed: ParsedFile,
  variableName: string,
  injectMatches: readonly PatternMatch[],
  lineOffsets: readonly number[],
  currentFilePath: string,
  currentImportSources: Readonly<Record<string, string>>,
  currentImports: Record<string, string>,
  currentOriginalNames: Record<string, string>,
  currentInjectCalls: InjectCall[],
): AnalyzerValue {
  if (conversionResult.factoryRefs.length === 0) {
    return conversionResult.value;
  }

  // For top-level factory (the value itself is a factory)
  const record = isRecordValue(conversionResult.value) ? conversionResult.value : null;

  if (record !== null && typeof record[ZIPBUL_FACTORY_CODE] === 'string') {
    const funcNode = findVariableInitAstNode(parsed, variableName);

    if (funcNode !== null) {
      const funcStart = funcNode.start;
      const funcEnd = funcNode.end;
      const deps = extractDependencies(funcNode, funcStart, currentImports, currentOriginalNames);
      const resolveOriginalName = (localName: string): string => currentOriginalNames[localName] ?? localName;
      const injectCalls = collectFactoryInjectCalls(
        injectMatches, lineOffsets, funcStart, funcEnd,
        currentFilePath, currentImportSources, currentImports,
        currentInjectCalls, resolveOriginalName,
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
 * When an extracted symbol has a call-type initializer imported from
 * `@zipbul/core`, this function checks the callee against known aliases
 * and namespace imports to classify it as either a `createApplication`
 * or `defineModule` call.
 *
 * @param symbol - The variable symbol
 * @param conversionResult - Result from `convertExpressionDeep`
 * @param createApplicationAliases - Aliases for `createApplication`
 * @param createApplicationNamespaces - Namespace imports from `@zipbul/core`
 * @param defineModuleAliases - Aliases for `defineModule`
 * @param defineModuleNamespaces - Namespace imports from `@zipbul/core`
 * @param createApplicationCalls - Output array to push matched createApplication calls
 * @param defineModuleCalls - Output array to push matched defineModule calls
 */
export function detectFrameworkCallsFromInitializer(
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

  if (isCreateApplicationCallee(callee, createApplicationAliases, createApplicationNamespaces)) {
    createApplicationCalls.push({
      callee,
      importSource,
      args,
    });
  }

  if (isDefineModuleCallee(callee, defineModuleAliases, defineModuleNamespaces)) {
    const defineCall: DefineModuleCall = {
      callee,
      importSource,
      args,
      localName: symbol.name,
      exportedName: symbol.isExported ? symbol.name : undefined,
    };

    upsertDefineModuleCall(defineModuleCalls, defineCall);
  }
}

/**
 * Checks whether a callee name matches `createApplication` or an alias/namespace.
 *
 * Handles both direct name matches (including aliases) and namespace-qualified
 * calls like `Core.createApplication`.
 *
 * @param callee - Callee name from ExpressionCall
 * @param aliases - Direct aliases for `createApplication`
 * @param namespaces - Namespace imports from `@zipbul/core`
 * @returns `true` if this is a createApplication call
 */
function isCreateApplicationCallee(
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
 * Handles both direct name matches (including aliases) and namespace-qualified
 * calls like `Core.defineModule`.
 *
 * @param callee - Callee name from ExpressionCall
 * @param aliases - Direct aliases for `defineModule`
 * @param namespaces - Namespace imports from `@zipbul/core`
 * @returns `true` if this is a defineModule call
 */
function isDefineModuleCallee(
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
 * Walks the object properties to extract `name`, `providers`, and `adapters`
 * fields. Used when a variable named `module` has an object literal initializer.
 *
 * @param expr - The object expression from gildash
 * @param importMap - Import map for type resolution
 * @param currentImports - Import source map (localName -> module path)
 * @returns ModuleDefinition with name, providers, adapters, and imports
 */
export function convertModuleDefinition(
  expr: ExpressionObject,
  _importMap: ImportMap,
  currentImports: Record<string, string>,
): ModuleDefinition {
  let name: string | undefined;
  let nameDeclared = false;
  const providers: AnalyzerValue[] = [];
  let adapters: AnalyzerValue | undefined = undefined;

  for (const entry of expr.properties) {
    if (entry.kind === 'spread') {
      // defineModule({ ...someBase, name: 'x' }) — spread 는 정적 분석 무관, skip.
      continue;
    }

    // gildash 0.26: prop.key 는 KeyExpression. plain identifier / 'string'-literal
    // 키는 모두 { kind: 'string', value: 'name' } 형태로 옴.
    const propKey = entry.key.kind === 'string' && typeof entry.key.value === 'string'
      ? entry.key.value
      : null;

    if (propKey === null) {
      // computed key (`[varName]: ...`) 는 모듈 정의에 미지원
      continue;
    }

    if (propKey === 'name') {
      nameDeclared = true;

      if (entry.value.kind === 'string' && typeof entry.value.value === 'string') {
        name = entry.value.value;
      }

      continue;
    }

    if (propKey === 'providers' && entry.value.kind === 'array') {
      for (const element of entry.value.elements) {
        providers.push(convertExpression(element));
      }

      continue;
    }

    if (propKey === 'adapters') {
      adapters = convertExpression(entry.value);
    }
  }

  return {
    name,
    nameDeclared,
    providers,
    adapters,
    imports: { ...currentImports },
  };
}

/**
 * Inserts or updates a `DefineModuleCall` entry in the calls array.
 *
 * If a call with the same `start`/`end` offsets already exists, merges
 * `localName` and `exportedName` into the existing entry instead of
 * creating a duplicate.
 *
 * @param calls - Mutable array of defineModule calls
 * @param call - The new call to insert or merge
 */
export function upsertDefineModuleCall(calls: DefineModuleCall[], call: DefineModuleCall): void {
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
 * For simple identifiers, resolves through the import map. For member
 * expressions (e.g. `ns.Something`), resolves the namespace portion.
 * For complex expressions (objects, arrays), wraps the text in a variable
 * declaration, parses with gildash, and converts via `convertExpression`.
 *
 * @param argsText - Raw argument text captured by `$$$ARGS`
 * @param importMap - Import map for identifier resolution
 * @param currentImports - Import source map (localName -> module path)
 * @param currentOriginalNames - Original name map (localName -> originalName)
 * @returns Parsed arguments as AnalyzerValue array
 */
export function parsePatternCaptureArgs(
  argsText: string,
  importMap: ImportMap,
  currentImports: Record<string, string>,
  currentOriginalNames: Record<string, string>,
): AnalyzerValue[] {
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
      [ZIPBUL_REF]: currentOriginalNames[trimmed] ?? trimmed,
      [ZIPBUL_IMPORT_SOURCE]: currentImports[trimmed],
    }];
  }

  // Member expression: ns.Something
  const memberMatch = trimmed.match(/^(\w+)\.(\w+)$/);

  if (memberMatch?.[1] !== undefined && memberMatch[2] !== undefined) {
    const objName = memberMatch[1];
    const propName = memberMatch[2];

    return [{
      [ZIPBUL_REF]: `${currentOriginalNames[objName] ?? objName}.${propName}`,
      [ZIPBUL_IMPORT_SOURCE]: currentImports[objName],
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
 * Handles both inline call expressions (`export default defineModule(...)`)
 * and identifier references (`export default myModule`).
 *
 * @param parsed - Parsed file for AST access
 * @param defineModuleCalls - defineModule calls to annotate
 */
export function resolveExportDefaultDefineModule(
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
