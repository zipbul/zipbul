import type { Gildash } from '@zipbul/gildash';

import type { AnalyzerValue } from '../types';
import type { FileAnalysis, ProviderRef, ProviderTokenValue } from './interfaces';
import type { ModuleNode } from './module-node';

import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_SPREAD, ZIPBUL_CALL,
  VISIBILITY_MODULE,
} from '@zipbul/common';
import { toRecord, isAnalyzerValueArray, isClassMetadata, isNonEmptyString, isUnresolvable } from '../type-guards';
import { extractTokenName } from './token-resolver';
import { parseInjectableOptions } from './scope-visibility-resolver';

/**
 * Merges a provider ref into a module node, handling implicit→explicit overrides
 * and detecting ambiguous duplicates.
 *
 * @param node - The target module node.
 * @param ref - The provider reference to merge.
 * @param moduleName - Module name (for error messages).
 * @public
 */
export function mergeProviderRef(node: ModuleNode, ref: ProviderRef, moduleName: string): void {
  if (node.providers.has(ref.token) && !isImplicit(node.providers.get(ref.token))) {
    throw new Error(
      `Ambiguous provider '${ref.token}' in module '${moduleName}' (${node.filePath}). Duplicate explicit definition.`,
    );
  }

  if (node.providers.has(ref.token)) {
    const prev = node.providers.get(ref.token);

    if (isImplicit(prev)) {
      const metaRecord = toRecord(ref.metadata);

      if (metaRecord && typeof metaRecord[ZIPBUL_REF] === 'string') {
        const prevMeta = prev?.metadata;
        const prevFilePath = prev?.filePath;
        const prevScope = prev?.scope;
        const prevVisibility = prev?.visibility;
        const prevVisibleTo = prev?.visibleTo;

        if (prevMeta !== undefined) {
          ref.metadata = prevMeta;
        }

        if (prevFilePath !== undefined) {
          ref.filePath = prevFilePath;
        }

        if (ref.scope === undefined && prevScope !== undefined) {
          ref.scope = prevScope;
        }

        if (ref.visibility === VISIBILITY_MODULE && prevVisibility !== undefined) {
          ref.visibility = prevVisibility;
        }

        if (ref.visibleTo === undefined && prevVisibleTo !== undefined) {
          ref.visibleTo = prevVisibleTo;
        }
      }
    }
  }

  node.providers.set(ref.token, ref);
}

/**
 * Resolves a spread expression in a provider list to concrete provider values.
 *
 * @param spreadValue - The spread value to resolve.
 * @param modulePath - Current module file path.
 * @param moduleName - Current module name.
 * @param fileMap - All parsed file analyses.
 * @param gildash - Optional gildash instance.
 * @returns Array of resolved provider values.
 * @public
 */
