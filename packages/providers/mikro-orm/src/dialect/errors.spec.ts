import { test, expect } from 'bun:test';

import { StreamingUnsupportedError } from './errors';

test('is an Error subclass', () => {
  expect(new StreamingUnsupportedError()).toBeInstanceOf(Error);
});

test('carries its class name', () => {
  expect(new StreamingUnsupportedError().name).toBe('StreamingUnsupportedError');
});

test('message states streaming is unsupported', () => {
  expect(new StreamingUnsupportedError().message).toContain('streaming is unsupported');
});
