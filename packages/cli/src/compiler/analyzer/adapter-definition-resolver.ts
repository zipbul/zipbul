import type { AdapterResolveParams, FileAnalysis } from './graph/interfaces';
import type {
  AdapterExtraction,
  AdapterExportResolution,
  AdapterResolution,
  AdapterStaticSchemaResult,
  AdapterStaticSchema,
  AdapterEntryDecoratorsSchema,
  HandlerIndexEntry,
  TypedCallMetadata,
  RouteRegistration,
} from './interfaces';
import type {
  CompiledMiddlewareBindingEntry,
  CompiledOptionEntry,
  CompiledPipelineBindingEntry,
  CompiledPipelineScope,
  CompiledValidationEntry,
} from '@zipbul/common';
import type { ClassMetadata } from './interfaces';
import type { AnalyzerValue, AnalyzerValueRecord, DecoratorArguments } from './types';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../diagnostics';

import { err, isErr } from '@zipbul/result';
import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_COMPUTED_PREFIX, ZIPBUL_NEW,
  ZIPBUL_UNRESOLVABLE,
  FRAMEWORK_DEFINE_ADAPTER,
} from '@zipbul/common';
import { Logger } from '@zipbul/logger';
import { buildDiagnostic } from '../../diagnostics';
import { PathResolver } from '../../common';
import { AstParser } from './ast-parser';
import { isRecordValue, isAnalyzerValueArray, isNonEmptyString, isUnresolvable } from './type-guards';

const logger = new Logger('AdapterDefinitionResolver');

interface DecoratorKeyExtraction {
  keys: string[];
  bindings: CompiledPipelineBindingEntry[];
}

interface MiddlewareDecoratorKeyExtraction {
  keys: string[];
  bindings: CompiledMiddlewareBindingEntry[];
}

/**
 * Interns immutable arrays/objects so that structurally identical values
 * share a single reference across all compiled handler entries.
 */
class InternPool {
  private readonly pool = new Map<string, unknown>();

  /**
   * Returns a cached reference if an identical value was already interned,
   * otherwise stores and returns the given value.
   */
  intern<T>(value: T): T {
    const key = JSON.stringify(value);
    const existing = this.pool.get(key);

    if (existing !== undefined) {
      return existing as T;
    }

    this.pool.set(key, value);

    return value;
  }
}

export class AdapterDefinitionResolver {
  private parser = new AstParser();

