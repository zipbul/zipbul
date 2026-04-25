import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'path';

import { parseSource, extractSymbols, patternSearch, buildLineOffsets } from '@zipbul/gildash';
import type { ParsedFile, PatternMatch } from '@zipbul/gildash';
import type { ImportEntry } from '../interfaces';
import type { ClassMetadata } from '../interfaces';
import type { CreateApplicationCall, DefineModuleCall, InjectCall, ModuleDefinition, ParseResult, ReExport } from '../parser-models';
import type {
  AnalyzerValueRecord,
  ReExportName,
} from '../types';

import type { Result } from '@zipbul/result';
import { err, isErr } from '@zipbul/result';
import {
  FRAMEWORK_CREATE_APPLICATION, FRAMEWORK_DEFINE_MODULE,
} from '@zipbul/common';
import type { Diagnostic } from '../../../diagnostics';
import { buildDiagnostic } from '../../../diagnostics';
import {
  convertExpressionDeep, buildImportMap,
} from '../expression-converter';


import { isNonEmptyString } from '../type-guards';
import { compareCodePoint } from '../../../common';

import { buildImportState, buildExportState, collectExportNames, resolveExportDefaultForDefineModuleInline } from './import-export-extractor';
import type { ImportTrackingState } from './import-export-extractor';
import { convertClassSymbol } from './class-metadata-extractor';
import type { AstNodeLocatorCallbacks, MethodMetadataCallbacks, AnonymousClassCallback, ClassMetadataContext } from './class-metadata-extractor';
import { enrichFactoryValues, detectFrameworkCallsFromInitializer, convertModuleDefinition, upsertDefineModuleCall, parsePatternCaptureArgs, resolveExportDefaultDefineModule } from './framework-call-detector';
import { resolveInjectCallee, findImportSourceForCallee, buildInjectCallFromCapture } from './inject-call-analyzer';
import { extractExceptionFiltersFromConfigure, extractMiddlewaresFromConfigure } from './method-metadata-extractor';
import { extractHandlerContextUsages } from './handler-context-usage-extractor';
import { findClassAstNode, findMethodBodyAstNode, findPropertyAstNode, getMethodAstMeta, isAnonymousClassSymbol, extractFunctionSourceText } from './ast-node-locator';


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
        reason: `Parse error in ${filename}: ${JSON.stringify(parseResult.data)}`,
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
    const tracking: ImportTrackingState = {
      currentImports: this.currentImports,
      currentImportSources: this.currentImportSources,
      currentOriginalNames: this.currentOriginalNames,
    };

    buildImportState(
      parsed.module.staticImports,
      filename,
      imports,
      importEntries,
      createApplicationAliases,
      createApplicationNamespaces,
      defineModuleAliases,
      defineModuleNamespaces,
      (sourcePath, importPath) => this.resolvePath(sourcePath, importPath),
      tracking,
    );

    // 3. buildExportState from staticExports
    buildExportState(
      parsed.module.staticExports,
      filename,
      reExports,
      (sourcePath, importPath) => this.resolvePath(sourcePath, importPath),
    );

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
      const calleeName = resolveInjectCallee(match.matchedText);
      const resolvedCallee = this.resolveOriginalName(calleeName);
      const importSource = findImportSourceForCallee(calleeName, this.currentImportSources);

      if (importSource !== '@zipbul/common') {
        continue;
      }

      if (resolvedCallee !== 'inject' && !resolvedCallee.endsWith('.inject')) {
        continue;
      }

      const argsCapture = match.captures?.['$$$ARGS'];
      const resolveOriginalName = (localName: string): string => this.resolveOriginalName(localName);
      const injectCall = buildInjectCallFromCapture(
        argsCapture,
        resolvedCallee,
        importSource,
        this.currentFilePath,
        this.currentImports,
        resolveOriginalName,
      );

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
        collectExportNames(stmt, localExports, exportMappings, defineModuleCalls);

        continue;
      }

      if (stmt.type === 'ExportDefaultDeclaration') {
        resolveExportDefaultForDefineModuleInline(stmt, defineModuleCalls);
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

    const astLocators: AstNodeLocatorCallbacks = {
      findClassAstNode,
      findMethodBodyAstNode,
      findPropertyAstNode,
      getMethodAstMeta,
    };

    const methodCallbacks: MethodMetadataCallbacks = {
      extractMiddlewaresFromConfigure,
      extractExceptionFiltersFromConfigure,
      extractHandlerContextUsages: (funcNode) => extractHandlerContextUsages(funcNode)?.usages,
      extractHandlerContextOps: (funcNode) => extractHandlerContextUsages(funcNode)?.contextOps,
    };

    const anonymousCheck: AnonymousClassCallback = {
      isAnonymousClassSymbol,
    };

    const classMetadataContext: ClassMetadataContext = {
      currentFilePath: this.currentFilePath,
      currentOriginalNames: this.currentOriginalNames,
      resolvePath: (sourcePath, importPath) => this.resolvePath(sourcePath, importPath),
    };

    for (const symbol of symbols) {
      if (symbol.kind === 'class') {
        const classResult = convertClassSymbol(
          symbol,
          parsed,
          imports,
          importMap,
          classMetadataContext,
          astLocators,
          methodCallbacks,
          anonymousCheck,
        );

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

        const symbolValue = enrichFactoryValues(
          conversionResult,
          parsed,
          symbol.name,
          allInjectMatches,
          lineOffsets,
          this.currentFilePath,
          this.currentImportSources,
          this.currentImports,
          this.currentOriginalNames,
          this.currentInjectCalls,
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

        detectFrameworkCallsFromInitializer(
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
          moduleDefinition = convertModuleDefinition(symbol.initializer, importMap, this.currentImports);
        }
      }

      if (symbol.kind === 'function') {
        const funcExpr = symbol.initializer ?? {
          kind: 'function' as const,
          sourceText: extractFunctionSourceText(parsed, symbol.name, this.currentCode),
          ...(symbol.parameters !== undefined ? { parameters: symbol.parameters } : {}),
        };
        const conversionResult = convertExpressionDeep(funcExpr, filename, conversionOptions);

        const symbolValue = enrichFactoryValues(
          conversionResult,
          parsed,
          symbol.name,
          allInjectMatches,
          lineOffsets,
          this.currentFilePath,
          this.currentImportSources,
          this.currentImports,
          this.currentOriginalNames,
          this.currentInjectCalls,
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
      const importSource = findImportSourceForCallee(callee, this.currentImportSources);

      if (importSource !== '@zipbul/core') {
        continue;
      }

      const argsCapture = match.captures?.['$$$ARGS'];
      const args = parsePatternCaptureArgs(argsCapture?.text ?? '', importMap, this.currentImports, this.currentOriginalNames);

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
      const importSource = findImportSourceForCallee(callee, this.currentImportSources);

      if (importSource !== '@zipbul/core') {
        continue;
      }

      const argsCapture = match.captures?.['$$$ARGS'];
      const args = parsePatternCaptureArgs(argsCapture?.text ?? '', importMap, this.currentImports, this.currentOriginalNames);

      const defineCall: DefineModuleCall = {
        callee,
        importSource,
        args,
        start: extMatch.startOffset,
        end: extMatch.endOffset,
      };

      upsertDefineModuleCall(defineModuleCalls, defineCall);
    }

    // Handle export default for defineModule calls detected via patternSearch
    resolveExportDefaultDefineModule(parsed, defineModuleCalls);

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
}
