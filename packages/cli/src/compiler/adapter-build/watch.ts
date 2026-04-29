/**
 * Watch mode for `zb build adapter --watch` (Section K, Items 102~108).
 *
 * Watches the adapter package's source tree for `.ts` changes, debounces a
 * configurable window (default 100ms), then re-runs `buildAdapter`. In-flight
 * builds are cancelled-and-restarted via an AbortController-equivalent flag.
 *
 * The implementation uses Node's recursive `fs.watch` (Bun-compatible) — no
 * extra dependency. tsconfig.json / package.json mutations trigger a full
 * rebuild (Item 107).
 *
 * @public
 */
import { watch } from 'node:fs';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import { buildAdapter } from './adapter-build.command';
import type { BuildAdapterOptions, BuildAdapterResult } from './interfaces';

export interface WatchAdapterOptions extends BuildAdapterOptions {
  /** Debounce window in ms (Item 108). Default: 100. */
  readonly debounceMs?: number;
  /**
   * Called after every successful (or failed) rebuild. Failures are passed
   * as the second argument; on success the second argument is `null`.
   */
  readonly onRebuild?: (result: BuildAdapterResult | null, error: Error | null) => void;
  /** Called once when the initial build completes and the watcher is armed. */
  readonly onReady?: () => void;
}

export interface WatchHandle {
  /** Stop the watcher and release fs handles. */
  readonly close: () => void;
}

/**
 * Starts a watcher rooted at the adapter package. Returns a handle whose
 * `close()` tears down the watcher.
 *
 * @public
 */
export async function watchAdapter(options: WatchAdapterOptions = {}): Promise<WatchHandle> {
  const packageRoot = options.packageRoot ?? process.cwd();
  const debounceMs = options.debounceMs ?? 100;

  let buildToken = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const triggerBuild = (): void => {
    if (closed) return;

    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
    }

    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const myToken = ++buildToken;

      buildAdapter(options).then(
        (result) => {
          if (myToken !== buildToken) return; // newer build started — drop result
          options.onRebuild?.(result, null);
        },
        (cause: unknown) => {
          if (myToken !== buildToken) return;
          options.onRebuild?.(null, cause instanceof Error ? cause : new Error(String(cause)));
        },
      );
    }, debounceMs);
  };

  // Initial build first (Item 102 — same code path as one-shot build).
  try {
    const result = await buildAdapter(options);
    options.onRebuild?.(result, null);
  } catch (cause) {
    options.onRebuild?.(null, cause instanceof Error ? cause : new Error(String(cause)));
  }

  const watchTargets: string[] = [];
  const srcDir = join(packageRoot, 'src');

  if (await pathExists(srcDir)) watchTargets.push(srcDir);
  if (await pathExists(join(packageRoot, 'index.ts'))) watchTargets.push(join(packageRoot, 'index.ts'));
  watchTargets.push(join(packageRoot, 'package.json'));
  const tsconfigPath = join(packageRoot, 'tsconfig.build.json');
  if (await pathExists(tsconfigPath)) watchTargets.push(tsconfigPath);

  const watchers = watchTargets.map(target => watch(target, { recursive: true }, (_event, filename) => {
    if (filename === null) return;
    if (typeof filename === 'string' && filename.endsWith('~')) return; // editor swap files
    triggerBuild();
  }));

  options.onReady?.();

  return {
    close(): void {
      closed = true;
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      for (const w of watchers) {
        try { w.close(); } catch { /* swallow */ }
      }
    },
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
