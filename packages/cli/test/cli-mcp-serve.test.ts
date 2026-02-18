import { describe, expect, it } from 'bun:test';

import type { CommandOptions } from '../src/bin/types';

import { __testing__ } from '../src/bin/mcp.command';

describe('cli — zp mcp (default serve)', () => {
  it('should start server when no subcommand is provided', async () => {
    let started = false;

    const mcp = __testing__.createMcpCommand({
      loadConfig: async () => ({ config: {} as any }),
      ensureRepo: async () => {},
      verifyProject: async () => ({ ok: true, errors: [], warnings: [] }),
      rebuildProjectIndex: async () => ({ ok: true }),
      startServer: async () => {
        started = true;
      },
      reportInvalidSubcommand: () => {
        throw new Error('should not be called');
      },
    });

    await mcp([], {} as CommandOptions);
    expect(started).toBe(true);
  });

  it('should keep verify subcommand working', async () => {
    let verified = false;

    const mcp = __testing__.createMcpCommand({
      loadConfig: async () => ({ config: {} as any }),
      ensureRepo: async () => {},
      verifyProject: async () => {
        verified = true;
        return { ok: true, errors: [], warnings: [] };
      },
      rebuildProjectIndex: async () => ({ ok: true }),
      startServer: async () => {
        throw new Error('should not be called');
      },
      reportInvalidSubcommand: () => {
        throw new Error('should not be called');
      },
    });

    await mcp(['verify'], {} as CommandOptions);
    expect(verified).toBe(true);
  });
});
