import { relative } from 'path';
import { gzipSync } from 'node:zlib';

import type { CliRendererLike } from '../interfaces';

import type { Gildash } from '@zipbul/gildash';
import type { FileAnalysis } from '../../compiler/analyzer';

// ---------------------------------------------------------------------------
// Output file sizes
// ---------------------------------------------------------------------------

export interface OutputSizeEntry {
  outputFilePath: string;
  projectRoot: string;
}

/**
 * Reads bundled output files and the manifest, computes raw + gzip sizes,
 * and renders them via the CLI renderer.
 *
 * @param params - Output file paths and manifest JSON
 * @param renderer - CLI renderer for display
 *
 * @public
 */
export async function reportOutputSizes(
  params: {
    entryOutputFile: string;
    runtimeOutputFile: string;
    manifestFile: string;
    manifestJson: string;
    projectRoot: string;
  },
  renderer: CliRendererLike,
): Promise<void> {
  const { entryOutputFile, runtimeOutputFile, manifestFile, manifestJson, projectRoot } = params;

  const [entryBuffer, runtimeBuffer] = await Promise.all([
    Bun.file(entryOutputFile).arrayBuffer(),
    Bun.file(runtimeOutputFile).arrayBuffer(),
  ]);
  const manifestBuffer = Buffer.from(manifestJson, 'utf-8');

  const entrySize = entryBuffer.byteLength;
  const runtimeSize = runtimeBuffer.byteLength;
  const manifestSize = manifestBuffer.byteLength;

  const entryGzip = gzipSync(Buffer.from(entryBuffer)).byteLength;
  const runtimeGzip = gzipSync(Buffer.from(runtimeBuffer)).byteLength;
  const manifestGzip = gzipSync(manifestBuffer).byteLength;

  renderer.outputFiles('\u{1F4E6} Output', [
    { name: relative(projectRoot, entryOutputFile), size: entrySize, gzipSize: entryGzip },
    { name: relative(projectRoot, runtimeOutputFile), size: runtimeSize, gzipSize: runtimeGzip },
    { name: relative(projectRoot, manifestFile), size: manifestSize, gzipSize: manifestGzip },
  ]);
}

// ---------------------------------------------------------------------------
// Coupling metrics
// ---------------------------------------------------------------------------

/**
 * Reports files with high fan-in/fan-out coupling via the CLI renderer.
 *
 * @param fileMap - Analysed source files
 * @param ledger - Gildash instance for querying metrics
 * @param projectRoot - Project root for relative path display
 * @param renderer - CLI renderer for display
 *
 * @public
 */
export async function reportCouplingMetrics(
  fileMap: ReadonlyMap<string, FileAnalysis>,
  ledger: Gildash,
  projectRoot: string,
  renderer: CliRendererLike,
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

  if (highCoupling.length > 0) {
    renderer.outputPaths('High Coupling', highCoupling.map(m => ({
      label: relative(projectRoot, m.filePath),
      value: `fan-in: ${m.fanIn}, fan-out: ${m.fanOut}`,
    })));
  }
}

// ---------------------------------------------------------------------------
// Complex files
// ---------------------------------------------------------------------------

/**
 * Reports files exceeding complexity thresholds (symbol count or line count).
 *
 * @param fileMap - Analysed source files
 * @param ledger - Gildash instance for querying stats
 * @param projectRoot - Project root for relative path display
 * @param renderer - CLI renderer for display
 *
 * @public
 */
export function reportComplexFiles(
  fileMap: ReadonlyMap<string, FileAnalysis>,
  ledger: Gildash,
  projectRoot: string,
  renderer: CliRendererLike,
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

  if (complexFiles.length > 0) {
    renderer.outputPaths('Complex Files', complexFiles.map(f => ({
      label: relative(projectRoot, f.filePath),
      value: `${f.stats.symbolCount} symbols, ${f.stats.lineCount} lines, ${f.stats.exportedSymbolCount} exports`,
    })));
  }
}

// ---------------------------------------------------------------------------
// Project stats
// ---------------------------------------------------------------------------

/**
 * Reports overall project statistics (file count, symbol count).
 *
 * @param ledger - Gildash instance for querying stats
 * @param renderer - CLI renderer for display
 *
 * @public
 */
export function reportProjectStats(ledger: Gildash, renderer: CliRendererLike): void {
  try {
    const stats = ledger.getStats();
    renderer.info(`Project: ${stats.fileCount} files, ${stats.symbolCount} symbols`);
  } catch { /* stats failure ignored */ }
}