export function resolveSpreadBundle(
  spreadValue: AnalyzerValue,
  modulePath: string,
  moduleName: string,
  fileMap: ReadonlyMap<string, FileAnalysis>,
  gildash: Gildash | undefined,
): AnalyzerValue[] {
  if (isAnalyzerValueArray(spreadValue)) {
    return flattenSpreadArray(spreadValue, modulePath, moduleName, fileMap, gildash);
  }

  const record = toRecord(spreadValue);

  if (record && typeof record[ZIPBUL_REF] === 'string') {
    const refString = record[ZIPBUL_REF];
    const importSource = typeof record[ZIPBUL_IMPORT_SOURCE] === 'string' ? record[ZIPBUL_IMPORT_SOURCE] : undefined;
    const segments = refString.split('.');
    const varName = segments[0];
    let propertyPath = segments.slice(1);

    if (!isNonEmptyString(varName)) {
      throw buildSpreadError(moduleName, modulePath, refString, '변수명을 파싱할 수 없습니다.');
    }

    let targetValue: AnalyzerValue;

    if (importSource !== undefined) {
      let resolvedFile: string | undefined;
      let resolvedName: string | undefined;

      if (gildash) {
        try {
          const resolved = gildash.resolveSymbol(varName, importSource);

          if (!resolved.circular) {
            resolvedFile = resolved.originalFilePath;
            resolvedName = resolved.originalName;
          }
        } catch {
          /* fallthrough to direct lookup */
        }
      }

      if (resolvedFile === undefined) {
        resolvedFile = importSource;
        resolvedName = varName;
      }

      const fileAnalysis = findFileAnalysis(resolvedFile, fileMap);
      const exportedValues = fileAnalysis?.exportedValues;

      if (exportedValues === undefined) {
        throw buildSpreadError(moduleName, modulePath, refString, `파일 '${resolvedFile}'에서 exported values를 찾을 수 없습니다.`);
      }

      targetValue = exportedValues[resolvedName ?? varName];

      if (targetValue === undefined && propertyPath.length > 0) {
        const firstProp = propertyPath[0];

        if (isNonEmptyString(firstProp)) {
          targetValue = exportedValues[firstProp];

          if (targetValue !== undefined) {
            propertyPath = propertyPath.slice(1);
          }
        }
      }

      if (targetValue === undefined) {
        throw buildSpreadError(moduleName, modulePath, refString, `'${resolvedName ?? varName}'를 찾을 수 없습니다.`);
      }
    } else {
      const fileAnalysis = fileMap.get(modulePath);
      const localValues = fileAnalysis?.localValues;

      if (localValues === undefined) {
        throw buildSpreadError(moduleName, modulePath, refString, '로컬 변수를 찾을 수 없습니다.');
      }

      targetValue = localValues[varName];

      if (targetValue === undefined) {
        throw buildSpreadError(moduleName, modulePath, refString, `로컬 변수 '${varName}'를 찾을 수 없습니다.`);
      }
    }

    for (const prop of propertyPath) {
      const propRecord = toRecord(targetValue);

      if (propRecord === null) {
        throw buildSpreadError(moduleName, modulePath, refString, `프로퍼티 '${prop}' 접근 대상이 객체가 아닙니다.`);
      }

      targetValue = propRecord[prop];

      if (targetValue === undefined) {
        throw buildSpreadError(moduleName, modulePath, refString, `프로퍼티 '${prop}'를 찾을 수 없습니다.`);
      }
    }

    if (isAnalyzerValueArray(targetValue)) {
      return flattenSpreadArray(targetValue, modulePath, moduleName, fileMap, gildash);
    }

    throw buildSpreadError(moduleName, modulePath, refString, '해석된 값이 배열이 아닙니다.');
  }

  if (record && record[ZIPBUL_CALL] !== undefined) {
    const callName = typeof record[ZIPBUL_CALL] === 'string' ? record[ZIPBUL_CALL] : 'unknown';

    throw buildSpreadError(
      moduleName, modulePath, `${callName}()`,
      '함수 호출 결과는 빌드 타임에 결정할 수 없습니다.',
      '프로바이더를 배열 리터럴 또는 exported const로 선언하세요.',
    );
  }

  if (isUnresolvable(spreadValue)) {
    const exprDesc = spreadValue.nodeType ?? spreadValue.sourceText ?? 'unknown';

    throw buildSpreadError(
      moduleName, modulePath, exprDesc,
      `'${exprDesc}' 표현식은 빌드 타임에 결정할 수 없습니다.`,
      '프로바이더를 배열 리터럴 또는 exported const로 선언하세요.',
    );
  }

  const valueDescription = typeof spreadValue === 'string' ? spreadValue
    : typeof spreadValue === 'number' ? String(spreadValue)
    : typeof spreadValue === 'boolean' ? String(spreadValue)
    : spreadValue === null ? 'null'
    : spreadValue === undefined ? 'undefined'
    : 'unknown expression';

  throw buildSpreadError(
    moduleName, modulePath, valueDescription,
    '스프레드 표현식을 정적으로 해석할 수 없습니다.',
    '프로바이더를 배열 리터럴 또는 exported const로 선언하세요.',
  );
}

/**
 * Flattens nested spread arrays recursively.
 *
 * @public
 */
export function flattenSpreadArray(
  items: readonly AnalyzerValue[],
  modulePath: string,
  moduleName: string,
  fileMap: ReadonlyMap<string, FileAnalysis>,
  gildash: Gildash | undefined,
): AnalyzerValue[] {
  const result: AnalyzerValue[] = [];

  for (const item of items) {
    const record = toRecord(item);

    if (record && record[ZIPBUL_SPREAD] !== undefined) {
      const nested = resolveSpreadBundle(record[ZIPBUL_SPREAD], modulePath, moduleName, fileMap, gildash);

      result.push(...nested);
    } else {
      result.push(item);
    }
  }

  return result;
}

/**
 * Normalizes a raw provider value into a ProviderRef.
 *
 * @public
 */
