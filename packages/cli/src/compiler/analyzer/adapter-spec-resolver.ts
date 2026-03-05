import type { AdapterSpecResolveParams, FileAnalysis } from './graph/interfaces';
import type {
  AdapterSpecExtraction,
  AdapterSpecExportResolution,
  AdapterSpecResolution,
  AdapterStaticSpecResult,
  AdapterStaticSpec,
  AdapterEntryDecoratorsSpec,
  HandlerIndexEntry,
} from './interfaces';
import type { ClassMetadata } from './interfaces';
import type { AnalyzerValue, AnalyzerValueRecord, DecoratorArguments } from './types';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../diagnostics';

import { err, isErr } from '@zipbul/result';
import { MiddlewareHook } from '@zipbul/common';
import { Logger } from '@zipbul/logger';
import { buildDiagnostic } from '../../diagnostics';
import { PathResolver } from '../../common';
import { AstParser } from './ast-parser';

const logger = new Logger('AdapterSpecResolver');

const VALID_HOOKS = new Set<string>(Object.values(MiddlewareHook));

const isRecordValue = (value: AnalyzerValue): value is AnalyzerValueRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isAnalyzerValueArray = (value: AnalyzerValue): value is AnalyzerValue[] => {
  return Array.isArray(value);
};

const isNonEmptyString = (value: string | null | undefined): value is string => {
  return typeof value === 'string' && value.length > 0;
};

export class AdapterSpecResolver {
  private parser = new AstParser();

