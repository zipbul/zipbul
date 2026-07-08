import { describe, expect, test, beforeAll } from 'bun:test';
import { mkdir } from 'node:fs/promises';

import type { FileAnalysis } from '../graph/interfaces';

import { DiagnosticError } from '../../../diagnostics';
import {
  readAugmentsManifests,
  buildAugmentsManifestIndex,
  emptyAugmentsManifestIndex,
  type ManifestMiddlewareEntry,
} from './augments-manifest-reader';

const tmpDir = `/tmp/zipbul-test-augments-manifest-${Date.now()}`;

function analysisImporting(filePath: string, resolvedSource: string): FileAnalysis {
  return {
    filePath,
    classes: [],
    reExports: [],
    exports: [],
    importEntries: [{ source: '@test/pkg', resolvedSource, isRelative: false }],
  };
}

async function writePackage(name: string, dir: string, manifest: unknown | null): Promise<string> {
  const root = `${tmpDir}/${dir}`;

  await mkdir(`${root}/dist`, { recursive: true });
  await Bun.write(`${root}/package.json`, JSON.stringify({ name }));
  await Bun.write(`${root}/dist/index.ts`, 'export const x = 1;');

  if (manifest !== null) {
    await Bun.write(`${root}/dist/context-augments.json`, JSON.stringify(manifest));
  }

  return `${root}/dist/index.ts`;
}

describe('readAugmentsManifests', () => {
  let queryEntry: string;
  let plainEntry: string;
  let badVersionEntry: string;
  let malformedEntry: string;

  beforeAll(async () => {
    queryEntry = await writePackage('@test/query-parser', 'query-parser', {
      version: 2,
      middlewares: [{
        exportName: 'queryParser',
        form: 2,
        contextType: 'HttpContext',
        augments: [{ ns: 'request', prop: 'getQuery', kind: 'validated-accessor' }],
        contextOps: [],
      }],
    });
    plainEntry = await writePackage('@test/plain', 'plain', null);
    badVersionEntry = await writePackage('@test/bad-version', 'bad-version', {
      version: 99,
      middlewares: [],
    });
    malformedEntry = await writePackage('@test/malformed', 'malformed', {
      version: 2,
      middlewares: [{ exportName: '', form: 2, contextType: null, augments: [], contextOps: [] }],
    });
  });

  test('reads manifest entries and exposes validated-accessor names', async () => {
    const fileMap = new Map<string, FileAnalysis>([
      ['/app/src/a.ts', analysisImporting('/app/src/a.ts', queryEntry)],
    ]);

    const index = await readAugmentsManifests(fileMap);

    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]!.packageName).toBe('@test/query-parser');
    expect(index.entries[0]!.exportName).toBe('queryParser');
    expect(index.entries[0]!.augments[0]!.kind).toBe('validated-accessor');
    expect([...index.validationAccessorNames]).toEqual(['getQuery']);
    expect(index.byPackage.get('@test/query-parser')).toHaveLength(1);
  });

  test('packages without a manifest are skipped silently', async () => {
    const fileMap = new Map<string, FileAnalysis>([
      ['/app/src/a.ts', analysisImporting('/app/src/a.ts', plainEntry)],
    ]);

    const index = await readAugmentsManifests(fileMap);

    expect(index.entries).toHaveLength(0);
    expect(index.validationAccessorNames.size).toBe(0);
  });

  test('unknown manifest version is a hard error', async () => {
    const fileMap = new Map<string, FileAnalysis>([
      ['/app/src/a.ts', analysisImporting('/app/src/a.ts', badVersionEntry)],
    ]);

    expect(readAugmentsManifests(fileMap)).rejects.toThrow(DiagnosticError);
  });

  test('structurally invalid manifest is a hard error', async () => {
    const fileMap = new Map<string, FileAnalysis>([
      ['/app/src/a.ts', analysisImporting('/app/src/a.ts', malformedEntry)],
    ]);

    expect(readAugmentsManifests(fileMap)).rejects.toThrow(DiagnosticError);
  });
});

describe('buildAugmentsManifestIndex', () => {
  test('groups by package and sorts deterministically', () => {
    const entries: ManifestMiddlewareEntry[] = [
      {
        packageName: '@b/pkg', exportName: 'z', form: 1, contextType: null,
        augments: [{ ns: 'request', prop: 'getCookies', kind: 'validated-accessor' }],
        contextOps: [],
      },
      {
        packageName: '@a/pkg', exportName: 'a', form: 1, contextType: 'HttpContext',
        augments: [{ ns: 'request', prop: 'meta', kind: 'validated-accessor' }],
        contextOps: [{ kind: 'set', keyIdentifier: 'K' }],
      },
    ];

    const index = buildAugmentsManifestIndex(entries);

    expect(index.entries.map(e => e.packageName)).toEqual(['@a/pkg', '@b/pkg']);
    // every augment is a validated accessor — both prop names surface (sorted by package)
    expect([...index.validationAccessorNames]).toEqual(['meta', 'getCookies']);
  });
});

describe('emptyAugmentsManifestIndex', () => {
  test('returns an empty index', () => {
    const index = emptyAugmentsManifestIndex();

    expect(index.entries).toHaveLength(0);
    expect(index.byPackage.size).toBe(0);
    expect(index.validationAccessorNames.size).toBe(0);
  });
});
