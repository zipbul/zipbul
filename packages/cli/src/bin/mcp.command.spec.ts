import { afterEach, describe, expect, it } from 'bun:test';

import { __testing__ } from './mcp.command';
import type { ResolvedBunnerConfig } from '../config';

const testConfig: ResolvedBunnerConfig = {
  module: { fileName: 'module.ts' },
  sourceDir: './src',
  entry: './src/main.ts',
  mcp: {
    card: { relations: [] },
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

  it('should report invalid args when any args are provided', async () => {
    // Arrange
    const calls: string[] = [];
    const cmd = __testing__.createMcpCommand({
      loadConfig: async () => ({ config: testConfig }),
      ensureRepo: async () => {
        calls.push('ensureRepo');
      },
      verifyProject: async () => {
        calls.push('verifyProject');
        return { ok: true, errors: [], warnings: [] } as any;
      },
      startServer: async () => {
        calls.push('startServer');
      },
      reportInvalidSubcommand: (value) => {
        calls.push(`invalidSubcommand:${value}`);
      },
    });

    try {
      process.exitCode = 0;

      // Act
      await cmd(['verify'], {});

      // Assert
      expect(calls).toEqual(['invalidSubcommand:verify']);
      expect(process.exitCode).toBe(1);
    } finally {
      // handled by afterEach
    }
  });
});
