import { describe, expect, it } from 'bun:test';

import type { ResolvedBunnerConfig } from '../../config';

import { closeDb, createDb } from '../../store/connection';
import { card, cardKeyword, cardTag, keyword, tag } from '../../store/schema';

import { createBunnerToolRegistry, startBunnerMcpServerStdio } from './mcp-server';

describe('createBunnerToolRegistry', () => {
  it('should include verify and card CRUD tools when registry is created', () => {
    const registry = createBunnerToolRegistry({
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    });

    const names = registry.list().map((t) => t.name);

    expect(names).toContain('bunner.verifyProject');
    expect(names).toContain('bunner.verify_project');
    expect(names).toContain('bunner.cardCreate');
    expect(names).toContain('bunner.cardUpdate');
    expect(names).toContain('bunner.cardUpdateStatus');
    expect(names).toContain('bunner.cardDelete');
    expect(names).toContain('bunner.cardRename');
  });

  it('should include index tools when registry is created', () => {
    const registry = createBunnerToolRegistry({
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    });

    const names = registry.list().map((t) => t.name);
    expect(names).toContain('bunner.indexProject');
    expect(names).toContain('bunner.rebuild_index');
  });

  it('should include search tools when registry is created', () => {
    const registry = createBunnerToolRegistry({
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    });

    const names = registry.list().map((t) => t.name);
    expect(names).toContain('bunner.searchCards');
    expect(names).toContain('bunner.searchCode');
  });

  it('should include lookup tools when registry is created', () => {
    const registry = createBunnerToolRegistry({
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    });

    const names = registry.list().map((t) => t.name);
    expect(names).toContain('bunner.getCard');
    expect(names).toContain('bunner.getCodeEntity');
    expect(names).toContain('bunner.listCardRelations');
    expect(names).toContain('bunner.listCardCodeLinks');
  });

    it('should include P7 read tools when registry is created', () => {
      // Arrange
      const ctx = { projectRoot: '/repo', config: {} as any };

      // Act
      const registry = createBunnerToolRegistry(ctx);
      const names = registry.list().map((t) => t.name);

      // Assert
      expect(names).toContain('bunner.search');
      expect(names).toContain('bunner.get_context');
      expect(names).toContain('bunner.get_subgraph');
      expect(names).toContain('bunner.impact_analysis');
      expect(names).toContain('bunner.trace_chain');
      expect(names).toContain('bunner.coverage_report');
      expect(names).toContain('bunner.list_unlinked');
      expect(names).toContain('bunner.list_cards');
      expect(names).toContain('bunner.get_relations');
    });

    it('should include P7 write tools when registry is created', () => {
      // Arrange
      const ctx = { projectRoot: '/repo', config: {} as any };

      // Act
      const registry = createBunnerToolRegistry(ctx);
      const names = registry.list().map((t) => t.name);

      // Assert
      expect(names).toContain('bunner.card_create');
      expect(names).toContain('bunner.card_update');
      expect(names).toContain('bunner.card_delete');
      expect(names).toContain('bunner.card_rename');
      expect(names).toContain('bunner.card_update_status');
      expect(names).toContain('bunner.link_add');
      expect(names).toContain('bunner.link_remove');
      expect(names).toContain('bunner.relation_add');
      expect(names).toContain('bunner.relation_remove');

      expect(names).toContain('bunner.keyword_create');
      expect(names).toContain('bunner.keyword_delete');
      expect(names).toContain('bunner.tag_create');
      expect(names).toContain('bunner.tag_delete');
    });

  it('should call deps.getCard when bunner.getCard tool runs', async () => {
    // Arrange
    let called: { key: string } | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registry = createBunnerToolRegistry(ctx, {
      getCard: async (input) => {
        called = { key: input.key };
        return { card: { key: input.key, summary: 'S', status: 'draft', keywords: [] } } as any;
      },
    });

    // Act
    const tool = registry.get('bunner.getCard');
    const out = await tool!.run(ctx, { key: 'auth/login' });

    // Assert
    expect(out).toEqual({ card: { key: 'auth/login', summary: 'S', status: 'draft', keywords: [] } });
    if (!called) throw new Error('Expected deps.getCard to be called');
    expect(called as any).toEqual({ key: 'auth/login' });
  });

  it('should return mapped keywords when bunner.getCard runs with default implementation', async () => {
    // Arrange
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const seededDb = createDb(':memory:');
    seededDb
      .insert(card)
      .values({
        key: 'a',
        summary: 'A',
        status: 'draft',
        constraintsJson: null,
        body: 'Body',
        filePath: '.bunner/cards/a.card.md',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      .run();
    seededDb.insert(keyword).values({ name: 'auth' }).run();
    const authRow = seededDb.select({ id: keyword.id }).from(keyword).limit(1).get() as { id: number };
    seededDb.insert(cardKeyword).values({ cardKey: 'a', keywordId: authRow.id }).run();

    const registry = createBunnerToolRegistry(ctx, {
      createDb: () => seededDb as any,
      closeDb: () => {
        closeDb(seededDb as any);
      },
    });

    // Act
    const tool = registry.get('bunner.getCard');
    const out = await tool!.run(ctx, { key: 'a' });

    // Assert
    expect(out).toEqual({
      card: {
        key: 'a',
        summary: 'A',
        status: 'draft',
        keywords: ['auth'],
        constraintsJson: null,
        body: 'Body',
        filePath: '.bunner/cards/a.card.md',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('should filter by tags (OR) when bunner.list_cards runs with default implementation', async () => {
    // Arrange
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const seededDb = createDb(':memory:');

    seededDb
      .insert(card)
      .values({
        key: 'a',
        summary: 'A',
        status: 'draft',
        constraintsJson: null,
        body: 'Body A',
        filePath: '.bunner/cards/a.card.md',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      .run();
    seededDb
      .insert(card)
      .values({
        key: 'b',
        summary: 'B',
        status: 'draft',
        constraintsJson: null,
        body: 'Body B',
        filePath: '.bunner/cards/b.card.md',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      .run();

    seededDb.insert(tag).values({ name: 'backend' }).run();
    seededDb.insert(tag).values({ name: 'frontend' }).run();
    const tagRows = seededDb.select({ id: tag.id, name: tag.name }).from(tag).all() as Array<{ id: number; name: string }>;
    const backendId = tagRows.find((t) => t.name === 'backend')!.id;
    const frontendId = tagRows.find((t) => t.name === 'frontend')!.id;
    seededDb.insert(cardTag).values({ cardKey: 'a', tagId: backendId }).run();
    seededDb.insert(cardTag).values({ cardKey: 'b', tagId: frontendId }).run();

    const registry = createBunnerToolRegistry(ctx, {
      createDb: () => seededDb as any,
      closeDb: () => {
        // no-op: this test calls the tool twice; we close manually at the end
      },
    });

    try {
      // Act
      const tool = registry.get('bunner.list_cards');
      const out = await tool!.run(ctx, { tags: ['backend'], limit: 50 });

      const outOr = await tool!.run(ctx, { tags: ['backend', 'frontend'], limit: 50 });

    // Assert
    expect(out).toEqual({
      cards: [{ key: 'a', summary: 'A', status: 'draft' }],
    });

      expect(outOr).toEqual({
        cards: [
          { key: 'a', summary: 'A', status: 'draft' },
          { key: 'b', summary: 'B', status: 'draft' },
        ],
      });
    } finally {
      closeDb(seededDb as any);
    }
  });

  it('should return mapped keywords when bunner.get_context runs with default implementation', async () => {
    // Arrange
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const seededDb = createDb(':memory:');
    seededDb
      .insert(card)
      .values({
        key: 'a',
        summary: 'A',
        status: 'draft',
        constraintsJson: null,
        body: 'Body',
        filePath: '.bunner/cards/a.card.md',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      .run();
    seededDb.insert(keyword).values({ name: 'auth' }).run();
    const authRow = seededDb.select({ id: keyword.id }).from(keyword).limit(1).get() as { id: number };
    seededDb.insert(cardKeyword).values({ cardKey: 'a', keywordId: authRow.id }).run();

    const registry = createBunnerToolRegistry(ctx, {
      createDb: () => seededDb as any,
      closeDb: () => {
        closeDb(seededDb as any);
      },
    });

    // Act
    const tool = registry.get('bunner.get_context');
    const out = await tool!.run(ctx, { target: { kind: 'card', key: 'a' } });

    // Assert
    expect(out).toEqual({
      target: { kind: 'card', key: 'a' },
      card: {
        key: 'a',
        summary: 'A',
        status: 'draft',
        keywords: ['auth'],
        constraintsJson: null,
        body: 'Body',
        filePath: '.bunner/cards/a.card.md',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      codeEntity: null,
      relations: [],
      codeLinks: [],
      linkedCards: [],
      linkedCode: [],
      codeRelations: [],
    });
  });

  it('should call deps.getCodeEntity when bunner.getCodeEntity tool runs', async () => {
    // Arrange
    let called: { entityKey: string } | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registry = createBunnerToolRegistry(ctx, {
      getCodeEntity: async (input) => {
        called = { entityKey: input.entityKey };
        return { entity: { entityKey: input.entityKey, filePath: 'src/a.ts', symbolName: null, kind: 'module' } } as any;
      },
    });

    // Act
    const tool = registry.get('bunner.getCodeEntity');
    const out = await tool!.run(ctx, { entityKey: 'module:src/a.ts' });

    // Assert
    expect(out).toEqual({ entity: { entityKey: 'module:src/a.ts', filePath: 'src/a.ts', symbolName: null, kind: 'module' } });
    if (!called) throw new Error('Expected deps.getCodeEntity to be called');
    expect(called as any).toEqual({ entityKey: 'module:src/a.ts' });
  });

  it('should call deps.listCardRelations when bunner.listCardRelations tool runs', async () => {
    // Arrange
    let called: { cardKey: string } | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registry = createBunnerToolRegistry(ctx, {
      listCardRelations: async (input) => {
        called = { cardKey: input.cardKey };
        return {
          relations: [
            { type: 'depends-on', srcCardKey: input.cardKey, dstCardKey: 'x', isReverse: false, metaJson: null },
          ],
        } as any;
      },
    });

    // Act
    const tool = registry.get('bunner.listCardRelations');
    const out = await tool!.run(ctx, { cardKey: 'auth/login' });

    // Assert
    expect(out).toEqual({
      relations: [{ type: 'depends-on', srcCardKey: 'auth/login', dstCardKey: 'x', isReverse: false, metaJson: null }],
    });
    if (!called) throw new Error('Expected deps.listCardRelations to be called');
    expect(called as any).toEqual({ cardKey: 'auth/login' });
  });

  it('should call deps.listCardCodeLinks when bunner.listCardCodeLinks tool runs', async () => {
    // Arrange
    let called: { cardKey: string } | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registry = createBunnerToolRegistry(ctx, {
      listCardCodeLinks: async (input) => {
        called = { cardKey: input.cardKey };
        return {
          links: [
            { type: 'see', cardKey: input.cardKey, entityKey: 'module:src/a.ts', filePath: 'src/a.ts', symbolName: null, metaJson: null },
          ],
        } as any;
      },
    });

    // Act
    const tool = registry.get('bunner.listCardCodeLinks');
    const out = await tool!.run(ctx, { cardKey: 'auth/login' });

    // Assert
    expect(out).toEqual({
      links: [{ type: 'see', cardKey: 'auth/login', entityKey: 'module:src/a.ts', filePath: 'src/a.ts', symbolName: null, metaJson: null }],
    });
    if (!called) throw new Error('Expected deps.listCardCodeLinks to be called');
    expect(called as any).toEqual({ cardKey: 'auth/login' });
  });

  it('should call deps.searchCards when bunner.searchCards tool runs', async () => {
    let called: { q: string; limit: number } | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registry = createBunnerToolRegistry(ctx, {
      searchCards: async (input) => {
        called = { q: input.query, limit: input.limit };
        return { results: [{ key: 'a', summary: 'A', status: 'draft', score: 1 }] };
      },
    });

    const tool = registry.get('bunner.searchCards');
    expect(tool).not.toBeUndefined();

    const out = await tool!.run(ctx, { query: 'auth', limit: 7 });
    expect(out).toEqual({ results: [{ key: 'a', summary: 'A', status: 'draft', score: 1 }] });
    if (!called) throw new Error('Expected deps.searchCards to be called');
    expect(called as any).toEqual({ q: 'auth', limit: 7 });
  });

  it('should call deps.searchCode when bunner.searchCode tool runs', async () => {
    let called: { q: string; limit: number } | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registry = createBunnerToolRegistry(ctx, {
      searchCode: async (input) => {
        called = { q: input.query, limit: input.limit };
        return { results: [{ entityKey: 'module:src/a.ts', symbolName: null, filePath: 'src/a.ts', kind: 'module', score: 2 }] };
      },
    });

    const tool = registry.get('bunner.searchCode');
    expect(tool).not.toBeUndefined();

    const out = await tool!.run(ctx, { query: 'login', limit: 3 });
    expect(out).toEqual({ results: [{ entityKey: 'module:src/a.ts', symbolName: null, filePath: 'src/a.ts', kind: 'module', score: 2 }] });
    if (!called) throw new Error('Expected deps.searchCode to be called');
    expect(called as any).toEqual({ q: 'login', limit: 3 });
  });

  it('should call deps.indexProject with mode=full when bunner.indexProject runs with full mode', async () => {
    let called: { projectRoot: string; mode: string; didClose: boolean } | null = null;
    let didClose = false;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registry = createBunnerToolRegistry(ctx, {
      createDb: () => ({}) as any,
      closeDb: () => {
        didClose = true;
      },
      indexProject: async (input) => {
        called = { projectRoot: input.projectRoot, mode: input.mode, didClose };
        return { stats: { indexedCardFiles: 0, indexedCodeFiles: 0, removedFiles: 0 } };
      },
    });

    const tool = registry.get('bunner.indexProject');
    expect(tool).not.toBeUndefined();

    const out = await tool!.run(ctx, { mode: 'full' });
    expect(out).toEqual({ stats: { indexedCardFiles: 0, indexedCodeFiles: 0, removedFiles: 0 } });
    if (!called) throw new Error('Expected deps.indexProject to be called');
    expect(called as any).toEqual({ projectRoot: '/repo', mode: 'full', didClose: false });
    expect(didClose).toBe(true);
  });

  it('should default mode=incremental when bunner.indexProject runs without mode', async () => {
    let calledMode: string | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registry = createBunnerToolRegistry(ctx, {
      createDb: () => ({}) as any,
      closeDb: () => {},
      indexProject: async (input) => {
        calledMode = input.mode;
        return { stats: { indexedCardFiles: 0, indexedCodeFiles: 0, removedFiles: 0 } };
      },
    });

    const tool = registry.get('bunner.indexProject');
    expect(tool).not.toBeUndefined();

    await tool!.run(ctx, {});
    if (calledMode === null) throw new Error('Expected deps.indexProject to be called');
    expect(calledMode as any).toBe('incremental');
  });

  it('should call deps.verifyProject when bunner.verifyProject tool runs', async () => {
    let called: { projectRoot: string; hasConfig: boolean } | null = null;

    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registry = createBunnerToolRegistry(ctx, {
      verifyProject: async (input) => {
        called = { projectRoot: input.projectRoot, hasConfig: input.config != null };
        return { ok: true, errors: [], warnings: [] };
      },
    });

    const tool = registry.get('bunner.verifyProject');
    expect(tool).not.toBeUndefined();

    const out = await tool!.run(ctx, {});
    expect(out).toEqual({ ok: true, errors: [], warnings: [] });
    if (!called) throw new Error('Expected deps.verifyProject to be called');
    expect(called as any).toEqual({ projectRoot: '/repo', hasConfig: true });
  });
});

describe('startBunnerMcpServerStdio', () => {
  it('should connect the server to the transport when started', async () => {
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
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

    await startBunnerMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'reader', ownerPid: 1, lockPath: '/repo/.bunner/cache/watcher.owner.lock' }),
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
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const registered: string[] = [];

    const fakeServer = {
      registerTool: (name: string) => {
        registered.push(name);
      },
      connect: async () => {},
    };

    await startBunnerMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'reader', ownerPid: 1, lockPath: '/repo/.bunner/cache/watcher.owner.lock' }),
        release: () => {},
      }),
      fileExists: async () => true,
      subscribe: async () => ({ unsubscribe: async () => {} }),
    });

    // Read tools should be present.
    expect(registered.includes('bunner.search')).toBe(true);
    expect(registered.includes('bunner.verify_project')).toBe(true);

    // Write tools should not be present for reader.
    expect(registered.includes('bunner.card_create')).toBe(false);
    expect(registered.includes('bunner.keyword_create')).toBe(false);
    expect(registered.includes('bunner.tag_create')).toBe(false);
    expect(registered.includes('bunner.rebuild_index')).toBe(false);
  });

  it('should build the index on startup when owner and db is missing', async () => {
    // Arrange
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const calls: string[] = [];

    const fakeServer = {
      registerTool: () => {},
      connect: async () => {},
    };

    await startBunnerMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'owner', ownerPid: 1, lockPath: '/repo/.bunner/cache/watcher.owner.lock' }),
        release: () => {
          calls.push('release');
        },
      }),
      fileExists: async () => false,
      createDb: () => ({}) as any,
      closeDb: () => {
        calls.push('closeDb');
      },
      indexProject: async (input) => {
        calls.push(`index:${input.mode}`);
        return { stats: { indexedCardFiles: 0, indexedCodeFiles: 0, removedFiles: 0 } } as any;
      },
      subscribe: async () => ({ unsubscribe: async () => {} }),
    } as any);

    // Assert
    expect(calls).toEqual(['index:full', 'closeDb']);
  });

  it('should reindex incrementally on watched card/code changes and fully on config changes', async () => {
    // Arrange
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const calls: string[] = [];

    let watchCb: ((err: Error | null, events: Array<{ type: string; path: string }>) => void) | null = null;

    const fakeServer = {
      registerTool: () => {},
      connect: async () => {},
    };

    await startBunnerMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'owner', ownerPid: 1, lockPath: '/repo/.bunner/cache/watcher.owner.lock' }),
        release: () => {},
      }),
      fileExists: async () => true,
      createDb: () => ({}) as any,
      closeDb: () => {},
      indexProject: async (input) => {
        calls.push(`index:${input.mode}`);
        return { stats: { indexedCardFiles: 0, indexedCodeFiles: 0, removedFiles: 0 } } as any;
      },
      loadConfig: async () => {
        calls.push('loadConfig');
        return {
          config: {
            sourceDir: './src2',
            entry: './src2/main.ts',
            module: { fileName: 'module.ts' },
            mcp: { exclude: [], card: { relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'] } },
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

    // Act
    watchCb(null, [{ type: 'update', path: '/repo/.bunner/cards/a.card.md' }]);
    watchCb(null, [{ type: 'update', path: '/repo/src/a.ts' }]);
    watchCb(null, [{ type: 'update', path: '/repo/bunner.jsonc' }]);

    // Allow queued tasks to flush.
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    // Assert
    expect(calls).toEqual(['index:incremental', 'index:incremental', 'loadConfig', 'index:full']);
    expect((ctx as any).config.sourceDir).toBe('./src2');
  });

  it('should perform full reindex when reindex.signal changes (owner only)', async () => {
    const ctx = {
      projectRoot: '/repo',
      config: {
        sourceDir: './src',
        entry: './src/main.ts',
        module: { fileName: 'module.ts' },
        mcp: {
          exclude: [],
          card: {
            relations: ['depends-on', 'references', 'related', 'extends', 'conflicts'],
          },
        },
      } as unknown as ResolvedBunnerConfig,
    };

    const calls: string[] = [];

    let cacheCb: ((err: Error | null, events: Array<{ type: string; path: string }>) => void) | null = null;

    const fakeServer = {
      registerTool: () => {},
      connect: async () => {},
    };

    await startBunnerMcpServerStdio(ctx, {
      createServer: () => fakeServer as any,
      createTransport: () => ({}) as any,
      createOwnerElection: () => ({
        acquire: () => ({ role: 'owner', ownerPid: 1, lockPath: '/repo/.bunner/cache/watcher.owner.lock' }),
        release: () => {},
      }),
      fileExists: async () => true,
      createDb: () => ({}) as any,
      closeDb: () => {},
      indexProject: async (input) => {
        calls.push(`index:${input.mode}`);
        return { stats: { indexedCardFiles: 0, indexedCodeFiles: 0, removedFiles: 0 } } as any;
      },
      subscribe: async (root: string, cb: any) => {
        if (root === '/repo/.bunner/cache') {
          cacheCb = cb;
        }
        return { unsubscribe: async () => {} };
      },
    } as any);

    if (!cacheCb) throw new Error('Expected cache subscription callback');

    cacheCb(null, [{ type: 'update', path: '/repo/.bunner/cache/reindex.signal' }]);

    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }

    expect(calls).toEqual(['index:full']);
  });
});
