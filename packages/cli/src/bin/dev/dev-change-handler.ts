import type { IndexResult } from '@zipbul/gildash';
import type { Gildash } from '@zipbul/gildash';

import { Logger } from '@zipbul/logger';

import type { RebuildContext } from './interfaces';
import { shouldAnalyzeFile, analyzeFile, rebuild } from './dev-rebuild-engine';
import { buildDevIncrementalImpactLog } from './dev-incremental-impact';
import type { DevProcessManager } from './dev-process-manager';

const log = new Logger('dev');
const rebuildLog = new Logger('dev/rebuild');

interface ChangeHandlerContext {
  rebuildContext: RebuildContext;
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
 * Output uses `dev:` prefix for status lines and `dev/rebuild:` for rebuild
 * trigger lines that monitor tools can match against.
 *
 * @public
 */
export function createChangeHandler(context: ChangeHandlerContext): {
  handleIndexResult: (result: IndexResult) => Promise<void>;
  state: ChangeHandlerState;
} {
  const {
    rebuildContext,
    toProjectRelativePath,
    ledger,
    processManager,
    moduleFileName,
  } = context;

  const { fileCache, fingerprintCache } = rebuildContext;

  const state: ChangeHandlerState = { lastRebuildFailed: false };

  async function handleIndexResult(result: IndexResult): Promise<void> {
    // 1. Remove deleted files
    for (const file of result.deletedFiles) {
      fileCache.delete(file);
      fingerprintCache.delete(file);
    }

    if (result.deletedFiles.length > 0) {
      log.info('deleted %s', result.deletedFiles.map(toProjectRelativePath).join(', '));
    }

    // 2. Log parse-failed files
    for (const file of result.failedFiles) {
      log.warn('file could not be indexed: %s', toProjectRelativePath(file));
    }

    // 3. Symbol-level changes
    const { added, modified, removed } = result.changedSymbols;

    if (removed.length > 0) {
      const grouped = Map.groupBy(removed, (s) => s.filePath);
      for (const [file, symbols] of grouped) {
        log.warn('removed %s in %s', symbols.map(s => s.name).join(', '), toProjectRelativePath(file));
      }
    }
    if (modified.length > 0) {
      const grouped = Map.groupBy(modified, (s) => s.filePath);
      for (const [file, symbols] of grouped) {
        log.info('modified %s in %s', symbols.map(s => s.name).join(', '), toProjectRelativePath(file));
      }
    }
    if (added.length > 0) {
      const grouped = Map.groupBy(added, (s) => s.filePath);
      for (const [file, symbols] of grouped) {
        log.info('added %s in %s', symbols.map(s => s.name).join(', '), toProjectRelativePath(file));
      }
    }

    if (result.renamedSymbols.length > 0) {
      for (const renamed of result.renamedSymbols) {
        log.info('renamed %s -> %s in %s', renamed.oldName, renamed.newName, toProjectRelativePath(renamed.filePath));
      }
    }

    if (result.movedSymbols.length > 0) {
      for (const moved of result.movedSymbols) {
        log.info('moved %s from %s -> %s', moved.name,
          toProjectRelativePath(moved.oldFilePath),
          toProjectRelativePath(moved.newFilePath));
      }
    }

    // 4. Skip if only non-app files changed
    const hasAppChanges = result.changedFiles.some(shouldAnalyzeFile);
    if (!hasAppChanges && result.deletedFiles.length === 0) {
      log.info('no app files changed, skipping restart');
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

      log.info('no exported changes, skipping rebuild');
      await processManager.restart();
      return;
    }

    // 5. Save fingerprints before re-analyzing changed files. The same
    // snapshot+analyze pass runs against changedFiles first, then against
    // any files reachable via getAffected — both sets contribute to the
    // fingerprint comparison below that decides whether a rebuild is needed.
    const oldFingerprints = new Map<string, string>();
    const snapshotFingerprints = (files: readonly string[]): void => {
      for (const file of files) {
        if (!shouldAnalyzeFile(file)) continue;
        const existing = fingerprintCache.get(file);
        if (existing !== undefined) {
          oldFingerprints.set(file, existing);
        }
      }
    };

    snapshotFingerprints(result.changedFiles);

    for (const file of result.changedFiles) {
      if (shouldAnalyzeFile(file)) {
        await analyzeFile(file, rebuildContext);
      }
    }

    let affectedFiles: string[];
    try {
      affectedFiles = await ledger.getAffected(result.changedFiles);
    } catch {
      affectedFiles = [];
    }

    snapshotFingerprints(affectedFiles);

    for (const file of affectedFiles) {
      if (shouldAnalyzeFile(file)) {
        await analyzeFile(file, rebuildContext);
      }
    }

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

    if (!needsRebuild) {
      for (const file of result.changedFiles) {
        if (shouldAnalyzeFile(file) && !oldFingerprints.has(file) && fingerprintCache.has(file)) {
          needsRebuild = true;
          break;
        }
      }
    }

    if (needsRebuild) {
      const importRelationTypes = new Set(['imports', 're-exports', 'type-references']);
      const importsChanged = result.changedRelations.added.some(r => importRelationTypes.has(r.type))
        || result.changedRelations.removed.some(r => importRelationTypes.has(r.type))
        || result.deletedFiles.length > 0;

      rebuildLog.time('elapsed');
      const allAffected = [...result.changedFiles, ...affectedFiles];
      const impactLog = buildDevIncrementalImpactLog({
        affectedFiles: allAffected,
        fileCache,
        moduleFileName,
        toProjectRelativePath,
      });

      const rebuildResult = await rebuild(rebuildContext, { skipCycleCheck: !importsChanged });

      for (const warning of rebuildResult.graph.warnings) {
        rebuildLog.warn('%s', warning);
      }

      const moduleNames = Array.from(impactLog.affectedModules)
        .map(toProjectRelativePath)
        .map(p => p.replace(/\/module\.ts$/, '').replace(/\/__module__\.ts$/, ''))
        .sort();
      const moduleSummary = moduleNames.length > 0 ? moduleNames.join(', ') : '(none)';
      rebuildLog.info('ok modules=%s', moduleSummary);
      rebuildLog.timeEnd('elapsed');
    } else {
      log.info('no structural changes, skipping rebuild');
    }

    if (state.lastRebuildFailed) {
      log.info('build recovered');
      state.lastRebuildFailed = false;
    }

    await processManager.restart();
  }

  return { handleIndexResult, state };
}
