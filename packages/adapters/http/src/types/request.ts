import type { RequestQueryArray, RequestQueryRecord } from '../interfaces';

import type { JsonValue } from './json';

export type HeadersInit = Headers | Array<[string, string]> | Record<string, string>;

export type RequestParamMap = Record<string, string | undefined>;

export type RequestQueryValue = string | RequestQueryArray | RequestQueryRecord;

export type RequestQueryMap = Record<string, RequestQueryValue | undefined>;

export type RequestBodyValue = JsonValue | string | ReadableStream<Uint8Array> | undefined;
