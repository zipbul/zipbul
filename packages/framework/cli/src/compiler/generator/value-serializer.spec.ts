import { describe, expect, it } from 'bun:test';
import { ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_UNRESOLVABLE } from '@zipbul/common';

import type { AnalyzerValue } from '../analyzer/types';

import { ImportRegistry } from './import-registry';
import { serializeValue } from './value-serializer';

function registry(): ImportRegistry {
  return new ImportRegistry('/app/src');
}

describe('serializeValue', () => {
  it('should serialize a plain string as a JSON string literal', () => {
    expect(serializeValue('hello', registry())).toBe('"hello"');
  });

  it('should serialize a number verbatim', () => {
    expect(serializeValue(42, registry())).toBe('42');
  });

  it('should serialize an array element-wise', () => {
    expect(serializeValue([1, 'a'] as unknown as AnalyzerValue, registry())).toBe('[1, "a"]');
  });

  it('should serialize a plain object record with sorted keys', () => {
    const value = { b: 2, a: 1 } as unknown as AnalyzerValue;
    expect(serializeValue(value, registry())).toBe("{ 'a': 1, 'b': 2 }");
  });

  describe('unresolvable markers', () => {
    it('should emit the raw sourceText for an unresolvable string literal', () => {
      const value = { [ZIPBUL_UNRESOLVABLE]: true, sourceText: "'https://allowed.example'" } as unknown as AnalyzerValue;
      expect(serializeValue(value, registry())).toBe("'https://allowed.example'");
    });

    it('should emit the raw sourceText for an unresolvable numeric literal', () => {
      const value = { [ZIPBUL_UNRESOLVABLE]: true, sourceText: '42' } as unknown as AnalyzerValue;
      expect(serializeValue(value, registry())).toBe('42');
    });

    it('should reconstruct a factory call whose object argument holds unresolvable literals', () => {
      const value = {
        [ZIPBUL_CALL]: 'corsMiddleware',
        [ZIPBUL_IMPORT_SOURCE]: '@zipbul/cors',
        args: [{ origin: { [ZIPBUL_UNRESOLVABLE]: true, sourceText: "'https://allowed.example'" } }],
      } as unknown as AnalyzerValue;
      expect(serializeValue(value, registry())).toBe("corsMiddleware({ 'origin': 'https://allowed.example' })");
    });

    it('should fall back to undefined when an unresolvable marker has no sourceText', () => {
      const value = { [ZIPBUL_UNRESOLVABLE]: true } as unknown as AnalyzerValue;
      expect(serializeValue(value, registry())).toBe('undefined');
    });
  });

  it('should resolve a ZIPBUL_REF through the import registry alias', () => {
    const value = { [ZIPBUL_REF]: 'HttpAdapter', [ZIPBUL_IMPORT_SOURCE]: '@zipbul/http-adapter' } as unknown as AnalyzerValue;
    expect(serializeValue(value, registry())).toBe('HttpAdapter');
  });

  it('should throw on a local (non-imported) ref instead of leaking the marker record', () => {
    const value = { [ZIPBUL_REF]: 'localCors' } as unknown as AnalyzerValue;
    expect(() => serializeValue(value, registry())).toThrow(/localCors/);
  });
});
