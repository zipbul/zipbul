import { test, expect } from 'bun:test';

import { BunMySqlErrorNormalizer } from './mysql.error-normalizer';

const normalizer = new BunMySqlErrorNormalizer();

// NOTE: current scaffold is an identity stub. Integration (errno 1062 ->
// UniqueConstraintViolationException) drives whether a remap is actually needed;
// these lock the current contract: MySQL surfaces errno natively, pass-through.
test('returns the same error reference (no mutation)', () => {
  const input = { errno: 1062, code: 'ERR_MYSQL_X' };
  expect(normalizer.normalize(input)).toBe(input);
});

test('returns null unchanged', () => {
  expect(normalizer.normalize(null)).toBeNull();
});

test('returns a real Error instance unchanged', () => {
  const err = new Error('x');
  expect(normalizer.normalize(err)).toBe(err);
});
