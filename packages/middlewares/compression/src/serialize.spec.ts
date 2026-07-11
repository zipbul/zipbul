import { describe, expect, it } from 'bun:test';

import { serializeBody } from './serialize';

describe('serializeBody', () => {
  it('passes a Uint8Array through by reference (no copy)', () => {
    const u = new Uint8Array([1, 2, 3]);
    expect(serializeBody(u)).toBe(u);
  });

  it('views an ArrayBuffer as a Uint8Array', () => {
    const ab = new Uint8Array([1, 2, 3]).buffer;
    const r = serializeBody(ab);
    expect(r).toBeInstanceOf(Uint8Array);
    expect([...r]).toEqual([1, 2, 3]);
  });

  it('UTF-8 encodes strings', () => {
    expect([...serializeBody('AB')]).toEqual([65, 66]);
    expect([...serializeBody('한')]).toEqual([...new TextEncoder().encode('한')]);
  });

  it('JSON-stringifies objects and arrays', () => {
    expect(new TextDecoder().decode(serializeBody({ a: 1 }))).toBe('{"a":1}');
    expect(new TextDecoder().decode(serializeBody([1, 2]))).toBe('[1,2]');
  });

  it('JSON-stringifies numbers and booleans', () => {
    expect(new TextDecoder().decode(serializeBody(42))).toBe('42');
    expect(new TextDecoder().decode(serializeBody(true))).toBe('true');
  });

  it('throws on circular references (caller treats a throw as skip)', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(() => serializeBody(o)).toThrow();
  });

  it('throws on BigInt values', () => {
    expect(() => serializeBody({ n: 1n } as unknown as object)).toThrow();
  });
});
