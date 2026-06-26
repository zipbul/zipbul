import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { FileAnalysis } from '../graph/interfaces';

import { AstParser } from '../parser';
import { resolveEnumValues } from './enum-type-resolver';

describe('resolveEnumValues', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zb-enum-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const emptyMap = (): Map<string, FileAnalysis> => new Map<string, FileAnalysis>();

  it('should resolve an enum declared in the imported file directly', async () => {
    writeFileSync(join(dir, 'phase.ts'), "export enum MyPhase { OnA = 'OnA', OnB = 'valB' }\n");

    const result = await resolveEnumValues('MyPhase', join(dir, 'phase.ts'), emptyMap(), new AstParser());

    expect(result).toEqual(new Set(['OnA', 'valB']));
  });

  it('should resolve an enum re-exported through a single named barrel', async () => {
    writeFileSync(join(dir, 'phase.ts'), "export enum MyPhase { OnA = 'OnA' }\n");
    writeFileSync(join(dir, 'index.ts'), "export { MyPhase } from './phase';\n");

    const result = await resolveEnumValues('MyPhase', join(dir, 'index.ts'), emptyMap(), new AstParser());

    expect(result).toEqual(new Set(['OnA']));
  });

  it('should resolve an enum re-exported through a double barrel (mirrors @zipbul/http-adapter)', async () => {
    mkdirSync(join(dir, 'enums'));
    writeFileSync(join(dir, 'enums', 'phase.ts'), "export enum MyPhase { OnA = 'OnA' }\n");
    writeFileSync(join(dir, 'enums', 'index.ts'), "export { MyPhase } from './phase';\n");
    writeFileSync(join(dir, 'index.ts'), "export { MyPhase } from './enums';\n");

    const result = await resolveEnumValues('MyPhase', join(dir, 'index.ts'), emptyMap(), new AstParser());

    expect(result).toEqual(new Set(['OnA']));
  });

  it('should resolve an enum re-exported through an export-all barrel', async () => {
    writeFileSync(join(dir, 'phase.ts'), "export enum MyPhase { OnA = 'OnA' }\n");
    writeFileSync(join(dir, 'index.ts'), "export * from './phase';\n");

    const result = await resolveEnumValues('MyPhase', join(dir, 'index.ts'), emptyMap(), new AstParser());

    expect(result).toEqual(new Set(['OnA']));
  });

  it('should return undefined when the enum is not declared anywhere reachable', async () => {
    writeFileSync(join(dir, 'index.ts'), "export const x = 1;\n");

    const result = await resolveEnumValues('MissingEnum', join(dir, 'index.ts'), emptyMap(), new AstParser());

    expect(result).toBeUndefined();
  });
});
