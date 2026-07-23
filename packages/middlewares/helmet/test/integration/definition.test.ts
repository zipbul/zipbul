import { describe, expect, it } from 'bun:test';

import { isErr } from '@zipbul/result';
import { HttpAdapter } from '@zipbul/http-adapter';

import { helmetMiddleware } from '../../index';
import { resolveHelmetOptions } from '../../src/options';

/**
 * The option keys this test suite (integration `<feature>.test.ts`/`composition`
 * + e2e `<feature>.test.ts`) has coverage for. Adding a field to `HelmetOptions`
 * requires updating this list — and its expected-value mirror in
 * `composition.test.ts` — or this drift guard fails.
 */
const OWNED_OPTION_KEYS = ['xContentTypeOptions', 'referrerPolicy'] as const;

describe('helmetMiddleware — definition shape', () => {
  it('should return a MiddlewareDefinition keyed to [HttpAdapter]', () => {
    const def = helmetMiddleware();
    expect(def).toBeDefined();
    // Arrays are reference types — toEqual (structural), never ===.
    expect(def.adapters).toEqual([HttpAdapter]);
    expect(typeof def.factory).toBe('function');
  });

  // Registration-time validation is this file's sole responsibility — it is
  // not duplicated in the per-feature integration files.
  it('throws at registration on a wrong-typed xContentTypeOptions option', () => {
    // @ts-expect-error — boolean field given a string; boot-time validation.
    expect(() => helmetMiddleware({ xContentTypeOptions: 'yes' })).toThrow();
  });

  it('throws at registration on an unrecognized referrerPolicy token', () => {
    expect(() => helmetMiddleware({ referrerPolicy: 'bogus' as never })).toThrow();
  });
});

describe('helmetMiddleware — option-key drift guard', () => {
  // Bidirectional: if HelmetOptions gains or loses a field without this list
  // (and the tests that exercise it) being updated, this fails in both
  // directions — a superset or a subset of OWNED_OPTION_KEYS is a mismatch.
  it('keeps the tests-owned option key list in sync with resolveHelmetOptions', () => {
    const resolved = resolveHelmetOptions({});
    if (isErr(resolved)) {
      throw new Error('expected ok, got err');
    }

    const actualKeys = Object.keys(resolved).sort();
    const ownedKeys = [...OWNED_OPTION_KEYS].sort();
    expect(actualKeys).toEqual(ownedKeys);
  });
});
