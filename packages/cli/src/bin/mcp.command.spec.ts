import { afterEach, describe, expect, it } from 'bun:test';

import { __testing__ } from './mcp.command';
import type { ResolvedZipbulConfig } from '../config';

const testConfig: ResolvedZipbulConfig = {
  module: { fileName: 'module.ts' },
  sourceDir: './src',
  entry: './src/main.ts',
  mcp: {
    exclude: [],
  },
};

describe('createMcpCommand', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it('should call ensureRepo before loadConfig on mcp (serve only)', async () => {
    // Arrange
    const calls: string[] = [];
    const cmd = __testing__.createMcpCommand({
      ensureRepo: async () => {
        calls.push('ensureRepo');
      },
      loadConfig: async () => {
        calls.push('loadConfig');
        return { config: testConfig };
      },
      rebuildProjectIndex: async () => {
        calls.push('rebuildProjectIndex');
        return { ok: true };
      },
      startServer: async () => {
        calls.push('startServer');
      },
      reportInvalidSubcommand: () => {
        calls.push('invalidSubcommand');
      },
    });

    // Act
    await cmd([], {});

    // Assert
    expect(calls).toEqual(['ensureRepo', 'loadConfig', 'startServer']);
  });
});
