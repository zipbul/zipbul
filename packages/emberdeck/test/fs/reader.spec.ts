import { describe, it, expect, mock, spyOn } from 'bun:test';
import { readCardFile } from '../../src/fs/reader';

// ---- Fixtures ----
// parseCardMarkdown/serializeCardMarkdown are pure functions (no I/O) — real impl used.
// Only Bun.file (I/O) is spied on.

const VALID_MARKDOWN = '---\nkey: test/card\nsummary: A test card\nstatus: draft\n---\nbody content';

// ---- Tests ----

describe('readCardFile', () => {
  // HP
  it('should return CardFile when Bun.file().text() and parseCardMarkdown succeed', async () => {
    // Arrange
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => VALID_MARKDOWN),
    } as ReturnType<typeof Bun.file>);
    // Act
    const result = await readCardFile('/cards/test/card.card.md');
    // Assert
    expect(result.frontmatter.key).toBe('test/card');
    expect(result.frontmatter.summary).toBe('A test card');
    expect(result.body).toBe('body content');
    fileSpy.mockRestore();
  });

  it('should set filePath field to given argument when parsing succeeds', async () => {
    // Arrange
    const filePath = '/cards/test/card.card.md';
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => VALID_MARKDOWN),
    } as ReturnType<typeof Bun.file>);
    // Act
    const result = await readCardFile(filePath);
    // Assert
    expect(result.filePath).toBe(filePath);
    fileSpy.mockRestore();
  });

  it('should call Bun.file with given filePath once when invoked', async () => {
    // Arrange
    const filePath = '/cards/test/card.card.md';
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => VALID_MARKDOWN),
    } as ReturnType<typeof Bun.file>);
    // Act
    await readCardFile(filePath);
    // Assert
    expect(fileSpy).toHaveBeenCalledTimes(1);
    expect(fileSpy).toHaveBeenCalledWith(filePath);
    fileSpy.mockRestore();
  });

  // NE
  it('should reject when Bun.file().text() rejects', async () => {
    // Arrange
    const error = new Error('read error');
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => { throw error; }),
    } as ReturnType<typeof Bun.file>);
    // Act / Assert
    await expect(readCardFile('/cards/missing.card.md')).rejects.toThrow('read error');
    fileSpy.mockRestore();
  });

  it('should throw when parseCardMarkdown throws due to invalid markdown', async () => {
    // Arrange: text without --- frontmatter triggers CardValidationError
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => 'no frontmatter at all'),
    } as ReturnType<typeof Bun.file>);
    // Act / Assert
    await expect(readCardFile('/cards/bad.card.md')).rejects.toThrow();
    fileSpy.mockRestore();
  });

  it('should call Bun.file with empty string when filePath is empty string', async () => {
    // Arrange
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => VALID_MARKDOWN),
    } as ReturnType<typeof Bun.file>);
    // Act
    await readCardFile('');
    // Assert
    expect(fileSpy).toHaveBeenCalledWith('');
    fileSpy.mockRestore();
  });

  // ED
  it('should call Bun.file with single-char filePath when "a" given', async () => {
    // Arrange
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => VALID_MARKDOWN),
    } as ReturnType<typeof Bun.file>);
    // Act
    await readCardFile('a');
    // Assert
    expect(fileSpy).toHaveBeenCalledWith('a');
    fileSpy.mockRestore();
  });

  // ID
  it('should return same result when called twice with same mocked output', async () => {
    // Arrange
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      text: mock(async () => VALID_MARKDOWN),
    } as ReturnType<typeof Bun.file>);
    // Act
    const first = await readCardFile('/cards/x.card.md');
    const second = await readCardFile('/cards/x.card.md');
    // Assert
    expect(first.frontmatter).toEqual(second.frontmatter);
    expect(first.body).toBe(second.body);
    fileSpy.mockRestore();
  });
});
