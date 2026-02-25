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
import type { AnalyzerValue, AnalyzerValueRecord, DecoratorArguments } from './types';
import type { Result } from '@zipbul/result';
import type { Diagnostic } from '../../diagnostics';

import { err, isErr } from '@zipbul/result';
import { buildDiagnostic } from '../../diagnostics';
import { PathResolver } from '../../common';
import { AstParser } from './ast-parser';

const isRecordValue = (value: AnalyzerValue): value is AnalyzerValueRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isAnalyzerValueArray = (value: AnalyzerValue): value is AnalyzerValue[] => {
  return Array.isArray(value);
};

const isNonEmptyString = (value: string | null | undefined): value is string => {
  return typeof value === 'string' && value.length > 0;
};

const RESERVED_MAP: Record<string, string> = {
  'ReservedPipeline.Guards': 'Guards',
  'ReservedPipeline.Pipes': 'Pipes',
  'ReservedPipeline.Handler': 'Handler',
};

export class AdapterSpecResolver {
  private parser = new AstParser();

  async resolve(params: AdapterSpecResolveParams): Promise<Result<AdapterSpecResolution, Diagnostic>> {
    const { fileMap, projectRoot } = params;
    const entryFiles = this.collectPackageEntryFiles(fileMap);
    const adapterSpecs: AdapterSpecExtraction[] = [];

    for (const entryFile of entryFiles) {
      const resolvedExport = await this.resolveAdapterSpecExport(entryFile, fileMap, new Set());

      if (resolvedExport === null) {
        continue;
      }

      const defineCall = this.asRecord(resolvedExport.value);

      if (defineCall?.__zipbul_call !== 'defineAdapter') {
        return err(buildDiagnostic({
          severity: 'error',
          reason: `adapterSpec must be defineAdapter({ name, classRef, pipeline, ... }) in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const args = isAnalyzerValueArray(defineCall.args) ? defineCall.args : [];

      if (args.length !== 1) {
        return err(buildDiagnostic({
          severity: 'error',
          reason: `defineAdapter requires exactly one argument in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const arg = this.asRecord(args[0]);

      if (arg === null) {
        return err(buildDiagnostic({
          severity: 'error',
          reason: `defineAdapter argument must be an object literal in ${resolvedExport.sourceFile}.`,
          file: resolvedExport.sourceFile,
        }));
      }

      const extraction = this.extractFromObjectLiteral(arg, resolvedExport.sourceFile);
      if (isErr(extraction)) return extraction;

      adapterSpecs.push({ adapterId: extraction.adapterId, staticSpec: extraction.staticSpec });
    }

    if (adapterSpecs.length === 0) {
      return err(buildDiagnostic({
        severity: 'error',
        reason: 'No adapterSpec exports found in adapter package entry files.',
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

    return null;
  }

  private async resolveAdapterSpecExport(
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

    if (Object.prototype.hasOwnProperty.call(exportedValues, 'adapterSpec')) {
      return { value: exportedValues.adapterSpec, sourceFile: filePath };
    }

    const reExports = analysis.reExports ?? [];

    for (const entry of reExports) {
      if (entry.exportAll) {
        const result = await this.resolveAdapterSpecExport(entry.module, fileMap, visited);

        if (result) {
          return result;
        }

        continue;
      }

      const names = entry.names ?? [];

      for (const nameEntry of names) {
        if (nameEntry.exported === 'adapterSpec') {
          const result = await this.resolveAdapterSpecExport(entry.module, fileMap, visited);

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

    if (!(await Bun.file(filePath).exists())) {
      return null;
    }

    const fileContent = await Bun.file(filePath).text();
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

    fileMap.set(filePath, analysis);

    return analysis;
  }

  private extractFromObjectLiteral(arg: AnalyzerValueRecord, sourceFile: string): Result<AdapterStaticSpecResult, Diagnostic> {
    const adapterId = arg.name;

    if (typeof adapterId !== 'string' || adapterId.length === 0) {
      return err(buildDiagnostic({
        severity: 'error',
        reason: `defineAdapter.name must be a non-empty string in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const pipelineRaw = arg.pipeline;

    if (!Array.isArray(pipelineRaw)) {
      return err(buildDiagnostic({
        severity: 'error',
        reason: `defineAdapter.pipeline must be an array in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const pipeline: string[] = [];

    for (const token of pipelineRaw) {
      if (typeof token === 'string') {
        pipeline.push(token);
      } else if (isRecordValue(token) && typeof token.__zipbul_ref === 'string') {
        const resolved = RESERVED_MAP[token.__zipbul_ref] ?? token.__zipbul_ref;

        pipeline.push(resolved);
      } else {
        return err(buildDiagnostic({
          severity: 'error',
          reason: `defineAdapter.pipeline elements must be strings or enum references in ${sourceFile}.`,
          file: sourceFile,
        }));
      }
    }

    const decsRaw = this.asRecord(arg.decorators);

    if (decsRaw === null) {
      return err(buildDiagnostic({
        severity: 'error',
        reason: `defineAdapter.decorators must be an object in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const controllerRaw = this.asRecord(decsRaw.controller);

    if (controllerRaw === null || typeof controllerRaw.__zipbul_ref !== 'string') {
      return err(buildDiagnostic({
        severity: 'error',
        reason: `defineAdapter.decorators.controller must be an Identifier in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const controller = controllerRaw.__zipbul_ref;
    const handlerRaw = decsRaw.handler;

    if (!Array.isArray(handlerRaw) || handlerRaw.length === 0) {
      return err(buildDiagnostic({
        severity: 'error',
        reason: `defineAdapter.decorators.handler must be a non-empty Identifier array in ${sourceFile}.`,
        file: sourceFile,
      }));
    }

    const handler: string[] = [];

    for (const item of handlerRaw) {
      const rec = this.asRecord(item);

      if (rec === null || typeof rec.__zipbul_ref !== 'string') {
        return err(buildDiagnostic({
          severity: 'error',
          reason: `defineAdapter.decorators.handler elements must be Identifiers in ${sourceFile}.`,
          file: sourceFile,
        }));
      }

      handler.push(rec.__zipbul_ref);
    }

    const entryDecorators: AdapterEntryDecoratorsSpec = { controller, handler };

    const pipelineCheck = this.validatePipelineConsistency(pipeline, sourceFile);
    if (isErr(pipelineCheck)) return pipelineCheck;

    return {
      adapterId,
      staticSpec: {
        pipeline,
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
          severity: 'error',
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
            severity: 'error',
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
        severity: 'error',
        reason: 'adapterIds must be an array.',
      }));
    }

    if (adapterIds.length === 0) {
      return err(buildDiagnostic({
        severity: 'error',
        reason: 'adapterIds must not be empty.',
      }));
    }

    const knownIds = new Set(extractions.map(e => e.adapterId));

    for (const id of adapterIds) {
      if (typeof id !== 'string') {
        return err(buildDiagnostic({
          severity: 'error',
          reason: 'adapterIds elements must be string literals.',
        }));
      }

      if (!knownIds.has(id)) {
        return err(buildDiagnostic({
          severity: 'error',
          reason: `Unknown adapterId '${id}' in adapterIds.`,
        }));
      }
    }

    return adapterIds as string[];
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
                severity: 'error',
                reason: `Handler '${cls.className}.${method.name}' must not be a static method.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            if (method.isComputed) {
              return err(buildDiagnostic({
                severity: 'error',
                reason: `Handler '${cls.className}.${method.name}' must not use a computed property name.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            if (method.isPrivateName) {
              return err(buildDiagnostic({
                severity: 'error',
                reason: `Handler '${cls.className}.${method.name}' must not be a private method.`,
                file: analysis.filePath,
                symbol: `${cls.className}.${method.name}`,
              }));
            }

            if (!isNonEmptyString(controllerAdapterId)) {
              return err(buildDiagnostic({
                severity: 'error',
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
                severity: 'error',
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
      const supported = this.deriveSupportedPhases(extraction.staticSpec.pipeline);

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
        if (!supported.has(phaseId)) {
          return err(buildDiagnostic({
            severity: 'error',
            reason: `Unsupported middleware phase '${phaseId}' for adapter '${extraction.adapterId}'.`,
          }));
        }
      }
    }
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
          severity: 'error',
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
          severity: 'error',
          reason: `middlewares must be an object literal for '${adapterId}'.`,
          file: analysis.filePath,
        }));
      }

      for (const key of Object.keys(middlewares)) {
        if (key.startsWith('__zipbul_computed_')) {
          return err(buildDiagnostic({
            severity: 'error',
            reason: `Middleware phase keys must be string literals for '${adapterId}'.`,
            file: analysis.filePath,
            symbol: adapterId,
          }));
        }

        if (key.length === 0) {
          return err(buildDiagnostic({
            severity: 'error',
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
                severity: 'error',
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
          severity: 'error',
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
          severity: 'error',
          reason: `@Middlewares map must be an object literal for '${adapterId}'.`,
        }));
      }

      const keys: string[] = [];

      for (const key of Object.keys(mapping)) {
        if (key.startsWith('__zipbul_computed_')) {
          return err(buildDiagnostic({
            severity: 'error',
            reason: `@Middlewares phaseId must be a string literal for '${adapterId}'.`,
          }));
        }

        if (key.length === 0) {
          return err(buildDiagnostic({
            severity: 'error',
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
      severity: 'error',
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

  private validatePipelineConsistency(pipeline: string[], context: string): Result<void, Diagnostic> {
    const RESERVED = new Set(['Guards', 'Pipes', 'Handler']);

    for (const reserved of RESERVED) {
      const count = pipeline.filter(t => t === reserved).length;

      if (count !== 1) {
        return err(buildDiagnostic({
          severity: 'error',
          reason: `pipeline must contain '${reserved}' exactly once (${context}).`,
          file: context,
        }));
      }
    }

    const customPhases = pipeline.filter(t => !RESERVED.has(t));
    const seen = new Set<string>();

    for (const phase of customPhases) {
      if (seen.has(phase)) {
        return err(buildDiagnostic({
          severity: 'error',
          reason: `pipeline must not contain duplicate middleware phase '${phase}' (${context}).`,
          file: context,
        }));
      }

      const phaseIdCheck = this.assertValidPhaseId(phase, context, 'defineAdapter.pipeline');
      if (isErr(phaseIdCheck)) return phaseIdCheck;

      seen.add(phase);
    }
  }

  private deriveSupportedPhases(pipeline: string[]): Set<string> {
    const RESERVED = new Set(['Guards', 'Pipes', 'Handler']);

    return new Set(pipeline.filter(t => !RESERVED.has(t)));
  }

  private asRecord(value: AnalyzerValue | undefined): AnalyzerValueRecord | null {
    if (value === undefined || !isRecordValue(value)) {
      return null;
    }

    return value;
  }

  private getString(node: AnalyzerValueRecord, key: string): string | null {
    const value = node[key];

    if (typeof value === 'string') {
      return value;
    }

    return null;
  }

  private assertValidPhaseId(phaseId: string, context: string, field: string): Result<void, Diagnostic> {
    if (phaseId.length === 0) {
      return err(buildDiagnostic({
        severity: 'error',
        reason: `${field} phase id must be non-empty (${context}).`,
      }));
    }

    if (phaseId.includes(':')) {
      return err(buildDiagnostic({
        severity: 'error',
        reason: `${field} phase id must not contain ':' (${context}).`,
      }));
    }
  }
}
