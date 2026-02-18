import type { ForwardRef } from './interfaces';
import type { ZipbulValue, Callable, Constructor, ForwardRefFactory, PrimitiveArray, PrimitiveRecord, ValueLike } from './types';

export function isClass(target: ZipbulValue): target is Constructor {
  return typeof target === 'function' && 'prototype' in target;
}

export function forwardRef(fn: ForwardRefFactory): ForwardRef {
  return { forwardRef: fn };
}

export function isUndefined(obj: ValueLike): obj is undefined {
  return typeof obj === 'undefined';
}

export function isNil(obj: ValueLike): obj is null | undefined {
  return isUndefined(obj) || obj === null;
}

export function isEmpty(array: PrimitiveArray | PrimitiveRecord): boolean {
  if (Array.isArray(array)) {
    return array.length === 0;
  }

  return Object.keys(array).length === 0;
}

export function isSymbol(fn: ValueLike): fn is symbol {
  return typeof fn === 'symbol';
}

export function isString(fn: ValueLike): fn is string {
  return typeof fn === 'string';
}

export function isFunction(fn: ValueLike): fn is Callable {
  return typeof fn === 'function';
}
