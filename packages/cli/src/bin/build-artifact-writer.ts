import { rm } from 'fs/promises';
import { relative } from 'path';

import type { Gildash } from '@zipbul/gildash';

import type { ModuleNode } from '../compiler/analyzer/graph/module-node';
import { writeIfChanged } from '../common';

// ---------------------------------------------------------------------------
// Interface catalog
// ---------------------------------------------------------------------------

export interface InterfaceCatalogParams {
  modules: ReadonlyMap<string, ModuleNode>;
  ledger: Gildash;
  semanticAvailable: boolean;
  projectRoot: string;
  catalogFilePath: string;
}

/**
 * Generates and writes `interface-catalog.json` from the module graph.
 *
 * @param params - Catalog generation parameters
 *
 * @public
 */
export async function writeInterfaceCatalog(params: InterfaceCatalogParams): Promise<void> {
  const { modules, ledger, semanticAvailable, projectRoot, catalogFilePath } = params;
  const catalogEntries = [];

  for (const [modulePath, moduleNode] of modules) {
    try {
      const iface = semanticAvailable
        ? ledger.getSemanticModuleInterface(modulePath)
        : ledger.getModuleInterface(modulePath);

      let fileStats: { lineCount: number; symbolCount: number; exportedSymbolCount: number } | undefined;

      try {
        const stats = ledger.getFileStats(modulePath);

        fileStats = {
          lineCount: stats.lineCount,
          symbolCount: stats.symbolCount,
          exportedSymbolCount: stats.exportedSymbolCount,
        };
      } catch { /* stats unavailable */ }

      catalogEntries.push({
        module: moduleNode.name,
        filePath: relative(projectRoot, modulePath),
        exports: iface.exports,
        semantic: semanticAvailable,
        ...(fileStats !== undefined ? { fileStats } : {}),
      });
    } catch {
      try {
        const iface = ledger.getModuleInterface(modulePath);

        catalogEntries.push({
          module: moduleNode.name,
          filePath: relative(projectRoot, modulePath),
          exports: iface.exports,
          semantic: false,
        });
      } catch { /* skip */ }
    }
  }

  const catalogJson = JSON.stringify(
    { schemaVersion: '3', entries: catalogEntries },
    null,
    2,
  );

  await writeIfChanged(catalogFilePath, catalogJson);
}

/**
 * Removes `interface-catalog.json` if it exists.
 *
 * @param catalogFilePath - Absolute path to the catalog file
 *
 * @public
 */
export async function removeInterfaceCatalog(catalogFilePath: string): Promise<void> {
  await rm(catalogFilePath, { force: true });
}

// ---------------------------------------------------------------------------
// Runtime report
// ---------------------------------------------------------------------------

/**
 * Writes the initial `runtime-report.json` stub.
 *
 * @param reportFilePath - Absolute path to the report file
 *
 * @public
 */
export async function writeRuntimeReport(reportFilePath: string): Promise<void> {
  const reportJson = JSON.stringify({ schemaVersion: '1', adapters: [] }, null, 2);
  await writeIfChanged(reportFilePath, reportJson);
}

/**
 * Removes `runtime-report.json` if it exists.
 *
 * @param reportFilePath - Absolute path to the report file
 *
 * @public
 */
export async function removeRuntimeReport(reportFilePath: string): Promise<void> {
  await rm(reportFilePath, { force: true });
}
