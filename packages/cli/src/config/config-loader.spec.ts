import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { join } from 'path';

// MUST: MUST-10 (config source 선택)
// MUST: MUST-11 (json/jsonc 파싱)
// MUST: MUST-12 (sourceDir/entry/module.fileName 검증)

import type { FileSetup } from '../../test/shared/interfaces';

import { createBunFileStub } from '../../test/shared/stubs';
import { ConfigLoader } from './config-loader';
import { ConfigLoadError } from './errors';

describe('ConfigLoader', () => {
  const projectRoot = '/project';
  const jsonPath = join(projectRoot, 'zipbul.json');
  const jsoncPath = join(projectRoot, 'zipbul.jsonc');
  let setup: FileSetup;
  let bunFileSpy: ReturnType<typeof spyOn> | undefined;
  let consoleErrorSpy: ReturnType<typeof spyOn> | undefined;
  let jsonParseSpy: ReturnType<typeof spyOn> | undefined;
  let jsoncParseSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    setup = {
      existsByPath: new Map<string, boolean>(),
      textByPath: new Map<string, string>(),
    };

    bunFileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
      return createBunFileStub(setup, String(path)) as any;
    });

    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    jsonParseSpy = spyOn(JSON, 'parse');
    jsoncParseSpy = spyOn(Bun.JSONC, 'parse');
  });

  afterEach(() => {
    bunFileSpy?.mockRestore();
    consoleErrorSpy?.mockRestore();
    jsonParseSpy?.mockRestore();
    jsoncParseSpy?.mockRestore();
  });

  it('should throw when both zipbul.json and zipbul.jsonc exist', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, true);

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should throw when zipbul config is missing', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, false);
    setup.existsByPath.set(jsoncPath, false);

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject entry outside sourceDir when entry is not within sourceDir', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: '__module__.ts' },
          sourceDir: 'src',
          entry: 'main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject entry when it points to the sourceDir itself (empty relative path)', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: '__module__.ts' },
          sourceDir: 'src',
          entry: 'src',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject module.fileName containing a path when module.fileName is not a single filename', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: 'modules/__module__.ts' },
          sourceDir: 'src',
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject module.fileName containing backslash when module.fileName is not a single filename', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: 'modules\\__module__.ts' },
          sourceDir: 'src',
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should load valid json config when sourceDir and entry are valid', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: '__module__.ts' },
          sourceDir: 'src',
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act
    const result = await ConfigLoader.load(projectRoot);

    // Assert
    expect(result.source.format).toBe('json');
    expect(result.config.sourceDir).toBe('src');
    expect(result.config.entry).toBe('src/main.ts');
  });

  it('should load valid jsonc config when config contains comments', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, false);
    setup.existsByPath.set(jsoncPath, true);
    setup.textByPath.set(
      jsoncPath,
      [
        '{',
        '  // This is a comment',
        '  "module": { "fileName": "__module__.ts" },',
        '  "sourceDir": "src",',
        '  "entry": "src/main.ts"',
        '}',
      ].join('\n'),
    );

    // Act
    const result = await ConfigLoader.load(projectRoot);

    // Assert
    expect(result.source.format).toBe('jsonc');
    expect(result.config.module.fileName).toBe('__module__.ts');
    expect(result.config.sourceDir).toBe('src');
    expect(result.config.entry).toBe('src/main.ts');
  });

  it('should reject config missing module field when module is undefined', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          sourceDir: 'src',
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config missing module field when module is null', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: null,
          sourceDir: 'src',
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config missing module field when module is an array', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: [],
          sourceDir: 'src',
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config when top-level json is not an object', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(jsonPath, JSON.stringify(['not-an-object'], null, 2));

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config when module is not an object', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: 'invalid',
          sourceDir: 'src',
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config when module.fileName is not a string', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: 123 },
          sourceDir: 'src',
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config when sourceDir is not a string', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: '__module__.ts' },
          sourceDir: 123,
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config when entry is not a string', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: '__module__.ts' },
          sourceDir: 'src',
          entry: 123,
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config missing sourceDir field when sourceDir is undefined', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: '__module__.ts' },
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config missing entry field when entry is undefined', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: '__module__.ts' },
          sourceDir: 'src',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject config with empty module.fileName when module.fileName is empty', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(
      jsonPath,
      JSON.stringify(
        {
          module: { fileName: '' },
          sourceDir: 'src',
          entry: 'src/main.ts',
        },
        null,
        2,
      ),
    );

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should reject malformed json when JSON.parse fails', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);
    setup.textByPath.set(jsonPath, '{ invalid json }');

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  it('should wrap non-ConfigLoadError exceptions into ConfigLoadError', async () => {
    // Arrange
    setup.existsByPath.set(jsonPath, true);
    setup.existsByPath.set(jsoncPath, false);

    bunFileSpy!.mockImplementation((path: any) => {
      const p = String(path);
      if (p === jsonPath) {
        return {
          exists: async () => true,
          text: async () => {
            throw new Error('read failed');
          },
        } as any;
      }
      return createBunFileStub(setup, p) as any;
    });

    // Act & Assert
    await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
  });

  describe('mcp config', () => {
    it('should call JSON.parse when zipbul.json is used', async () => {
      // Arrange
      setup.existsByPath.set(jsonPath, true);
      setup.existsByPath.set(jsoncPath, false);
      setup.textByPath.set(
        jsonPath,
        JSON.stringify(
          {
            module: { fileName: '__module__.ts' },
            sourceDir: 'src',
            entry: 'src/main.ts',
          },
          null,
          2,
        ),
      );

      // Act
      await ConfigLoader.load(projectRoot);

      // Assert
      expect(jsonParseSpy).toHaveBeenCalledTimes(1);
      expect(jsoncParseSpy).toHaveBeenCalledTimes(0);
    });

    it('should call Bun.JSONC.parse when zipbul.jsonc is used', async () => {
      // Arrange
      setup.existsByPath.set(jsonPath, false);
      setup.existsByPath.set(jsoncPath, true);
      setup.textByPath.set(
        jsoncPath,
        [
          '{',
          '  // This is a comment',
          '  "module": { "fileName": "__module__.ts" },',
          '  "sourceDir": "src",',
          '  "entry": "src/main.ts"',
          '}',
        ].join('\n'),
      );

      // Act
      await ConfigLoader.load(projectRoot);

      // Assert
      expect(jsoncParseSpy).toHaveBeenCalledTimes(1);
      expect(jsonParseSpy).toHaveBeenCalledTimes(0);
    });

  });

  describe('mcp.exclude config', () => {
    it('should use empty array as default when mcp.exclude is omitted', async () => {
      // Arrange
      setup.existsByPath.set(jsonPath, true);
      setup.existsByPath.set(jsoncPath, false);
      setup.textByPath.set(
        jsonPath,
        JSON.stringify(
          {
            module: { fileName: '__module__.ts' },
            sourceDir: 'src',
            entry: 'src/main.ts',
          },
          null,
          2,
        ),
      );

      // Act
      const result = await ConfigLoader.load(projectRoot);

      // Assert
      expect(result.config.mcp.exclude).toEqual([]);
    });

    it('should use custom mcp.exclude patterns when mcp.exclude is provided', async () => {
      // Arrange
      setup.existsByPath.set(jsonPath, true);
      setup.existsByPath.set(jsoncPath, false);
      setup.textByPath.set(
        jsonPath,
        JSON.stringify(
          {
            module: { fileName: '__module__.ts' },
            sourceDir: 'src',
            entry: 'src/main.ts',
            mcp: {
              exclude: ['**/test/**', '**/fixtures/**'],
            },
          },
          null,
          2,
        ),
      );

      // Act
      const result = await ConfigLoader.load(projectRoot);

      // Assert
      expect(result.config.mcp.exclude).toEqual(['**/test/**', '**/fixtures/**']);
    });

    it('should reject mcp.exclude when it is not a string array', async () => {
      // Arrange
      setup.existsByPath.set(jsonPath, true);
      setup.existsByPath.set(jsoncPath, false);
      setup.textByPath.set(
        jsonPath,
        JSON.stringify(
          {
            module: { fileName: '__module__.ts' },
            sourceDir: 'src',
            entry: 'src/main.ts',
            mcp: {
              exclude: [1, 2, 3],
            },
          },
          null,
          2,
        ),
      );

      // Act & Assert
      await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
    });

    it('should reject mcp.exclude when it is null', async () => {
      // Arrange
      setup.existsByPath.set(jsonPath, true);
      setup.existsByPath.set(jsoncPath, false);
      setup.textByPath.set(
        jsonPath,
        JSON.stringify(
          {
            module: { fileName: '__module__.ts' },
            sourceDir: 'src',
            entry: 'src/main.ts',
            mcp: {
              exclude: null,
            },
          },
          null,
          2,
        ),
      );

      // Act & Assert
      await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
    });

    it('should reject mcp.exclude when it is a string', async () => {
      // Arrange
      setup.existsByPath.set(jsonPath, true);
      setup.existsByPath.set(jsoncPath, false);
      setup.textByPath.set(
        jsonPath,
        JSON.stringify(
          {
            module: { fileName: '__module__.ts' },
            sourceDir: 'src',
            entry: 'src/main.ts',
            mcp: {
              exclude: 'src/**',
            },
          },
          null,
          2,
        ),
      );

      // Act & Assert
      await expect(ConfigLoader.load(projectRoot)).rejects.toBeInstanceOf(ConfigLoadError);
    });
  });
});