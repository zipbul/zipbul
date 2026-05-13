import type { HttpStatus } from '../enums';
import type { RedirectStatus } from '../types';

interface OptionEntry {
  readonly name: string;
  readonly arguments?: readonly unknown[];
}

interface RedirectSpec {
  readonly url: string;
  readonly status?: RedirectStatus;
}

export interface ParsedDecoratorOptions {
  readonly rawBody: boolean;
  readonly sse: boolean;
  readonly bodyLimit: number | undefined;
  readonly status: HttpStatus | undefined;
  readonly redirect: RedirectSpec | undefined;
  readonly contentType: string | undefined;
  readonly headers: readonly (readonly [string, string])[];
}

export function parseDecoratorOptions(options: readonly OptionEntry[] | undefined): ParsedDecoratorOptions {
  let rawBody = false;
  let sse = false;
  let bodyLimit: number | undefined;
  let status: HttpStatus | undefined;
  let redirect: RedirectSpec | undefined;
  let contentType: string | undefined;
  const headers: Array<readonly [string, string]> = [];

  if (options === undefined) {
    return { rawBody, sse, bodyLimit, status, redirect, contentType, headers };
  }

  for (const option of options) {
    switch (option.name) {
      case 'RawBody':
        rawBody = true;
        break;
      case 'Sse':
        sse = true;
        break;
      case 'BodyLimit':
        if (typeof option.arguments?.[0] === 'number') {
          bodyLimit = option.arguments[0];
        }
        break;
      case 'Status':
        if (typeof option.arguments?.[0] === 'number') {
          // Runtime boundary: metadata arrives as unknown at AOT-parse time.
          // The Status decorator's compile-time HttpStatus signature guarantees
          // only enum values reach here, so the cast is load-bearing only for
          // the `unknown` → `HttpStatus` boundary narrowing.
          status = option.arguments[0] as HttpStatus;
        }
        break;
      case 'Redirect':
        if (typeof option.arguments?.[0] === 'string') {
          redirect = {
            url: option.arguments[0],
            ...(option.arguments?.[1] !== undefined ? { status: option.arguments[1] as RedirectStatus } : {}),
          };
        }
        break;
      case 'ContentType':
        if (typeof option.arguments?.[0] === 'string') {
          contentType = option.arguments[0];
        }
        break;
      case 'Header':
        if (typeof option.arguments?.[0] === 'string' && typeof option.arguments?.[1] === 'string') {
          headers.push([option.arguments[0], option.arguments[1]] as const);
        }
        break;
    }
  }

  return { rawBody, sse, bodyLimit, status, redirect, contentType, headers };
}
