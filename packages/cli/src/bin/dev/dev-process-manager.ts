import type { Subprocess } from 'bun';
import { relative } from 'path';

import type { CliRendererLike } from '../interfaces';

const STOP_TIMEOUT_MS = 5000;
const LINE_PREFIX = '│  ';

interface DevProcessManagerParams {
  entryPath: string;
  cwd: string;
  renderer: CliRendererLike;
  spawnProcess: (command: string[], cwd: string) => Subprocess;
}

/**
 * Manages the lifecycle of the child application process spawned by `zb dev`.
 *
 * When the subprocess stdout/stderr are piped (`ReadableStream`), each output
 * line is prefixed with the clack continuation bar (`│  `) so app logs stay
 * visually inside the CLI frame.
 *
 * @public
 */
export class DevProcessManager {
  private process: Subprocess | null = null;
  private readonly entryPath: string;
  private readonly cwd: string;
  private readonly renderer: CliRendererLike;
  private readonly spawnProcess: DevProcessManagerParams['spawnProcess'];

  constructor(params: DevProcessManagerParams) {
    this.entryPath = params.entryPath;
    this.cwd = params.cwd;
    this.renderer = params.renderer;
    this.spawnProcess = params.spawnProcess;
  }

  /**
   * Spawns the application process.
   *
   * @param label - Verb prefix shown in the log message (e.g. `"Starting"` or `"Restarting"`)
   * @public
   */
  start(label: string = 'Starting'): void {
    const displayPath = relative(this.cwd, this.entryPath) || this.entryPath;
    this.renderer.step(`${label} app: bun ${displayPath}`);
    this.process = this.spawnProcess(['bun', this.entryPath], this.cwd);

    this.pipeStream(this.process.stdout);
    this.pipeStream(this.process.stderr);

    this.process.exited.then((exitCode) => {
      if (exitCode !== null && exitCode !== 0 && this.process !== null) {
        this.renderer.warn(`App process exited with code ${String(exitCode)}.`);
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
    this.start('Restarting');
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
   * to `process.stdout` with the clack continuation bar prefix.
   *
   * Does nothing when the stream is not a `ReadableStream` (e.g. inherited or null).
   */
  private pipeStream(stream: ReadableStream<Uint8Array> | null | number | undefined): void {
    if (stream === null || stream === undefined || typeof stream === 'number') {
      return;
    }

    const readable = stream as ReadableStream<Uint8Array>;
    const reader = readable.getReader();
    const decoder = new TextDecoder();

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
            process.stdout.write(`${LINE_PREFIX}${line}\n`);
          }
        }

        if (buffer.length > 0) {
          process.stdout.write(`${LINE_PREFIX}${buffer}\n`);
        }
      } catch {
        /* stream closed on process kill */
      }
    };

    void pump();
  }
}
