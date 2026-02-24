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

export class AdapterSpecResolver {
  private parser = new AstParser();

  async resolve(params: AdapterSpecResolveParams): Promise<AdapterSpecResolution> {
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
        throw new Error(`[Zipbul AOT] adapterSpec must be defineAdapter({ name, classRef, pipeline, ... }) in ${resolvedExport.sourceFile}.`);
      }

      const args = isAnalyzerValueArray(defineCall.args) ? defineCall.args : [];

      if (args.length !== 1) {
        throw new Error(`[Zipbul AOT] defineAdapter requires exactly one argument in ${resolvedExport.sourceFile}.`);
      }

      const arg = this.asRecord(args[0]);

      if (arg === null) {
        throw new Error(`[Zipbul AOT] defineAdapter argument must be an object literal in ${resolvedExport.sourceFile}.`);
      }

      const result = this.extractFromObjectLiteral(arg, resolvedExport.sourceFile);

      adapterSpecs.push({ adapterId: result.adapterId, staticSpec: result.staticSpec });
    }

    if (adapterSpecs.length === 0) {
      throw new Error('[Zipbul AOT] No adapterSpec exports found in adapter package entry files.');
    }

    const adapterStaticSpecs = this.buildAdapterStaticSpecSet(adapterSpecs);
    const controllerAdapterMap = this.buildControllerAdapterMap(adapterSpecs, fileMap);

    this.validateMiddlewarePhaseInputs(adapterSpecs, fileMap, controllerAdapterMap);

    const handlerIndex = this.buildHandlerIndex(adapterSpecs, fileMap, projectRoot, controllerAdapterMap);

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

  private extractFromObjectLiteral(arg: AnalyzerValueRecord, sourceFile: string): AdapterStaticSpecResult {
    const adapterId = arg.name;

    if (typeof adapterId !== 'string' || adapterId.length === 0) {
      throw new Error(`[Zipbul AOT] defineAdapter.name must be a non-empty string in ${sourceFile}.`);
    }

    const pipelineRaw = arg.pipeline;

    if (!Array.isArray(pipelineRaw)) {
      throw new Error(`[Zipbul AOT] defineAdapter.pipeline must be an array in ${sourceFile}.`);
    }

    const pipeline: string[] = [];

    for (const token of pipelineRaw) {
      if (typeof token !== 'string') {
        throw new Error(`[Zipbul AOT] defineAdapter.pipeline elements must be strings in ${sourceFile}.`);
      }

      pipeline.push(token);
    }

    const mpoRaw = arg.middlewarePhaseOrder;

    if (!Array.isArray(mpoRaw)) {
      throw new Error(`[Zipbul AOT] defineAdapter.middlewarePhaseOrder must be an array in ${sourceFile}.`);
    }

    const middlewarePhaseOrder: string[] = [];

    for (const phase of mpoRaw) {
      if (typeof phase !== 'string') {
        throw new Error(`[Zipbul AOT] defineAdapter.middlewarePhaseOrder elements must be strings in ${sourceFile}.`);
      }

      this.assertValidPhaseId(phase, sourceFile, 'defineAdapter.middlewarePhaseOrder');
      middlewarePhaseOrder.push(phase);
    }

    const smpRaw = this.asRecord(arg.supportedMiddlewarePhases);

    if (smpRaw === null) {
      throw new Error(`[Zipbul AOT] defineAdapter.supportedMiddlewarePhases must be an object in ${sourceFile}.`);
    }

    const supportedMiddlewarePhases: Record<string, true> = {};

    for (const [key, value] of Object.entries(smpRaw)) {
      if (value !== true) {
        throw new Error(`[Zipbul AOT] defineAdapter.supportedMiddlewarePhases values must be true in ${sourceFile}.`);
      }

      this.assertValidPhaseId(key, sourceFile, 'defineAdapter.supportedMiddlewarePhases');
      supportedMiddlewarePhases[key] = true;
    }

    const decsRaw = this.asRecord(arg.decorators);

    if (decsRaw === null) {
      throw new Error(`[Zipbul AOT] defineAdapter.decorators must be an object in ${sourceFile}.`);
    }

    const controllerRaw = this.asRecord(decsRaw.controller);

    if (controllerRaw === null || typeof controllerRaw.__zipbul_ref !== 'string') {
      throw new Error(`[Zipbul AOT] defineAdapter.decorators.controller must be an Identifier in ${sourceFile}.`);
    }

    const controller = controllerRaw.__zipbul_ref;
    const handlerRaw = decsRaw.handler;

    if (!Array.isArray(handlerRaw) || handlerRaw.length === 0) {
      throw new Error(`[Zipbul AOT] defineAdapter.decorators.handler must be a non-empty Identifier array in ${sourceFile}.`);
    }

    const handler: string[] = [];

    for (const item of handlerRaw) {
      const rec = this.asRecord(item);

      if (rec === null || typeof rec.__zipbul_ref !== 'string') {
        throw new Error(`[Zipbul AOT] defineAdapter.decorators.handler elements must be Identifiers in ${sourceFile}.`);
      }

      handler.push(rec.__zipbul_ref);
    }

    const entryDecorators: AdapterEntryDecoratorsSpec = { controller, handler };

    this.validatePhaseConsistency(middlewarePhaseOrder, supportedMiddlewarePhases, sourceFile);
    this.validatePipelineConsistency(pipeline, middlewarePhaseOrder, sourceFile);

    return {
      adapterId,
      staticSpec: {
        pipeline,
        middlewarePhaseOrder,
        supportedMiddlewarePhases,
        entryDecorators,
      },
    };
  }

  private buildAdapterStaticSpecSet(extractions: AdapterSpecExtraction[]): Record<string, AdapterStaticSpec> {
    const sorted = [...extractions].sort((a, b) => a.adapterId.localeCompare(b.adapterId));
    const adapterStaticSpecs: Record<string, AdapterStaticSpec> = {};

    for (const entry of sorted) {
      if (Object.prototype.hasOwnProperty.call(adapterStaticSpecs, entry.adapterId)) {
        throw new Error(`[Zipbul AOT] Duplicate adapterId detected: ${entry.adapterId}`);
      }

      adapterStaticSpecs[entry.adapterId] = entry.staticSpec;
    }

    return adapterStaticSpecs;
  }

  private buildControllerAdapterMap(
    extractions: AdapterSpecExtraction[],
    fileMap: Map<string, FileAnalysis>,
  ): Map<string, string> {
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

          if (adapterIds !== null) {
            controllerAdapters = controllerAdapters.filter(a => adapterIds.includes(a.adapterId));
          }
        }

        if (controllerAdapters.length > 1) {
          const names = controllerAdapters.map(adapter => adapter.adapterId).join(', ');

          throw new Error(`[Zipbul AOT] Controller '${cls.className}' has multiple adapter owner decorators (${names}).`);
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
  ): string[] | null {
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
      throw new Error('[Zipbul AOT] adapterIds must be an array.');
    }

    if (adapterIds.length === 0) {
      throw new Error('[Zipbul AOT] adapterIds must not be empty.');
    }

    const knownIds = new Set(extractions.map(e => e.adapterId));

    for (const id of adapterIds) {
      if (typeof id !== 'string') {
        throw new Error('[Zipbul AOT] adapterIds elements must be string literals.');
      }

      if (!knownIds.has(id)) {
        throw new Error(`[Zipbul AOT] Unknown adapterId '${id}' in adapterIds.`);
      }
    }

    return adapterIds as string[];
  }

  private buildHandlerIndex(
    extractions: AdapterSpecExtraction[],
    fileMap: Map<string, FileAnalysis>,
    projectRoot: string,
    controllerAdapterMap: Map<string, string>,
  ): HandlerIndexEntry[] {
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
              throw new Error(
                `[Zipbul AOT] Handler '${cls.className}.${method.name}' must not be a static method.`,
              );
            }

            if (method.isComputed) {
              throw new Error(
                `[Zipbul AOT] Handler '${cls.className}.${method.name}' must not use a computed property name.`,
              );
            }

            if (method.isPrivateName) {
              throw new Error(
                `[Zipbul AOT] Handler '${cls.className}.${method.name}' must not be a private method.`,
              );
            }

            if (!isNonEmptyString(controllerAdapterId)) {
              throw new Error(
                `[Zipbul AOT] Handler '${cls.className}.${method.name}' must belong to a controller for adapter '${extraction.adapterId}'.`,
              );
            }

            if (controllerAdapterId !== extraction.adapterId) {
              continue;
            }

            const file = this.normalizeProjectPath(projectRoot, analysis.filePath);
            const symbol = `${cls.className}.${method.name}`;
            const id = `${extraction.adapterId}:${file}#${symbol}`;

            if (seen.has(id)) {
              throw new Error(`[Zipbul AOT] Duplicate handler id detected: ${id}`);
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
  ): void {
    for (const extraction of extractions) {
      const supported = extraction.staticSpec.supportedMiddlewarePhases;
      const supportedKeys = Object.keys(supported);
      const modulePhaseIds = this.collectModuleMiddlewarePhaseIds(fileMap, extraction.adapterId);
      const decoratorPhaseIds = this.collectDecoratorPhaseIds(
        fileMap,
        extraction.adapterId,
        extraction.staticSpec.entryDecorators,
        controllerAdapterMap,
      );
      const combinedPhaseIds = [...modulePhaseIds, ...decoratorPhaseIds];

      combinedPhaseIds.forEach(phaseId => {
        if (!supportedKeys.includes(phaseId)) {
          throw new Error(`[Zipbul AOT] Unsupported middleware phase '${phaseId}' for adapter '${extraction.adapterId}'.`);
        }
      });
    }
  }

  private collectModuleMiddlewarePhaseIds(fileMap: Map<string, FileAnalysis>, adapterId: string): string[] {
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
        throw new Error(`[Zipbul AOT] Adapter config must be an object literal for '${adapterId}'.`);
      }

      if (!Object.prototype.hasOwnProperty.call(adapterConfig, 'middlewares')) {
        continue;
      }

      const middlewares = this.asRecord(adapterConfig.middlewares);

      if (middlewares === null) {
        throw new Error(`[Zipbul AOT] middlewares must be an object literal for '${adapterId}'.`);
      }

      for (const key of Object.keys(middlewares)) {
        if (key.startsWith('__zipbul_computed_')) {
          throw new Error(`[Zipbul AOT] Middleware phase keys must be string literals for '${adapterId}'.`);
        }

        if (key.length === 0) {
          throw new Error(`[Zipbul AOT] Middleware phase keys must be non-empty for '${adapterId}'.`);
        }

        this.assertValidPhaseId(key, adapterId, 'middlewares');
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
  ): string[] {
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

            phaseIds.push(...this.extractPhaseIdsFromDecorator(decorator, adapterId));
          }
        }

        for (const method of cls.methods) {
          const hasHandlerDecorator = method.decorators.some(dec => entryDecorators.handler.includes(dec.name));

          if (!hasHandlerDecorator) {
            continue;
          }

          if (!isAdapterController) {
            if (!isNonEmptyString(controllerAdapterId)) {
              throw new Error(
                `[Zipbul AOT] @Middlewares handler '${cls.className}.${method.name}' must belong to adapter '${adapterId}'.`,
              );
            }

            continue;
          }

          for (const decorator of method.decorators) {
            if (decorator.name !== 'Middlewares') {
              continue;
            }

            phaseIds.push(...this.extractPhaseIdsFromDecorator(decorator, adapterId));
          }
        }
      }
    }

    return phaseIds;
  }

  private extractPhaseIdsFromDecorator(decorator: DecoratorArguments, adapterId: string): string[] {
    const args = decorator.arguments;

    if (args.length === 2) {
      const phaseId = typeof args[0] === 'string' ? args[0] : null;

      if (!isNonEmptyString(phaseId)) {
        throw new Error(`[Zipbul AOT] @Middlewares phaseId must be a string literal for '${adapterId}'.`);
      }

      this.assertValidPhaseId(phaseId, adapterId, '@Middlewares');

      return [phaseId];
    }

    if (args.length === 1) {
      const mapping = this.asRecord(args[0]);

      if (mapping === null) {
        throw new Error(`[Zipbul AOT] @Middlewares map must be an object literal for '${adapterId}'.`);
      }

      return Object.keys(mapping).map(key => {
        if (key.startsWith('__zipbul_computed_')) {
          throw new Error(`[Zipbul AOT] @Middlewares phaseId must be a string literal for '${adapterId}'.`);
        }

        if (key.length === 0) {
          throw new Error(`[Zipbul AOT] @Middlewares phaseId must be non-empty for '${adapterId}'.`);
        }

        this.assertValidPhaseId(key, adapterId, '@Middlewares');

        return key;
      });
    }

    throw new Error(`[Zipbul AOT] @Middlewares expects (phaseId, refs) or ({ [phaseId]: refs }) for '${adapterId}'.`);
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

  private validatePhaseConsistency(
    middlewarePhaseOrder: string[],
    supportedMiddlewarePhases: Record<string, true>,
    context: string,
  ): void {
    if (middlewarePhaseOrder.length === 0 && Object.keys(supportedMiddlewarePhases).length === 0) {
      return;
    }

    const phaseSet = new Set<string>();

    for (const phase of middlewarePhaseOrder) {
      if (phaseSet.has(phase)) {
        throw new Error(`[Zipbul AOT] middlewarePhaseOrder must not contain duplicates (${context}).`);
      }

      phaseSet.add(phase);
    }

    const supportedKeys = Object.keys(supportedMiddlewarePhases).sort();
    const phaseList = Array.from(phaseSet.values()).sort();

    if (supportedKeys.length !== phaseList.length) {
      throw new Error(`[Zipbul AOT] supportedMiddlewarePhases keys must match middlewarePhaseOrder (${context}).`);
    }

    for (let index = 0; index < supportedKeys.length; index += 1) {
      if (supportedKeys[index] !== phaseList[index]) {
        throw new Error(`[Zipbul AOT] supportedMiddlewarePhases keys must match middlewarePhaseOrder (${context}).`);
      }
    }
  }

  private validatePipelineConsistency(pipeline: string[], middlewarePhaseOrder: string[], context: string): void {
    const RESERVED = new Set(['Guards', 'Pipes', 'Handler']);

    for (const reserved of RESERVED) {
      const count = pipeline.filter(t => t === reserved).length;

      if (count !== 1) {
        throw new Error(`[Zipbul AOT] pipeline must contain '${reserved}' exactly once (${context}).`);
      }
    }

    const customPhases = pipeline.filter(t => !RESERVED.has(t));
    const customSet = new Set(customPhases);
    const orderSet = new Set(middlewarePhaseOrder);

    if (customSet.size !== orderSet.size) {
      throw new Error(`[Zipbul AOT] pipeline custom phases must match middlewarePhaseOrder (${context}).`);
    }

    for (const phase of customSet) {
      if (!orderSet.has(phase)) {
        throw new Error(`[Zipbul AOT] pipeline custom phases must match middlewarePhaseOrder (${context}).`);
      }
    }
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

  private assertValidPhaseId(phaseId: string, context: string, field: string): void {
    if (phaseId.length === 0) {
      throw new Error(`[Zipbul AOT] ${field} phase id must be non-empty (${context}).`);
    }

    if (phaseId.includes(':')) {
      throw new Error(`[Zipbul AOT] ${field} phase id must not contain ':' (${context}).`);
    }
  }
}
