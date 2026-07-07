import { describe, it, expect } from 'bun:test';
import { augmentRawKey, augmentValidatedKey } from './augment-keys';

describe('augment keys', () => {
  it('should derive deterministic raw keys via Symbol.for', () => {
    // Arrange & Act & Assert
    expect(augmentRawKey('request', 'getQuery')).toBe(Symbol.for('zipbul.augment.request.getQuery.raw'));
  });

  it('should derive deterministic validated keys via Symbol.for', () => {
    // Arrange & Act & Assert
    expect(augmentValidatedKey('request', 'getQuery')).toBe(Symbol.for('zipbul.augment.request.getQuery.validated'));
  });

  it('should return identical symbols across repeated calls (multi-boot idempotency)', () => {
    // Arrange & Act & Assert
    expect(augmentRawKey('a', 'b')).toBe(augmentRawKey('a', 'b'));
  });
});
