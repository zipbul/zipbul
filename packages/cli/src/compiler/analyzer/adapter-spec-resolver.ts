import { parseSync } from 'oxc-parser';

import type { AdapterSpecResolveParams, FileAnalysis } from './graph/interfaces';
import type {
  AdapterSpecExtraction,
  AdapterSpecExportResolution,
  AdapterSpecResolution,
  AdapterStaticSpecResult,
  AdapterStaticSpec,
  AdapterEntryDecoratorsSpec,
  AdapterRuntimeSpec,
  PipelineSpec,
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
        throw new Error(`[Zipbul AOT] adapterSpec must be defineAdapter(<AdapterClassRef>) in ${resolvedExport.sourceFile}.`);
      }

      const args = isAnalyzerValueArray(defineCall.args) ? defineCall.args : [];

      if (args.length !== 1) {
        throw new Error(`[Zipbul AOT] defineAdapter requires exactly one argument in ${resolvedExport.sourceFile}.`);
      }

      const arg = this.asRecord(args[0]);

      if (arg === null || typeof arg.__zipbul_ref !== 'string') {
        throw new Error(`[Zipbul AOT] defineAdapter argument must be an Identifier reference in ${resolvedExport.sourceFile}.`);
      }

      const adapterClassName = arg.__zipbul_ref;
      const adapterClassSource =
        typeof arg.__zipbul_import_source === 'string' ? arg.__zipbul_import_source : resolvedExport.sourceFile;
      const staticSpec = await this.extractAdapterStaticSpec(adapterClassSource, adapterClassName, fileMap);

      adapterSpecs.push({ adapterId: staticSpec.adapterId, staticSpec: staticSpec.staticSpec });
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

  private async extractAdapterStaticSpec(
    classFile: string,
    className: string,
    fileMap: Map<string, FileAnalysis>,
  ): Promise<AdapterStaticSpecResult> {
    const analysisExists = await this.getFileAnalysis(classFile, fileMap);

    if (analysisExists === null) {
      throw new Error(`[Zipbul AOT] Adapter class source not found: ${classFile}`);
    }

    const code = await Bun.file(classFile).text();
    const parsed = parseSync(classFile, code);
    const program = this.asRecord(parsed.program);

    if (program === null) {
      throw new Error(`[Zipbul AOT] Failed to parse adapter class source: ${classFile}`);
    }

    const classNode = this.findClassDeclaration(program, className);

    if (classNode === null) {
      throw new Error(`[Zipbul AOT] Adapter class '${className}' not found in ${classFile}.`);
    }

    const staticFields = this.extractStaticFields(classNode);
    const adapterId = this.parseStringLiteral(staticFields.adapterId);

    if (!isNonEmptyString(adapterId)) {
      throw new Error(`[Zipbul AOT] AdapterClass.adapterId must be a string literal (${className}).`);
    }

    const middlewarePhaseOrder = this.parseStringArray(staticFields.middlewarePhaseOrder, 'middlewarePhaseOrder', className);
    const supportedMiddlewarePhases = this.parseSupportedPhaseSet(
      staticFields.supportedMiddlewarePhases,
      'supportedMiddlewarePhases',
      className,
    );
    const entryDecorators = this.parseEntryDecorators(staticFields.entryDecorators, className);
    const runtime = this.parseRuntimeSpec(staticFields.runtime, className);
    const pipeline = this.parsePipelineSpec(staticFields.pipeline, className);

    this.validatePhaseConsistency(middlewarePhaseOrder, supportedMiddlewarePhases, className);
    this.validatePipelineConsistency(pipeline, middlewarePhaseOrder, className);

    return {
      adapterId,
      staticSpec: {
        pipeline,
        middlewarePhaseOrder,
        supportedMiddlewarePhases,
        entryDecorators,
        runtime,
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
        const controllerAdapters = adapters.filter(adapter =>
          cls.decorators.some(dec => dec.name === adapter.entryDecorators.controller),
        );

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

            if (!isNonEmptyString(controllerAdapterId) || controllerAdapterId !== extraction.adapterId) {
              throw new Error(
                `[Zipbul AOT] Handler '${cls.className}.${method.name}' must belong to a controller for adapter '${extraction.adapterId}'.`,
              );
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
            throw new Error(
              `[Zipbul AOT] @Middlewares handler '${cls.className}.${method.name}' must belong to adapter '${adapterId}'.`,
            );
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

  private findClassDeclaration(programNode: AnalyzerValueRecord, className: string): AnalyzerValueRecord | null {
    const statements = isAnalyzerValueArray(programNode.body) ? programNode.body : [];

    for (const stmtValue of statements) {
      const stmt = this.asRecord(stmtValue);

      if (stmt === null) {
        continue;
      }

      const defaultExport = stmt.type === 'ExportDefaultDeclaration' ? this.asRecord(stmt.declaration) : null;
      const namedExport = stmt.type === 'ExportNamedDeclaration' ? this.asRecord(stmt.declaration) : null;
      const candidate = defaultExport ?? namedExport ?? stmt;

      if (candidate.type === 'ClassDeclaration') {
        const id = this.asRecord(candidate.id);
        const name = id ? this.getString(id, 'name') : null;

        if (name === className) {
          return candidate;
        }
      }
    }

    return null;
  }

  private extractStaticFields(classNode: AnalyzerValueRecord): AnalyzerValueRecord {
    const body = this.asRecord(classNode.body);
    const members = body && isAnalyzerValueArray(body.body) ? body.body : [];
    const fields: AnalyzerValueRecord = {};

    for (const memberValue of members) {
      const member = this.asRecord(memberValue);

      if (member === null) {
        continue;
      }

      const isStatic = Boolean(member.static);

      if (!isStatic) {
        continue;
      }

      if (member.type === 'PropertyDefinition') {
        const key = this.asRecord(member.key);
        const keyName = key ? this.getString(key, 'name') : null;

        if (!isNonEmptyString(keyName)) {
          continue;
        }

        fields[keyName] = member.value;
      }

      if (member.type === 'MethodDefinition') {
        const key = this.asRecord(member.key);
        const keyName = key ? this.getString(key, 'name') : null;

        if (!isNonEmptyString(keyName)) {
          continue;
        }

        fields[keyName] = member;
      }
    }

    return fields;
  }

  private parseStringLiteral(nodeValue: AnalyzerValue): string | null {
    const node = this.asRecord(nodeValue);

    if (node === null) {
      return null;
    }

    if (node.type === 'Literal') {
      const value = node.value;

      if (typeof value === 'string') {
        return value;
      }
    }

    return null;
  }

  private parseIdentifier(nodeValue: AnalyzerValue): string | null {
    const node = this.asRecord(nodeValue);

    if (node === null) {
      return null;
    }

    if (node.type === 'Identifier') {
      return this.getString(node, 'name');
    }

    return null;
  }

  private parseStringArray(nodeValue: AnalyzerValue, field: string, className: string): string[] {
    const node = this.asRecord(nodeValue);

    if (node?.type !== 'ArrayExpression') {
      throw new Error(`[Zipbul AOT] AdapterClass.${field} must be an array literal (${className}).`);
    }

    const elements = isAnalyzerValueArray(node.elements) ? node.elements : [];
    const values: string[] = [];

    for (const elementValue of elements) {
      const element = this.asRecord(elementValue);

      if (element === null || element.type === 'SpreadElement') {
        throw new Error(`[Zipbul AOT] AdapterClass.${field} must be a string literal array (${className}).`);
      }

      const literal = this.parseStringLiteral(element);

      if (!isNonEmptyString(literal)) {
        throw new Error(`[Zipbul AOT] AdapterClass.${field} must be a string literal array (${className}).`);
      }

      this.assertValidPhaseId(literal, className, `AdapterClass.${field}`);
      values.push(literal);
    }

    return values;
  }

  private parseSupportedPhaseSet(nodeValue: AnalyzerValue, field: string, className: string): Record<string, true> {
    const node = this.asRecord(nodeValue);

    if (node?.type !== 'ObjectExpression') {
      throw new Error(`[Zipbul AOT] AdapterClass.${field} must be an object literal (${className}).`);
    }

    const phases: Record<string, true> = {};
    const properties = isAnalyzerValueArray(node.properties) ? node.properties : [];

    for (const propValue of properties) {
      const prop = this.asRecord(propValue);

      if (prop === null || (prop.type !== 'Property' && prop.type !== 'ObjectProperty')) {
        continue;
      }

      const key = this.getPropertyKey(prop.key);

      if (!isNonEmptyString(key)) {
        throw new Error(`[Zipbul AOT] AdapterClass.${field} keys must be string literals (${className}).`);
      }

      this.assertValidPhaseId(key, className, `AdapterClass.${field}`);

      const valueNode = this.asRecord(prop.value);
      const literalValue = valueNode ? valueNode.value : undefined;

      if (literalValue !== true) {
        throw new Error(`[Zipbul AOT] AdapterClass.${field} values must be literal true (${className}).`);
      }

      phases[key] = true;
    }

    return phases;
  }

  private parseEntryDecorators(nodeValue: AnalyzerValue, className: string): AdapterEntryDecoratorsSpec {
    const node = this.asRecord(nodeValue);

    if (node?.type !== 'ObjectExpression') {
      throw new Error(`[Zipbul AOT] AdapterClass.entryDecorators must be an object literal (${className}).`);
    }

    const controllerNode = this.getObjectPropertyValue(node, 'controller');
    const handlerNode = this.getObjectPropertyValue(node, 'handler');
    const controller = this.parseIdentifier(controllerNode);

    if (!isNonEmptyString(controller)) {
      throw new Error(`[Zipbul AOT] AdapterClass.entryDecorators.controller must be an Identifier (${className}).`);
    }

    const handler = this.parseIdentifierArray(handlerNode, 'entryDecorators.handler', className);

    if (handler.length === 0) {
      throw new Error(`[Zipbul AOT] AdapterClass.entryDecorators.handler must not be empty (${className}).`);
    }

    return { controller, handler };
  }

  private parseRuntimeSpec(nodeValue: AnalyzerValue, className: string): AdapterRuntimeSpec {
    const node = this.asRecord(nodeValue);

    if (node?.type !== 'ObjectExpression') {
      throw new Error(`[Zipbul AOT] AdapterClass.runtime must be an object literal (${className}).`);
    }

    const startNode = this.getObjectPropertyValue(node, 'start');
    const stopNode = this.getObjectPropertyValue(node, 'stop');
    const start = this.parseIdentifier(startNode);
    const stop = this.parseIdentifier(stopNode);

    if (!isNonEmptyString(start) || !isNonEmptyString(stop)) {
      throw new Error(`[Zipbul AOT] AdapterClass.runtime must include start/stop Identifiers (${className}).`);
    }

    return { start, stop };
  }

  private parsePipelineSpec(nodeValue: AnalyzerValue, className: string): PipelineSpec {
    const node = this.asRecord(nodeValue);

    if (node === null) {
      throw new Error(`[Zipbul AOT] AdapterClass.pipeline must be defined (${className}).`);
    }

    if (node.type === 'MethodDefinition') {
      return this.parsePipelineFromMethod(node, className);
    }

    if (node.type !== 'ObjectExpression') {
      throw new Error(`[Zipbul AOT] AdapterClass.pipeline must be an object literal or static method (${className}).`);
    }

    return this.parsePipelineFromObject(node, className);
  }

  private parsePipelineFromMethod(node: AnalyzerValueRecord, className: string): PipelineSpec {
    const value = this.asRecord(node.value);
    const body = value ? this.asRecord(value.body) : null;
    const statements = body && isAnalyzerValueArray(body.body) ? body.body : [];

    if (statements.length !== 1) {
      throw new Error(`[Zipbul AOT] AdapterClass.pipeline must return a single object literal (${className}).`);
    }

    const stmt = this.asRecord(statements[0]);

    if (stmt?.type !== 'ReturnStatement') {
      throw new Error(`[Zipbul AOT] AdapterClass.pipeline must return a single object literal (${className}).`);
    }

    const argument = this.asRecord(stmt.argument);

    if (argument?.type !== 'ObjectExpression') {
      throw new Error(`[Zipbul AOT] AdapterClass.pipeline must return a single object literal (${className}).`);
    }

    return this.parsePipelineFromObject(argument, className);
  }

  private parsePipelineFromObject(node: AnalyzerValueRecord, className: string): PipelineSpec {
    const middlewares = this.parseIdentifierArray(
      this.getObjectPropertyValue(node, 'middlewares'),
      'pipeline.middlewares',
      className,
    );
    const guards = this.parseIdentifierArray(this.getObjectPropertyValue(node, 'guards'), 'pipeline.guards', className);
    const pipes = this.parseIdentifierArray(this.getObjectPropertyValue(node, 'pipes'), 'pipeline.pipes', className);
    const handler = this.parseIdentifier(this.getObjectPropertyValue(node, 'handler'));

    if (!isNonEmptyString(handler)) {
      throw new Error(`[Zipbul AOT] AdapterClass.pipeline.handler must be an Identifier (${className}).`);
    }

    return { middlewares, guards, pipes, handler };
  }

  private parseIdentifierArray(nodeValue: AnalyzerValue, field: string, className: string): string[] {
    const node = this.asRecord(nodeValue);

    if (node?.type !== 'ArrayExpression') {
      throw new Error(`[Zipbul AOT] AdapterClass.${field} must be an array literal (${className}).`);
    }

    const elements = isAnalyzerValueArray(node.elements) ? node.elements : [];
    const names: string[] = [];

    for (const elementValue of elements) {
      const element = this.asRecord(elementValue);

      if (element === null || element.type === 'SpreadElement') {
        throw new Error(`[Zipbul AOT] AdapterClass.${field} must be an Identifier array (${className}).`);
      }

      const name = this.parseIdentifier(element);

      if (!isNonEmptyString(name)) {
        throw new Error(`[Zipbul AOT] AdapterClass.${field} must be an Identifier array (${className}).`);
      }

      names.push(name);
    }

    return names;
  }

  private validatePhaseConsistency(
    middlewarePhaseOrder: string[],
    supportedMiddlewarePhases: Record<string, true>,
    className: string,
  ): void {
    if (middlewarePhaseOrder.length === 0) {
      throw new Error(`[Zipbul AOT] AdapterClass.middlewarePhaseOrder must not be empty (${className}).`);
    }

    const phaseSet = new Set<string>();

    for (const phase of middlewarePhaseOrder) {
      if (phaseSet.has(phase)) {
        throw new Error(`[Zipbul AOT] AdapterClass.middlewarePhaseOrder must not contain duplicates (${className}).`);
      }

      phaseSet.add(phase);
    }

    const supportedKeys = Object.keys(supportedMiddlewarePhases).sort();
    const phaseList = Array.from(phaseSet.values()).sort();

    if (supportedKeys.length !== phaseList.length) {
      throw new Error(`[Zipbul AOT] supportedMiddlewarePhases keys must match middlewarePhaseOrder (${className}).`);
    }

    for (let index = 0; index < supportedKeys.length; index += 1) {
      if (supportedKeys[index] !== phaseList[index]) {
        throw new Error(`[Zipbul AOT] supportedMiddlewarePhases keys must match middlewarePhaseOrder (${className}).`);
      }
    }
  }

  private validatePipelineConsistency(pipeline: PipelineSpec, middlewarePhaseOrder: string[], className: string): void {
    if (pipeline.middlewares.length !== middlewarePhaseOrder.length) {
      throw new Error(`[Zipbul AOT] pipeline.middlewares length must match middlewarePhaseOrder (${className}).`);
    }
  }

  private getObjectPropertyValue(node: AnalyzerValueRecord, propName: string): AnalyzerValue | null {
    const properties = isAnalyzerValueArray(node.properties) ? node.properties : [];

    for (const propValue of properties) {
      const prop = this.asRecord(propValue);

      if (prop === null || (prop.type !== 'Property' && prop.type !== 'ObjectProperty')) {
        continue;
      }

      const keyName = this.getPropertyKey(prop.key);

      if (keyName === propName) {
        return prop.value;
      }
    }

    return null;
  }

  private getPropertyKey(nodeValue: AnalyzerValue): string | null {
    const node = this.asRecord(nodeValue);

    if (node === null) {
      return null;
    }

    if (node.type === 'Identifier') {
      return this.getString(node, 'name');
    }

    if (node.type === 'Literal') {
      const value = node.value;

      if (typeof value === 'string') {
        return value;
      }
    }

    return null;
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
