import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE } from '@zipbul/common';
import { isErr } from '@zipbul/result';

import type { FileAnalysis } from '../graph/interfaces';

import { AstParser } from '../parser';
import { resolvePhaseId } from './phase-key-resolver';

describe('resolvePhaseId', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zb-phase-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const emptyMap = (): Map<string, FileAnalysis> => new Map<string, FileAnalysis>();

  it('should pass a string-literal phase key through unchanged', async () => {
    const result = await resolvePhaseId('OnRequest', emptyMap(), new AstParser());

    expect(result).toBe('OnRequest');
  });

  it('should resolve an enum-member ref to its value through a barrel re-export', async () => {
    writeFileSync(join(dir, 'phase.ts'), "export enum HttpPhase { OnRequest = 'OnRequest' }\n");
    writeFileSync(join(dir, 'index.ts'), "export { HttpPhase } from './phase';\n");

    const ref = { [ZIPBUL_REF]: 'HttpPhase.OnRequest', [ZIPBUL_IMPORT_SOURCE]: join(dir, 'index.ts') };
    const result = await resolvePhaseId(ref, emptyMap(), new AstParser());

    expect(result).toBe('OnRequest');
  });

  it('should resolve to the enum VALUE, not the member name, when they differ', async () => {
    writeFileSync(join(dir, 'phase.ts'), "export enum TickPhase { OnTick = 'tick.on' }\n");

    const ref = { [ZIPBUL_REF]: 'TickPhase.OnTick', [ZIPBUL_IMPORT_SOURCE]: join(dir, 'phase.ts') };
    const result = await resolvePhaseId(ref, emptyMap(), new AstParser());

    expect(result).toBe('tick.on');
  });

  it('should error on an enum member that cannot be resolved', async () => {
    writeFileSync(join(dir, 'phase.ts'), "export enum HttpPhase { OnRequest = 'OnRequest' }\n");

    const ref = { [ZIPBUL_REF]: 'HttpPhase.Nope', [ZIPBUL_IMPORT_SOURCE]: join(dir, 'phase.ts') };
    const result = await resolvePhaseId(ref, emptyMap(), new AstParser());

    expect(isErr(result)).toBe(true);
  });

  it('should error on a bare identifier ref (not a member)', async () => {
    const ref = { [ZIPBUL_REF]: 'SomeVar', [ZIPBUL_IMPORT_SOURCE]: join(dir, 'x.ts') };
    const result = await resolvePhaseId(ref, emptyMap(), new AstParser());

    expect(isErr(result)).toBe(true);
  });
});