export function normalizeProvider(
  p: ProviderTokenValue,
  modulePath: string,
  moduleName: string,
  gildash: Gildash | undefined,
  warnings: string[],
  moduleFileSet: ReadonlySet<string>,
  moduleNameByPath: ReadonlyMap<string, string>,
  moduleMarkerExports: ReadonlyMap<string, Set<string>>,
): ProviderRef {
  if (isUnresolvable(p)) {
    throw new Error(`Module '${moduleName}' (${modulePath}): provider must be a class reference or provider object. Found: ${p.nodeType ?? p.sourceText ?? 'unknown'} expression.`);
  }

  let token = 'UNKNOWN';
  const record = toRecord(p);
  const options = parseInjectableOptions(record, modulePath, moduleName, moduleFileSet, moduleNameByPath, moduleMarkerExports);

  if (record?.provide !== undefined) {
    token = extractTokenName(record.provide, gildash, warnings);
  } else if (typeof p === 'function') {
    token = p.name;
  } else if (record && typeof record[ZIPBUL_REF] === 'string') {
    token = record[ZIPBUL_REF];
    if (gildash && typeof record[ZIPBUL_IMPORT_SOURCE] === 'string') {
      try {
        const resolved = gildash.resolveSymbol(record[ZIPBUL_REF], record[ZIPBUL_IMPORT_SOURCE]);
        if (!resolved.circular) token = resolved.originalName;
      } catch {
        warnings.push(
          `Symbol resolution failed for '${record[ZIPBUL_REF]}'. Using raw reference name.`,
        );
      }
    }
  }

  if (token === 'UNKNOWN') {
    throw new Error(`Cannot determine provider token in module '${moduleName}' (${modulePath}). Ensure the provider is a class reference or a valid provider object.`);
  }

  const metadata = isClassMetadata(p) ? p : record;

  const ref: ProviderRef = {
    token,
    metadata,
    visibility: options.visibility,
  };
  if (options.visibleTo !== undefined) {
    ref.visibleTo = options.visibleTo;
  }
  if (options.scope !== undefined) {
    ref.scope = options.scope;
  }
  return ref;
}

/**
 * Extracts dependency tokens from a provider reference.
 *
 * @public
 */
export function extractDeps(
  provider: ProviderRef,
  gildash: Gildash | undefined,
  warnings: string[],
): string[] {
  if (provider.metadata === undefined) {
    return [];
  }

  if (isClassMetadata(provider.metadata)) {
    // Class providers resolve dependencies via inject() in their own bodies
    // (collected separately as module inject deps), not via constructor
    // parameters — so they contribute no constructor-derived deps here.
    return [];
  }

  const record = toRecord(provider.metadata);
  const deps: string[] = [];

  if (record && isAnalyzerValueArray(record.inject)) {
    for (const value of record.inject) {
      const name = extractTokenName(value, gildash, warnings);

      if (name !== 'UNKNOWN') {
        deps.push(name);
      }
    }
  }

  if (record) {
    const factoryRecord = toRecord(record.useFactory);

    if (factoryRecord !== null) {
      const factoryInjects = isAnalyzerValueArray(factoryRecord.__zipbul_factory_injects)
        ? factoryRecord.__zipbul_factory_injects
        : [];

      for (const entry of factoryInjects) {
        const entryRecord = toRecord(entry);

        if (entryRecord !== null) {
          const tokenName = extractTokenName(entryRecord.token, gildash, warnings);

          if (tokenName !== 'UNKNOWN') {
            deps.push(tokenName);
          }
        }
      }
    }
  }

  return deps;
}

function isImplicit(ref: ProviderRef | undefined): boolean {
  return isClassMetadata(ref?.metadata);
}

function findFileAnalysis(filePath: string, fileMap: ReadonlyMap<string, FileAnalysis>): FileAnalysis | undefined {
  const direct = fileMap.get(filePath);

  if (direct !== undefined) {
    return direct;
  }

  const candidates = [
    `${filePath}.ts`,
    `${filePath}/index.ts`,
  ];

  for (const candidate of candidates) {
    const found = fileMap.get(candidate);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function buildSpreadError(moduleName: string, modulePath: string, expression: string, reason: string, solution?: string): Error {
  let message = `Module '${moduleName}' (${modulePath}):\n  스프레드 표현식 '${expression}' 를 정적으로 해석할 수 없습니다.\n  원인: ${reason}`;

  if (solution !== undefined) {
    message += `\n  해결: ${solution}`;
  }

  return new Error(message);
}
