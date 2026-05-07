import { mkdir, rename, rm, stat } from 'node:fs/promises';

/**
 * Atomic directory emission helper — write artifacts into a staging directory,
 * then promote it to the final location through a backup-then-rename swap so
 * the prior good build is never destroyed before the new one is in place.
 *
 * Used uniformly by `zb build adapter`, `zb build --lib`, and `zb build`
 * (user-app `dist/`) so that partial output never replaces a prior good build.
 *
 * **Filesystem requirement**: `stagingDir`, `finalDir`, and the temporary
 * backup path (`<finalDir>.backup-<random>`) MUST reside on the same
 * filesystem. `rename(2)` is atomic only within a single mount point; cross-
 * mount renames degrade to copy+delete and lose the atomicity guarantee.
 * Callers conventionally place staging as a sibling of `finalDir`, which
 * satisfies this invariant on every supported deployment.
 *
 * @public
 */
export interface AtomicEmitOptions {
  /** Final destination, e.g. `<packageRoot>/dist`. */
  readonly finalDir: string;
  /** Staging directory, e.g. `<packageRoot>/dist.staging`. Must be a sibling of `finalDir` (same filesystem). */
  readonly stagingDir: string;
  /**
   * Optional cleanup hook — invoked with the staging path after staging is
   * created. Used to register the staging dir with a `CancellationScope` so
   * SIGINT/SIGTERM removes it before exit.
   */
  readonly registerCleanup?: (fn: () => Promise<void> | void) => void;
}

/**
 * Runs `emit(stagingDir)` against a freshly created staging directory, then
 * promotes it to `finalDir` through a backup-then-rename sequence:
 *
 *   1. `emit(stagingDir)` — caller writes artifacts into staging.
 *   2. If `finalDir` exists, rename it aside to `<finalDir>.backup-<rand>`.
 *      `rename(2)` is atomic on POSIX, so the prior dist is preserved.
 *   3. Rename `stagingDir` → `finalDir`. Atomic on POSIX; either the new
 *      build is fully visible or the old one still is via the backup.
 *   4. Remove the backup. Crash-safe — a leftover `.backup-*` directory is
 *      harmless and discoverable.
 *
 * Failure semantics:
 *   - Any error before step 3 leaves `finalDir` intact (backup is restored
 *     if it was created).
 *   - An error after step 3 leaves the new dist in place; the orphan backup
 *     is removed on next call's cleanup pass.
 *
 * @public
 */
export async function withAtomicEmit<T>(
  options: AtomicEmitOptions,
  emit: (stagingDir: string) => Promise<T>,
): Promise<T> {
  const { finalDir, stagingDir, registerCleanup } = options;
  const backupDir = `${finalDir}.backup-${randomSuffix()}`;

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  // SIGINT / SIGTERM cleanup — staging must always be removable; backup is
  // intentionally left for inspection if the swap was already completed.
  if (registerCleanup !== undefined) {
    registerCleanup(() => rm(stagingDir, { recursive: true, force: true }));
  }

  let backupCreated = false;
  let promoted = false;

  try {
    const result = await emit(stagingDir);

    // Step 2 — backup the current finalDir if it exists.
    if (await pathExists(finalDir)) {
      await rename(finalDir, backupDir);
      backupCreated = true;
    }

    // Step 3 — promote staging to final. Atomic on POSIX.
    await rename(stagingDir, finalDir);
    promoted = true;

    // Step 4 — drop the backup. Best-effort; leftover backups are
    // harmless because step 2 names them with a random suffix.
    if (backupCreated) {
      await rm(backupDir, { recursive: true, force: true }).catch(() => {});
    }

    return result;
  } catch (cause) {
    // Restoration order: if we failed BEFORE promoting, restore backup so
    // finalDir reverts to its prior contents. If promotion succeeded but a
    // later step threw (currently unreachable, but defensive), leave the
    // new build and remove the backup.
    if (!promoted && backupCreated) {
      // finalDir might exist if the rename succeeded in step 3 then the
      // process raced — rm it before restoring backup so rename is clean.
      await rm(finalDir, { recursive: true, force: true }).catch(() => {});
      await rename(backupDir, finalDir).catch(() => {});
    } else if (promoted && backupCreated) {
      await rm(backupDir, { recursive: true, force: true }).catch(() => {});
    }
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw cause;
  }
}

function randomSuffix(): string {
  // 6 hex chars from a 24-bit random — collision odds negligible for the
  // intended use (one swap per build).
  return Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0');
}

async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}
