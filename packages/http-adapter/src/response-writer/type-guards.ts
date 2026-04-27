import type { ErrorResponseData, ResponseBodyValue } from '../types';

export function isResponseBodyValue(value: unknown): value is ResponseBodyValue {
  if (value === null) {
    return true;
  }

  const valueType = typeof value;

  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return true;
  }

  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return true;
  }

  if (valueType === 'object') {
    return true;
  }

  return false;
}

export function isErrorResponseData(value: unknown): value is ErrorResponseData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'number'
  );
}
