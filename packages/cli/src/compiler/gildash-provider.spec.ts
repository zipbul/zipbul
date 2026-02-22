import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';

import type { IndexResult } from '@zipbul/gildash';

// mock.module must be called before SUT import so that gildash-provider.ts
// receives the mock when it imports '@zipbul/gildash'.
const mockClose = mock(async () => {});
const mockGetDependencies = mock((_filePath: string) => ['dep-a.ts', 'dep-b.ts']);
const mockGetDependents = mock((_filePath: string) => ['dep-on-a.ts']);
const mockGetAffected = mock(async (_files: string[]) => ['affected-a.ts']);
const mockHasCycle = mock(async () => false);
const mockOnIndexedUnsubscribe = mock(() => {});
const mockOnIndexed = mock((_cb: (r: IndexResult) => void) => mockOnIndexedUnsubscribe);

const mockLedger = {
  close: mockClose,
  getDependencies: mockGetDependencies,
  getDependents: mockGetDependents,
  getAffected: mockGetAffected,
  hasCycle: mockHasCycle,
  onIndexed: mockOnIndexed,
};

const mockGildashOpen = mock(async (_opts: unknown) => mockLedger);

mock.module('@zipbul/gildash', () => ({
  Gildash: {
    open: mockGildashOpen,
  },
  GildashError: class GildashError extends Error {},
}));

// Dynamic import ensures the mock is applied before module evaluation.
const { GildashProvider } = await import('./gildash-provider');

describe('GildashProvider', () => {
  afterEach(() => {
    mockGildashOpen.mockClear();
    mockClose.mockClear();
    mockGetDependencies.mockClear();
    mockGetDependents.mockClear();
    mockGetAffected.mockClear();
    mockHasCycle.mockClear();
    mockOnIndexed.mockClear();
    mockOnIndexedUnsubscribe.mockClear();
  });

  it('should call Gildash.open() with projectRoot when options provided', async () => {
    // Arrange
    const options = { projectRoot: '/my/project' };

    // Act
    await GildashProvider.open(options);

    // Assert
    expect(mockGildashOpen).toHaveBeenCalledTimes(1);
    expect(mockGildashOpen.mock.calls[0]?.[0]).toMatchObject({ projectRoot: '/my/project' });
  });

  it('should call Gildash.open() with extensions when provided', async () => {
    // Arrange
    const options = { projectRoot: '/my/project', extensions: ['.ts', '.tsx'] };

    // Act
    await GildashProvider.open(options);

    // Assert
    expect(mockGildashOpen.mock.calls[0]?.[0]).toMatchObject({ extensions: ['.ts', '.tsx'] });
  });

  it('should call Gildash.open() with ignorePatterns when provided', async () => {
    // Arrange
    const options = { projectRoot: '/my/project', ignorePatterns: ['dist', 'node_modules'] };

    // Act
    await GildashProvider.open(options);

    // Assert
    expect(mockGildashOpen.mock.calls[0]?.[0]).toMatchObject({ ignorePatterns: ['dist', 'node_modules'] });
  });

  it('should delegate to ledger.close() when close() is called', async () => {
    // Arrange
    const provider = await GildashProvider.open({ projectRoot: '/p' });

    // Act
    await provider.close();

    // Assert
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('should delegate to ledger.getDependencies() and return result when getDependencies() is called', async () => {
    // Arrange
    const provider = await GildashProvider.open({ projectRoot: '/p' });

    // Act
    const result = provider.getDependencies('/some/file.ts');

    // Assert
    expect(mockGetDependencies).toHaveBeenCalledWith('/some/file.ts');
    expect(result).toEqual(['dep-a.ts', 'dep-b.ts']);
  });

  it('should delegate to ledger.getDependents() and return result when getDependents() is called', async () => {
    // Arrange
    const provider = await GildashProvider.open({ projectRoot: '/p' });

    // Act
    const result = provider.getDependents('/some/file.ts');

    // Assert
    expect(mockGetDependents).toHaveBeenCalledWith('/some/file.ts');
    expect(result).toEqual(['dep-on-a.ts']);
  });

  it('should delegate to ledger.getAffected() and return result when getAffected() is called', async () => {
    // Arrange
    const provider = await GildashProvider.open({ projectRoot: '/p' });

    // Act
    const result = await provider.getAffected(['/changed.ts']);

    // Assert
    expect(mockGetAffected).toHaveBeenCalledWith(['/changed.ts']);
    expect(result).toEqual(['affected-a.ts']);
  });

  it('should return false when ledger.hasCycle() returns false', async () => {
    // Arrange
    mockHasCycle.mockResolvedValueOnce(false);
    const provider = await GildashProvider.open({ projectRoot: '/p' });

    // Act
    const result = await provider.hasCycle();

    // Assert
    expect(result).toBe(false);
  });

  it('should return true when ledger.hasCycle() returns true', async () => {
    // Arrange
    mockHasCycle.mockResolvedValueOnce(true);
    const provider = await GildashProvider.open({ projectRoot: '/p' });

    // Act
    const result = await provider.hasCycle();

    // Assert
    expect(result).toBe(true);
  });

  it('should delegate to ledger.onIndexed() and return unsubscribe function when onIndexed() is called', async () => {
    // Arrange
    const provider = await GildashProvider.open({ projectRoot: '/p' });
    const callback = mock((_r: IndexResult) => {});

    // Act
    const unsubscribe = provider.onIndexed(callback);

    // Assert
    expect(mockOnIndexed).toHaveBeenCalledTimes(1);
    expect(typeof unsubscribe).toBe('function');

    // Verify unsubscribe delegates to ledger's unsubscribe
    unsubscribe();
    expect(mockOnIndexedUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('should propagate rejection when Gildash.open() rejects', async () => {
    // Arrange
    const err = new Error('open failed');

    mockGildashOpen.mockRejectedValueOnce(err);

    // Act & Assert
    await expect(GildashProvider.open({ projectRoot: '/p' })).rejects.toThrow('open failed');
  });

  it('should delegate empty array and return empty array when getAffected() is called with empty changedFiles', async () => {
    // Arrange
    mockGetAffected.mockResolvedValueOnce([]);
    const provider = await GildashProvider.open({ projectRoot: '/p' });

    // Act
    const result = await provider.getAffected([]);

    // Assert
    expect(mockGetAffected).toHaveBeenCalledWith([]);
    expect(result).toEqual([]);
  });
});
