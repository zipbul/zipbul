import { relative } from 'path';
import { gzipSync } from 'node:zlib';

import type { Gildash } from '@zipbul/gildash';
import type { FileAnalysis } from '../../compiler/analyzer';

/**
 * Reads bundled output files and the manifest, computes raw + gzip sizes,
 * and emits a console.table row per artifact + a totals line.
 */
export async function reportOutputSizes(params: {
  entryOutputFile: string;
  runtimeOutputFile: string;
  manifestFile: string;
  manifestJson: string;
  projectRoot: string;
}): Promise<void> {
  const { entryOutputFile, runtimeOutputFile, manifestFile, manifestJson, projectRoot } = params;

  const [entryBuffer, runtimeBuffer] = await Promise.all([
    Bun.file(entryOutputFile).arrayBuffer(),
    Bun.file(runtimeOutputFile).arrayBuffer(),
  ]);
  const manifestBuffer = Buffer.from(manifestJson, 'utf-8');

  const rows = [
    {
      file: relative(projectRoot, entryOutputFile),
      size: entryBuffer.byteLength,
      gzip: gzipSync(Buffer.from(entryBuffer)).byteLength,
    },
    {
      file: relative(projectRoot, runtimeOutputFile),
      size: runtimeBuffer.byteLength,
      gzip: gzipSync(Buffer.from(runtimeBuffer)).byteLength,
    },
    {
      file: relative(projectRoot, manifestFile),
      size: manifestBuffer.byteLength,
      gzip: gzipSync(manifestBuffer).byteLength,
    },
  ];

  console.group('output');
  console.table(rows);
  console.groupEnd();
}

/**
 * Reports files with high fan-in/fan-out coupling. Emits at most 5 rows.
 * Skipped when no files exceed the thresholds (fan-in > 10 OR fan-out > 8).
 */
export async function reportCouplingMetrics(
  fileMap: ReadonlyMap<string, FileAnalysis>,
  ledger: Gildash,
  projectRoot: string,
): Promise<void> {
  const filePaths = Array.from(fileMap.keys());
  const metricsResults = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const metrics = await ledger.getFanMetrics(filePath);
        return { filePath, fanIn: metrics.fanIn, fanOut: metrics.fanOut };
      } catch {
        return null;
      }
    })
  );

  const highCoupling = metricsResults
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .filter(m => m.fanIn > 10 || m.fanOut > 8)
    .sort((a, b) => (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut))
    .slice(0, 5);

  if (highCoupling.length === 0) return;

  console.group('coupling');
  console.table(highCoupling.map(m => ({
    file: relative(projectRoot, m.filePath),
    fanIn: m.fanIn,
    fanOut: m.fanOut,
  })));
  console.groupEnd();
}

/**
 * Reports files exceeding complexity thresholds (symbolCount > 20 OR
 * lineCount > 500). Emits at most 5 rows.
 */
export function reportComplexFiles(
  fileMap: ReadonlyMap<string, FileAnalysis>,
  ledger: Gildash,
  projectRoot: string,
): void {
  const filePaths = Array.from(fileMap.keys());

  const complexFiles = filePaths
    .map((filePath) => {
      try {
        return { filePath, stats: ledger.getFileStats(filePath) };
      } catch {
        return null;
      }
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .filter(f => f.stats.symbolCount > 20 || f.stats.lineCount > 500)
    .sort((a, b) => b.stats.symbolCount - a.stats.symbolCount)
    .slice(0, 5);

  if (complexFiles.length === 0) return;

  console.group('complex');
  console.table(complexFiles.map(f => ({
    file: relative(projectRoot, f.filePath),
    symbols: f.stats.symbolCount,
    lines: f.stats.lineCount,
    exports: f.stats.exportedSymbolCount,
  })));
  console.groupEnd();
}

/**
 * Reports overall project statistics (file count, symbol count).
 */
export function reportProjectStats(ledger: Gildash): void {
  try {
    const stats = ledger.getStats();
    console.log('project: %d files, %d symbols', stats.fileCount, stats.symbolCount);
  } catch { /* stats failure ignored */ }
}
