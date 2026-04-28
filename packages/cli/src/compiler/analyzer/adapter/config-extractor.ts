import type { FileAnalysis } from '../graph/interfaces';
import type {
  AdapterExtraction,
  AdapterExportResolution,
  AdapterStaticSchemaResult,
  AdapterEntryDecoratorsSchema,
  ClassMetadata,
} from '../interfaces';
import type { AnalyzerValue, AnalyzerValueRecord } from '../types';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../../diagnostics';

import { dirname, join } from 'path';
import { err, isErr } from '@zipbul/result';
import { parseSource, type ParsedFile } from '@zipbul/gildash';
import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_NEW,
} from '@zipbul/common';
import { Logger } from '@zipbul/logger';
import { buildDiagnostic } from '../../../diagnostics';
import { AstParser } from '../parser';
import { toRecord, isAnalyzerValueArray } from '../type-guards';
import { resolveEnumValues, resolvePipelineArray } from './enum-type-resolver';

import type { ContextNamespaceMap } from '../interfaces';
import type { Node as AstNode } from '@zipbul/gildash';

const logger = new Logger('AdapterDefinitionResolver');

/**
 * Collects package entry files referenced by non-relative imports across all file analyses.
 *
 * @param fileMap - Map of file paths to their analysis results.
 * @returns Sorted array of unique entry file paths.
 * @public
 */
export function collectPackageEntryFiles(fileMap: Map<string, FileAnalysis>): string[] {
  const entryFiles = new Set<string>();

  for (const analysis of fileMap.values()) {
    const importEntries = analysis.importEntries ?? [];

    for (const entry of importEntries) {
      if (entry.isRelative) {
        continue;
      }

      const resolved = normalizeTsEntry(entry.resolvedSource);

      if (resolved !== null) {
        entryFiles.add(resolved);

        if (!entry.resolvedSource.endsWith('.ts')) {
          entryFiles.add(`${entry.resolvedSource}/index.ts`);
        }
      }
    }
  }

  return Array.from(entryFiles.values()).sort((a, b) => a.localeCompare(b));
}

/**
 * Normalizes a file path to ensure it ends with `.ts`.
 *
 * @param rawPath - The raw file path.
 * @returns Normalized path ending in `.ts`, or `null` if the path is empty.
 * @public
 */
export function normalizeTsEntry(rawPath: string): string | null {
  if (rawPath.length === 0) {
    return null;
  }

  if (rawPath.endsWith('.ts')) {
    return rawPath;
  }

  return `${rawPath}.ts`;
}

/**
 * Resolves an `adapterDefinition` (or deprecated `adapterSpec`) named export
 * by traversing the file map and following re-exports.
 *
 * @param filePath - The file to start resolution from.
 * @param fileMap - Map of file paths to their analysis results.
 * @param visited - Set of already-visited file paths to prevent cycles.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns The resolved export value and source file, or `null` if not found.
 * @public
 */
export async function resolveAdapterDefinitionExport(
  filePath: string,
  fileMap: Map<string, FileAnalysis>,
  visited: Set<string>,
  parser: AstParser,
): Promise<AdapterExportResolution | null> {
  if (visited.has(filePath)) {
    return null;
  }

  visited.add(filePath);

  const analysis = await getFileAnalysis(filePath, fileMap, parser);

  if (analysis === null) {
    return null;
  }

  const exportedValues = analysis.exportedValues ?? {};

  if (Object.prototype.hasOwnProperty.call(exportedValues, 'adapterDefinition')) {
    if (Object.prototype.hasOwnProperty.call(exportedValues, 'adapterSpec')) {
      logger.warn(`Both 'adapterDefinition' and deprecated 'adapterSpec' found in ${filePath}. Remove 'adapterSpec'.`);
    }

    return { value: exportedValues.adapterDefinition, sourceFile: filePath };
  }

  // Backward compatibility: also search for legacy 'adapterSpec' export name
  if (Object.prototype.hasOwnProperty.call(exportedValues, 'adapterSpec')) {
    logger.warn(`'adapterSpec' is deprecated. Rename to 'adapterDefinition' in ${filePath}.`);
    return { value: exportedValues.adapterSpec, sourceFile: filePath };
  }

  const reExports = analysis.reExports ?? [];

  for (const entry of reExports) {
    if (entry.exportAll) {
      const result = await resolveAdapterDefinitionExport(entry.module, fileMap, visited, parser);

      if (result) {
        return result;
      }

      continue;
    }

    const names = entry.names ?? [];

    for (const nameEntry of names) {
      if (nameEntry.exported === 'adapterDefinition' || nameEntry.exported === 'adapterSpec') {
        const result = await resolveAdapterDefinitionExport(entry.module, fileMap, visited, parser);

        if (result) {
          return result;
        }
      }
    }
  }

  return null;
}

