import type { DecoratorMetadata } from '../analyzer/interfaces';
import type { AnalyzerValue } from '../analyzer/types';
import type { ImportRegistry } from './import-registry';
import type { MetadataClassEntry } from './interfaces';

import {
  ZIPBUL_REF, ZIPBUL_LAZY_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_NEW,
  ZIPBUL_FACTORY_CODE,
} from '@zipbul/common';
import { compareCodePoint } from '../../common';
import { isRecordValue, isAnalyzerValueArray, isNonEmptyString } from '../analyzer/type-guards';

/**
 * Emits `createMetadataRegistry()` — a `className → constructor` lookup the
 * router uses to resolve controllers (for the `@Controller` prefix) and handler
 * DTOs (by `metatypeKey`, to hand to `baker.deserialize`).
 *
 * Only `className` and the class-level `decorators` are emitted. Property/method
 * metadata is NOT emitted: the router never reads it, and a class's `@Field`
 * schema is owned entirely by baker via `Class[Symbol.metadata]` (baker seals
 * nested DTOs by recursion). Emitting `@Field` rules here would force the
 * compiler to serialize baker rule expressions — a responsibility it must not
 * take on.
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
          const refName = record[ZIPBUL_REF];

          // A reference to a runtime value (enum, class, …). Import it whenever
          // its source is known so it emits as an identifier; an unsourced ref
          // falls back to a string literal.
          if (typeof record[ZIPBUL_IMPORT_SOURCE] === 'string') {
            registry.addImport(refName, record[ZIPBUL_IMPORT_SOURCE]);

            return refName;
          }

          return JSON.stringify(refName);
        }

        if (typeof record[ZIPBUL_FACTORY_CODE] === 'string') {
          return record[ZIPBUL_FACTORY_CODE];
        }

        if (typeof record[ZIPBUL_CALL] === 'string') {
          if (typeof record[ZIPBUL_IMPORT_SOURCE] === 'string') {
            const root = record[ZIPBUL_CALL].split('.')[0];

            if (!isNonEmptyString(root)) {
              return record[ZIPBUL_CALL];
            }

            if (root !== record[ZIPBUL_CALL]) {
              registry.addImport(root, record[ZIPBUL_IMPORT_SOURCE]);
            } else {
              registry.addImport(record[ZIPBUL_CALL], record[ZIPBUL_IMPORT_SOURCE]);
            }
          }

          const args = (isAnalyzerValueArray(record.args) ? record.args : []).map(a => serializeValue(a)).join(', ');

          return `${record[ZIPBUL_CALL]}(${args})`;
        }

        if (typeof record[ZIPBUL_NEW] === 'string') {
          const args = (isAnalyzerValueArray(record.args) ? record.args : []).map(a => serializeValue(a)).join(', ');

          return `new ${record[ZIPBUL_NEW]}(${args})`;
        }

        if (typeof record[ZIPBUL_LAZY_REF] === 'string') {
          return `lazy(() => ${record[ZIPBUL_LAZY_REF]})`;
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
