import { describe, it, expect } from 'bun:test';
import { contextKey, type ContextKey } from './context-key';

describe('contextKey', () => {
  it('returns a symbol', () => {
    const key = contextKey<string>('test');
    expect(typeof key).toBe('symbol');
  });

  it('passes the description to Symbol()', () => {
    const key = contextKey<number>('zipbul.cookies');
    expect(key.description).toBe('zipbul.cookies');
  });

  it('returns a unique symbol on each call', () => {
    const keyA = contextKey<string>('same-description');
    const keyB = contextKey<string>('same-description');
    expect(keyA).not.toBe(keyB);
  });

  it('carries the branded type at compile time', () => {
    const stringKey: ContextKey<string> = contextKey<string>('str');
    const numberKey: ContextKey<number> = contextKey<number>('num');

    // At runtime both are plain symbols — the brand is erased.
    expect(typeof stringKey).toBe('symbol');
    expect(typeof numberKey).toBe('symbol');
  });

  it('can be used as a Map key', () => {
    const key = contextKey<boolean>('flag');
    const store = new Map<symbol, unknown>();
    store.set(key, true);
    expect(store.get(key)).toBe(true);
  });

  it('should create a key with empty string description', () => {
    const key = contextKey<string>('');

    expect(typeof key).toBe('symbol');
    expect(key.description).toBe('');
  });

  it('should create a key with special characters in description', () => {
    const key = contextKey<string>('zipbul.http.ctx/request-id@v2');

    expect(key.description).toBe('zipbul.http.ctx/request-id@v2');
  });

  it('should not equal another key even with identical description and type', () => {
    const keyA = contextKey<number>('counter');
    const keyB = contextKey<number>('counter');

    const store = new Map<symbol, number>();
    store.set(keyA, 1);
    store.set(keyB, 2);

    expect(store.get(keyA)).toBe(1);
    expect(store.get(keyB)).toBe(2);
    expect(store.size).toBe(2);
  });
});