  async resolve(params: AdapterSpecResolveParams): Promise<Result<AdapterSpecResolution, Diagnostic>> {
    const { fileMap, projectRoot } = params;
    const entryFiles = this.collectPackageEntryFiles(fileMap);
    const adapterSpecs: AdapterSpecExtraction[] = [];

    for (const entryFile of entryFiles) {
      const resolvedExport = await this.resolveAdapterDefinitionExport(entryFile, fileMap, new Set());

      if (resolvedExport === null) {
        continue;
      }

      const defineCall = this.asRecord(resolvedExport.value);

      if (defineCall?.__zipbul_call !== 'defineAdapter') {
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

      if (arg === null || typeof arg.__zipbul_ref !== 'string') {
        return err(buildDiagnostic({
          reason: `defineAdapter argument must be a class reference in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const className = arg.__zipbul_ref;
      const importSource = typeof arg.__zipbul_import_source === 'string' ? arg.__zipbul_import_source : null;

      const classMetadata = await this.findClassMetadata(className, importSource, resolvedExport.sourceFile, fileMap);

      if (classMetadata === null) {
        return err(buildDiagnostic({
          reason: `Could not find class '${className}' referenced by defineAdapter in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const extraction = this.extractFromClassProperties(classMetadata, resolvedExport.sourceFile);
      if (isErr(extraction)) return extraction;

      adapterSpecs.push({ adapterId: extraction.adapterId, staticSpec: extraction.staticSpec });
    }

    if (adapterSpecs.length === 0) {
      return err(buildDiagnostic({
        reason: 'No adapter definition found. Export an adapterDefinition from your adapter package entry file.',
      }));
    }

    const adapterStaticSpecs = this.buildAdapterStaticSpecSet(adapterSpecs);
    if (isErr(adapterStaticSpecs)) return adapterStaticSpecs;

    const controllerAdapterMap = this.buildControllerAdapterMap(adapterSpecs, fileMap);
    if (isErr(controllerAdapterMap)) return controllerAdapterMap;

    const middlewareValidation = this.validateMiddlewarePhaseInputs(adapterSpecs, fileMap, controllerAdapterMap);
    if (isErr(middlewareValidation)) return middlewareValidation;

    const handlerIndex = this.buildHandlerIndex(adapterSpecs, fileMap, projectRoot, controllerAdapterMap);
    if (isErr(handlerIndex)) return handlerIndex;

    return { adapterStaticSpecs, handlerIndex };
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
  ): Promise<AdapterSpecExportResolution | null> {
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

  private extractFromClassProperties(classMetadata: ClassMetadata, sourceFile: string): Result<AdapterStaticSpecResult, Diagnostic> {
    const nameProperty = classMetadata.properties.find(p => p.name === 'name');
    const adapterId = nameProperty?.initializer;

    if (typeof adapterId !== 'string' || adapterId.length === 0) {
      return err(buildDiagnostic({
        reason: `Adapter class '${classMetadata.className}' must have a 'name' property with a non-empty string initializer in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const decoratorsProperty = classMetadata.properties.find(p => p.name === 'decorators');
    const decsRaw = this.asRecord(decoratorsProperty?.initializer);

    if (decsRaw === null) {
      return err(buildDiagnostic({
        reason: `Adapter class '${classMetadata.className}' must have a 'decorators' property with an object initializer in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const controllerRaw = this.asRecord(decsRaw.controller);

    if (controllerRaw === null || typeof controllerRaw.__zipbul_ref !== 'string') {
      return err(buildDiagnostic({
        reason: `Adapter class '${classMetadata.className}' decorators.controller must be an Identifier in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const controller = controllerRaw.__zipbul_ref;
    const handlerRaw = decsRaw.handler;

    if (!Array.isArray(handlerRaw) || handlerRaw.length === 0) {
      return err(buildDiagnostic({
        reason: `Adapter class '${classMetadata.className}' decorators.handler must be a non-empty Identifier array in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const handler: string[] = [];

    for (const item of handlerRaw) {
      const rec = this.asRecord(item);

      if (rec === null || typeof rec.__zipbul_ref !== 'string') {
        return err(buildDiagnostic({
          reason: `Adapter class '${classMetadata.className}' decorators.handler elements must be Identifiers in ${sourceFile}.`,
          file: sourceFile,
        }));
      }

      handler.push(rec.__zipbul_ref);
    }

    const entryDecorators: AdapterEntryDecoratorsSpec = { controller, handler };

    return {
      adapterId,
      staticSpec: {
        entryDecorators,
      },
    };
  }

  private buildAdapterStaticSpecSet(extractions: AdapterSpecExtraction[]): Result<Record<string, AdapterStaticSpec>, Diagnostic> {
    const sorted = [...extractions].sort((a, b) => a.adapterId.localeCompare(b.adapterId));
    const adapterStaticSpecs: Record<string, AdapterStaticSpec> = {};

    for (const entry of sorted) {
      if (Object.prototype.hasOwnProperty.call(adapterStaticSpecs, entry.adapterId)) {
        return err(buildDiagnostic({
          reason: `Duplicate adapterId detected: ${entry.adapterId}`,
        }));
      }

      adapterStaticSpecs[entry.adapterId] = entry.staticSpec;
    }

    return adapterStaticSpecs;
  }

  private buildControllerAdapterMap(
    extractions: AdapterSpecExtraction[],
    fileMap: Map<string, FileAnalysis>,
  ): Result<Map<string, string>, Diagnostic> {
    const adapterByController = new Map<string, string>();
    const adapters = extractions.map(extraction => ({
      adapterId: extraction.adapterId,
      entryDecorators: extraction.staticSpec.entryDecorators,
    }));

    for (const analysis of fileMap.values()) {
      for (const cls of analysis.classes) {
        let controllerAdapters = adapters.filter(adapter =>
          cls.decorators.some(dec => dec.name === adapter.entryDecorators.controller),
        );

        // adapterIds constraint (ADAPTER-R-010): filter by explicit adapterIds if present
        const controllerDecorator = cls.decorators.find(dec =>
          adapters.some(a => a.entryDecorators.controller === dec.name),
        );

        if (controllerDecorator) {
          const adapterIds = this.extractAdapterIds(controllerDecorator, extractions);
          if (isErr(adapterIds)) return adapterIds;

          if (adapterIds !== null) {
            controllerAdapters = controllerAdapters.filter(a => adapterIds.includes(a.adapterId));
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

  private extractAdapterIds(
    decorator: { name: string; arguments: readonly import('./types').AnalyzerValue[] },
    extractions: AdapterSpecExtraction[],
  ): Result<string[] | null, Diagnostic> {
    const args = decorator.arguments;

    if (args.length === 0) {
      return null;
    }

    const arg = this.asRecord(args[0]);

    if (arg === null) {
      return null;
    }

    if (!Object.prototype.hasOwnProperty.call(arg, 'adapterIds')) {
      return null;
    }

    const adapterIds = arg.adapterIds;

    if (!Array.isArray(adapterIds)) {
      return err(buildDiagnostic({
        reason: 'adapterIds must be an array.',
      }));
    }

    if (adapterIds.length === 0) {
      return err(buildDiagnostic({
        reason: 'adapterIds must not be empty.',
      }));
    }

    const knownIds = new Set(extractions.map(e => e.adapterId));
    const validated: string[] = [];

    for (const id of adapterIds) {
      if (typeof id !== 'string') {
        return err(buildDiagnostic({
          reason: 'adapterIds elements must be string literals.',
        }));
      }

      if (!knownIds.has(id)) {
        return err(buildDiagnostic({
          reason: `Unknown adapterId '${id}' in adapterIds.`,
        }));
      }

      validated.push(id);
    }

    return validated;
  }

  private buildHandlerIndex(
    extractions: AdapterSpecExtraction[],
    fileMap: Map<string, FileAnalysis>,
    projectRoot: string,
    controllerAdapterMap: Map<string, string>,
  ): Result<HandlerIndexEntry[], Diagnostic> {
    const entries: HandlerIndexEntry[] = [];
    const seen = new Set<string>();

    for (const analysis of fileMap.values()) {
      for (const cls of analysis.classes) {
        const controllerAdapterId = controllerAdapterMap.get(cls.className);

        for (const method of cls.methods) {
          for (const extraction of extractions) {
            const handlerDecorators = extraction.staticSpec.entryDecorators.handler;
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

            seen.add(id);
            entries.push({ id });
          }
        }
      }
    }

    const sorted = entries.sort((a, b) => a.id.localeCompare(b.id));

    return sorted;
  }

  private validateMiddlewarePhaseInputs(
    extractions: AdapterSpecExtraction[],
    fileMap: Map<string, FileAnalysis>,
    controllerAdapterMap: Map<string, string>,
  ): Result<void, Diagnostic> {
    for (const extraction of extractions) {
      const modulePhaseIds = this.collectModuleMiddlewarePhaseIds(fileMap, extraction.adapterId);
      if (isErr(modulePhaseIds)) return modulePhaseIds;

      const decoratorPhaseIds = this.collectDecoratorPhaseIds(
        fileMap,
        extraction.adapterId,
        extraction.staticSpec.entryDecorators,
        controllerAdapterMap,
      );
      if (isErr(decoratorPhaseIds)) return decoratorPhaseIds;

      const combinedPhaseIds = [...modulePhaseIds, ...decoratorPhaseIds];

      for (const phaseId of combinedPhaseIds) {
        if (!VALID_HOOKS.has(phaseId)) {
          return err(buildDiagnostic({
            reason: `Unsupported middleware hook '${phaseId}' for adapter '${extraction.adapterId}'. Valid hooks: ${[...VALID_HOOKS].join(', ')}.`,
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

      const adaptersRecord = this.asRecord(moduleDefinition.adapters);

      if (adaptersRecord === null) {
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(adaptersRecord, adapterId)) {
        continue;
      }

      const adapterConfig = this.asRecord(adaptersRecord[adapterId]);

      if (adapterConfig === null) {
        return err(buildDiagnostic({
          reason: `Adapter config must be an object literal for '${adapterId}'.`,
          file: analysis.filePath,
        }));
      }

      if (!Object.prototype.hasOwnProperty.call(adapterConfig, 'middlewares')) {
        continue;
      }

      const middlewares = this.asRecord(adapterConfig.middlewares);

      if (middlewares === null) {
        return err(buildDiagnostic({
          reason: `middlewares must be an object literal for '${adapterId}'.`,
          file: analysis.filePath,
        }));
      }

      for (const key of Object.keys(middlewares)) {
        if (key.startsWith('__zipbul_computed_')) {
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

    return phaseIds;
  }

  private collectDecoratorPhaseIds(
    fileMap: Map<string, FileAnalysis>,
    adapterId: string,
    entryDecorators: AdapterEntryDecoratorsSpec,
    controllerAdapterMap: Map<string, string>,
  ): Result<string[], Diagnostic> {
    const phaseIds: string[] = [];

    for (const analysis of fileMap.values()) {
      for (const cls of analysis.classes) {
        const controllerAdapterId = controllerAdapterMap.get(cls.className);
        const isAdapterController = controllerAdapterId === adapterId;

        if (isAdapterController) {
          for (const decorator of cls.decorators) {
            if (decorator.name !== 'Middlewares') {
              continue;
            }

            const extracted = this.extractPhaseIdsFromDecorator(decorator, adapterId);
            if (isErr(extracted)) return extracted;

            phaseIds.push(...extracted);
          }
        }

        for (const method of cls.methods) {
          const hasHandlerDecorator = method.decorators.some(dec => entryDecorators.handler.includes(dec.name));

          if (!hasHandlerDecorator) {
            continue;
          }

          if (!isAdapterController) {
            if (!isNonEmptyString(controllerAdapterId)) {
              return err(buildDiagnostic({
                reason: `@Middlewares handler '${cls.className}.${method.name}' must belong to adapter '${adapterId}'.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            continue;
          }

          for (const decorator of method.decorators) {
            if (decorator.name !== 'Middlewares') {
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
          reason: `@Middlewares phaseId must be a string literal for '${adapterId}'.`,
        }));
      }

      const phaseIdCheck = this.assertValidPhaseId(phaseId, adapterId, '@Middlewares');
      if (isErr(phaseIdCheck)) return phaseIdCheck;

      return [phaseId];
    }

    if (args.length === 1) {
      const mapping = this.asRecord(args[0]);

      if (mapping === null) {
        return err(buildDiagnostic({
          reason: `@Middlewares map must be an object literal for '${adapterId}'.`,
        }));
      }

      const keys: string[] = [];

      for (const key of Object.keys(mapping)) {
        if (key.startsWith('__zipbul_computed_')) {
          return err(buildDiagnostic({
            reason: `@Middlewares phaseId must be a string literal for '${adapterId}'.`,
          }));
        }

        if (key.length === 0) {
          return err(buildDiagnostic({
            reason: `@Middlewares phaseId must be non-empty for '${adapterId}'.`,
          }));
        }

        const phaseIdCheck = this.assertValidPhaseId(key, adapterId, '@Middlewares');
        if (isErr(phaseIdCheck)) return phaseIdCheck;

        keys.push(key);
      }

      return keys;
    }

    return err(buildDiagnostic({
      reason: `@Middlewares expects (phaseId, refs) or ({ [phaseId]: refs }) for '${adapterId}'.`,
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
