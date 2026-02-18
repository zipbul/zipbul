import type { Class } from '@zipbul/common';

import type { MetadataDecorator } from '../metadata/interfaces';
import type { MetadataTypeValue } from '../metadata/types';
import type {
  ClassRefs,
  InstanceToPlainFn,
  PlainToInstanceFn,
  TransformerPlainRecord,
  TransformerPlainValue,
  TransformerValue,
  TransformerValueArray,
  TransformerValueRecord,
} from './types';

import { MetadataConsumer } from '../metadata/metadata-consumer';

const EMPTY_DECORATORS: readonly MetadataDecorator[] = [];

function normalizeDecorators(decorators: readonly MetadataDecorator[] | undefined): readonly MetadataDecorator[] {
  return decorators ?? EMPTY_DECORATORS;
}

function findDecorator(decorators: readonly MetadataDecorator[], name: string): MetadataDecorator | null {
  return decorators.find(decorator => decorator.name === name) ?? null;
}

function isPrimitiveName(value: MetadataTypeValue | undefined, name: 'string' | 'number' | 'boolean'): boolean {
  return typeof value === 'string' && value.toLowerCase() === name;
}

function isClassConstructor(value: MetadataTypeValue | undefined): value is Class<TransformerValue> {
  if (typeof value !== 'function') {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(value, 'prototype');
}

function isForwardRef(value: MetadataTypeValue | undefined): value is () => Class<TransformerValue> {
  return typeof value === 'function' && !isClassConstructor(value);
}

function resolveClassReference(value: MetadataTypeValue | undefined): Class<TransformerValue> | null {
  if (isClassConstructor(value)) {
    return value;
  }

  if (isForwardRef(value)) {
    const resolved = value();

    if (isClassConstructor(resolved)) {
      return resolved;
    }
  }

  return null;
}

function isPlainRecord(value: TransformerPlainValue): value is TransformerPlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValueRecord(value: TransformerValue): value is TransformerValueRecord {
  return typeof value === 'object' && value !== null;
}

function isTransformerValueArray(value: TransformerValue): value is TransformerValueArray {
  return Array.isArray(value);
}

function setInstanceValue(instance: TransformerValueRecord, key: string, value: TransformerValue): void {
  instance[key] = value;
}

export class TransformerCompiler {
  private static p2iCache = new Map<Class, PlainToInstanceFn>();
  private static i2pCache = new Map<Class, InstanceToPlainFn>();

  static compilePlainToInstance(target: Class<TransformerValue>): PlainToInstanceFn {
    const cached = this.p2iCache.get(target);

    if (cached) {
      return cached;
    }

    const metadata = MetadataConsumer.getCombinedMetadata(target);
    const properties = metadata.properties;
    const classRefs: ClassRefs = {};

    for (const [propertyName, property] of Object.entries(properties)) {
      const classRef = resolveClassReference(property.type);

      if (property.isClass === true && classRef) {
        classRefs[propertyName] = classRef;
      }

      const itemTypeName = property.items?.typeName;
      const hasItemTypeName = itemTypeName !== undefined;

      if (property.isArray === true && hasItemTypeName) {
        const itemClassRef = resolveClassReference(itemTypeName);

        if (itemClassRef) {
          classRefs[propertyName] = itemClassRef;
        }
      }
    }

    const closure: PlainToInstanceFn = plainValue => {
      const instance = new target();
      let instanceRecord: TransformerValueRecord;

      if (isValueRecord(instance)) {
        instanceRecord = instance;
      } else {
        instanceRecord = {};
      }

      if (!isPlainRecord(plainValue)) {
        return instance;
      }

      const plainRecord: TransformerPlainRecord = plainValue;

      for (const [propertyName, property] of Object.entries(properties)) {
        const value = plainRecord[propertyName];

        if (value === undefined) {
          continue;
        }

        const decorators = normalizeDecorators(property.decorators);
        const transformDecorator = findDecorator(decorators, 'Transform');

        if (transformDecorator !== null) {
          setInstanceValue(instanceRecord, propertyName, value);

          continue;
        }

        if (property.isArray === true) {
          if (!Array.isArray(value)) {
            setInstanceValue(instanceRecord, propertyName, []);

            continue;
          }

          const itemTypeName = property.items?.typeName;
          const isPrimitiveString = isPrimitiveName(itemTypeName, 'string');
          const isPrimitiveNumber = isPrimitiveName(itemTypeName, 'number');
          const isPrimitiveBoolean = isPrimitiveName(itemTypeName, 'boolean');

          if (isPrimitiveString) {
            setInstanceValue(
              instanceRecord,
              propertyName,
              value.map(itemValue => String(itemValue)),
            );

            continue;
          }

          if (isPrimitiveNumber) {
            setInstanceValue(
              instanceRecord,
              propertyName,
              value.map(itemValue => Number(itemValue)),
            );

            continue;
          }

          if (isPrimitiveBoolean) {
            setInstanceValue(
              instanceRecord,
              propertyName,
              value.map(itemValue => Boolean(itemValue)),
            );

            continue;
          }

          const itemClassRef = classRefs[propertyName];

          if (itemClassRef) {
            setInstanceValue(
              instanceRecord,
              propertyName,
              value.map(itemValue => TransformerCompiler.compilePlainToInstance(itemClassRef)(itemValue)),
            );

            continue;
          }

          setInstanceValue(instanceRecord, propertyName, value);

          continue;
        }

        if (property.type === Number || isPrimitiveName(property.type, 'number')) {
          setInstanceValue(instanceRecord, propertyName, Number(value));

          continue;
        }

        if (property.type === String || isPrimitiveName(property.type, 'string')) {
          if (typeof value === 'string') {
            setInstanceValue(instanceRecord, propertyName, value);

            continue;
          }

          if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') {
            setInstanceValue(instanceRecord, propertyName, String(value));

            continue;
          }

          setInstanceValue(instanceRecord, propertyName, '');

          continue;
        }

        if (property.type === Boolean || isPrimitiveName(property.type, 'boolean')) {
          setInstanceValue(instanceRecord, propertyName, Boolean(value));

          continue;
        }

        if (property.isClass === true) {
          const classRef = classRefs[propertyName];

          if (classRef) {
            setInstanceValue(instanceRecord, propertyName, TransformerCompiler.compilePlainToInstance(classRef)(value));

            continue;
          }
        }

        setInstanceValue(instanceRecord, propertyName, value);
      }

      return instance;
    };

    this.p2iCache.set(target, closure);

    return closure;
  }

  /**
   * Compiles instanceToPlain function
   */
  static compileInstanceToPlain(target: Class): InstanceToPlainFn {
    const cached = this.i2pCache.get(target);

    if (cached) {
      return cached;
    }

    const metadata = MetadataConsumer.getCombinedMetadata(target);
    const properties = metadata.properties;
    const classRefs: ClassRefs = {};

    for (const [propertyName, property] of Object.entries(properties)) {
      const classRef = resolveClassReference(property.type);

      if (property.isClass === true && classRef) {
        classRefs[propertyName] = classRef;
      }

      const itemTypeName = property.items?.typeName;
      const hasItemTypeName = itemTypeName !== undefined;

      if (property.isArray === true && hasItemTypeName) {
        const itemClassRef = resolveClassReference(itemTypeName);

        if (itemClassRef) {
          classRefs[propertyName] = itemClassRef;
        }
      }
    }

    const closure: InstanceToPlainFn = instanceValue => {
      const plainRecord: TransformerValueRecord = {};

      if (!isValueRecord(instanceValue)) {
        return plainRecord;
      }

      const instanceRecord = instanceValue;

      for (const [propertyName, property] of Object.entries(properties)) {
        const decorators = normalizeDecorators(property.decorators);
        const isExcluded = findDecorator(decorators, 'Exclude') !== null;

        if (isExcluded) {
          continue;
        }

        const instanceField = instanceRecord[propertyName];

        if (instanceField === undefined) {
          continue;
        }

        const itemTypeName = property.items?.typeName;
        const hasItemTypeName = itemTypeName !== undefined;
        const shouldConvert = property.isClass === true || (property.isArray === true && hasItemTypeName);

        if (shouldConvert) {
          const classRef = classRefs[propertyName];

          if (isTransformerValueArray(instanceField)) {
            if (classRef) {
              plainRecord[propertyName] = instanceField.map(itemValue =>
                TransformerCompiler.compileInstanceToPlain(classRef)(itemValue),
              );

              continue;
            }

            plainRecord[propertyName] = instanceField;

            continue;
          }

          if (classRef) {
            plainRecord[propertyName] = TransformerCompiler.compileInstanceToPlain(classRef)(instanceField);

            continue;
          }
        }

        plainRecord[propertyName] = instanceField;
      }

      return plainRecord;
    };

    this.i2pCache.set(target, closure);

    return closure;
  }
}
