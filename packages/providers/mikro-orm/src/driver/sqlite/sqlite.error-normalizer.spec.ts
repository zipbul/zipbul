import { test, expect } from 'bun:test';

import { SqliteErrorNormalizer } from './sqlite.error-normalizer';

const normalizer = new SqliteErrorNormalizer();

// NOTE: current scaffold is an identity stub. Integration (SQLITE_CONSTRAINT_*) drives
// whether a remap is needed; these lock the current pass-through contract.
test('returns the same error reference (no mutation)', () => {
  const input = { code: 'SQLITE_CONSTRAINT_UNIQUE', errno: 2067 };
  expect(normalizer.normalize(input)).toBe(input);
});

test('returns undefined unchanged', () => {
  expect(normalizer.normalize(undefined)).toBeUndefined();
});

test('returns a real Error instance unchanged', () => {
  const err = new Error('x');
  expect(normalizer.normalize(err)).toBe(err);
});
