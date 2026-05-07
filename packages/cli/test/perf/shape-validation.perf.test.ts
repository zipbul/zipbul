/**
 * Perf baseline + regression guard for `validateDefineCallShape`.
 *
 * What this measures: end-to-end cost of (a) `parseSource` + (b)
 * `validateDefineCallShape` over a synthetic fixture of N files, each
 * containing a single regulated `defineX` export plus typical class/import
 * boilerplate. This is the dominant work performed by `zb build adapter`
 * and `zb build --lib` at the gate before the rest of the pipeline runs.
 *
 * How regression is detected: the test reads `baseline.json` (committed),
 * runs the same workload, and FAILS if the median wall time exceeds
 * `baseline.medianMs * REGRESSION_FACTOR`. To refresh the baseline after
 * an intentional algorithmic change, set `ZIPBUL_PERF_RECORD=1` and the
 * test will rewrite `baseline.json` with the current measurements.
 *
 * The thresholds are intentionally generous (REGRESSION_FACTOR = 2.0)
 * because CI hosts vary in CPU performance — the goal is to catch
 * order-of-magnitude regressions, not micro-fluctuations.
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseSource, type ParsedFile } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import { validateDefineCallShape, type DefineCallShapeInput } from '../../src/compiler/define-call-shape';

const FIXTURE_SIZES = [100, 500, 1000] as const;
const ITERATIONS_PER_SIZE = 5;
const WARMUP_ITERATIONS = 1;
const REGRESSION_FACTOR = 2.0;

const baselinePath = join(import.meta.dir, 'baseline.json');

interface BaselineEntry {
  readonly fileCount: number;
  readonly medianMs: number;
}

interface BaselineFile {
  readonly entries: readonly BaselineEntry[];
  readonly recordedAt: string;
}

function generateFile(index: number): { filePath: string; sourceText: string } {
  const sourceText = [
    `import { defineMiddleware } from '@zipbul/common';`,
    `import type { MiddlewareDefinition } from '@zipbul/common';`,
    ``,
    `interface Mw${String(index)}Options { readonly name: string; readonly value: number; }`,
    ``,
    `class Helper${String(index)} {`,
    `  constructor(private readonly opts: Mw${String(index)}Options) {}`,
    `  apply(): void { console.log(this.opts.name, this.opts.value); }`,
    `}`,
    ``,
    `export const middleware${String(index)}: MiddlewareDefinition = defineMiddleware([], () => () => {`,
    `  const h = new Helper${String(index)}({ name: 'mw${String(index)}', value: ${String(index)} });`,
    `  h.apply();`,
    `});`,
  ].join('\n');

  return { filePath: `/synthetic/mw-${String(index)}.ts`, sourceText };
}

function buildShapeInputs(count: number): DefineCallShapeInput[] {
  const inputs: DefineCallShapeInput[] = [];
  for (let i = 0; i < count; i++) {
    const { filePath, sourceText } = generateFile(i);
    const parsed = parseSource(filePath, sourceText);
    if (isErr(parsed)) {
      throw new Error(`fixture parse failed at index ${String(i)}`);
    }
    inputs.push({ filePath, parsed: parsed as ParsedFile });
  }
  return inputs;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function readBaseline(): BaselineFile | null {
  if (!existsSync(baselinePath)) return null;
  const raw = readFileSync(baselinePath, 'utf8');
  return JSON.parse(raw) as BaselineFile;
}

function writeBaseline(entries: readonly BaselineEntry[]): void {
  const file: BaselineFile = {
    entries,
    recordedAt: new Date().toISOString(),
  };
  writeFileSync(baselinePath, `${JSON.stringify(file, null, 2)}\n`);
}

describe('perf: validateDefineCallShape', () => {
  const recordingMode = process.env.ZIPBUL_PERF_RECORD === '1';
  const measurements: BaselineEntry[] = [];

  for (const size of FIXTURE_SIZES) {
    it(`N=${String(size)} files completes within regression threshold`, () => {
      // Pre-build inputs once so timing isolates validation, not fixture creation.
      const inputs = buildShapeInputs(size);

      // Warmup — JIT, cache fill.
      for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        validateDefineCallShape(inputs);
      }

      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS_PER_SIZE; i++) {
        const start = performance.now();
        validateDefineCallShape(inputs);
        samples.push(performance.now() - start);
      }

      const medianMs = median(samples);
      measurements.push({ fileCount: size, medianMs });

      if (recordingMode) return;

      const baseline = readBaseline();
      if (baseline === null) {
        // First run on a host without a committed baseline: just record
        // the measurement, don't fail. CI should commit a baseline.
        return;
      }

      const baseEntry = baseline.entries.find(e => e.fileCount === size);
      if (baseEntry === undefined) return;

      const ceiling = baseEntry.medianMs * REGRESSION_FACTOR;
      // Soft-floor: if the baseline is sub-millisecond, allow at least 5ms
      // before declaring regression — measurement noise dominates below.
      const effectiveCeiling = Math.max(ceiling, 5);

      expect(medianMs).toBeLessThanOrEqual(effectiveCeiling);
    });
  }

  it('records baseline when ZIPBUL_PERF_RECORD=1 is set', () => {
    if (!recordingMode) {
      // Not in record mode — nothing to assert. The earlier `it` blocks
      // populated `measurements`; we just skip the write.
      return;
    }
    expect(measurements.length).toBe(FIXTURE_SIZES.length);
    writeBaseline(measurements);
  });
});
