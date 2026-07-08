const encoder = new TextEncoder();

/**
 * Serializes a response body value to bytes for buffered compression.
 * `Uint8Array`/`ArrayBuffer` pass through as raw bytes; strings are UTF-8 encoded;
 * everything else is JSON-stringified. `JSON.stringify` can throw on circular
 * references or BigInt — the caller treats a throw as "skip compression, leave the
 * body untouched", so this function does not guard the throw itself.
 */
export function serializeBody(
  body: string | number | boolean | Uint8Array | ArrayBuffer | object,
): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === 'string') return encoder.encode(body);
  return encoder.encode(JSON.stringify(body));
}
