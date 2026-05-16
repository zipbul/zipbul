import type { JsonArray, JsonObject } from '../interfaces';

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
