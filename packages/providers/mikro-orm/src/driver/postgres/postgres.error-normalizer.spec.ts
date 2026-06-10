import { test, expect } from 'bun:test';

import { BunPostgreSqlErrorNormalizer } from './postgres.error-normalizer';

const normalizer = new BunPostgreSqlErrorNormalizer();

test('copies a string errno into code when code is a generic ERR_ string', () => {
  const result = normalizer.normalize({ errno: '23505', code: 'ERR_POSTGRES_UNIQUE_VIOLATION' });
  expect((result as { code: string }).code).toBe('23505');
});

test('stringifies a numeric errno into code', () => {
  const result = normalizer.normalize({ errno: 23505, code: 'ERR_POSTGRES_X' });
  expect((result as { code: string }).code).toBe('23505');
});

test('rewrites code when code is not a string', () => {
  const result = normalizer.normalize({ errno: '23505', code: 12345 });
  expect((result as { code: string }).code).toBe('23505');
});

test('sets code from errno when code is absent', () => {
  const result = normalizer.normalize({ errno: '23505' });
  expect((result as { code: string }).code).toBe('23505');
});

test('leaves an already-valid SQLSTATE code untouched', () => {
  const result = normalizer.normalize({ errno: '23505', code: '23505' });
  expect((result as { code: string }).code).toBe('23505');
});

test('leaves a generic code untouched when errno is absent', () => {
  const result = normalizer.normalize({ code: 'ERR_POSTGRES_X' });
  expect((result as { code: string }).code).toBe('ERR_POSTGRES_X');
});

test('preserves detail/constraint/table and returns the same reference', () => {
  const input = { errno: '23505', code: 'ERR_X', detail: 'd', constraint: 'c', table: 't' };
  const result = normalizer.normalize(input);
  expect(result).toBe(input);
  expect(result).toMatchObject({ code: '23505', detail: 'd', constraint: 'c', table: 't' });
});

test('rewrites when code is exactly the "ERR_" prefix boundary', () => {
  const result = normalizer.normalize({ errno: '23505', code: 'ERR_' });
  expect((result as { code: string }).code).toBe('23505');
});

test('does not rewrite a code that does not start with "ERR_" (adjacent "ERRX")', () => {
  const result = normalizer.normalize({ errno: '23505', code: 'ERRX' });
  expect((result as { code: string }).code).toBe('ERRX');
});

test('does not throw on a frozen error object', () => {
  const frozen = Object.freeze({ errno: '23505', code: 'ERR_X' });
  expect(() => normalizer.normalize(frozen)).not.toThrow();
});
