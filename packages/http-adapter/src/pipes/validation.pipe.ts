import type { Class, PrimitiveArray, PrimitiveRecord, PrimitiveValue } from '@zipbul/common';
import type { TransformerPlainValue, TransformerValue } from '@zipbul/core/src/transformer/types';
import type { ValidatorValueRecord } from '@zipbul/core/src/validator/types';

import { ValidatorCompiler, TransformerCompiler } from '@zipbul/core';
import { StatusCodes } from 'http-status-codes';

import type { ArgumentMetadata, PipeTransform } from '../interfaces';
import type { RequestBodyValue, RouteParamType, RouteParamValue } from '../types';

export class ValidationPipe implements PipeTransform {
  transform(value: RouteParamValue, metadata: ArgumentMetadata): RouteParamValue {
    const metatype = metadata.metatype;

    if (metatype === undefined || !this.isValidationClass(metatype)) {
      return value;
    }

    const plainValue = this.toPlainValue(value);

    if (plainValue === undefined) {
      return value;
    }

    const p2iFn = TransformerCompiler.compilePlainToInstance(metatype);
    const object = p2iFn(plainValue);
    const validatorRecord = this.toValidatorRecord(object);

    if (!validatorRecord) {
      return value;
    }

    const validateFn = ValidatorCompiler.compile(metatype);
    const errors = validateFn(validatorRecord);

    if (errors.length > 0) {
      const error = new Error('Validation failed');

      Object.assign(error, {
        status: StatusCodes.BAD_REQUEST,
        details: errors,
      });

      Object.defineProperty(error, 'message', {
        value: error.message,
        enumerable: true,
        writable: true,
        configurable: true,
      });

      throw error;
    }

    const converted = this.toRouteParamValue(object);

    return converted ?? value;
  }

  private isValidationClass(metatype: RouteParamType): metatype is Class<TransformerValue> {
    if (this.isPrimitiveMetatype(metatype)) {
      return false;
    }

    return typeof metatype === 'function';
  }

  private isPrimitiveMetatype(metatype: RouteParamType): boolean {
    return metatype === String || metatype === Boolean || metatype === Number || metatype === Array || metatype === Object;
  }

  private toPlainValue(value: RouteParamValue): TransformerPlainValue | undefined {
    if (this.isPrimitiveValue(value)) {
      return value;
    }

    const arrayValue = this.toPrimitiveArray(value);

    if (arrayValue !== undefined) {
      return arrayValue;
    }

    const recordValue = this.toPrimitiveRecord(value);

    if (recordValue !== undefined) {
      return recordValue;
    }

    return undefined;
  }

  private toValidatorRecord(value: TransformerValue): ValidatorValueRecord | undefined {
    const recordValue = this.toPrimitiveRecord(value);

    if (recordValue === undefined) {
      return undefined;
    }

    return recordValue;
  }

  private toRouteParamValue(value: TransformerValue): RouteParamValue | undefined {
    const jsonValue = this.toJsonValue(value);

    if (jsonValue === undefined) {
      return undefined;
    }

    return jsonValue;
  }

  private toJsonValue(value: TransformerValue): RequestBodyValue | undefined {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      const items: RequestBodyValue[] = [];
      const values: TransformerValue[] = value;

      for (const item of values) {
        const converted = this.toJsonValue(item);

        if (converted === undefined) {
          return undefined;
        }

        items.push(converted);
      }

      return items;
    }

    if (this.isTransformerRecord(value)) {
      const record: Record<string, RequestBodyValue> = {};

      for (const [key, item] of Object.entries(value)) {
        const converted = this.toJsonValue(item);

        if (converted === undefined) {
          return undefined;
        }

        record[key] = converted;
      }

      return record;
    }

    return undefined;
  }

  private isPrimitiveValue(value: RouteParamValue | TransformerValue): value is PrimitiveValue {
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

  private toPrimitiveArray(value: RouteParamValue | TransformerValue): PrimitiveArray | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const items: PrimitiveArray = [];
    const values: Array<RouteParamValue | TransformerValue> = value;

    for (const item of values) {
      if (!this.isPrimitiveValue(item)) {
        return undefined;
      }

      items.push(item);
    }

    return items;
  }

  private toPrimitiveRecord(value: RouteParamValue | TransformerValue): PrimitiveRecord | undefined {
    if (!this.isPrimitiveRecordValue(value)) {
      return undefined;
    }

    const record: PrimitiveRecord = {};
    const entries = Object.entries(value);

    for (const [key, item] of entries) {
      if (this.isPrimitiveValue(item)) {
        record[key] = item;

        continue;
      }

      const arrayValue = this.toPrimitiveArray(item);

      if (arrayValue !== undefined) {
        record[key] = arrayValue;

        continue;
      }

      return undefined;
    }

    return record;
  }

  private isPrimitiveRecordValue(value: RouteParamValue | TransformerValue): value is PrimitiveRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isTransformerRecord(value: TransformerValue): value is Record<string, TransformerValue> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
