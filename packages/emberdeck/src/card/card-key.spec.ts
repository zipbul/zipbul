import { describe, it, expect } from 'bun:test';
import { normalizeSlug, parseFullKey, buildCardPath, CardKeyError } from './card-key';

describe('normalizeSlug', () => {
  // HP
  it('should return "my-card" when input is valid simple slug', () => {
    // Arrange
    const slug = 'my-card';
    // Act
    const result = normalizeSlug(slug);
    // Assert
    expect(result).toBe('my-card');
  });

  it('should return "parent/child" when nested path given', () => {
    // Arrange
    const slug = 'parent/child';
    // Act
    const result = normalizeSlug(slug);
    // Assert
    expect(result).toBe('parent/child');
  });

  it('should return "foo/bar" when backslash given', () => {
    // Arrange
    const slug = 'foo\\bar';
    // Act
    const result = normalizeSlug(slug);
    // Assert
    expect(result).toBe('foo/bar');
  });

  it('should return "my-card" when leading slash given', () => {
    // Arrange
    const slug = '/my-card';
    // Act
    const result = normalizeSlug(slug);
    // Assert
    expect(result).toBe('my-card');
  });

  it('should return "feat.v1" when dot in slug', () => {
    // Arrange
    const slug = 'feat.v1';
    // Act
    const result = normalizeSlug(slug);
    // Assert
    expect(result).toBe('feat.v1');
  });

  // NE
  it('should throw CardKeyError when empty string', () => {
    // Arrange / Act / Assert
    expect(() => normalizeSlug('')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when dot-segment "../traverse"', () => {
    expect(() => normalizeSlug('../traverse')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when dot-only ".."', () => {
    expect(() => normalizeSlug('..')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when drive letter "C:/path"', () => {
    expect(() => normalizeSlug('C:/path')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when double colon "key::ann"', () => {
    expect(() => normalizeSlug('key::ann')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when single colon "key:colon"', () => {
    expect(() => normalizeSlug('key:colon')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when space in slug', () => {
    expect(() => normalizeSlug('has space')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when double slash inside "a//b"', () => {
    expect(() => normalizeSlug('a//b')).toThrow(CardKeyError);
  });

  // ED
  it('should return "a" when single char slug', () => {
    // Arrange
    const slug = 'a';
    // Act
    const result = normalizeSlug(slug);
    // Assert
    expect(result).toBe('a');
  });

  it('should throw CardKeyError when slash-only "/"', () => {
    // "/" → trim → "" → regex fail
    expect(() => normalizeSlug('/')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when non-ASCII characters', () => {
    expect(() => normalizeSlug('한국어')).toThrow(CardKeyError);
  });

  // CO
  it('should throw CardKeyError when backslash+dot traverse "\\\\/../"', () => {
    expect(() => normalizeSlug('\\/../')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when single dot "."', () => {
    expect(() => normalizeSlug('.')).toThrow(CardKeyError);
  });

  // ID
  it('should return same result when called twice with same input', () => {
    // Arrange
    const slug = 'my-card';
    // Act
    const first = normalizeSlug(slug);
    const second = normalizeSlug(slug);
    // Assert
    expect(first).toBe(second);
  });
});

describe('parseFullKey', () => {
  // HP
  it('should return "spec/api" when valid fullKey given', () => {
    // Arrange
    const key = 'spec/api';
    // Act
    const result = parseFullKey(key);
    // Assert
    expect(result).toBe('spec/api');
  });

  // NE
  it('should throw CardKeyError when empty string', () => {
    expect(() => parseFullKey('')).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when null given', () => {
    expect(() => parseFullKey(null as unknown as string)).toThrow(CardKeyError);
  });

  it('should throw CardKeyError when number given', () => {
    expect(() => parseFullKey(123 as unknown as string)).toThrow(CardKeyError);
  });

  // CO
  it('should throw CardKeyError when undefined given', () => {
    expect(() => parseFullKey(undefined as unknown as string)).toThrow(CardKeyError);
  });
});

describe('buildCardPath', () => {
  // HP
  it('should return "/cards/api.card.md" when cardsDir="/cards" and slug="api"', () => {
    // Arrange
    const cardsDir = '/cards';
    const slug = 'api';
    // Act
    const result = buildCardPath(cardsDir, slug);
    // Assert
    expect(result).toBe('/cards/api.card.md');
  });

  it('should return "/base/specs/api.card.md" when nested slug given', () => {
    // Arrange
    const cardsDir = '/base';
    const slug = 'specs/api';
    // Act
    const result = buildCardPath(cardsDir, slug);
    // Assert
    expect(result).toBe('/base/specs/api.card.md');
  });
});
