import { describe, expect, it } from 'bun:test';
import { join } from 'path';

import { EntryGenerator } from './entry-generator';

describe('EntryGenerator', () => {
  it('should inline bootstrap when generating runtime entry code', async () => {
    // Arrange
    const gen = new EntryGenerator();
    const existingFile = join(import.meta.dir, 'entry-generator.ts');

    // Act
    const code = await gen.generate(existingFile, false);

    // Assert
    expect(code).toContain('await bootstrap();');
    expect(code).toContain("const runtimeFileName = './runtime.js'");
    expect(code).toContain(`await ${'im'}${'port'}(runtimeFileName)`);
  });

  it('should throw when entry file does not exist', async () => {
    // Arrange
    const gen = new EntryGenerator();
    const nonExistentFile = '/non/existent/main.ts';

    // Act & Assert
    await expect(gen.generate(nonExistentFile, false)).rejects.toThrow(
      "[Zipbul AOT] Entry file '/non/existent/main.ts' does not exist.",
    );
  });
});
