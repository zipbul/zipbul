import type { RequestIdOptions } from './types';

export function resolveRequestId(headers: Headers, options?: RequestIdOptions): string {
  if (options?.header !== undefined) {
    const headerValue = headers.get(options.header);
    if (headerValue !== null && validateRequestId(headerValue)) {
      return headerValue;
    }
  }
  if (options?.generate !== undefined) {
    return options.generate();
  }
  return crypto.randomUUID();
}

/**
 * log injection 방어: 인쇄 가능 ASCII(0x20-0x7E)만 허용.
 */
export function validateRequestId(value: string): boolean {
  if (value.length === 0 || value.length > 256) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}
