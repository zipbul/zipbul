import { test, expect, afterEach } from 'bun:test';
import type { MikroORM } from '@mikro-orm/core';

import { ConnectionRegistry } from './connection-registry';
import { ConnectionNotRegisteredError } from './errors';

// ConnectionRegistry is a process-global static Map. Reset the keys this spec sets so
// state never leaks into other specs in the same `bun test` run.
const KEYS = ['default', 'a', 'analytics'];
afterEach(() => {
  for (const k of KEYS) {
    ConnectionRegistry.delete(k);
  }
});

const orm = (tag: string) => ({ tag }) as unknown as MikroORM;

test('get on an unregistered name throws ConnectionNotRegisteredError', () => {
  expect(() => ConnectionRegistry.get('default')).toThrow(ConnectionNotRegisteredError);
});

test('get returns the exact instance that was set', () => {
  const instance = orm('o1');
  ConnectionRegistry.set('default', instance);
  expect(ConnectionRegistry.get('default')).toBe(instance);
});

test('has is true after set', () => {
  ConnectionRegistry.set('default', orm('o1'));
  expect(ConnectionRegistry.has('default')).toBe(true);
});

test('has is false for an unregistered name', () => {
  expect(ConnectionRegistry.has('default')).toBe(false);
});

test('delete removes the entry', () => {
  ConnectionRegistry.set('a', orm('o1'));
  ConnectionRegistry.delete('a');
  expect(ConnectionRegistry.has('a')).toBe(false);
  expect(() => ConnectionRegistry.get('a')).toThrow(ConnectionNotRegisteredError);
});

test('delete on a never-set name is a no-op', () => {
  expect(() => ConnectionRegistry.delete('default')).not.toThrow();
  expect(ConnectionRegistry.has('default')).toBe(false);
});

test('set overwrites an existing entry', () => {
  ConnectionRegistry.set('a', orm('first'));
  const second = orm('second');
  ConnectionRegistry.set('a', second);
  expect(ConnectionRegistry.get('a')).toBe(second);
});
