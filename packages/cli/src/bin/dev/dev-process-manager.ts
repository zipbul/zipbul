import type { Subprocess } from 'bun';
import { relative } from 'path';

const STOP_TIMEOUT_MS = 5000;
const LINE_PREFIX = 'app: ';

interface DevProcessManagerParams {
  entryPath: string;
  cwd: string;
  spawnProcess: (command: string[], cwd: string) => Subprocess;
}

/**
 * Manages the lifecycle of the child application process spawned by `zb dev`.
 *
 * Subprocess stdout/stderr lines are prefixed with `app:` so they remain
 * grep-able alongside the dev watcher's own `dev:` and `build:` lines.
 *
 * @public
 */
export class DevProcessManager {
  private process: Subprocess | null = null;
  private readonly entryPath: string;
  private readonly cwd: string;
  private readonly spawnProcess: DevProcessManagerParams['spawnProcess'];

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
    console.log('dev: %s app bun %s', label, displayPath);
    this.process = this.spawnProcess(['bun', this.entryPath], this.cwd);

    this.pipeStream(this.process.stdout, false);
    this.pipeStream(this.process.stderr, true);

    this.process.exited.then((exitCode) => {
      if (exitCode !== null && exitCode !== 0 && this.process !== null) {
        console.error('warn: app process exited with code %d', exitCode);
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
   * Reads a piped subprocess stream line-by-line and writes each line
   * with the `app:` prefix. stderr lines go to process.stderr; stdout lines
   * go to process.stdout. No interpretation — agents see the raw app output
   * tagged so they can filter dev watcher events from app events.
   */
  private pipeStream(stream: ReadableStream<Uint8Array> | null | number | undefined, isStderr: boolean): void {
    if (stream === null || stream === undefined || typeof stream === 'number') {
      return;
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const sink = isStderr ? process.stderr : process.stdout;

    const pump = async (): Promise<void> => {
      let buffer = '';

      try {
        for (;;) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            sink.write(`${LINE_PREFIX}${line}\n`);
          }
        }

        if (buffer.length > 0) {
          sink.write(`${LINE_PREFIX}${buffer}\n`);
        }
      } catch {
        /* stream closed on process kill */
      }
    };

    void pump();
  }
}
