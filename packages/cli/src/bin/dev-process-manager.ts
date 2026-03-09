import type { Subprocess } from 'bun';
import type { Logger } from '@zipbul/logger';

const STOP_TIMEOUT_MS = 5000;

export interface DevProcessManagerParams {
  entryPath: string;
  cwd: string;
  logger: Logger;
  spawnProcess: (command: string[], cwd: string) => Subprocess;
}

/**
 * Manages the lifecycle of the child application process spawned by `zb dev`.
 *
 * @public
 */
export class DevProcessManager {
  private process: Subprocess | null = null;
  private readonly entryPath: string;
  private readonly cwd: string;
  private readonly logger: Logger;
  private readonly spawnProcess: DevProcessManagerParams['spawnProcess'];

  constructor(params: DevProcessManagerParams) {
    this.entryPath = params.entryPath;
    this.cwd = params.cwd;
    this.logger = params.logger;
    this.spawnProcess = params.spawnProcess;
  }

  /**
   * Spawns the application process.
   *
   * @public
   */
  start(): void {
    this.logger.info(`Starting app: bun ${this.entryPath}`);
    this.process = this.spawnProcess(['bun', this.entryPath], this.cwd);

    this.process.exited.then((exitCode) => {
      if (exitCode !== null && exitCode !== 0 && this.process !== null) {
        this.logger.warn(`App process exited with code ${String(exitCode)}.`);
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
    this.start();
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
}
