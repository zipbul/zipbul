import type { DecoratorMetadata } from '../analyzer/interfaces';
import type { AnalyzerValue } from '../analyzer/types';
import type { ImportRegistry } from './import-registry';
import type { MetadataClassEntry } from './interfaces';

import {
  ZIPBUL_REF, ZIPBUL_LAZY_REF, ZIPBUL_CALL, ZIPBUL_NEW,
  ZIPBUL_FACTORY_CODE,
} from '@zipbul/common';
import { compareCodePoint } from '../../common';
import { isRecordValue, isAnalyzerValueArray } from '../analyzer/type-guards';

/**
 * Emits `createMetadataRegistry()` — a `className → constructor` lookup the
 * router uses to resolve controllers (for the `@Controller` prefix) and handler
 * DTOs (by `metatypeKey`, to hand to `baker.deserialize`).
 *
 * Only `className` and the class-level `decorators` are emitted. Property/method
 * metadata is NOT emitted: the router never reads it, and a class's `@Field`
 * schema is owned entirely by baker via `Class[Symbol.metadata]` (baker seals
 * nested DTOs by recursion).
 *
 * Registry entries are PURE DATA. Decorator arguments serialize to literals;
 * a reference to a runtime value (a middleware fn in `@UseMiddlewares`, a
 * guard, a class) serializes to its NAME as a string — never to an imported
 * identifier. Runtime wiring is the injector's job (`__route_mw__` keys,
 * provider factories); importing source modules from the registry would drag
 * arbitrary files into the runtime module graph for data nobody executes.
 */
export class MetadataGenerator {
  generate(classes: MetadataClassEntry[], registry: ImportRegistry): string {
    const sortedClasses = [...classes].sort((a, b) => {
      const nameDiff = compareCodePoint(a.metadata.className, b.metadata.className);

      if (nameDiff !== 0) {
        return nameDiff;
      }

      return compareCodePoint(a.filePath, b.filePath);
    });
    const registryEntries: string[] = [];

    const serializeValue = (value: AnalyzerValue): string => {
      if (value === null) {
        return 'null';
      }

      if (value === undefined) {
        return 'undefined';
      }

      if (isAnalyzerValueArray(value)) {
        return `[${value.map(v => serializeValue(v)).join(',')}]`;
      }

      if (typeof value === 'object') {
        if (!isRecordValue(value)) {
          return 'null';
        }

        const record = value;

        if (typeof record[ZIPBUL_REF] === 'string') {
          return JSON.stringify(record[ZIPBUL_REF]);
        }

        if (typeof record[ZIPBUL_LAZY_REF] === 'string') {
          return JSON.stringify(record[ZIPBUL_LAZY_REF]);
        }

        if (typeof record[ZIPBUL_CALL] === 'string') {
          return JSON.stringify(record[ZIPBUL_CALL]);
        }

        if (typeof record[ZIPBUL_NEW] === 'string') {
          return JSON.stringify(record[ZIPBUL_NEW]);
        }

        if (typeof record[ZIPBUL_FACTORY_CODE] === 'string') {
          return JSON.stringify(record[ZIPBUL_FACTORY_CODE]);
        }

        const entries = Object.entries(record).map(([k, v]) => {
          return `${k}: ${serializeValue(v)}`;
        });

        return `{${entries.join(',')}}`;
      }

      return JSON.stringify(value);
    };

    const normalizeDecorators = (decorators: DecoratorMetadata[]): AnalyzerValue[] => {
      return decorators.map(decorator => ({ name: decorator.name, arguments: decorator.arguments }));
    };

    sortedClasses.forEach(({ metadata, filePath }) => {
      const alias = registry.getAlias(metadata.className, filePath);
      const metaFactoryCall = `_meta(
        '${metadata.className}',
        ${serializeValue(normalizeDecorators(metadata.decorators))}
      )`;

      registryEntries.push(`  registry.set(${alias}, ${metaFactoryCall});`);
    });

    return `
export function createMetadataRegistry() {
  const registry = new Map();
${registryEntries.join('\n')}

  registry.forEach(v => deepFreeze(v));
  return sealMap(registry);
}
`;
  }
}
