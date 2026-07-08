import { describe, expect, test } from 'bun:test';

import type { ContextUsage } from '../parser/handler-context-usage-extractor';

import { buildValidationEntries, DEFAULT_VALIDATION_ACCESSORS } from './handler-index-builder';

function usage(path: readonly string[], dto: string | null = 'SearchDto', isCall = true): ContextUsage {
  return { path, isCall, dtoIdentifier: dto };
}

describe('buildValidationEntries', () => {
  test('wires built-in accessors by default', () => {
    const entries = buildValidationEntries([usage(['request', 'getBody'])]);

    expect(entries).toEqual([{ accessor: ['request', 'getBody'], metatypeKey: 'SearchDto' }]);
  });

  test('does not wire manifest accessors without the extended set', () => {
    const entries = buildValidationEntries([usage(['request', 'getQuery'])]);

    expect(entries).toEqual([]);
  });

  test('wires manifest-declared accessors when passed via the parameter', () => {
    const accessors = new Set([...DEFAULT_VALIDATION_ACCESSORS, 'getQuery']);

    const entries = buildValidationEntries([usage(['request', 'getQuery'])], accessors);

    expect(entries).toEqual([{ accessor: ['request', 'getQuery'], metatypeKey: 'SearchDto' }]);
  });

  test('non-call usages never produce validation entries', () => {
    const accessors = new Set([...DEFAULT_VALIDATION_ACCESSORS, 'getQuery']);

    const entries = buildValidationEntries([usage(['request', 'getQuery'], null, false)], accessors);

    expect(entries).toEqual([]);
  });
});