/**
 * Retrieves or parses a file analysis from the file map.
 * If the file is not cached, reads and parses it on demand.
 *
 * @param filePath - The file path to look up.
 * @param fileMap - Map of file paths to their analysis results.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns The file analysis, or `null` if the file does not exist or fails to parse.
 * @public
 */
export async function getFileAnalysis(filePath: string, fileMap: Map<string, FileAnalysis>, parser: AstParser): Promise<FileAnalysis | null> {
  const cached = fileMap.get(filePath);

  if (cached) {
    return cached;
  }

  const normalizedPath = filePath.endsWith('.ts') ? filePath : filePath + '.ts';
  const normalized = fileMap.get(normalizedPath);

  if (normalized) {
    return normalized;
  }

  if (!(await Bun.file(normalizedPath).exists())) {
    return null;
  }

  const fileContent = await Bun.file(normalizedPath).text();
  const parseResult = await parser.parse(filePath, fileContent);

  if (isErr(parseResult)) {
    return null;
  }

  const analysis: FileAnalysis = {
    filePath,
    classes: parseResult.classes,
    reExports: parseResult.reExports,
    exports: parseResult.exports,
  };

  if (parseResult.defineModuleCalls !== undefined) {
    analysis.defineModuleCalls = parseResult.defineModuleCalls;
  }

  if (parseResult.imports !== undefined) {
    analysis.imports = parseResult.imports;
  }

  if (parseResult.importEntries !== undefined) {
    analysis.importEntries = parseResult.importEntries;
  }

  if (parseResult.exportedValues !== undefined) {
    analysis.exportedValues = parseResult.exportedValues;
  }

  if (parseResult.localValues !== undefined) {
    analysis.localValues = parseResult.localValues;
  }

  if (parseResult.moduleDefinition !== undefined) {
    analysis.moduleDefinition = parseResult.moduleDefinition;
  }

  if (parseResult.enums !== undefined) {
    analysis.enums = parseResult.enums;
  }

  fileMap.set(normalizedPath, analysis);

  return analysis;
}

/**
 * Finds class metadata by class name, optionally starting from an import source path.
 *
 * @param className - The class name to look for.
 * @param importSource - The import source path (if available).
 * @param sourceFile - The file where the reference was found.
 * @param fileMap - Map of file paths to their analysis results.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns The class metadata, or `null` if not found.
 * @public
 */
