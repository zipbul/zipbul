import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildAdapter, readAdapterManifest, detectMultiAdapterConflicts } from '../../src/compiler/adapter-build';

/**
 * Step 12 External e2e — emulates the user-app build's interaction with a
 * pre-built adapter package. The whole interaction is mediated by the
 * `dist/*.json` manifests + `dist/index.js` runtime. NO `.ts` source from
 * the adapter package is read after `zb build adapter` completes.
 *
 * The fixture is a temp directory that mimics
 * `node_modules/<adapter>/dist/...`. The "user app" code path here is just
 * `readAdapterManifest()` — that's the one entry point the user-app build
 * is allowed to use after Step 12.
 */

let adapterRoot: string;

beforeEach(async () => {
  adapterRoot = await mkdtemp(join(tmpdir(), 'zb-external-e2e-'));
  await mkdir(join(adapterRoot, 'src'), { recursive: true });
});

afterEach(async () => {
  await rm(adapterRoot, { recursive: true, force: true });
});

async function writeAdapter(adapterId: string): Promise<void> {
  await Bun.write(
    join(adapterRoot, 'package.json'),
    JSON.stringify({
      name: '@example/external-fixture',
      version: '0.0.1',
      module: 'dist/index.js',
      types: 'dist/index.d.ts',
      files: ['dist'],
      zipbul: { kind: 'adapter' },
    }),
  );
  await Bun.write(
    join(adapterRoot, 'index.ts'),
    [
      `export { ${adapterId}, ${adapterId}Context } from './src/${adapterId}';`,
    ].join('\n'),
  );
  await Bun.write(
    join(adapterRoot, 'src/adapter-definition.ts'),
    [
      `import { defineAdapter } from '@zipbul/common';`,
      `import { CoreStep } from '@zipbul/core';`,
      `import { ${adapterId}, ${adapterId}Context, ${adapterId}Phase, ${adapterId}Step } from './${adapterId}';`,
      `export const adapterDefinition = defineAdapter({`,
      `  adapter: ${adapterId},`,
      `  context: ${adapterId}Context,`,
      `  phase: ${adapterId}Phase,`,
      `  step: ${adapterId}Step,`,
      `  pipeline: [${adapterId}Phase.OnRequest, CoreStep.Handler],`,
      `});`,
    ].join('\n'),
  );
  await Bun.write(
    join(adapterRoot, `src/${adapterId}.ts`),
    [
      `import type { AdapterEntryDecorators } from '@zipbul/common';`,
      `export class ${adapterId} {`,
      `  readonly decorators: AdapterEntryDecorators = { controller: ${adapterId}Controller, handlers: [${adapterId}Get] };`,
      `}`,
      `export class ${adapterId}Context {}`,
      `export const ${adapterId}Controller = () => () => {};`,
      `export const ${adapterId}Get = () => () => {};`,
      `export const ${adapterId}Phase = { OnRequest: 'OnRequest' } as const;`,
      `export const ${adapterId}Step = {} as const;`,
    ].join('\n'),
  );
}

describe('Step 12 External e2e — manifest-only adapter consumption', () => {
  it('user-app build consumes adapter purely via dist/*.json + dist/index.js', async () => {
    await writeAdapter('Foo');

    // 1. Adapter package author runs `zb build adapter`. After this point,
    //    the adapter source could be deleted — only dist/ matters.
    await buildAdapter({ packageRoot: adapterRoot });

    // 2. User app's build resolves the manifest via the conventional
    //    `node_modules/<name>/dist/` path. Here we point straight at the
    //    fixture's dist.
    const manifest = await readAdapterManifest(join(adapterRoot, 'dist'));

    expect(manifest).not.toBeNull();
    expect(manifest!.adapter.adapterId).toBe('Foo');
    expect(manifest!.pipeline!.pipeline).toEqual([
      { qualifier: 'FooPhase', name: 'OnRequest' },
      { qualifier: 'CoreStep', name: 'Handler' },
    ]);
    expect(manifest!.decorators!.controller).toBe('FooController');
    expect(manifest!.decorators!.handlers).toEqual(['FooGet']);
    expect(manifest!.peerContract!.clusterStrategy).toBe('Shared');

    // 3. dist/index.js must exist + be non-empty (runtime entry).
    const indexJs = await readFile(join(adapterRoot, 'dist', 'index.js'), 'utf8');
    expect(indexJs.length).toBeGreaterThan(0);

    // 4. Multi-adapter conflict scan with a single adapter → empty.
    const conflicts = detectMultiAdapterConflicts([manifest!]);
    expect(conflicts).toEqual([]);
  });

  it('two pre-built adapters with overlapping decorators surface conflicts', async () => {
    // Build adapter A
    await writeAdapter('Alpha');
    await buildAdapter({ packageRoot: adapterRoot });
    const aManifest = await readAdapterManifest(join(adapterRoot, 'dist'));

    // Recreate root for adapter B with the same controller name — collision
    await rm(adapterRoot, { recursive: true, force: true });
    await mkdir(join(adapterRoot, 'src'), { recursive: true });
    await Bun.write(
      join(adapterRoot, 'package.json'),
      JSON.stringify({ name: '@example/b', version: '0.0.1', zipbul: { kind: 'adapter' } }),
    );
    await Bun.write(
      join(adapterRoot, 'src/adapter-definition.ts'),
      [
        `import { defineAdapter } from '@zipbul/common';`,
        `import { CoreStep } from '@zipbul/core';`,
        `import { Beta, BetaCtx, BetaPhase, BetaStep } from './beta';`,
        `export const d = defineAdapter({ adapter: Beta, context: BetaCtx, phase: BetaPhase, step: BetaStep, pipeline: [BetaPhase.X, CoreStep.Handler] });`,
      ].join('\n'),
    );
    await Bun.write(
      join(adapterRoot, 'src/beta.ts'),
      [
        `import type { AdapterEntryDecorators } from '@zipbul/common';`,
        // Same name as Alpha's controller → triggers decorator-name conflict
        `export class Beta {`,
        `  readonly decorators: AdapterEntryDecorators = { controller: AlphaController, handlers: [BetaPost] };`,
        `}`,
        `export class BetaCtx {}`,
        `export const AlphaController = () => () => {};`,
        `export const BetaPost = () => () => {};`,
        `export const BetaPhase = { X: 'X' } as const;`,
        `export const BetaStep = {} as const;`,
      ].join('\n'),
    );
    await buildAdapter({ packageRoot: adapterRoot });
    const bManifest = await readAdapterManifest(join(adapterRoot, 'dist'));

    const conflicts = detectMultiAdapterConflicts([aManifest!, bManifest!]);

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.find(c => c.kind === 'decorator-name' && c.name === 'AlphaController')).toBeDefined();
  });
});
