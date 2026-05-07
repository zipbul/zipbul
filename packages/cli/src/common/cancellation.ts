/**
 * Cancellation primitive shared by all `zb` commands. Installs SIGINT/SIGTERM
 * handlers, exposes an `AbortSignal` for downstream operations
 * (`Bun.build`, `Bun.spawn`, `child_process.spawn`, `withAtomicEmit`), and
 * runs registered cleanup callbacks before exiting.
 *
 * **Cleanup contract**: on signal, the handler awaits every callback
 * passed to {@link CancellationScope.registerCleanup} *in registration
 * order*, then calls `process.exit(signalExitCode)`. Code outside the
 * cleanup list — e.g. `try { ... } finally { ... }` blocks running in
 * other async branches — is **not awaited**: `process.exit` terminates
 * synchronously and skips pending finally handlers. This is intentional:
 * a signal asks the program to stop *now*; waiting indefinitely on
 * unrelated async would defeat the purpose. Code that owns resources
 * needing graceful release MUST register a cleanup callback (or listen
 * to the {@link CancellationScope.signal} `'abort'` event) — relying on
 * a `finally` block alone is unsafe under cancellation.
 *
 * Orthodox lifecycle:
 *   const cancel = installCancellation({ renderer });
 *   try {
 *     // pass cancel.signal to long-running ops
 *     // cancel.registerCleanup(() => rm(stagingDir, ...))
 *   } finally {
 *     await cancel.dispose();   // unregister handlers
 *   }
 *
 * @public
 */

import type { CliRendererLike } from '../bin/interfaces';

/**
 * Cancellation scope returned by {@link installCancellation}.
 *
 * @public
 */
export interface CancellationScope {
  /** Aborted when SIGINT/SIGTERM arrives. Pass to `Bun.build`, `Bun.spawn`, etc. */
  readonly signal: AbortSignal;
  /** Register a cleanup callback to run before exit on signal. */
  registerCleanup(fn: () => Promise<void> | void): void;
  /** Remove signal handlers — call from a `finally` block on normal completion. */
  dispose(): void;
}

export interface InstallCancellationOptions {
  readonly renderer: CliRendererLike;
  /** Exit code to use on signal. Default 130 (SIGINT convention). */
  readonly signalExitCode?: number;
}

/**
 * Installs SIGINT/SIGTERM handlers backed by an `AbortController`. Idempotent
 * with respect to multiple signals — first signal triggers shutdown, repeats
 * are ignored.
 *
 * @public
 */
export function installCancellation(options: InstallCancellationOptions): CancellationScope {
  const { renderer, signalExitCode = 130 } = options;
  const controller = new AbortController();
  const cleanups: Array<() => Promise<void> | void> = [];
  let firing = false;

  const onSignal = async (sig: NodeJS.Signals): Promise<void> => {
    if (firing) return;
    firing = true;

    controller.abort(new Error(`Received ${sig}`));
    try { renderer.cancelled(`${sig} received. Cleaning up.`); } catch { /* renderer may be torn down */ }

    for (const fn of cleanups) {
      try { await fn(); } catch { /* best-effort cleanup */ }
    }

    process.exit(signalExitCode);
  };

  const sigintHandler = (): void => { void onSignal('SIGINT'); };
  const sigtermHandler = (): void => { void onSignal('SIGTERM'); };

  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  return {
    signal: controller.signal,
    registerCleanup(fn) { cleanups.push(fn); },
    dispose() {
      process.off('SIGINT', sigintHandler);
      process.off('SIGTERM', sigtermHandler);
    },
  };
}
