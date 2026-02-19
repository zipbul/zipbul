import { describe, it, expect } from 'bun:test';
import {
  CardValidationError,
  CardNotFoundError,
  CardAlreadyExistsError,
  CardRenameSamePathError,
  RelationTypeError,
} from './errors';

// ── CardValidationError ──────────────────────────────────────────────────────

describe('CardValidationError', () => {
  it('should set message, name, and be instanceof Error when constructed', () => {
    // Arrange / Act
    const err = new CardValidationError('frontmatter missing key');
    // Assert
    expect(err.message).toBe('frontmatter missing key');
    expect(err.name).toBe('CardValidationError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CardValidationError);
  });

  it('should allow empty string message when empty string given', () => {
    // Arrange / Act
    const err = new CardValidationError('');
    // Assert
    expect(err.message).toBe('');
  });

  it('should be catchable as CardValidationError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new CardValidationError('bad field'); }).toThrow(CardValidationError);
  });
});

// ── CardNotFoundError ────────────────────────────────────────────────────────

describe('CardNotFoundError', () => {
  it('should format message with key and set name when constructed', () => {
    // Arrange / Act
    const err = new CardNotFoundError('my-card');
    // Assert
    expect(err.message).toBe('Card not found: my-card');
    expect(err.name).toBe('CardNotFoundError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CardNotFoundError);
  });

  it('should produce "Card not found: " when empty key given', () => {
    // Arrange / Act
    const err = new CardNotFoundError('');
    // Assert
    expect(err.message).toBe('Card not found: ');
  });

  it('should include nested key in message when nested slug given', () => {
    // Arrange / Act
    const err = new CardNotFoundError('parent/child/item');
    // Assert
    expect(err.message).toContain('parent/child/item');
  });

  it('should be catchable as CardNotFoundError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new CardNotFoundError('k'); }).toThrow(CardNotFoundError);
  });

  it('should produce identical messages when same key given twice', () => {
    // Arrange / Act
    const a = new CardNotFoundError('dup-key');
    const b = new CardNotFoundError('dup-key');
    // Assert
    expect(a.message).toBe(b.message);
  });
});

// ── CardAlreadyExistsError ───────────────────────────────────────────────────

describe('CardAlreadyExistsError', () => {
  it('should format message with key and set name when constructed', () => {
    // Arrange / Act
    const err = new CardAlreadyExistsError('existing-card');
    // Assert
    expect(err.message).toBe('Card already exists: existing-card');
    expect(err.name).toBe('CardAlreadyExistsError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CardAlreadyExistsError);
  });

  it('should produce "Card already exists: " when empty key given', () => {
    // Arrange / Act
    const err = new CardAlreadyExistsError('');
    // Assert
    expect(err.message).toBe('Card already exists: ');
  });

  it('should be catchable as CardAlreadyExistsError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new CardAlreadyExistsError('k'); }).toThrow(CardAlreadyExistsError);
  });
});

// ── CardRenameSamePathError ──────────────────────────────────────────────────

describe('CardRenameSamePathError', () => {
  it('should set fixed message and name when constructed', () => {
    // Arrange / Act
    const err = new CardRenameSamePathError();
    // Assert
    expect(err.message).toBe('No-op rename: source and target paths are identical');
    expect(err.name).toBe('CardRenameSamePathError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CardRenameSamePathError);
  });

  it('should be catchable as CardRenameSamePathError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new CardRenameSamePathError(); }).toThrow(CardRenameSamePathError);
  });

  it('should produce identical messages for two separate instances', () => {
    // Arrange / Act
    const a = new CardRenameSamePathError();
    const b = new CardRenameSamePathError();
    // Assert
    expect(a.message).toBe(b.message);
  });
});

// ── RelationTypeError ────────────────────────────────────────────────────────

describe('RelationTypeError', () => {
  it('should include type and allowed list in message and set name when constructed', () => {
    // Arrange / Act
    const err = new RelationTypeError('unknown', ['depends-on', 'related']);
    // Assert
    expect(err.message).toContain('"unknown"');
    expect(err.message).toContain('depends-on, related');
    expect(err.name).toBe('RelationTypeError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RelationTypeError);
  });

  it('should include empty-string type as "" in message when type is empty', () => {
    // Arrange / Act
    const err = new RelationTypeError('', ['related']);
    // Assert
    expect(err.message).toContain('""');
  });

  it('should produce empty allowed listing when allowed is empty array', () => {
    // Arrange / Act
    const err = new RelationTypeError('bad', []);
    // Assert
    expect(err.message).toContain('Allowed: ');
    // join('') on [] = ''
    expect(err.message.endsWith('Allowed: ')).toBe(true);
  });

  it('should produce single-item listing when allowed has one entry', () => {
    // Arrange / Act
    const err = new RelationTypeError('bad', ['only-type']);
    // Assert
    expect(err.message).toContain('only-type');
  });

  it('should be catchable as RelationTypeError when thrown', () => {
    // Arrange / Act / Assert
    expect(() => { throw new RelationTypeError('x', ['a']); }).toThrow(RelationTypeError);
  });
});
