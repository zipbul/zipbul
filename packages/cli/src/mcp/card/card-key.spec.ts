import { describe, expect, it } from 'bun:test';

import { cardPathFromFullKey, normalizeSlug, parseFullKey } from './card-key';
import { zipbulCardMarkdownPath } from '../../common/zipbul-paths';

describe('mcp/card — card key', () => {
  it('normalizes slug by trimming slashes and backslashes', () => {
    expect(normalizeSlug('/auth/login/')).toBe('auth/login');
    expect(normalizeSlug('auth\\login')).toBe('auth/login');
    expect(normalizeSlug('\\auth\\login\\')).toBe('auth/login');
    expect(normalizeSlug('auth/login/')).toBe('auth/login');
  });

  it('rejects unsafe slugs', () => {
    expect(() => normalizeSlug('')).toThrow();
    expect(() => normalizeSlug('../x')).toThrow();
    expect(() => normalizeSlug('a/../b')).toThrow();
    expect(() => normalizeSlug('./a')).toThrow();
    expect(() => normalizeSlug('a//b')).toThrow();
    expect(() => normalizeSlug('a::b')).toThrow();
    expect(() => normalizeSlug('a/.')).toThrow();
    expect(() => normalizeSlug('a/..')).toThrow();
    expect(() => normalizeSlug('a/./b')).toThrow();
    expect(() => normalizeSlug('C:/x')).toThrow();
    expect(() => normalizeSlug('C:\\x')).toThrow();
  });

  it('parses keys as slug-only (no type prefix)', () => {
    const parsed = parseFullKey('auth/login');
    expect(parsed).toBe('auth/login');
  });

  it('normalizes keys when parsing slug-only keys', () => {
    // Arrange
    const inputs = ['/auth/login/', 'auth\\login', '\\auth\\login\\'];

    // Act
    const parsed = inputs.map((k) => parseFullKey(k));

    // Assert
    expect(parsed).toEqual(['auth/login', 'auth/login', 'auth/login']);
  });

  it('rejects invalid keys', () => {
    expect(() => parseFullKey('')).toThrow();
    expect(() => parseFullKey('::auth/login')).toThrow();
    expect(() => parseFullKey('a::b::c')).toThrow();
    expect(() => parseFullKey('auth//login')).toThrow();
    expect(() => parseFullKey('auth/./login')).toThrow();
    expect(() => parseFullKey('auth/../login')).toThrow();
  });

  it('maps key to .zipbul/cards path', () => {
    const root = '/repo';
    expect(cardPathFromFullKey(root, 'auth/login')).toBe(zipbulCardMarkdownPath(root, 'auth/login'));
    expect(cardPathFromFullKey(root, 'auth')).toBe(zipbulCardMarkdownPath(root, 'auth'));
    expect(cardPathFromFullKey(root, '/auth/login/')).toBe(zipbulCardMarkdownPath(root, 'auth/login'));
  });
});
