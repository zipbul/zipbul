import type { IndexResult } from '@zipbul/gildash';
import type { Gildash } from '@zipbul/gildash';

import type { CliRendererLike } from '../interfaces';
import type { RebuildContext } from './interfaces';
import { shouldAnalyzeFile, analyzeFile, rebuild } from './dev-rebuild-engine';
import { buildDevIncrementalImpactLog } from './dev-incremental-impact';
import type { DevProcessManager } from './dev-process-manager';

interface ChangeHandlerContext {
  rebuildContext: RebuildContext;
  renderer: CliRendererLike;
  toProjectRelativePath: (filePath: string) => string;
  ledger: Gildash;
  processManager: DevProcessManager;
  moduleFileName: string;
}

interface ChangeHandlerState {
  lastRebuildFailed: boolean;
}

/**
 * Creates the `onIndexed` callback that processes file-system changes detected
 * by Gildash. Handles: deleted file cleanup, symbol change logging, fast-path
 * skip, fingerprint comparison, affected file analysis, and conditional rebuild.
 *
 * @param context - Shared handler context with caches, renderer, and process manager
 * @returns An object with the `handleIndexResult` callback and mutable `state`
 * @public
 */
export function createChangeHandler(context: ChangeHandlerContext): {
  handleIndexResult: (result: IndexResult) => Promise<void>;
  state: ChangeHandlerState;
} {
  const {
    rebuildContext,
    renderer,
    toProjectRelativePath,
    ledger,
    processManager,
    moduleFileName,
  } = context;

  const { fileCache, fingerprintCache } = rebuildContext;

  const state: ChangeHandlerState = { lastRebuildFailed: false };

  async function handleIndexResult(result: IndexResult): Promise<void> {
    renderer.separator();

    // 1. Remove deleted files
    for (const file of result.deletedFiles) {
      fileCache.delete(file);
      fingerprintCache.delete(file);
    }

    if (result.deletedFiles.length > 0) {
      renderer.info(`Deleted: ${result.deletedFiles.map(toProjectRelativePath).join(', ')}`);
    }

    // 2. Log parse-failed files
    for (const file of result.failedFiles) {
      renderer.warn(`File could not be indexed: ${toProjectRelativePath(file)}`);
    }

    // 3. Analyze symbol-level changes (changedSymbols)
    const { added, modified, removed } = result.changedSymbols;

    if (removed.length > 0) {
      const grouped = Map.groupBy(removed, (s) => s.filePath);
      for (const [file, symbols] of grouped) {
        renderer.warn(`Removed: ${symbols.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
      }
    }
    if (modified.length > 0) {
      const grouped = Map.groupBy(modified, (s) => s.filePath);
      for (const [file, symbols] of grouped) {
        renderer.info(`Modified: ${symbols.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
      }
    }
    if (added.length > 0) {
      const grouped = Map.groupBy(added, (s) => s.filePath);
      for (const [file, symbols] of grouped) {
        renderer.info(`Added: ${symbols.map(s => s.name).join(', ')} in ${toProjectRelativePath(file)}`);
      }
    }

    if (result.renamedSymbols.length > 0) {
      for (const renamed of result.renamedSymbols) {
        renderer.info(`Renamed: ${renamed.oldName} → ${renamed.newName} in ${toProjectRelativePath(renamed.filePath)}`);
      }
    }

    if (result.movedSymbols.length > 0) {
      for (const moved of result.movedSymbols) {
        renderer.info(`Moved: ${moved.name} from ${toProjectRelativePath(moved.oldFilePath)} → ${toProjectRelativePath(moved.newFilePath)}`);
      }
    }

    // 4. Skip if only non-app files changed
    const hasAppChanges = result.changedFiles.some(shouldAnalyzeFile);
    if (!hasAppChanges && result.deletedFiles.length === 0) {
      renderer.info('No app files changed, skipping restart');
      return;
    }

    // 4-B. Fast path: skip re-parse + rebuild when no exported symbols changed
    const hasExportedChange = result.changedSymbols.modified.some(s => s.isExported)
      || result.changedSymbols.added.some(s => s.isExported)
      || result.changedSymbols.removed.some(s => s.isExported);
    const hasReExportChange = result.changedRelations.added.some(r => r.type === 're-exports')
      || result.changedRelations.removed.some(r => r.type === 're-exports');

    if (!hasExportedChange && !hasReExportChange && result.deletedFiles.length === 0) {
      // Only internal changes — re-analyze files but skip rebuild
      for (const file of result.changedFiles) {
        if (shouldAnalyzeFile(file)) {
          await analyzeFile(file, rebuildContext);
        }
      }

      renderer.info('No exported changes, skipping rebuild');
      await processManager.restart();
      return;
    }

    // 5. Save fingerprints before re-analyzing changed files
    const oldFingerprints = new Map<string, string>();
    for (const file of result.changedFiles) {
      if (shouldAnalyzeFile(file)) {
        const existing = fingerprintCache.get(file);
        if (existing !== undefined) {
          oldFingerprints.set(file, existing);
        }
      }
    }

    // 6. Re-analyze changed files themselves (getAffected excludes changed files)
    for (const file of result.changedFiles) {
      if (shouldAnalyzeFile(file)) {
        await analyzeFile(file, rebuildContext);
      }
    }

    // 7. Compute affected files (file-level)
    let affectedFiles: string[];
    try {
      affectedFiles = await ledger.getAffected(result.changedFiles);
    } catch {
      affectedFiles = [];
    }

    // 8. Save fingerprints + re-analyze affected files
    for (const file of affectedFiles) {
      if (shouldAnalyzeFile(file)) {
        const existing = fingerprintCache.get(file);
        if (existing !== undefined) {
          oldFingerprints.set(file, existing);
        }
        await analyzeFile(file, rebuildContext);
      }
    }

    // 9. Determine if structural change occurred
    let needsRebuild = result.deletedFiles.length > 0;

    if (!needsRebuild) {
      for (const [file, oldFp] of oldFingerprints) {
        const newFp = fingerprintCache.get(file);
        if (newFp !== oldFp) {
          needsRebuild = true;
          break;
        }
      }
    }

    // Newly added files (no previous fingerprint) → rebuild required
    if (!needsRebuild) {
      for (const file of result.changedFiles) {
        if (shouldAnalyzeFile(file) && !oldFingerprints.has(file) && fingerprintCache.has(file)) {
          needsRebuild = true;
          break;
        }
      }
    }

    // 10. Conditional rebuild
    if (needsRebuild) {
      const importRelationTypes = new Set(['imports', 're-exports', 'type-references']);
      const importsChanged = result.changedRelations.added.some(r => importRelationTypes.has(r.type))
        || result.changedRelations.removed.some(r => importRelationTypes.has(r.type))
        || result.deletedFiles.length > 0;

      const rebuildStartedAt = performance.now();
      const allAffected = [...result.changedFiles, ...affectedFiles];
      const impactLog = buildDevIncrementalImpactLog({
        affectedFiles: allAffected,
        fileCache,
        moduleFileName,
        toProjectRelativePath,
      });

      await rebuild(rebuildContext, { skipCycleCheck: !importsChanged });

      const rebuildDuration = ((performance.now() - rebuildStartedAt) / 1000).toFixed(1);

      const moduleNames = Array.from(impactLog.affectedModules)
        .map(toProjectRelativePath)
        .map(p => p.replace(/\/module\.ts$/, '').replace(/\/__module__\.ts$/, ''))
        .sort();
      const moduleSummary = moduleNames.length > 0 ? moduleNames.join(', ') : '(none)';
      renderer.step(`🧭 ${moduleSummary} → rebuilt (${rebuildDuration}s)`);
    } else {
      renderer.info('No structural changes, skipping rebuild');
    }

    if (state.lastRebuildFailed) {
      renderer.success('Build recovered');
      state.lastRebuildFailed = false;
    }

    await processManager.restart();
  }

  return { handleIndexResult, state };
}