export async function findClassMetadata(
  className: string,
  importSource: string | null,
  _sourceFile: string,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<ClassMetadata | null> {
  if (importSource !== null) {
    const resolvedPath = normalizeTsEntry(importSource);

    if (resolvedPath !== null) {
      const analysis = await getFileAnalysis(resolvedPath, fileMap, parser);

      if (analysis !== null) {
        const cls = analysis.classes.find(c => c.className === className);

        if (cls !== undefined) {
          return cls;
        }
      }

      if (analysis === null && !importSource.endsWith('.ts')) {
        const indexPath = `${importSource}/index.ts`;
        const indexAnalysis = await getFileAnalysis(indexPath, fileMap, parser);

        if (indexAnalysis !== null) {
          const cls = indexAnalysis.classes.find(c => c.className === className);

          if (cls !== undefined) {
            return cls;
          }
        }
      }
    }
  }

  for (const analysis of fileMap.values()) {
    const cls = analysis.classes.find(c => c.className === className);

    if (cls !== undefined) {
      return cls;
    }
  }

  return null;
}

/**
 * Extracts adapter static schema from a config object passed to `defineAdapter({...})`.
 * Reads `adapter`, `step`, `phase`, `pipeline` directly from the config instead of
 * parsing static class properties.
 *
 * @param config - The config object from `defineAdapter({...})`.
 * @param sourceFile - The file where the config was found.
 * @param fileMap - Map of file paths to their analysis results.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns The extracted adapter definition, or a diagnostic error.
 * @public
 */
export async function extractFromConfigObject(
  config: AnalyzerValueRecord,
  sourceFile: string,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Result<AdapterExtraction, Diagnostic>> {
  // adapter field -> class reference for decorator extraction
  const adapterField = toRecord(config.adapter);
  if (adapterField === null || typeof adapterField[ZIPBUL_REF] !== 'string') {
    return err(buildDiagnostic({
      reason: `defineAdapter config.adapter must be a class reference in ${sourceFile}.`,
      file: sourceFile,
    }));
  }

  const className = adapterField[ZIPBUL_REF] as string;
  const importSource = typeof adapterField[ZIPBUL_IMPORT_SOURCE] === 'string' ? adapterField[ZIPBUL_IMPORT_SOURCE] as string : null;

  const classMetadata = await findClassMetadata(className, importSource, sourceFile, fileMap, parser);
  if (classMetadata === null) {
    return err(buildDiagnostic({
      reason: `Could not find class '${className}' referenced by defineAdapter.adapter in ${sourceFile}.`,
      file: sourceFile,
    }));
  }

  // Extract decorators from the class (still needed for handler discovery)
  const classExtraction = await extractFromClassProperties(classMetadata, sourceFile, fileMap, parser);
  if (isErr(classExtraction)) return classExtraction;

  // Override pipeline and validPhases from config object
  const schema = { ...classExtraction.staticSchema };

  // step enum -> not directly stored, used for pipeline validation
  // phase enum -> resolves to validPhases
  const phaseField = toRecord(config.phase);
  if (phaseField !== null && typeof phaseField[ZIPBUL_REF] === 'string') {
    const phaseEnumName = phaseField[ZIPBUL_REF] as string;
    const phaseImportSource = typeof phaseField[ZIPBUL_IMPORT_SOURCE] === 'string' ? phaseField[ZIPBUL_IMPORT_SOURCE] as string : null;
    const phases = await resolveEnumValues(phaseEnumName, phaseImportSource, fileMap, parser);
    if (phases !== undefined) {
      schema.validPhases = phases;
    }
  }

  // pipeline -> direct array
  const pipelineProperty = config.pipeline;
  if (pipelineProperty !== undefined) {
    const pipeline = await resolvePipelineArray(pipelineProperty, fileMap, parser);
    if (pipeline !== undefined) {
      schema.pipeline = pipeline;
    }
  }

  // context class → auto-derive namespace-to-interface mapping for declaration merging
  const contextField = toRecord(config.context);
  if (contextField !== null && typeof contextField[ZIPBUL_REF] === 'string') {
    const contextClassName = contextField[ZIPBUL_REF] as string;
    const contextImportSource = typeof contextField[ZIPBUL_IMPORT_SOURCE] === 'string'
      ? contextField[ZIPBUL_IMPORT_SOURCE] as string
      : null;

    const contextNamespaces = await extractContextGetterTypes(
      contextClassName,
      contextImportSource,
      sourceFile,
      fileMap,
    );

    if (contextNamespaces !== null) {
      schema.contextNamespaces = contextNamespaces;
    }
  }

  // Validate CoreStep presence in pipeline
  if (schema.pipeline !== undefined) {
    const pipelineSteps = new Set(schema.pipeline);
    const requiredCoreSteps = ['Handler', 'Guard', 'Validation'];

    for (const required of requiredCoreSteps) {
      if (!pipelineSteps.has(required)) {
        return err(buildDiagnostic({
          reason: `Adapter pipeline must contain CoreStep.${required}. Missing in ${className}.`,
          file: sourceFile,
        }));
      }
    }
  }

  return {
    adapterId: classExtraction.adapterId,
    staticSchema: schema,
  };
}

/**
 * Extracts adapter static schema from class properties (decorators, validPhases, pipeline).
 *
 * @param classMetadata - The class metadata to extract from.
 * @param sourceFile - The file where the class was found.
 * @param fileMap - Map of file paths to their analysis results.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns The extracted adapter schema result, or a diagnostic error.
 * @public
 */
export async function extractFromClassProperties(
  classMetadata: ClassMetadata,
  sourceFile: string,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Result<AdapterStaticSchemaResult, Diagnostic>> {
  const adapterId = classMetadata.className;

  const decoratorsProperty = classMetadata.properties.find(p => p.name === 'decorators');
  const decsRaw = toRecord(decoratorsProperty?.initializer);

  if (decsRaw === null) {
    return err(buildDiagnostic({
      reason: `Adapter class '${classMetadata.className}' must have a 'decorators' property with an object initializer in ${sourceFile}.`,
      file: sourceFile,
    }));
  }

  const controllerRaw = toRecord(decsRaw.controller);

  if (controllerRaw === null || typeof controllerRaw[ZIPBUL_REF] !== 'string') {
    return err(buildDiagnostic({
      reason: `Adapter class '${classMetadata.className}' decorators.controller must be an Identifier in ${sourceFile}.`,
      file: sourceFile,
    }));
  }

  const controller = controllerRaw[ZIPBUL_REF];
  const handlersRaw = decsRaw.handlers;

  if (!Array.isArray(handlersRaw) || handlersRaw.length === 0) {
    return err(buildDiagnostic({
      reason: `Adapter class '${classMetadata.className}' decorators.handlers must be a non-empty Identifier array in ${sourceFile}.`,
      file: sourceFile,
    }));
  }

  const handlers: string[] = [];

  for (const adapterNode of handlersRaw) {
    const rec = toRecord(adapterNode);

    if (rec === null || typeof rec[ZIPBUL_REF] !== 'string') {
      return err(buildDiagnostic({
        reason: `Adapter class '${classMetadata.className}' decorators.handlers elements must be Identifiers in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    handlers.push(rec[ZIPBUL_REF]);
  }

  // Extract optional option decorators
  const optionsRaw = decsRaw.options;
  let options: string[] | undefined;

  if (optionsRaw !== undefined) {
    if (!Array.isArray(optionsRaw)) {
      return err(buildDiagnostic({
        reason: `Adapter class '${classMetadata.className}' decorators.options must be an Identifier array in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    options = [];

    for (const optionNode of optionsRaw) {
      const rec = toRecord(optionNode);

      if (rec === null || typeof rec[ZIPBUL_REF] !== 'string') {
        return err(buildDiagnostic({
          reason: `Adapter class '${classMetadata.className}' decorators.options elements must be Identifiers in ${sourceFile}.`,
          file: sourceFile,
        }));
      }

      options.push(rec[ZIPBUL_REF]);
    }
  }

  const entryDecorators: AdapterEntryDecoratorsSchema = {
    controller,
    handlers,
    ...(options !== undefined && options.length > 0 ? { options } : {}),
  };

  // Extract validPhases from static property
  const validPhasesProperty = classMetadata.properties.find(p => p.name === 'validPhases');
  let validPhases: Set<string> | undefined;

  if (validPhasesProperty !== undefined) {
    validPhases = await resolveValidPhases(validPhasesProperty.initializer, fileMap, parser);
  }

  // Extract pipeline from static property
  const pipelineProperty = classMetadata.properties.find(p => p.name === 'pipeline');
  let pipeline: readonly string[] | undefined;

  if (pipelineProperty !== undefined) {
    pipeline = await resolvePipelineArray(pipelineProperty.initializer, fileMap, parser);
  }

  return {
    adapterId,
    staticSchema: {
      entryDecorators,
      ...(validPhases !== undefined ? { validPhases } : {}),
      ...(pipeline !== undefined ? { pipeline } : {}),
    },
  };
}

/**
 * Resolves `static readonly validPhases = new Set(Object.values(SomeEnum))`
 * by statically evaluating the AST structure and looking up enum member values.
 *
 * @param value - The property initializer AST value.
 * @param fileMap - Map of file paths to their analysis results.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns Set of valid phase strings, or undefined if unresolvable.
 */
async function resolveValidPhases(
  value: AnalyzerValue | undefined,
  fileMap: Map<string, FileAnalysis>,
  parser: AstParser,
): Promise<Set<string> | undefined> {
  const rec = toRecord(value);

  if (rec === null) {
    return undefined;
  }

  // Check for `new Set(...)` structure
  if (rec[ZIPBUL_NEW] !== 'Set') {
    return undefined;
  }

  const setArgs = isAnalyzerValueArray(rec.args) ? rec.args : null;

  if (setArgs === null || setArgs.length !== 1) {
    return undefined;
  }

  const setArg = toRecord(setArgs[0]);

  if (setArg === null) {
    return undefined;
  }

  // Check for `Object.values(...)` structure
  if (setArg[ZIPBUL_CALL] !== 'Object.values') {
    return undefined;
  }

  const callArgs = isAnalyzerValueArray(setArg.args) ? setArg.args : null;

  if (callArgs === null || callArgs.length !== 1) {
    return undefined;
  }

  const enumRef = toRecord(callArgs[0]);

  if (enumRef === null || typeof enumRef[ZIPBUL_REF] !== 'string') {
    return undefined;
  }

  const enumName = enumRef[ZIPBUL_REF] as string;
  const importSource = typeof enumRef[ZIPBUL_IMPORT_SOURCE] === 'string' ? enumRef[ZIPBUL_IMPORT_SOURCE] as string : null;

  // Look up enum members from file analysis
  return await resolveEnumValues(enumName, importSource, fileMap, parser);
}

/**
 * Extracts getter return types from a context class using raw AST parsing.
 *
 * Only simple `TSTypeReference` getters are captured (e.g. `get request(): HttpRequest`).
 * Union types, optional types, and primitives are skipped — they're not augmentation targets.
 *
 * @param contextClassName - The context class name (e.g. 'HttpContext').
 * @param contextImportSource - The resolved import source of the context class.
 * @param adapterSourceFile - The file containing the defineAdapter() call.
 * @param fileMap - Map of file paths to their analysis results.
 * @returns ContextNamespaceMap, or null if unresolvable.
 */
async function extractContextGetterTypes(
  contextClassName: string,
  contextImportSource: string | null,
  adapterSourceFile: string,
  _fileMap: Map<string, FileAnalysis>,
): Promise<ContextNamespaceMap | null> {
  // Resolve the context class source file
  const contextFilePath = resolveImportPath(contextImportSource, adapterSourceFile);

  if (contextFilePath === null) return null;

  const file = Bun.file(contextFilePath);

  if (!(await file.exists())) return null;

  const sourceText = await file.text();
  const parseResult = parseSource(contextFilePath, sourceText);

  if (isErr(parseResult)) return null;

  const parsed: ParsedFile = parseResult;

  // Find the class declaration
  const namespaces: Record<string, string> = {};

  for (const stmt of parsed.program.body) {
    const classDecl = extractClassDeclaration(stmt, contextClassName);

    if (classDecl === null) continue;

    for (const member of classDecl.body.body) {
      if (member.type !== 'MethodDefinition' || (member as AstNode & { kind: string }).kind !== 'get') continue;

      const key = member.key;

      if (key.type !== 'Identifier') continue;

      const returnType = (member.value as AstNode & { returnType?: AstNode })?.returnType;
      const typeAnnotation = (returnType as AstNode & { typeAnnotation?: AstNode })?.typeAnnotation;

      if (typeAnnotation === undefined || typeAnnotation === null) continue;

      // Only capture simple type references (not unions, not primitives)
      if (typeAnnotation.type !== 'TSTypeReference') continue;

      const typeName = (typeAnnotation as AstNode & { typeName?: AstNode }).typeName;

      if (typeName === undefined || typeName.type !== 'Identifier') continue;

      namespaces[(key as AstNode & { name: string }).name] = (typeName as AstNode & { name: string }).name;
    }

    break; // found the class, stop searching
  }

  if (Object.keys(namespaces).length === 0) return null;

  // Resolve the package name for the module specifier
  const moduleSpecifier = await resolvePackageName(dirname(contextFilePath));

  if (moduleSpecifier === null) return null;

  return {
    contextType: contextClassName,
    module: moduleSpecifier,
    namespaces,
  };
}

/**
 * Extracts a class declaration from a statement, handling ExportNamedDeclaration wrapping.
 */
function extractClassDeclaration(
  stmt: AstNode,
  className: string,
): (AstNode & { body: { body: AstNode[] } }) | null {
  let decl: AstNode | null = null;

  if (stmt.type === 'ClassDeclaration') {
    decl = stmt;
  } else if (stmt.type === 'ExportNamedDeclaration') {
    const exportDecl = stmt as AstNode & { declaration?: AstNode };

    if (exportDecl.declaration?.type === 'ClassDeclaration') {
      decl = exportDecl.declaration;
    }
  }

  if (decl === null) return null;

  const classId = (decl as AstNode & { id?: AstNode }).id;

  if (classId === undefined || classId.type !== 'Identifier') return null;

  if ((classId as AstNode & { name: string }).name !== className) return null;

  return decl as AstNode & { body: { body: AstNode[] } };
}

/**
 * Resolves an import source to a file path.
 * Handles both relative and already-resolved absolute paths.
 */
function resolveImportPath(importSource: string | null, sourceFile: string): string | null {
  if (importSource === null) return null;

  // Already an absolute path (resolved by the analyzer)
  if (importSource.startsWith('/')) {
    return importSource.endsWith('.ts') ? importSource : `${importSource}.ts`;
  }

  // Relative import
  if (importSource.startsWith('.')) {
    const dir = dirname(sourceFile);
    const resolved = join(dir, importSource);

    return resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
  }

  // Non-relative (package import) — not supported here
  return null;
}

/**
 * Walks up from a directory to find the nearest package.json and returns the package name.
 */
async function resolvePackageName(startDir: string): Promise<string | null> {
  let currentDir = startDir;

  for (let depth = 0; depth < 10; depth++) {
    const packageJsonPath = join(currentDir, 'package.json');
    const file = Bun.file(packageJsonPath);

    if (await file.exists()) {
      const content = await file.json();

      if (typeof content.name === 'string') {
        return content.name;
      }
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) break;

    currentDir = parentDir;
  }

  return null;
}
