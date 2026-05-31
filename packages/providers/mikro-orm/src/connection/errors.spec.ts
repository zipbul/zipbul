import { test, expect } from 'bun:test';

import { ConnectionNotRegisteredError } from './errors';

test('is an Error subclass', () => {
  expect(new ConnectionNotRegisteredError('default')).toBeInstanceOf(Error);
});

test('carries its class name', () => {
  expect(new ConnectionNotRegisteredError('default').name).toBe('ConnectionNotRegisteredError');
});

test('message names the connection that was missing', () => {
  expect(new ConnectionNotRegisteredError('default').message).toContain('default');
});

test('interpolates the given name, not a hardcoded one', () => {
  expect(new ConnectionNotRegisteredError('analytics').message).toContain('analytics');
});
