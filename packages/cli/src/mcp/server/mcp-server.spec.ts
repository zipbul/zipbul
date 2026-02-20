import { describe, expect, it } from 'bun:test';

import type { ResolvedZipbulConfig } from '../../config';

import { closeDb, createDb } from '../../store/connection';
import { codeEntity } from '../../store/schema';

import { createZipbulToolRegistry, startZipbulMcpServerStdio } from './mcp-server';

describe('createZipbulToolRegistry', () => {
  it('should register only VS Code-safe tool names', () => {
    const registry = createZipbulToolRegistry({
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    });

    const names = registry.list().map((t) => t.name);
    const invalid = names.filter((n) => !/^[a-z0-9_-]+$/.test(n));
    expect(invalid).toEqual([]);
  });

  it('should include index tools when registry is created', () => {
    const registry = createZipbulToolRegistry({
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    });

    const names = registry.list().map((t) => t.name);
    expect(names).toContain('zipbul_index_project');
    expect(names).toContain('zipbul_rebuild_index');
  });

  it('should include search tools when registry is created', () => {
    const registry = createZipbulToolRegistry({
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    });

    const names = registry.list().map((t) => t.name);
    expect(names).toContain('zipbul_search_code');
  });

  it('should include lookup tools when registry is created', () => {
    const registry = createZipbulToolRegistry({
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    });

    const names = registry.list().map((t) => t.name);
    expect(names).toContain('zipbul_get_code_entity');
  });

  it('should call deps.getCodeEntity when zipbul_get_code_entity tool runs', async () => {
    // Arrange
    let called: { entityKey: string } | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const registry = createZipbulToolRegistry(ctx, {
      getCodeEntity: async (input) => {
        called = { entityKey: input.entityKey };
        return { entity: { entityKey: input.entityKey, filePath: 'src/a.ts', symbolName: null, kind: 'module' } } as any;
      },
    });

    // Act
    const tool = registry.get('zipbul_get_code_entity');
    const out = await tool!.run(ctx, { entityKey: 'module:src/a.ts' });

    // Assert
    expect(out).toEqual({ entity: { entityKey: 'module:src/a.ts', filePath: 'src/a.ts', symbolName: null, kind: 'module' } });
    if (!called) throw new Error('Expected deps.getCodeEntity to be called');
    expect(called as any).toEqual({ entityKey: 'module:src/a.ts' });
  });

  it('should call deps.searchCode when zipbul_search_code tool runs', async () => {
    let called: { q: string; limit: number } | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const registry = createZipbulToolRegistry(ctx, {
      searchCode: async (input) => {
        called = { q: input.query, limit: input.limit };
        return { results: [{ entityKey: 'module:src/a.ts', symbolName: null, filePath: 'src/a.ts', kind: 'module', score: 2 }] };
      },
    });

    const tool = registry.get('zipbul_search_code');
    expect(tool).not.toBeUndefined();

    const out = await tool!.run(ctx, { query: 'login', limit: 3 });
    expect(out).toEqual({ results: [{ entityKey: 'module:src/a.ts', symbolName: null, filePath: 'src/a.ts', kind: 'module', score: 2 }] });
    if (!called) throw new Error('Expected deps.searchCode to be called');
    expect(called as any).toEqual({ q: 'login', limit: 3 });
  });

  it('should return results when zipbul_search_code runs with default implementation', async () => {
    // Arrange
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const seededDb = createDb(':memory:');
    seededDb
      .insert(codeEntity)
      .values({
        entityKey: 'symbol:src/mcp.ts#mcp',
        filePath: 'src/mcp.ts',
        symbolName: 'mcp',
        kind: 'function',
        signature: null,
        fingerprint: null,
        contentHash: 'x',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      .run();

    const registry = createZipbulToolRegistry(ctx, {
      createDb: () => seededDb as any,
      closeDb: () => {
        // no-op: close manually
      },
    });

    try {
      // Act
      const tool = registry.get('zipbul_search_code');
      const out = await tool!.run(ctx, { query: 'mcp', limit: 10 });

      // Assert
      expect(out.results.length).toBeGreaterThan(0);
      expect(out.results[0]!.entityKey).toBe('symbol:src/mcp.ts#mcp');
    } finally {
      closeDb(seededDb as any);
    }
  });

  it('should call deps.indexProject with mode=full when zipbul_index_project runs with full mode', async () => {
    let called: { projectRoot: string; mode: string; didClose: boolean } | null = null;
    let didClose = false;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const registry = createZipbulToolRegistry(ctx, {
      createDb: () => ({}) as any,
      closeDb: () => {
        didClose = true;
      },
      indexProject: async (input) => {
        called = { projectRoot: input.projectRoot, mode: input.mode, didClose };
        return { stats: { indexedCodeFiles: 0, removedFiles: 0 } };
      },
    });

    const tool = registry.get('zipbul_index_project');
    expect(tool).not.toBeUndefined();

    const out = await tool!.run(ctx, { mode: 'full' });
    expect(out).toEqual({ stats: { indexedCodeFiles: 0, removedFiles: 0 } });
    if (!called) throw new Error('Expected deps.indexProject to be called');
    expect(called as any).toEqual({ projectRoot: '/repo', mode: 'full', didClose: false });
    expect(didClose).toBe(true);
  });

  it('should default mode=incremental when zipbul_index_project runs without mode', async () => {
    let calledMode: string | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const registry = createZipbulToolRegistry(ctx, {
      createDb: () => ({}) as any,
      closeDb: () => {},
      indexProject: async (input) => {
        calledMode = input.mode;
        return { stats: { indexedCodeFiles: 0, removedFiles: 0 } };
      },
    });

    const tool = registry.get('zipbul_index_project');
    expect(tool).not.toBeUndefined();

    await tool!.run(ctx, {});
    if (calledMode === null) throw new Error('Expected deps.indexProject to be called');
    expect(calledMode as any).toBe('incremental');
  });

});

describe('startZipbulMcpServerStdio', () => {
  it('should connect the server to the transport when started', async () => {
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const calls: Array<{ type: string; name?: string }> = [];

    const fakeServer = {
      registerTool: (name: string) => {
        calls.push({ type: 'registerTool', name });
      },
      connect: async () => {
        calls.push({ type: 'connect' });
      },
    };

    await startZipbulMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'reader', ownerPid: 1, lockPath: '/repo/.zipbul/cache/watcher.owner.lock' }),
        release: () => {},
      }),
      fileExists: async () => true,
      subscribe: async () => ({ unsubscribe: async () => {} }),
    });

    expect(calls.some((c) => c.type === 'registerTool')).toBe(true);
    expect(calls.some((c) => c.type === 'connect')).toBe(true);
  });

  it('should not register write tools when role is reader', async () => {
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const registered: string[] = [];

    const fakeServer = {
      registerTool: (name: string) => {
        registered.push(name);
      },
      connect: async () => {},
    };

    await startZipbulMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'reader', ownerPid: 1, lockPath: '/repo/.zipbul/cache/watcher.owner.lock' }),
        release: () => {},
      }),
      fileExists: async () => true,
      subscribe: async () => ({ unsubscribe: async () => {} }),
    });

    // Read tools should be present.
    expect(registered.includes('zipbul_search_code')).toBe(true);

    // Write tools should not be present for reader.
    expect(registered.includes('zipbul_rebuild_index')).toBe(false);
  });

  it('should build the index on startup when owner and db is missing', async () => {
    // Arrange
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const calls: string[] = [];

    const fakeServer = {
      registerTool: () => {},
      connect: async () => {},
    };

    await startZipbulMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'owner', ownerPid: 1, lockPath: '/repo/.zipbul/cache/watcher.owner.lock' }),
        release: () => {
          calls.push('release');
        },
      }),
      fileExists: async () => false,
      createDb: () => ({}) as any,
      closeDb: () => {
        calls.push('closeDb');
      },
      indexProject: async (input: any) => {
        calls.push(`index:${input.mode}`);
        return { stats: { indexedCodeFiles: 0, removedFiles: 0 } } as any;
      },
      subscribe: async () => ({ unsubscribe: async () => {} }),
    } as any);

    // Assert
    expect(calls).toEqual(['index:full', 'closeDb']);
  });

  it('should reindex incrementally on watched code changes and fully on config changes', async () => {
    // Arrange
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const calls: string[] = [];

    let watchCb: ((err: Error | null, events: Array<{ type: string; path: string }>) => void) | null = null;

    const fakeServer = {
      registerTool: () => {},
      connect: async () => {},
    };

    await startZipbulMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'owner', ownerPid: 1, lockPath: '/repo/.zipbul/cache/watcher.owner.lock' }),
        release: () => {},
      }),
      fileExists: async () => true,
      createDb: () => ({}) as any,
      closeDb: () => {},
      indexProject: async (input: any) => {
        calls.push(`index:${input.mode}`);
        return { stats: { indexedCodeFiles: 0, removedFiles: 0 } } as any;
      },
      loadConfig: async () => {
        calls.push('loadConfig');
        return {
          config: {
            sourceDir: './src2',
            entry: './src2/main.ts',
            module: { fileName: 'module.ts' },
            mcp: { exclude: [] },
          },
        };
      },
      subscribe: async (_root: string, cb: any) => {
        if (_root === '/repo') {
          watchCb = cb;
        }
        return { unsubscribe: async () => {} };
      },
    } as any);

    if (!watchCb) throw new Error('Expected watcher subscription callback');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triggerWatch = watchCb as any;

    // Act
    triggerWatch(null, [{ type: 'update', path: '/repo/src/a.ts' }]);
    triggerWatch(null, [{ type: 'update', path: '/repo/zipbul.jsonc' }]);

    // Allow queued tasks to flush.
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    // Assert
    expect(calls).toEqual(['index:incremental', 'loadConfig', 'index:full']);
    expect((ctx as any).config.sourceDir).toBe('./src2');
  });

  it('should perform full reindex when reindex.signal changes (owner only)', async () => {
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: { exclude: [] },
      } as unknown as ResolvedZipbulConfig,
    };

    const calls: string[] = [];

    let cacheCb: ((err: Error | null, events: Array<{ type: string; path: string }>) => void) | null = null;

    const fakeServer = {
      registerTool: () => {},
      connect: async () => {},
    };

    await startZipbulMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'owner', ownerPid: 1, lockPath: '/repo/.zipbul/cache/watcher.owner.lock' }),
        release: () => {},
      }),
      fileExists: async () => true,
      createDb: () => ({}) as any,
      closeDb: () => {},
      indexProject: async (input: any) => {
        calls.push(`index:${input.mode}`);
        return { stats: { indexedCodeFiles: 0, removedFiles: 0 } } as any;
      },
      subscribe: async (root: string, cb: any) => {
        if (root === '/repo/.zipbul/cache') {
          cacheCb = cb;
        }
        return { unsubscribe: async () => {} };
      },
    } as any);

    if (!cacheCb) throw new Error('Expected cache subscription callback');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triggerCache = cacheCb as any;

    triggerCache(null, [{ type: 'update', path: '/repo/.zipbul/cache/reindex.signal' }]);

    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    expect(calls).toEqual(['index:full']);
  });
});
