import type { JsonValue } from '../types';

export function parseJsonBody(parsed: unknown): JsonValue {
  // as 허용 사유: JSON.parse 반환값은 ECMAScript 스펙상 JsonValue.
  // TS의 `any` 반환 타입 한계를 보완. 런타임 보장은 JSON.parse 자체가 수행.
  return parsed as JsonValue;
}
