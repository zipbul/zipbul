import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setupEmberdeck, teardownEmberdeck, type EmberdeckContext } from '../index';

export interface TestContext {
  ctx: EmberdeckContext;
  cardsDir: string;
  cleanup: () => Promise<void>;
}

export async function createTestContext(
  options?: { allowedRelationTypes?: readonly string[] },
): Promise<TestContext> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'emberdeck_test_'));
  const cardsDir = join(tmpDir, 'cards');
  await mkdir(cardsDir, { recursive: true });

  const ctx = setupEmberdeck({
    cardsDir,
    dbPath: ':memory:',
    allowedRelationTypes: options?.allowedRelationTypes,
  });

  return {
    ctx,
    cardsDir,
    cleanup: async () => {
      teardownEmberdeck(ctx);
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}
