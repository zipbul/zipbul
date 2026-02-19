import { describe, it, expect, mock, spyOn } from 'bun:test';
import type { CardFile } from '../../src/card/types';
import { writeCardFile, deleteCardFile } from '../../src/fs/writer';
import { serializeCardMarkdown } from '../../src/card/markdown';

// ---- Fixtures ----
// serializeCardMarkdown/parseCardMarkdown are pure functions (no I/O) — real impl used.
// Only Bun.write / Bun.file (I/O) are spied on.

const CARD_FIXTURE: CardFile = {
  frontmatter: { key: 'k', summary: 's', status: 'draft' },
  body: 'body',
  filePath: '/cards/k.card.md',
};

// Pre-compute expected serialization using real serializeCardMarkdown
const EXPECTED_SERIALIZED = serializeCardMarkdown(CARD_FIXTURE.frontmatter, CARD_FIXTURE.body);

// ---- writeCardFile ----

describe('writeCardFile', () => {
  // HP
  it('should call Bun.write with filePath and serialized text when called', async () => {
    // Arrange
    const filePath = '/cards/k.card.md';
    const writeSpy = spyOn(Bun, 'write').mockResolvedValue(EXPECTED_SERIALIZED.length as unknown as number);
    // Act
    await writeCardFile(filePath, CARD_FIXTURE);
    // Assert
    expect(writeSpy).toHaveBeenCalledWith(filePath, EXPECTED_SERIALIZED);
    writeSpy.mockRestore();
  });

  it('should pass filePath as first argument to Bun.write when called', async () => {
    // Arrange
    const filePath = '/some/path/card.card.md';
    const writeSpy = spyOn(Bun, 'write').mockResolvedValue(0 as unknown as number);
    // Act
    await writeCardFile(filePath, CARD_FIXTURE);
    // Assert
    const [firstArg] = writeSpy.mock.calls[0] ?? [];
    expect(firstArg).toBe(filePath);
    writeSpy.mockRestore();
  });

  it('should call Bun.write exactly once when called', async () => {
    // Arrange
    const writeSpy = spyOn(Bun, 'write').mockResolvedValue(0 as unknown as number);
    // Act
    await writeCardFile('/cards/k.card.md', CARD_FIXTURE);
    // Assert
    expect(writeSpy).toHaveBeenCalledTimes(1);
    writeSpy.mockRestore();
  });

  it('should resolve void when Bun.write resolves', async () => {
    // Arrange
    const writeSpy = spyOn(Bun, 'write').mockResolvedValue(0 as unknown as number);
    // Act
    const result = await writeCardFile('/cards/k.card.md', CARD_FIXTURE);
    // Assert
    expect(result).toBeUndefined();
    writeSpy.mockRestore();
  });

  // NE
  it('should reject when Bun.write rejects', async () => {
    // Arrange
    const writeError = new Error('write error');
    const writeSpy = spyOn(Bun, 'write').mockRejectedValue(writeError);
    // Act / Assert
    await expect(writeCardFile('/cards/k.card.md', CARD_FIXTURE)).rejects.toThrow('write error');
    writeSpy.mockRestore();
  });
});

// ---- deleteCardFile ----

describe('deleteCardFile', () => {
  // HP
  it('should call file.delete() once when file.exists() returns true', async () => {
    // Arrange
    const mockDelete = mock(async () => {});
    const mockExists = mock(async () => true);
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mockExists,
      delete: mockDelete,
    } as unknown as ReturnType<typeof Bun.file>);
    // Act
    await deleteCardFile('/cards/k.card.md');
    // Assert
    expect(mockDelete).toHaveBeenCalledTimes(1);
    fileSpy.mockRestore();
  });

  it('should not call file.delete() when file.exists() returns false', async () => {
    // Arrange
    const mockDelete = mock(async () => {});
    const mockExists = mock(async () => false);
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mockExists,
      delete: mockDelete,
    } as unknown as ReturnType<typeof Bun.file>);
    // Act
    await deleteCardFile('/cards/k.card.md');
    // Assert
    expect(mockDelete).toHaveBeenCalledTimes(0);
    fileSpy.mockRestore();
  });

  it('should call Bun.file with given filePath once when invoked', async () => {
    // Arrange
    const filePath = '/cards/k.card.md';
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => false),
      delete: mock(async () => {}),
    } as unknown as ReturnType<typeof Bun.file>);
    // Act
    await deleteCardFile(filePath);
    // Assert
    expect(fileSpy).toHaveBeenCalledTimes(1);
    expect(fileSpy).toHaveBeenCalledWith(filePath);
    fileSpy.mockRestore();
  });

  it('should call file.exists() once when invoked', async () => {
    // Arrange
    const mockExists = mock(async () => false);
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mockExists,
      delete: mock(async () => {}),
    } as unknown as ReturnType<typeof Bun.file>);
    // Act
    await deleteCardFile('/cards/k.card.md');
    // Assert
    expect(mockExists).toHaveBeenCalledTimes(1);
    fileSpy.mockRestore();
  });

  it('should resolve void without calling delete when file does not exist', async () => {
    // Arrange
    const mockDelete = mock(async () => {});
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => false),
      delete: mockDelete,
    } as unknown as ReturnType<typeof Bun.file>);
    // Act
    const result = await deleteCardFile('/cards/k.card.md');
    // Assert
    expect(result).toBeUndefined();
    expect(mockDelete).toHaveBeenCalledTimes(0);
    fileSpy.mockRestore();
  });

  // NE
  it('should reject when file.exists() rejects', async () => {
    // Arrange
    const existsError = new Error('exists error');
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => { throw existsError; }),
      delete: mock(async () => {}),
    } as unknown as ReturnType<typeof Bun.file>);
    // Act / Assert
    await expect(deleteCardFile('/cards/k.card.md')).rejects.toThrow('exists error');
    fileSpy.mockRestore();
  });

  it('should reject when file.delete() rejects and file exists', async () => {
    // Arrange
    const deleteError = new Error('delete error');
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => true),
      delete: mock(async () => { throw deleteError; }),
    } as unknown as ReturnType<typeof Bun.file>);
    // Act / Assert
    await expect(deleteCardFile('/cards/k.card.md')).rejects.toThrow('delete error');
    fileSpy.mockRestore();
  });

  // ED
  it('should call Bun.file with empty string when filePath is empty', async () => {
    // Arrange
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => false),
      delete: mock(async () => {}),
    } as unknown as ReturnType<typeof Bun.file>);
    // Act
    await deleteCardFile('');
    // Assert
    expect(fileSpy).toHaveBeenCalledWith('');
    fileSpy.mockRestore();
  });

  // ID
  it('should not call delete when called twice and file does not exist', async () => {
    // Arrange
    const mockDelete = mock(async () => {});
    const fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: mock(async () => false),
      delete: mockDelete,
    } as unknown as ReturnType<typeof Bun.file>);
    // Act
    await deleteCardFile('/cards/k.card.md');
    await deleteCardFile('/cards/k.card.md');
    // Assert
    expect(mockDelete).toHaveBeenCalledTimes(0);
    fileSpy.mockRestore();
  });
});
