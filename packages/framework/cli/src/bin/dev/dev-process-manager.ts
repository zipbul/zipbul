import type { Subprocess } from 'bun';
import { relative } from 'path';

import { Logger } from '@zipbul/logger';

const STOP_TIMEOUT_MS = 5000;

interface DevProcessManagerParams {
  entryPath: string;
  cwd: string;
  spawnProcess: (command: string[], cwd: string) => Subprocess;
}

/**
 * Manages the lifecycle of the child application process spawned by `zb dev`.
 *
 * Status messages flow through `[dev/app]` Logger context. Subprocess
 * stdout/stderr lines are captured and echoed verbatim (no Logger wrapping)
 * so the running app's own structured output stays intact for downstream
 * consumers — Logger framing is reserved for the dev watcher's own events.
 *
 * @public
 */
export class DevProcessManager {
  private process: Subprocess | null = null;
  private readonly entryPath: string;
  private readonly cwd: string;
  private readonly spawnProcess: DevProcessManagerParams['spawnProcess'];
  private readonly log = new Logger('dev/app');

  constructor(params: DevProcessManagerParams) {
    this.entryPath = params.entryPath;
    this.cwd = params.cwd;
    this.spawnProcess = params.spawnProcess;
  }

  /**
   * Spawns the application process.
   *
   * @param label - Verb prefix shown in the log message (e.g. `"start"` or `"restart"`)
   * @public
   */
  start(label: string = 'start'): void {
    const displayPath = relative(this.cwd, this.entryPath) || this.entryPath;
    this.log.info('%s bun %s', label, displayPath);
    this.process = this.spawnProcess(['bun', this.entryPath], this.cwd);

    this.pipeStream(this.process.stdout, false);
    this.pipeStream(this.process.stderr, true);

    this.process.exited.then((exitCode) => {
      if (exitCode !== null && exitCode !== 0 && this.process !== null) {
        this.log.warn('process exited with code %d', exitCode);
      }
    }).catch(() => {
      /* exited promise rejection is non-actionable */
    });
  }

  /**
   * Stops the running process, then starts a fresh one.
   *
   * @public
   */
  async restart(): Promise<void> {
    await this.stop();
    this.start('restart');
  }

  /**
   * Gracefully stops the running process.
   * Waits up to {@link STOP_TIMEOUT_MS} ms for the process to exit.
   *
   * @public
   */
  async stop(): Promise<void> {
    const proc = this.process;

    if (proc === null) {
      return;
    }

    this.process = null;
    proc.kill();

    await Promise.race([
      proc.exited,
      new Promise<void>((resolve) => {
        setTimeout(resolve, STOP_TIMEOUT_MS);
      }),
    ]);
  }

  /**
   * Pipes the subprocess stream to stdout/stderr verbatim. The app already
   * has its own log format (most likely `@zipbul/logger` since the user app
   * was built by `zb`), so re-wrapping each line through Logger here would
   * double-frame and break the agent's grep contract.
   */
  private pipeStream(stream: ReadableStream<Uint8Array> | null | number | undefined, isStderr: boolean): void {
    if (stream === null || stream === undefined || typeof stream === 'number') {
      return;
    }

    const reader = stream.getReader();
    const sink = isStderr ? process.stderr : process.stdout;

    const pump = async (): Promise<void> => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          sink.write(value);
        }
      } catch {
        /* stream closed on process kill */
      } finally {
        // Release the lock so the underlying ReadableStream can be GC'd.
        // Without this, killing the subprocess leaves a dangling reader
        // lock that prevents stream finalization.
        try { reader.releaseLock(); } catch { /* already released */ }
      }
    };

    void pump();
  }
}