  async resolve(params: AdapterResolveParams): Promise<Result<AdapterResolution, Diagnostic>> {
    const { fileMap, projectRoot, graph } = params;
    const entryFiles = this.collectPackageEntryFiles(fileMap);
    const adapterExtractions: AdapterExtraction[] = [];

    for (const entryFile of entryFiles) {
      const resolvedExport = await this.resolveAdapterDefinitionExport(entryFile, fileMap, new Set());

      if (resolvedExport === null) {
        continue;
      }

      const defineCall = this.asRecord(resolvedExport.value);

      if (defineCall?.[ZIPBUL_CALL] !== FRAMEWORK_DEFINE_ADAPTER) {
        return err(buildDiagnostic({
          reason: `Adapter definition must use defineAdapter(ClassRef) in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const args = isAnalyzerValueArray(defineCall.args) ? defineCall.args : [];

      if (args.length !== 1) {
        return err(buildDiagnostic({
          reason: `defineAdapter requires exactly one argument in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const arg = this.asRecord(args[0]);

      if (arg === null) {
        return err(buildDiagnostic({
          reason: `defineAdapter argument must be a config object in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const adapterField = this.asRecord(arg.adapter);
      if (adapterField === null || typeof adapterField[ZIPBUL_REF] !== 'string') {
        return err(buildDiagnostic({
          reason: `defineAdapter argument must be a config object with an 'adapter' class reference in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const configResult = await this.extractFromConfigObject(arg, resolvedExport.sourceFile, fileMap);
      if (isErr(configResult)) return configResult;

      adapterExtractions.push(configResult);
    }

    if (adapterExtractions.length === 0) {
      return err(buildDiagnostic({
        reason: 'No adapter definition found. Export an adapterDefinition from your adapter package entry file.',
      }));
    }

    const adapterStaticSchemas = this.buildAdapterStaticSchemaSet(adapterExtractions);
    if (isErr(adapterStaticSchemas)) return adapterStaticSchemas;

    const controllerAdapterMap = this.buildControllerAdapterMap(adapterExtractions, fileMap);
    if (isErr(controllerAdapterMap)) return controllerAdapterMap;

    if (graph !== undefined) {
      const controllerDecoratorNames = adapterExtractions.map(extraction => extraction.staticSchema.entryDecorators.controller);
      graph.registerControllers(controllerDecoratorNames);
    }

    const middlewareValidation = this.validateMiddlewarePhaseInputs(adapterExtractions, fileMap, controllerAdapterMap);
    if (isErr(middlewareValidation)) return middlewareValidation;

    const handlerIndexResult = this.buildHandlerIndex(adapterExtractions, fileMap, projectRoot, controllerAdapterMap, graph);
    if (isErr(handlerIndexResult)) return handlerIndexResult;

    return {
      adapterStaticSchemas,
      handlerIndex: handlerIndexResult.entries,
      routeRegistrations: handlerIndexResult.routeRegistrations,
    };
  }

  private collectPackageEntryFiles(fileMap: Map<string, FileAnalysis>): string[] {
    const entryFiles = new Set<string>();

    for (const analysis of fileMap.values()) {
      const importEntries = analysis.importEntries ?? [];

      for (const entry of importEntries) {
        if (entry.isRelative) {
          continue;
        }

        const resolved = this.normalizeTsEntry(entry.resolvedSource);

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

  private normalizeTsEntry(rawPath: string): string | null {
    if (rawPath.length === 0) {
      return null;
    }

    if (rawPath.endsWith('.ts')) {
      return rawPath;
    }

    return `${rawPath}.ts`;
  }

  private async resolveAdapterDefinitionExport(
    filePath: string,
    fileMap: Map<string, FileAnalysis>,
    visited: Set<string>,
  ): Promise<AdapterExportResolution | null> {
    if (visited.has(filePath)) {
      return null;
    }

    visited.add(filePath);

    const analysis = await this.getFileAnalysis(filePath, fileMap);

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
        const result = await this.resolveAdapterDefinitionExport(entry.module, fileMap, visited);

        if (result) {
          return result;
        }

        continue;
      }

      const names = entry.names ?? [];

      for (const nameEntry of names) {
        if (nameEntry.exported === 'adapterDefinition' || nameEntry.exported === 'adapterSpec') {
          const result = await this.resolveAdapterDefinitionExport(entry.module, fileMap, visited);

          if (result) {
            return result;
          }
        }
      }
    }

    return null;
  }

  private async getFileAnalysis(filePath: string, fileMap: Map<string, FileAnalysis>): Promise<FileAnalysis | null> {
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
    const parseResult = this.parser.parse(filePath, fileContent);

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

  private async findClassMetadata(
    className: string,
    importSource: string | null,
    sourceFile: string,
    fileMap: Map<string, FileAnalysis>,
  ): Promise<ClassMetadata | null> {
    if (importSource !== null) {
      const resolvedPath = this.normalizeTsEntry(importSource);

      if (resolvedPath !== null) {
        const analysis = await this.getFileAnalysis(resolvedPath, fileMap);

        if (analysis !== null) {
          const cls = analysis.classes.find(c => c.className === className);

          if (cls !== undefined) {
            return cls;
          }
        }

        if (analysis === null && !importSource.endsWith('.ts')) {
          const indexPath = `${importSource}/index.ts`;
          const indexAnalysis = await this.getFileAnalysis(indexPath, fileMap);

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
   */
  private async extractFromConfigObject(
    config: AnalyzerValueRecord,
    sourceFile: string,
    fileMap: Map<string, FileAnalysis>,
  ): Promise<Result<AdapterExtraction, Diagnostic>> {
    // adapter field → class reference for decorator extraction
    const adapterField = this.asRecord(config.adapter);
    if (adapterField === null || typeof adapterField[ZIPBUL_REF] !== 'string') {
      return err(buildDiagnostic({
        reason: `defineAdapter config.adapter must be a class reference in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const className = adapterField[ZIPBUL_REF] as string;
    const importSource = typeof adapterField[ZIPBUL_IMPORT_SOURCE] === 'string' ? adapterField[ZIPBUL_IMPORT_SOURCE] as string : null;

    const classMetadata = await this.findClassMetadata(className, importSource, sourceFile, fileMap);
    if (classMetadata === null) {
      return err(buildDiagnostic({
        reason: `Could not find class '${className}' referenced by defineAdapter.adapter in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    // Extract decorators from the class (still needed for handler discovery)
    const classExtraction = await this.extractFromClassProperties(classMetadata, sourceFile, fileMap);
    if (isErr(classExtraction)) return classExtraction;

    // Override pipeline and validPhases from config object
    const schema = { ...classExtraction.staticSchema };

    // step enum → not directly stored, used for pipeline validation
    // phase enum → resolves to validPhases
    const phaseField = this.asRecord(config.phase);
    if (phaseField !== null && typeof phaseField[ZIPBUL_REF] === 'string') {
      const phaseEnumName = phaseField[ZIPBUL_REF] as string;
      const phaseImportSource = typeof phaseField[ZIPBUL_IMPORT_SOURCE] === 'string' ? phaseField[ZIPBUL_IMPORT_SOURCE] as string : null;
      const phases = await this.resolveEnumValues(phaseEnumName, phaseImportSource, fileMap);
      if (phases !== undefined) {
        schema.validPhases = phases;
      }
    }

    // pipeline → direct array
    const pipelineProperty = config.pipeline;
    if (pipelineProperty !== undefined) {
      const pipeline = await this.resolvePipelineArray(pipelineProperty, fileMap);
      if (pipeline !== undefined) {
        schema.pipeline = pipeline;
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

  private async extractFromClassProperties(classMetadata: ClassMetadata, sourceFile: string, fileMap: Map<string, FileAnalysis>): Promise<Result<AdapterStaticSchemaResult, Diagnostic>> {
    const adapterId = classMetadata.className;

    const decoratorsProperty = classMetadata.properties.find(p => p.name === 'decorators');
    const decsRaw = this.asRecord(decoratorsProperty?.initializer);

    if (decsRaw === null) {
      return err(buildDiagnostic({
        reason: `Adapter class '${classMetadata.className}' must have a 'decorators' property with an object initializer in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const controllerRaw = this.asRecord(decsRaw.controller);

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
      const rec = this.asRecord(adapterNode);

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
        const rec = this.asRecord(optionNode);

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
      validPhases = await this.resolveValidPhases(validPhasesProperty.initializer, fileMap);
    }

    // Extract pipeline from static property
    const pipelineProperty = classMetadata.properties.find(p => p.name === 'pipeline');
    let pipeline: readonly string[] | undefined;

    if (pipelineProperty !== undefined) {
      pipeline = await this.resolvePipelineArray(pipelineProperty.initializer, fileMap);
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
   * @returns Set of valid phase strings, or undefined if unresolvable.
   */
  private async resolveValidPhases(value: AnalyzerValue | undefined, fileMap: Map<string, FileAnalysis>): Promise<Set<string> | undefined> {
    const rec = this.asRecord(value);

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

    const setArg = this.asRecord(setArgs[0]);

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

    const enumRef = this.asRecord(callArgs[0]);

    if (enumRef === null || typeof enumRef[ZIPBUL_REF] !== 'string') {
      return undefined;
    }

    const enumName = enumRef[ZIPBUL_REF] as string;
    const importSource = typeof enumRef[ZIPBUL_IMPORT_SOURCE] === 'string' ? enumRef[ZIPBUL_IMPORT_SOURCE] as string : null;

    // Look up enum members from file analysis
    return await this.resolveEnumValues(enumName, importSource, fileMap);
  }

  /**
   * Looks up enum member values by resolving the enum from file analyses.
   * Falls back to scanning all file analyses if import source is not available.
   *
   * @param enumName - The enum identifier name.
   * @param importSource - The import source file path (if available).
   * @param fileMap - Map of file paths to their analysis results.
   * @returns Set of enum member values, or undefined if not found.
   */
  private async resolveEnumValues(enumName: string, importSource: string | null, fileMap: Map<string, FileAnalysis>): Promise<Set<string> | undefined> {
    if (importSource !== null) {
      const normalizedPath = importSource.endsWith('.ts') ? importSource : `${importSource}.ts`;
      const analysis = await this.getFileAnalysis(normalizedPath, fileMap);
      const enumMembers = this.getEnumMembers(analysis, enumName);

      if (enumMembers !== undefined) {
        return new Set(enumMembers.values());
      }

      // Try index.ts fallback
      if (!importSource.endsWith('.ts')) {
        const indexPath = `${importSource}/index.ts`;
        const indexAnalysis = await this.getFileAnalysis(indexPath, fileMap);
        const indexEnumMembers = this.getEnumMembers(indexAnalysis, enumName);

        if (indexEnumMembers !== undefined) {
          return new Set(indexEnumMembers.values());
        }
      }
    }

    // Fallback: scan all files
    for (const analysis of fileMap.values()) {
      const enumMembers = this.getEnumMembers(analysis, enumName);

      if (enumMembers !== undefined) {
        return new Set(enumMembers.values());
      }
    }

    return undefined;
  }

  /**
   * Resolves `static readonly pipeline = [EnumA.X, EnumB.Y, ...]` from the adapter class.
   * Each item is an enum reference like `{ __zipbul_ref: "HttpPhase.OnRequest" }`.
   * Resolves each reference to its string value by looking up enum members.
   */
  private async resolvePipelineArray(value: AnalyzerValue | undefined, fileMap: Map<string, FileAnalysis>): Promise<readonly string[] | undefined> {
    if (!isAnalyzerValueArray(value)) {
      return undefined;
    }

    const steps: string[] = [];
    const enumCache = new Map<string, Map<string, string>>();

    for (const item of value) {
      if (typeof item === 'string') {
        steps.push(item);
        continue;
      }

      const rec = this.asRecord(item);

      if (rec === null || typeof rec[ZIPBUL_REF] !== 'string') {
        continue;
      }

      const ref = rec[ZIPBUL_REF] as string;
      const importSource = typeof rec[ZIPBUL_IMPORT_SOURCE] === 'string' ? rec[ZIPBUL_IMPORT_SOURCE] as string : null;

      // ref = "HttpPhase.OnRequest" → enumName = "HttpPhase", memberName = "OnRequest"
      const dotIndex = ref.indexOf('.');

      if (dotIndex === -1) {
        steps.push(ref);
        continue;
      }

      const enumName = ref.slice(0, dotIndex);
      const memberName = ref.slice(dotIndex + 1);

      let members = enumCache.get(enumName);

      if (members === undefined) {
        const resolved = await this.resolveEnumValues(enumName, importSource, fileMap);

        if (resolved !== undefined) {
          // resolveEnumValues returns Set<string> (values). We need name→value mapping.
          // Re-resolve to get the Map directly.
          const memberMap = await this.resolveEnumMemberMap(enumName, importSource, fileMap);
          members = memberMap ?? new Map();
        } else {
          members = new Map();
        }

        enumCache.set(enumName, members);
      }

      const memberValue = members.get(memberName);
      steps.push(memberValue ?? memberName);
    }

    return steps.length > 0 ? steps : undefined;
  }

  /**
   * Resolves an enum to a name→value Map.
   */
  private async resolveEnumMemberMap(enumName: string, importSource: string | null, fileMap: Map<string, FileAnalysis>): Promise<Map<string, string> | undefined> {
    if (importSource !== null) {
      const normalizedPath = importSource.endsWith('.ts') ? importSource : `${importSource}.ts`;
      const analysis = await this.getFileAnalysis(normalizedPath, fileMap);
      const enumMembers = this.getEnumMembers(analysis, enumName);

      if (enumMembers !== undefined) {
        return enumMembers;
      }

      if (!importSource.endsWith('.ts')) {
        const indexPath = `${importSource}/index.ts`;
        const indexAnalysis = await this.getFileAnalysis(indexPath, fileMap);
        const indexEnumMembers = this.getEnumMembers(indexAnalysis, enumName);

        if (indexEnumMembers !== undefined) {
          return indexEnumMembers;
        }
      }
    }

    for (const analysis of fileMap.values()) {
      const enumMembers = this.getEnumMembers(analysis, enumName);

      if (enumMembers !== undefined) {
        return enumMembers;
      }
    }

    return undefined;
  }

  private getEnumMembers(
    analysis: FileAnalysis | undefined,
    enumName: string,
  ): Map<string, string> | undefined {
    const enums = analysis?.enums;

    if (enums === undefined) {
      return undefined;
    }

    if (enums instanceof Map) {
      return enums.get(enumName);
    }

    if (typeof enums === 'object' && enums !== null && enumName in enums) {
      const serializedMembers = (enums as Record<string, unknown>)[enumName];

      if (serializedMembers instanceof Map) {
        return serializedMembers;
      }

      if (typeof serializedMembers === 'object' && serializedMembers !== null) {
        return new Map(
          Object.entries(serializedMembers).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        );
      }
    }

    return undefined;
  }

  /**
   * Compiles a per-handler pipeline by eliminating dead steps.
   *
   * Splits the pipeline at `Handler` into `compiledPre` and `compiledPost`.
   * Handler itself is in neither array — core calls it directly between them.
   *
   * Elimination rules:
   * - Phase steps (in validPhases): removed when no middlewares from any scope
   * - `Guard`: removed when no merged guards (all scopes)
   * - `Validation`: removed when handler has no validations
   * - `Handler` and adapter-specific steps: always retained
   */
  private compilePipeline(
    pipeline: readonly string[] | undefined,
    validPhases: ReadonlySet<string> | undefined,
    hasMergedGuards: boolean,
    globalPhaseMiddlewares: ReadonlySet<string>,
    routePhaseMiddlewares: ReadonlySet<string>,
    validations: readonly CompiledValidationEntry[],
  ): { compiledPre: readonly string[]; compiledPost: readonly string[] } | undefined {
    if (pipeline === undefined) {
      return undefined;
    }

    const shouldRetain = (step: string): boolean => {
      if (validPhases !== undefined && validPhases.has(step)) {
        return globalPhaseMiddlewares.has(step) || routePhaseMiddlewares.has(step);
      }

      if (step === 'Guard') return hasMergedGuards;
      if (step === 'Validation') return validations.length > 0;

      return true;
    };

    const pre: string[] = [];
    const post: string[] = [];
    let reachedHandler = false;

    for (const step of pipeline) {
      if (step === 'Handler') {
        reachedHandler = true;
        continue;
      }

      if (!shouldRetain(step)) {
        continue;
      }

      if (reachedHandler) {
        post.push(step);
      } else {
        pre.push(step);
      }
    }

    return {
      compiledPre: pre,
      compiledPost: post,
    };
  }

  /**
   * Builds `CompiledValidationEntry[]` from `ctx.validated(keyRef, DtoClass)` calls
   * found in handler body. Both arguments are runtime identifiers captured by
   * the AST parser as `callArgs`. Resolves import sources from the file's import entries.
   *
   * @param typedCalls - Typed member calls found in the handler body.
   * @param importEntries - Import entries of the file containing the handler.
   * @returns Validation entries. Empty array when no matches.
   */
  private buildValidationEntries(
    typedCalls: readonly TypedCallMetadata[] | undefined,
    fileImports?: Record<string, string>,
  ): CompiledValidationEntry[] {
    if (typedCalls === undefined) {
      return [];
    }

    const result: CompiledValidationEntry[] = [];
    const seen = new Set<string>();

    for (const call of typedCalls) {
      if (call.methodName !== 'validated' || call.callArgs === undefined || call.callArgs.length < 2) {
        continue;
      }

      const keyArg = call.callArgs[0]!;
      const dtoArg = call.callArgs[1]!;

      const keyRef = keyArg.ref;
      const metatypeKey = dtoArg.ref;

      if (metatypeKey === 'never' || metatypeKey === 'any' || metatypeKey === 'unknown') {
        continue;
      }

      if (seen.has(keyRef)) {
        continue;
      }

      seen.add(keyRef);

      // Resolve import source for the context key identifier
      const keyImportSource = fileImports !== undefined ? fileImports[keyRef] : undefined;

      result.push({
        keyRef,
        ...(keyImportSource !== undefined ? { keyImportSource } : {}),
        metatypeKey,
      });
    }

    return result;
  }


  private buildAdapterStaticSchemaSet(extractions: AdapterExtraction[]): Result<Record<string, AdapterStaticSchema>, Diagnostic> {
    const sorted = [...extractions].sort((a, b) => a.adapterId.localeCompare(b.adapterId));
    const adapterStaticSchemas: Record<string, AdapterStaticSchema> = {};

    for (const entry of sorted) {
      if (Object.prototype.hasOwnProperty.call(adapterStaticSchemas, entry.adapterId)) {
        return err(buildDiagnostic({
          reason: `Duplicate adapterId detected: ${entry.adapterId}`,
        }));
      }

      adapterStaticSchemas[entry.adapterId] = entry.staticSchema;
    }

    return adapterStaticSchemas;
  }

  private buildControllerAdapterMap(
    extractions: AdapterExtraction[],
    fileMap: Map<string, FileAnalysis>,
  ): Result<Map<string, string>, Diagnostic> {
    const adapterByController = new Map<string, string>();
    const adapters = extractions.map(extraction => ({
      adapterId: extraction.adapterId,
      entryDecorators: extraction.staticSchema.entryDecorators,
    }));

    // Pre-index: controller decorator name → adapter entries that own it
    const adaptersByDecoratorName = new Map<string, typeof adapters>();

    for (const adapter of adapters) {
      const decoratorName = adapter.entryDecorators.controller;
      let list = adaptersByDecoratorName.get(decoratorName);

      if (list === undefined) {
        list = [];
        adaptersByDecoratorName.set(decoratorName, list);
      }

      list.push(adapter);
    }

    const controllerDecoratorNames = new Set(adaptersByDecoratorName.keys());

    for (const analysis of fileMap.values()) {
      for (const cls of analysis.classes) {
        const matchedDecorators = cls.decorators.filter(dec => controllerDecoratorNames.has(dec.name));

        if (matchedDecorators.length === 0) {
          continue;
        }

        // Collect all matching adapters across all controller decorators
        let controllerAdapters: typeof adapters = [];

        for (const decorator of matchedDecorators) {
          const matched = adaptersByDecoratorName.get(decorator.name);

          if (matched !== undefined) {
            controllerAdapters.push(...matched);
          }
        }

        // adapterNames constraint (ADAPTER-R-010): filter by explicit adapterNames if present
        const firstDecorator = matchedDecorators[0];

        if (firstDecorator !== undefined) {
          const adapterNames = this.extractAdapterNames(firstDecorator, extractions);
          if (isErr(adapterNames)) return adapterNames;

          if (adapterNames !== null) {
            controllerAdapters = controllerAdapters.filter(a => adapterNames.includes(a.adapterId));
          }
        }

        if (controllerAdapters.length > 1) {
          const names = controllerAdapters.map(adapter => adapter.adapterId).join(', ');

          return err(buildDiagnostic({
            reason: `Controller '${cls.className}' has multiple adapter owner decorators (${names}).`,
            file: analysis.filePath,
            symbol: cls.className,
          }));
        }

        if (controllerAdapters.length === 1) {
          const adapterEntry = controllerAdapters[0];

          if (adapterEntry) {
            adapterByController.set(cls.className, adapterEntry.adapterId);
          }
        }
      }
    }

    return adapterByController;
  }

  private extractAdapterNames(
    decorator: { name: string; arguments: readonly import('./types').AnalyzerValue[] },
    extractions: AdapterExtraction[],
  ): Result<string[] | null, Diagnostic> {
    const args = decorator.arguments;

    if (args.length === 0) {
      return null;
    }

    const arg = this.asRecord(args[0]);

    if (arg === null) {
      return null;
    }

    if (!Object.prototype.hasOwnProperty.call(arg, 'adapterNames')) {
      return null;
    }

    const adapterNames = arg.adapterNames;

    if (!Array.isArray(adapterNames)) {
      return err(buildDiagnostic({
        reason: 'adapterNames must be an array.',
      }));
    }

    if (adapterNames.length === 0) {
      return err(buildDiagnostic({
        reason: 'adapterNames must not be empty.',
      }));
    }

    const knownIds = new Set(extractions.map(e => e.adapterId));
    const validated: string[] = [];

    for (const id of adapterNames) {
      if (typeof id !== 'string') {
        return err(buildDiagnostic({
          reason: 'adapterNames elements must be string literals.',
        }));
      }

      if (!knownIds.has(id)) {
        return err(buildDiagnostic({
          reason: `Unknown adapter name '${id}' in adapterNames.`,
        }));
      }

      validated.push(id);
    }

    return validated;
  }

  private buildHandlerIndex(
    extractions: AdapterExtraction[],
    fileMap: Map<string, FileAnalysis>,
    projectRoot: string,
    controllerAdapterMap: Map<string, string>,
    graph?: AdapterResolveParams['graph'],
  ): Result<{ entries: HandlerIndexEntry[]; routeRegistrations: RouteRegistration[] }, Diagnostic> {
    const entries: HandlerIndexEntry[] = [];
    const routeRegistrations: RouteRegistration[] = [];
    const seen = new Set<string>();
    const internPool = new InternPool();

    // E-3: Pre-build set of all known class names for metatypeKey validation
    const knownClassNames = new Set<string>();

    for (const fa of fileMap.values()) {
      for (const cls of fa.classes) {
        knownClassNames.add(cls.className);
      }
    }

    for (const analysis of fileMap.values()) {
      for (const cls of analysis.classes) {
        const controllerAdapterId = controllerAdapterMap.get(cls.className);

        for (const method of cls.methods) {
          for (const extraction of extractions) {
            const handlerDecorators = extraction.staticSchema.entryDecorators.handlers;
            const hasHandlerDecorator = method.decorators.some(dec => handlerDecorators.includes(dec.name));

            if (!hasHandlerDecorator) {
              continue;
            }

            // Handler method constraints (ADAPTER-R-010)
            if (method.isStatic) {
              return err(buildDiagnostic({
                reason: `Handler '${cls.className}.${method.name}' must not be a static method.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            if (method.isComputed) {
              return err(buildDiagnostic({
                reason: `Handler '${cls.className}.${method.name}' must not use a computed property name.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            if (method.isPrivateName) {
              return err(buildDiagnostic({
                reason: `Handler '${cls.className}.${method.name}' must not be a private method.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            if (!isNonEmptyString(controllerAdapterId)) {
              return err(buildDiagnostic({
                reason: `Handler '${cls.className}.${method.name}' must belong to a controller for adapter '${extraction.adapterId}'.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            if (controllerAdapterId !== extraction.adapterId) {
              continue;
            }

            const file = this.normalizeProjectPath(projectRoot, analysis.filePath);
            const symbol = `${cls.className}.${method.name}`;
            const id = `${extraction.adapterId}:${file}#${symbol}`;

            if (seen.has(id)) {
              return err(buildDiagnostic({
                reason: `Duplicate handler id detected: ${id}`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            const matchingDecorators = method.decorators.filter(dec => handlerDecorators.includes(dec.name));

            if (matchingDecorators.length > 1) {
              return err(buildDiagnostic({
                reason: `[Zipbul AOT] Handler '${cls.className}.${method.name}' has multiple route decorators (${matchingDecorators.map(dec => '@' + dec.name).join(', ')}). Only one is allowed.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            const handlerDec = matchingDecorators[0];
            const ownerModule = graph?.classMap.get(cls.className);
            const ownerModuleName = ownerModule?.name;

            // Extract route-level pipeline decorator references
            const middlewareKeyResult = this.extractMiddlewaresDecoratorRefKeys(
              cls,
              method,
              `__route_mw__:${cls.className}.${method.name}`,
              routeRegistrations,
              0,
            );
            const allMiddlewareKeys = middlewareKeyResult.keys;
            const exceptionFilterKeyResult = this.extractDecoratorRefKeys(
              cls,
              method,
              'UseExceptionFilters',
              `__route_ef__:${cls.className}.${method.name}`,
              routeRegistrations,
            );
            const exceptionFilterKeys = exceptionFilterKeyResult.keys;
            const guardKeyResult = this.extractDecoratorRefKeys(
              cls,
              method,
              'UseGuards',
              `__route_gd__:${cls.className}.${method.name}`,
              routeRegistrations,
            );
            const guardKeys = guardKeyResult.keys;
            const globalBindingResult = this.extractGlobalPipelineBindings(
              fileMap,
              extraction.adapterId,
              routeRegistrations,
            );
            const middlewareBindings = this.combineMiddlewareBindings(
              middlewareKeyResult.bindings,
              globalBindingResult.middlewareBindings,
            );
            const guardBindings = this.combineGuardBindings(guardKeyResult.bindings, globalBindingResult.guardBindings);
            const exceptionFilterBindings = this.combineExceptionFilterBindings(
              exceptionFilterKeyResult.bindings,
              globalBindingResult.exceptionFilterBindings,
            );
            const mergedPhaseMiddlewareKeys = this.buildMergedPhaseMiddlewareKeys(middlewareBindings);
            const mergedGuardKeys = this.extractMergedBindingKeys(guardBindings);
            const mergedExceptionFilterKeys = this.extractMergedBindingKeys(exceptionFilterBindings);
            const globalPhaseMiddlewareIds = new Set(
              globalBindingResult.middlewareBindings
                .map(binding => binding.phase)
                .filter((phase): phase is string => typeof phase === 'string' && phase.length > 0),
            );
            const routePhaseMiddlewareIds = new Set(
              middlewareBindings
                .filter(binding => binding.scope !== 'global')
                .map(binding => binding.phase)
                .filter((phase): phase is string => typeof phase === 'string' && phase.length > 0),
            );
            const hasMergedGuards = mergedGuardKeys.length > 0;

            // Extract option decorators (class-level + method-level)
            const optionDecorators = extraction.staticSchema.entryDecorators.options;
            const handlerOptions = this.extractOptionDecorators(cls, method, optionDecorators);
            const params = this.extractHandlerParams(method);

            // Build validations from ctx.validated(key, Dto) calls
            const validations = this.buildValidationEntries(method.typedCalls, analysis.imports);

            // Compile pipeline — eliminate steps with no registrations
            // Currently adapterConfig is not analyzed, so global MW/guards are assumed absent.
            // When adapterConfig analysis is implemented, pass actual global registration data.
            const pipelineResult = this.compilePipeline(
              extraction.staticSchema.pipeline,
              extraction.staticSchema.validPhases,
              hasMergedGuards,
              globalPhaseMiddlewareIds,
              routePhaseMiddlewareIds,
              validations,
            );

            seen.add(id);
            entries.push({
              id,
              adapterId: extraction.adapterId,
              className: cls.className,
              ...(ownerModuleName !== undefined ? { ownerModuleName } : {}),
              methodName: method.name,
              handlerDecorator: handlerDec?.name ?? '',
              handlerDecoratorArgs: handlerDec?.arguments ?? [],
              params,
              ...(allMiddlewareKeys.length > 0 ? { middlewareKeys: allMiddlewareKeys } : {}),
              ...(exceptionFilterKeys.length > 0 ? { exceptionFilterKeys } : {}),
              ...(guardKeys.length > 0 ? { guardKeys } : {}),
              ...(Object.keys(mergedPhaseMiddlewareKeys).length > 0 ? { mergedPhaseMiddlewareKeys: internPool.intern(mergedPhaseMiddlewareKeys) } : {}),
              ...(mergedGuardKeys.length > 0 ? { mergedGuardKeys: internPool.intern(mergedGuardKeys) } : {}),
              ...(mergedExceptionFilterKeys.length > 0 ? { mergedExceptionFilterKeys: internPool.intern(mergedExceptionFilterKeys) } : {}),
              ...(middlewareBindings.length > 0 ? { middlewareBindings } : {}),
              ...(guardBindings.length > 0 ? { guardBindings } : {}),
              ...(exceptionFilterBindings.length > 0 ? { exceptionFilterBindings } : {}),
              ...(handlerOptions.length > 0 ? { options: internPool.intern(handlerOptions) } : {}),
              ...(validations.length > 0 ? { validations: internPool.intern(validations) } : {}),
              ...(pipelineResult !== undefined ? {
                compiledPre: internPool.intern(pipelineResult.compiledPre),
                compiledPost: internPool.intern(pipelineResult.compiledPost),
              } : {}),
            });
          }
        }
      }
    }

    // D-4: Warn when a controller has no handler methods registered
    for (const [controllerName, adapterId] of controllerAdapterMap) {
      const hasHandler = entries.some(
        entry => entry.className === controllerName && entry.adapterId === adapterId,
      );

      if (!hasHandler) {
        logger.warn(`[Zipbul AOT] Controller '${controllerName}' for adapter '${adapterId}' has no handler methods. Did you forget to add route decorators?`);
      }
    }

    // D-3: Detect duplicate routes (same adapter + same decorator/method + same path)
    const routeConflictCheck = this.detectRouteConflicts(entries, extractions, fileMap);
    if (isErr(routeConflictCheck)) return routeConflictCheck;

    const sorted = entries.sort((a, b) => a.id.localeCompare(b.id));

    return { entries: sorted, routeRegistrations };
  }

  /**
   * Detects route conflicts where two handlers share the same adapter, HTTP method decorator, and route path.
   * The full route path is composed of the controller prefix (from controller decorator arg) and
   * the handler path (from handler decorator arg).
   *
   * @param entries - All handler index entries.
   * @param extractions - Adapter extractions for looking up controller decorator names.
   * @param fileMap - File analysis map for resolving controller class metadata.
   * @returns void on success, or a diagnostic error if conflicts are found.
   */
  private detectRouteConflicts(
    entries: HandlerIndexEntry[],
    extractions: AdapterExtraction[],
    fileMap: Map<string, FileAnalysis>,
  ): Result<void, Diagnostic> {
    const controllerDecoratorNames = new Set(
      extractions.map(extraction => extraction.staticSchema.entryDecorators.controller),
    );

    // Pre-index: className → controller decorator prefix
    const controllerPrefixIndex = new Map<string, string>();

    for (const analysis of fileMap.values()) {
      for (const cls of analysis.classes) {
        const decorator = cls.decorators.find(dec => controllerDecoratorNames.has(dec.name));

        if (decorator === undefined) {
          continue;
        }

        const firstArg = decorator.arguments[0];
        const prefix = typeof firstArg === 'string' ? firstArg : '';

        controllerPrefixIndex.set(cls.className, prefix);
      }
    }

    const getControllerPrefix = (className: string): string => {
      return controllerPrefixIndex.get(className) ?? '';
    };

    const routeKeyToEntry = new Map<string, HandlerIndexEntry>();

    for (const entry of entries) {
      const prefix = getControllerPrefix(entry.className);
      const handlerPath = typeof entry.handlerDecoratorArgs[0] === 'string'
        ? entry.handlerDecoratorArgs[0]
        : '/';
      const fullPath = this.joinRoutePaths(prefix, handlerPath);
      const routeKey = `${entry.adapterId}:${entry.handlerDecorator}:${fullPath}`;
      const existing = routeKeyToEntry.get(routeKey);

      if (existing !== undefined) {
        return err(buildDiagnostic({
          reason: `[Zipbul AOT] Route conflict: @${entry.handlerDecorator}('${fullPath}') is defined on both '${existing.className}.${existing.methodName}' and '${entry.className}.${entry.methodName}'.`,
        }));
      }

      routeKeyToEntry.set(routeKey, entry);
    }

    return undefined;
  }

  /**
   * Joins a controller prefix and handler path into a normalized route path.
   *
   * @param prefix - Controller-level path prefix (e.g. '/users').
   * @param handlerPath - Handler-level path (e.g. '/:id').
   * @returns Combined path (e.g. '/users/:id').
   */
  private joinRoutePaths(prefix: string, handlerPath: string): string {
    const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    const normalizedHandler = handlerPath.startsWith('/') ? handlerPath : `/${handlerPath}`;

    return `${normalizedPrefix}${normalizedHandler}`;
  }

  /**
   * Collects option decorators from class-level and method-level.
   * Class-level options apply to all handlers in the controller.
   * Method-level options apply to the specific handler. Duplicates are deduplicated by name.
   *
   * @param cls - The class metadata.
   * @param method - The method metadata.
   * @param optionNames - Adapter-declared option decorator names.
   * @returns Array of option entries with name and arguments.
   */
  private extractOptionDecorators(
    cls: ClassMetadata,
    method: { decorators: readonly { name: string; arguments: readonly AnalyzerValue[] }[] },
    optionNames: readonly string[] | undefined,
  ): CompiledOptionEntry[] {
    if (optionNames === undefined || optionNames.length === 0) {
      return [];
    }

    const result: CompiledOptionEntry[] = [];
    const seen = new Set<string>();

    // Class-level first
    for (const decorator of cls.decorators) {
      if (optionNames.includes(decorator.name) && !seen.has(decorator.name)) {
        result.push({ name: decorator.name, arguments: decorator.arguments });
        seen.add(decorator.name);
      }
    }

    // Method-level overrides class-level (deduplicate by name)
    for (const decorator of method.decorators) {
      if (optionNames.includes(decorator.name)) {
        if (seen.has(decorator.name)) {
          // Method-level overrides class-level
          const index = result.findIndex(entry => entry.name === decorator.name);
          if (index !== -1) {
            result[index] = { name: decorator.name, arguments: decorator.arguments };
          }
        } else {
          result.push({ name: decorator.name, arguments: decorator.arguments });
          seen.add(decorator.name);
        }
      }
    }

    return result;
  }

  private extractHandlerParams(
    method: ClassMetadata['methods'][number],
  ): HandlerIndexEntry['params'] {
    const parameters = method.parameters ?? [];

    return parameters.map(param => {
      const primaryDecorator = param.decorators[0];
      const firstTypeArg = param.typeArgs?.[0];

      return {
        name: param.name,
        ...(primaryDecorator !== undefined ? { decoratorName: primaryDecorator.name } : {}),
        ...(primaryDecorator !== undefined ? { decoratorArgs: primaryDecorator.arguments } : {}),
        ...(typeof firstTypeArg === 'string' && firstTypeArg.length > 0 ? { metatypeKey: firstTypeArg } : {}),
      };
    });
  }

  /**
   * Extracts decorator argument references from class-level and method-level decorators,
   * generating deterministic container keys and route registrations for each reference.
   *
   * Class-level decorators are placed first (pipeline order), method-level after.
   *
   * @param cls - The class metadata.
   * @param method - The method metadata.
   * @param decoratorName - The decorator name to search for (e.g. 'UseMiddlewares').
   * @param keyPrefix - Prefix for generated container keys.
   * @param registrations - Accumulator for route-level container registrations.
   * @returns Array of deterministic container keys.
   */
  private extractDecoratorRefKeys(
    cls: ClassMetadata,
    method: { decorators: readonly { name: string; arguments: readonly AnalyzerValue[] }[] },
    decoratorName: string,
    keyPrefix: string,
    registrations: RouteRegistration[],
  ): DecoratorKeyExtraction {
    const keys: string[] = [];
    const bindings: CompiledPipelineBindingEntry[] = [];
    let index = 0;

    // Class-level first (applies to all handlers in this controller)
    for (const decorator of cls.decorators) {
      if (decorator.name !== decoratorName) {
        continue;
      }

      for (const arg of decorator.arguments) {
        if (isUnresolvable(arg)) {
          throw new Error(`[Zipbul AOT] @${decoratorName} on '${cls.className}': decorator argument must be a statically resolvable identifier. Found: ${arg.nodeType} expression.`);
        }

        const record = this.asRecord(arg);
        const ref = record !== null ? record[ZIPBUL_REF] : undefined;

        if (typeof ref === 'string' && ref.length > 0) {
          const key = `${keyPrefix}:cls:${index}`;

          keys.push(key);
          registrations.push({ key, value: arg, kind: 'ref' });
          bindings.push({ key, scope: 'controller', order: index });
          index++;
        }
      }
    }

    // Method-level second
    for (const decorator of method.decorators) {
      if (decorator.name !== decoratorName) {
        continue;
      }

      for (const arg of decorator.arguments) {
        if (isUnresolvable(arg)) {
          throw new Error(`[Zipbul AOT] @${decoratorName} on '${cls.className}': decorator argument must be a statically resolvable identifier. Found: ${arg.nodeType} expression.`);
        }

        const record = this.asRecord(arg);
        const ref = record !== null ? record[ZIPBUL_REF] : undefined;

        if (typeof ref === 'string' && ref.length > 0) {
          const key = `${keyPrefix}:mtd:${index}`;

          keys.push(key);
          registrations.push({ key, value: arg, kind: 'ref' });
          bindings.push({ key, scope: 'handler', order: index });
          index++;
        }
      }
    }

    return { keys, bindings };
  }

  /**
   * Extracts middleware refs from `@UseMiddlewares` phase-aware decorator.
   *
   * Handles both forms:
   * - `@UseMiddlewares('OnReceive', [mw1, mw2])` — positional
   * - `@UseMiddlewares({ OnReceive: [mw1] })` — object map
   *
   * @param cls - The class metadata.
   * @param method - The method metadata.
   * @param keyPrefix - Prefix for generated container keys.
   * @param registrations - Accumulator for route-level container registrations.
   * @param startIndex - Starting index for key generation (to avoid collision with UseMiddlewares keys).
   * @returns Array of deterministic container keys.
   */
  private extractMiddlewaresDecoratorRefKeys(
    cls: ClassMetadata,
    method: { decorators: readonly { name: string; arguments: readonly AnalyzerValue[] }[] },
    keyPrefix: string,
    registrations: RouteRegistration[],
    startIndex: number,
  ): MiddlewareDecoratorKeyExtraction {
    const keys: string[] = [];
    const bindings: CompiledMiddlewareBindingEntry[] = [];
    let index = startIndex;

    const extractFromDecorator = (decorator: { arguments: readonly AnalyzerValue[] }, scope: 'cls' | 'mtd'): void => {
      const args = decorator.arguments;

      if (args.length === 2) {
        // Positional: @UseMiddlewares('OnReceive', [mw1, mw2])
        const refsArray = isAnalyzerValueArray(args[1]) ? args[1] : null;

        if (refsArray === null) {
          return;
        }

        for (const ref of refsArray) {
          const record = this.asRecord(ref);
          const refName = record !== null ? record[ZIPBUL_REF] : undefined;

          if (typeof refName === 'string' && refName.length > 0) {
            const key = `${keyPrefix}:${scope}:${index}`;
            const bindingScope: CompiledPipelineScope = scope === 'cls' ? 'controller' : 'handler';
            const phaseArg = args[0];
            const phase = typeof phaseArg === 'string' ? phaseArg : undefined;

            keys.push(key);
            registrations.push({ key, value: ref, kind: 'ref' });
            bindings.push({ key, scope: bindingScope, order: index, ...(phase !== undefined ? { phase } : {}) });
            index++;
          }
        }

        return;
      }

      if (args.length === 1) {
        // Object map: @UseMiddlewares({ OnReceive: [mw1] })
        const mapping = this.asRecord(args[0]);

        if (mapping === null) {
          return;
        }

        for (const phaseKey of Object.keys(mapping)) {
          if (phaseKey.startsWith(ZIPBUL_COMPUTED_PREFIX) || phaseKey.startsWith('__zipbul')) {
            continue;
          }

          const phaseRefs = isAnalyzerValueArray(mapping[phaseKey]) ? mapping[phaseKey] : null;

          if (phaseRefs === null) {
            continue;
          }

          for (const ref of phaseRefs) {
            const record = this.asRecord(ref);
            const refName = record !== null ? record[ZIPBUL_REF] : undefined;

            if (typeof refName === 'string' && refName.length > 0) {
              const key = `${keyPrefix}:${scope}:${index}`;
              const bindingScope: CompiledPipelineScope = scope === 'cls' ? 'controller' : 'handler';

              keys.push(key);
              registrations.push({ key, value: ref, kind: 'ref' });
              bindings.push({ key, scope: bindingScope, order: index, phase: phaseKey });
              index++;
            }
          }
        }
      }
    };

    // Class-level first
    for (const decorator of cls.decorators) {
      if (decorator.name !== 'UseMiddlewares') {
        continue;
      }

      extractFromDecorator(decorator, 'cls');
    }

    // Method-level second
    for (const decorator of method.decorators) {
      if (decorator.name !== 'UseMiddlewares') {
        continue;
      }

      extractFromDecorator(decorator, 'mtd');
    }

    return { keys, bindings };
  }

  private extractGlobalPipelineBindings(
    fileMap: Map<string, FileAnalysis>,
    adapterId: string,
    registrations: RouteRegistration[],
  ): {
    middlewareBindings: CompiledMiddlewareBindingEntry[];
    guardBindings: CompiledPipelineBindingEntry[];
    exceptionFilterBindings: CompiledPipelineBindingEntry[];
  } {
    const middlewareBindings: CompiledMiddlewareBindingEntry[] = [];
    const guardBindings: CompiledPipelineBindingEntry[] = [];
    const exceptionFilterBindings: CompiledPipelineBindingEntry[] = [];

    const analyses = [...fileMap.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));

    for (const analysis of analyses) {
      const moduleName = analysis.moduleDefinition?.name;
      const adaptersValue = analysis.moduleDefinition?.adapters;
      const adaptersArray = isAnalyzerValueArray(adaptersValue) ? adaptersValue : null;

      if (moduleName === undefined || adaptersArray === null) {
        continue;
      }

      for (const adapterNode of adaptersArray) {
        const itemRecord = this.asRecord(adapterNode);

        if (itemRecord === null) {
          continue;
        }

        const adapterRef = this.asRecord(itemRecord.adapter);
        const adapterClassName = typeof adapterRef?.[ZIPBUL_REF] === 'string' ? adapterRef[ZIPBUL_REF] : null;

        if (adapterClassName !== adapterId) {
          continue;
        }

        let middlewareIndex = middlewareBindings.length;
        const middlewares = this.asRecord(itemRecord.middlewares);

        if (middlewares !== null) {
          for (const phase of Object.keys(middlewares)) {
            if (phase.startsWith(ZIPBUL_COMPUTED_PREFIX) || phase.startsWith('__zipbul')) {
              continue;
            }

            const refs = isAnalyzerValueArray(middlewares[phase]) ? middlewares[phase] : null;

            if (refs === null) {
              continue;
            }

            for (const ref of refs) {
              const record = this.asRecord(ref);
              const refName = record !== null ? record[ZIPBUL_REF] : undefined;

              if (typeof refName !== 'string' || refName.length === 0) {
                continue;
              }

              const key = `__global_mw__:${moduleName}:${adapterId}:${phase}:${middlewareIndex}`;

              registrations.push({ key, value: ref, kind: 'ref' });
              middlewareBindings.push({ key, scope: 'global', order: middlewareIndex, phase });
              middlewareIndex++;
            }
          }
        }

        let guardIndex = guardBindings.length;
        const guards = isAnalyzerValueArray(itemRecord.guards) ? itemRecord.guards : null;

        if (guards !== null) {
          for (const ref of guards) {
            const record = this.asRecord(ref);
            const refName = record !== null ? record[ZIPBUL_REF] : undefined;

            if (typeof refName !== 'string' || refName.length === 0) {
              continue;
            }

            const key = `__global_gd__:${moduleName}:${adapterId}:${guardIndex}`;

            registrations.push({ key, value: ref, kind: 'ref' });
            guardBindings.push({ key, scope: 'global', order: guardIndex });
            guardIndex++;
          }
        }

        let filterIndex = exceptionFilterBindings.length;
        const exceptionFilters = isAnalyzerValueArray(itemRecord.exceptionFilters) ? itemRecord.exceptionFilters : null;

        if (exceptionFilters !== null) {
          for (const ref of exceptionFilters) {
            const record = this.asRecord(ref);
            const refName = record !== null ? record[ZIPBUL_REF] : undefined;

            if (typeof refName !== 'string' || refName.length === 0) {
              continue;
            }

            const key = `__global_ef__:${moduleName}:${adapterId}:${filterIndex}`;

            registrations.push({ key, value: ref, kind: 'ref' });
            exceptionFilterBindings.push({ key, scope: 'global', order: filterIndex });
            filterIndex++;
          }
        }
      }
    }

    return { middlewareBindings, guardBindings, exceptionFilterBindings };
  }

  private combineMiddlewareBindings(
    ...parts: (readonly CompiledMiddlewareBindingEntry[] | undefined)[]
  ): CompiledMiddlewareBindingEntry[] {
    return this.reindexBindings(parts.flatMap(part => part ?? []), 'global-first');
  }

  private combineGuardBindings(
    ...parts: (readonly CompiledPipelineBindingEntry[] | undefined)[]
  ): CompiledPipelineBindingEntry[] {
    return this.reindexBindings(parts.flatMap(part => part ?? []), 'global-first');
  }

  private combineExceptionFilterBindings(
    ...parts: (readonly CompiledPipelineBindingEntry[] | undefined)[]
  ): CompiledPipelineBindingEntry[] {
    return this.reindexBindings(parts.flatMap(part => part ?? []), 'handler-first');
  }

  private reindexBindings<T extends { key: string; scope: CompiledPipelineScope; order: number }>(
    bindings: readonly T[],
    scopeDirection: 'global-first' | 'handler-first' = 'handler-first',
  ): T[] {
    return [...bindings]
      .sort((left, right) => {
        const leftRank = this.getScopeRank(left.scope);
        const rightRank = this.getScopeRank(right.scope);
        const scopeDiff = scopeDirection === 'global-first'
          ? rightRank - leftRank
          : leftRank - rightRank;

        if (scopeDiff !== 0) {
          return scopeDiff;
        }

        return left.order - right.order;
      })
      .map((binding, index) => ({ ...binding, order: index }));
  }

  private buildMergedPhaseMiddlewareKeys(
    bindings: readonly CompiledMiddlewareBindingEntry[],
  ): Record<string, readonly string[]> {
    const grouped = new Map<string, string[]>();

    for (const binding of bindings) {
      if (binding.phase === undefined) {
        continue;
      }

      const bucket = grouped.get(binding.phase);

      if (bucket === undefined) {
        grouped.set(binding.phase, [binding.key]);
        continue;
      }

      bucket.push(binding.key);
    }

    return Object.freeze(
      Object.fromEntries(
        Array.from(grouped.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([phase, keys]) => [phase, Object.freeze([...keys])] as const),
      ),
    );
  }

  private extractMergedBindingKeys(
    bindings: readonly CompiledPipelineBindingEntry[],
  ): readonly string[] {
    return Object.freeze(bindings.map(binding => binding.key));
  }

  private getScopeRank(scope: CompiledPipelineScope): number {
    switch (scope) {
      case 'handler':
        return 0;
      case 'controller':
        return 1;
      case 'module':
        return 2;
      case 'global':
        return 3;
      default:
        return Number.MAX_SAFE_INTEGER;
    }
  }

  private validateMiddlewarePhaseInputs(
    extractions: AdapterExtraction[],
    fileMap: Map<string, FileAnalysis>,
    controllerAdapterMap: Map<string, string>,
  ): Result<void, Diagnostic> {
    for (const extraction of extractions) {
      const validPhases = extraction.staticSchema.validPhases;

      if (validPhases === undefined) {
        return err(buildDiagnostic({
          reason: `Adapter '${extraction.adapterId}' does not declare validPhases. All adapters must declare static readonly validPhases: ReadonlySet<string>.`,
        }));
      }

      const modulePhaseIds = this.collectModuleMiddlewarePhaseIds(fileMap, extraction.adapterId);
      if (isErr(modulePhaseIds)) return modulePhaseIds;

      const decoratorPhaseIds = this.collectDecoratorPhaseIds(
        fileMap,
        extraction.adapterId,
        extraction.staticSchema.entryDecorators,
        controllerAdapterMap,
      );
      if (isErr(decoratorPhaseIds)) return decoratorPhaseIds;

      const combinedPhaseIds = [...modulePhaseIds, ...decoratorPhaseIds];

      for (const phaseId of combinedPhaseIds) {
        if (!validPhases.has(phaseId)) {
          return err(buildDiagnostic({
            reason: `Unsupported middleware phase '${phaseId}' for adapter '${extraction.adapterId}'. Valid phases: ${[...validPhases].join(', ')}.`,
          }));
        }
      }
    }

    return undefined;
  }

  private collectModuleMiddlewarePhaseIds(fileMap: Map<string, FileAnalysis>, adapterId: string): Result<string[], Diagnostic> {
    const phaseIds: string[] = [];

    for (const analysis of fileMap.values()) {
      const moduleDefinition = analysis.moduleDefinition;

      if (moduleDefinition?.adapters === undefined) {
        continue;
      }

      const adaptersArray = isAnalyzerValueArray(moduleDefinition.adapters) ? moduleDefinition.adapters : null;

      if (adaptersArray === null) {
        continue;
      }

      for (const adapterNode of adaptersArray) {
        const itemRecord = this.asRecord(adapterNode);

        if (itemRecord === null) {
          continue;
        }

        const adapterRef = this.asRecord(itemRecord.adapter);
        const adapterClassName = typeof adapterRef?.[ZIPBUL_REF] === 'string' ? adapterRef[ZIPBUL_REF] : null;

        if (adapterClassName !== adapterId) {
          continue;
        }

        if (!Object.prototype.hasOwnProperty.call(itemRecord, 'middlewares')) {
          continue;
        }

        const middlewares = this.asRecord(itemRecord.middlewares);

        if (middlewares === null) {
          return err(buildDiagnostic({
            reason: `middlewares must be an object literal for '${adapterId}'.`,
            file: analysis.filePath,
          }));
        }

        for (const key of Object.keys(middlewares)) {
          if (key.startsWith(ZIPBUL_COMPUTED_PREFIX)) {
            return err(buildDiagnostic({
              reason: `Middleware phase keys must be string literals for '${adapterId}'.`,
              file: analysis.filePath,
              symbol: adapterId,
            }));
          }

          if (key.length === 0) {
            return err(buildDiagnostic({
              reason: `Middleware phase keys must be non-empty for '${adapterId}'.`,
              file: analysis.filePath,
              symbol: adapterId,
            }));
          }

          const phaseIdCheck = this.assertValidPhaseId(key, adapterId, 'middlewares');
          if (isErr(phaseIdCheck)) return phaseIdCheck;

          phaseIds.push(key);
        }
      }
    }

    return phaseIds;
  }

  private collectDecoratorPhaseIds(
    fileMap: Map<string, FileAnalysis>,
    adapterId: string,
    entryDecorators: AdapterEntryDecoratorsSchema,
    controllerAdapterMap: Map<string, string>,
  ): Result<string[], Diagnostic> {
    const phaseIds: string[] = [];

    for (const analysis of fileMap.values()) {
      for (const cls of analysis.classes) {
        const controllerAdapterId = controllerAdapterMap.get(cls.className);
        const isAdapterController = controllerAdapterId === adapterId;

        if (isAdapterController) {
          for (const decorator of cls.decorators) {
            if (decorator.name !== 'UseMiddlewares') {
              continue;
            }

            const extracted = this.extractPhaseIdsFromDecorator(decorator, adapterId);
            if (isErr(extracted)) return extracted;

            phaseIds.push(...extracted);
          }
        }

        for (const method of cls.methods) {
          const hasHandlerDecorator = method.decorators.some(dec => entryDecorators.handlers.includes(dec.name));

          if (!hasHandlerDecorator) {
            continue;
          }

          if (!isAdapterController) {
            if (!isNonEmptyString(controllerAdapterId)) {
              return err(buildDiagnostic({
                reason: `@UseMiddlewares handlers '${cls.className}.${method.name}' must belong to adapter '${adapterId}'.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            continue;
          }

          for (const decorator of method.decorators) {
            if (decorator.name !== 'UseMiddlewares') {
              continue;
            }

            const extracted = this.extractPhaseIdsFromDecorator(decorator, adapterId);
            if (isErr(extracted)) return extracted;

            phaseIds.push(...extracted);
          }
        }
      }
    }

    return phaseIds;
  }

  private extractPhaseIdsFromDecorator(decorator: DecoratorArguments, adapterId: string): Result<string[], Diagnostic> {
    const args = decorator.arguments;

    if (args.length === 2) {
      const phaseId = typeof args[0] === 'string' ? args[0] : null;

      if (!isNonEmptyString(phaseId)) {
        return err(buildDiagnostic({
          reason: `@UseMiddlewares phaseId must be a string literal for '${adapterId}'.`,
        }));
      }

      const phaseIdCheck = this.assertValidPhaseId(phaseId, adapterId, '@UseMiddlewares');
      if (isErr(phaseIdCheck)) return phaseIdCheck;

      return [phaseId];
    }

    if (args.length === 1) {
      const mapping = this.asRecord(args[0]);

      if (mapping === null) {
        return err(buildDiagnostic({
          reason: `@UseMiddlewares map must be an object literal for '${adapterId}'.`,
        }));
      }

      const keys: string[] = [];

      for (const key of Object.keys(mapping)) {
        if (key.startsWith(ZIPBUL_COMPUTED_PREFIX)) {
          return err(buildDiagnostic({
            reason: `@UseMiddlewares phaseId must be a string literal for '${adapterId}'.`,
          }));
        }

        if (key.length === 0) {
          return err(buildDiagnostic({
            reason: `@UseMiddlewares phaseId must be non-empty for '${adapterId}'.`,
          }));
        }

        const phaseIdCheck = this.assertValidPhaseId(key, adapterId, '@UseMiddlewares');
        if (isErr(phaseIdCheck)) return phaseIdCheck;

        keys.push(key);
      }

      return keys;
    }

    return err(buildDiagnostic({
      reason: `@UseMiddlewares expects (phaseId, refs) or ({ [phaseId]: refs }) for '${adapterId}'.`,
    }));
  }

  private normalizeProjectPath(projectRoot: string, filePath: string): string {
    if (!filePath.startsWith(projectRoot)) {
      return PathResolver.normalize(filePath);
    }

    const trimmed = filePath.slice(projectRoot.length);

    if (trimmed.startsWith('/')) {
      return PathResolver.normalize(trimmed.slice(1));
    }

    return PathResolver.normalize(trimmed || '.');
  }

  private asRecord(value: AnalyzerValue | undefined): AnalyzerValueRecord | null {
    if (value === undefined || !isRecordValue(value)) {
      return null;
    }

    return value;
  }

  private assertValidPhaseId(phaseId: string, context: string, field: string): Result<void, Diagnostic> {
    if (phaseId.length === 0) {
      return err(buildDiagnostic({
        reason: `${field} phase id must be non-empty (${context}).`,
      }));
    }

    if (phaseId.includes(':')) {
      return err(buildDiagnostic({
        reason: `${field} phase id must not contain ':' (${context}).`,
      }));
    }

    return undefined;
  }
}
