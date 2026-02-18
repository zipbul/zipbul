import type { Class, PrimitiveValue } from '@zipbul/common';

import type { MetadataDecorator, MetadataProperty } from '../metadata/interfaces';
import type { MetadataArgument } from '../metadata/types';
import type { ValidatorClassRefs, ValidatorFunction, ValidatorHelpers } from './interfaces';
import type { ValidationErrors, ValidatorTarget, ValidatorValue, ValidatorValueArray, ValidatorValueRecord } from './types';

import { MetadataConsumer } from '../metadata/metadata-consumer';

const INVALID_OBJECT_MESSAGE = 'Invalid object';

function isValidatorRecord(value: ValidatorValue): value is ValidatorValueRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidatorArray(value: ValidatorValue): value is ValidatorValueArray {
  return Array.isArray(value);
}

function isPrimitiveValue(value: ValidatorValue): value is PrimitiveValue {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  );
}

function normalizeDecorators(decorators: readonly MetadataDecorator[] | undefined): readonly MetadataDecorator[] {
  return decorators ?? [];
}

function getDecoratorMessage(propertyName: string, decorator: MetadataDecorator): string {
  const options = decorator.options;
  const message = options && typeof options.message === 'string' ? options.message : undefined;

  if (message !== undefined && message !== '') {
    return message;
  }

  return `${propertyName} check failed for ${decorator.name}`;
}

function getFirstArgument(decorator: MetadataDecorator): MetadataArgument | undefined {
  if (!decorator.arguments) {
    return undefined;
  }

  return decorator.arguments[0];
}

function getValidatorTarget(classRefs: ValidatorClassRefs, propertyName: string, property: MetadataProperty): Class | null {
  if (property.metatype) {
    return property.metatype;
  }

  return classRefs[propertyName] ?? null;
}

function validateNestedValue(
  helpers: ValidatorHelpers,
  value: ValidatorValue,
  target: Class | null,
  propertyName: string,
): ValidationErrors {
  if (!target) {
    return [];
  }

  const nestedErrors = helpers.getValidator(value, target);

  if (nestedErrors.length === 0) {
    return [];
  }

  return nestedErrors.map(errorItem => `${propertyName}.${errorItem}`);
}

export class ValidatorCompiler {
  private static cache = new Map<ValidatorTarget, ValidatorFunction>();

  static compile(target: ValidatorTarget): ValidatorFunction {
    const cached = this.cache.get(target);

    if (cached) {
      return cached;
    }

    const metadata = MetadataConsumer.getCombinedMetadata(target);
    const classRefs: ValidatorClassRefs = {};

    for (const propertyName of Object.keys(metadata.properties)) {
      const property = metadata.properties[propertyName];

      if (property?.metatype) {
        classRefs[propertyName] = property.metatype;
      }
    }

    const helpers: ValidatorHelpers = {
      getValidator: (value, validatorTarget) => {
        if (!validatorTarget) {
          return [];
        }

        if (isValidatorArray(value)) {
          const errors: ValidationErrors = [];

          value.forEach((itemValue, index) => {
            if (!isValidatorRecord(itemValue)) {
              errors.push(`[${index}].${INVALID_OBJECT_MESSAGE}`);

              return;
            }

            const validator = ValidatorCompiler.compile(validatorTarget);
            const itemErrors = validator(itemValue);

            errors.push(...itemErrors.map(errorItem => `[${index}].${errorItem}`));
          });

          return errors;
        }

        if (!isValidatorRecord(value)) {
          return [INVALID_OBJECT_MESSAGE];
        }

        return ValidatorCompiler.compile(validatorTarget)(value);
      },
    };

    const validator: ValidatorFunction = input => {
      if (!isValidatorRecord(input)) {
        return [INVALID_OBJECT_MESSAGE];
      }

      const errors: ValidationErrors = [];

      for (const propertyName of Object.keys(metadata.properties)) {
        const property = metadata.properties[propertyName];

        if (!property) {
          continue;
        }

        const value = input[propertyName];
        const isOptional = property.isOptional === true;
        const decorators = normalizeDecorators(property.decorators);

        if (isOptional && (value === undefined || value === null)) {
          continue;
        }

        if (property.isArray === true) {
          if (!Array.isArray(value)) {
            errors.push(`${propertyName} must be an array`);
          }
        }

        for (const decorator of decorators) {
          const message = getDecoratorMessage(propertyName, decorator);
          const argument = getFirstArgument(decorator);

          if (decorator.name === 'IsString') {
            if (typeof value !== 'string') {
              errors.push(message);
            }

            continue;
          }

          if (decorator.name === 'IsNumber') {
            if (typeof value !== 'number' || Number.isNaN(value)) {
              errors.push(message);
            }

            continue;
          }

          if (decorator.name === 'IsInt') {
            if (typeof value !== 'number' || !Number.isInteger(value)) {
              errors.push(message);
            }

            continue;
          }

          if (decorator.name === 'IsBoolean') {
            if (typeof value !== 'boolean') {
              errors.push(message);
            }

            continue;
          }

          if (decorator.name === 'Min') {
            if (typeof argument === 'number' && typeof value === 'number' && value < argument) {
              errors.push(message);
            }

            continue;
          }

          if (decorator.name === 'Max') {
            if (typeof argument === 'number' && typeof value === 'number' && value > argument) {
              errors.push(message);
            }

            continue;
          }

          if (decorator.name === 'IsIn') {
            if (Array.isArray(argument) && value !== undefined && isPrimitiveValue(value) && !argument.includes(value)) {
              errors.push(message);
            }

            continue;
          }

          if (decorator.name === 'ValidateNested') {
            const targetValue = getValidatorTarget(classRefs, propertyName, property);
            const nestedErrors = validateNestedValue(helpers, value, targetValue, propertyName);

            errors.push(...nestedErrors);
          }
        }
      }

      return errors;
    };

    this.cache.set(target, validator);

    return validator;
  }
}
