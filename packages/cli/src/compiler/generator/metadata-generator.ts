import type { ConstructorParamMetadata, DecoratorMetadata } from '../analyzer/interfaces';
import type { AnalyzerValue, AnalyzerValueRecord } from '../analyzer/types';
import type { ImportRegistry } from './import-registry';
import type { MetadataClassEntry } from './interfaces';

import { type ClassMetadata } from '../analyzer';
import { compareCodePoint } from '../../common';

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
    const availableClasses = new Set(sortedClasses.map(c => c.metadata.className));
    const classMap = new Map<string, ClassMetadata>();
    const classFilePathMap = new Map<string, string>();

    sortedClasses.forEach(c => {
      classMap.set(c.metadata.className, c.metadata);
      classFilePathMap.set(c.metadata.className, c.filePath);
    });

    const isRecordValue = (value: AnalyzerValue): value is AnalyzerValueRecord => {
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    };

    const isNonEmptyString = (value: string | null | undefined): value is string => {
      return typeof value === 'string' && value.length > 0;
    };

    const getRefName = (value: AnalyzerValue): string | null => {
      if (typeof value === 'string') {
        return value;
      }

      if (!isRecordValue(value)) {
        return null;
      }

      if (typeof value.__zipbul_ref === 'string') {
        return value.__zipbul_ref;
      }

      return null;
    };

    const isAnalyzerValueArray = (value: AnalyzerValue): value is AnalyzerValue[] => {
      return Array.isArray(value);
    };

    const cloneAnalyzerValue = (value: AnalyzerValue | undefined): AnalyzerValue | undefined => {
      if (value === undefined || value === null) {
        return value;
      }

      if (isAnalyzerValueArray(value)) {
        return value.map(entry => entry);
      }

      if (isRecordValue(value)) {
        return { ...value };
      }

      return value;
    };

    const cloneProps = (props: ClassMetadata['properties']): ClassMetadata['properties'] =>
      props.map(p => ({
        ...p,
        decorators: [...p.decorators],
        items: cloneAnalyzerValue(p.items),
      }));

    const resolveMetadata = (className: string, visited = new Set<string>()): ClassMetadata['properties'] => {
      if (visited.has(className)) {
        return [];
      }

      visited.add(className);

      const meta = classMap.get(className);

      if (!meta) {
        return [];
      }

      let properties: ClassMetadata['properties'] = cloneProps(meta.properties);

      if (meta.heritage) {
        const h = meta.heritage;
        const parentProps = resolveMetadata(h.typeName, new Set(visited));

        if (h.typeName) {
          if (
            ['Partial', 'Pick', 'Omit', 'Required'].includes(h.typeName) &&
            Array.isArray(h.typeArgs) &&
            h.typeArgs.length > 0
          ) {
            const baseDtoName = h.typeArgs[0];

            if (!isNonEmptyString(baseDtoName)) {
              return properties;
            }

            const baseProps = resolveMetadata(baseDtoName, new Set(visited));

            if (h.typeName === 'Partial') {
              baseProps.forEach(p => {
                p.isOptional = true;

                if (!p.decorators.some(d => d.name === 'IsOptional')) {
                  p.decorators.push({ name: 'IsOptional', arguments: [] });
                }
              });

              properties = [...baseProps, ...properties];
            } else if (h.typeName === 'Pick') {
              properties = [...baseProps, ...properties];
            } else if (h.typeName === 'Omit') {
              properties = [...baseProps, ...properties];
            }
          } else {
            const parentMap = new Map(parentProps.map(p => [p.name, p]));

            properties.forEach(p => parentMap.set(p.name, p));

            properties = Array.from(parentMap.values());
          }
        }
      }

      return properties;
    };

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

        if (typeof record.__zipbul_ref === 'string') {
          if (typeof record.__zipbul_import_source === 'string') {
            registry.addImport(record.__zipbul_ref, record.__zipbul_import_source);
          }

          return record.__zipbul_ref;
        }

        if (typeof record.__zipbul_factory_code === 'string') {
          return record.__zipbul_factory_code;
        }

        if (typeof record.__zipbul_call === 'string') {
          if (typeof record.__zipbul_import_source === 'string') {
            const root = record.__zipbul_call.split('.')[0];

            if (!isNonEmptyString(root)) {
              return record.__zipbul_call;
            }

            if (root !== record.__zipbul_call) {
              registry.addImport(root, record.__zipbul_import_source);
            } else {
              registry.addImport(record.__zipbul_call, record.__zipbul_import_source);
            }
          }

          const args = (isAnalyzerValueArray(record.args) ? record.args : []).map(a => serializeValue(a)).join(', ');

          return `${record.__zipbul_call}(${args})`;
        }

        if (typeof record.__zipbul_new === 'string') {
          const args = (isAnalyzerValueArray(record.args) ? record.args : []).map(a => serializeValue(a)).join(', ');

          return `new ${record.__zipbul_new}(${args})`;
        }

        if (typeof record.__zipbul_forward_ref === 'string') {
          return `forwardRef(() => ${record.__zipbul_forward_ref})`;
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

    const normalizeConstructorParams = (params: ConstructorParamMetadata[]): AnalyzerValue[] => {
      return params.map(param => ({
        name: param.name,
        type: param.type,
        typeArgs: param.typeArgs,
        decorators: normalizeDecorators(param.decorators),
      }));
    };

    sortedClasses.forEach(({ metadata, filePath }) => {
      const alias = registry.getAlias(metadata.className, filePath);
      const resolvedProperties = resolveMetadata(metadata.className);
      const props = resolvedProperties.map(prop => {
        const propTypeName = getRefName(prop.type);
        const isClassRef = isNonEmptyString(propTypeName) && availableClasses.has(propTypeName);
        let typeValue = serializeValue(prop.type);

        if (isClassRef) {
          const filePath = classFilePathMap.get(propTypeName);

          if (filePath !== undefined) {
            const alias = registry.getAlias(propTypeName, filePath);

            if (alias.length > 0) {
              typeValue = `() => ${alias}`;
            }
          }
        }

        let itemsStr = 'undefined';

        if (prop.items !== undefined) {
          const itemRecord = isRecordValue(prop.items) ? prop.items : null;
          const itemTypeName = itemRecord && typeof itemRecord.typeName === 'string' ? itemRecord.typeName : 'Unknown';
          let itemTypeVal = `'${itemTypeName}'`;

          if (availableClasses.has(itemTypeName)) {
            const filePath = classFilePathMap.get(itemTypeName);

            if (filePath !== undefined) {
              const alias = registry.getAlias(itemTypeName, filePath);

              itemTypeVal = `() => ${alias}`;
            }
          }

          itemsStr = `{ typeName: ${itemTypeVal} }`;
        }

        return `{
          name: '${prop.name}',
          type: ${typeValue},
          isClass: ${isClassRef},
          typeArgs: ${JSON.stringify(prop.typeArgs)},
          decorators: ${serializeValue(normalizeDecorators(prop.decorators))},
          isOptional: ${prop.isOptional},
          isArray: ${prop.isArray},
          isEnum: ${prop.isEnum},
          items: ${itemsStr},
          literals: ${JSON.stringify(prop.literals)}
        }`;
      });

      const serializeMethods = (methods: ClassMetadata['methods']): string => {
        if (methods.length === 0) {
          return '[]';
        }

        return `[${methods
          .map(m => {
            const params = m.parameters
              .map(p => {
                let typeVal = serializeValue(p.type);
                const typeName = getRefName(p.type);

                if (isNonEmptyString(typeName) && availableClasses.has(typeName)) {
                  const filePath = classFilePathMap.get(typeName);

                  if (filePath !== undefined) {
                    const alias = registry.getAlias(typeName, filePath);

                    typeVal = `() => ${alias}`;
                  }
                }

                return `{
                      name: '${p.name}',
                      type: ${typeVal},
                      typeArgs: ${JSON.stringify(p.typeArgs)},
                      decorators: ${serializeValue(normalizeDecorators(p.decorators))},
                      index: ${p.index}
                  }`;
              })
              .join(',');

            return `{
                  name: '${m.name}',
                  decorators: ${serializeValue(normalizeDecorators(m.decorators))},
                  parameters: [${params}]
              }`;
          })
          .join(',')}]`;
      };

      const metaFactoryCall = `_meta(
        '${metadata.className}',
        ${serializeValue(normalizeDecorators(metadata.decorators))},
        ${serializeValue(normalizeConstructorParams(metadata.constructorParams))},
        ${serializeMethods(metadata.methods)},
        [${props.join(',')}]
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
