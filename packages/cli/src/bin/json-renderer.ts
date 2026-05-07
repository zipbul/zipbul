import { randomUUID } from 'node:crypto';

import type { Diagnostic } from '../diagnostics';
import type { CliRendererLike, OutputFileEntry, PathEntry, SpinnerHandle } from './interfaces';

/**
 * NDJSON-emitting renderer (`--json` mode). Each log call writes one JSON
 * object per line to stdout; **this renderer itself never writes to
 * stderr** — every diagnostic, warning, and error becomes a JSON event on
 * stdout with `"level":"error" | "warn"` so a single sink captures the
 * full event stream.
 *
 * Caveat: third-party libraries invoked during a build (e.g. `bunx tsc`,
 * `Bun.build`'s native logger) may still write to stderr independently;
 * this renderer cannot redirect those. Consumers of `--json` mode that
 * need a single combined stream should pipe `2>&1` at the shell level.
 *
 * Schema (one line per emit):
 *   { ts, level, command, traceId, type, ...payload }
 *
 * - `ts`: ISO-8601 UTC timestamp.
 * - `level`: `info | warn | error | success | step | trace`.
 * - `command`: command name passed to the constructor (`build`, `build adapter`,
 *    `build --lib`, `dev`).
 * - `traceId`: UUIDv4 generated once per renderer instance — one trace per
 *    command invocation, lets log ingesters group all events.
 * - `type`: structured event kind — `intro | outro | cancelled | message |
 *    spinner-start | spinner-stop | output-paths | output-files | diagnostic |
 *    separator`. Lets consumers route by event without parsing free-form
 *    `msg`.
 *
 * **Single-process scope**: `spinnerId` is a counter local to the
 * renderer instance. If two `zb` processes pipe `--json` output to a
 * shared log file, their spinner IDs collide. Consumers that aggregate
 * across processes should compose `spinnerId` with the upstream process
 * identifier (e.g. PID prefix added by the shell wrapper) — this
 * renderer optimises for single-invocation telemetry.
 *
 * @public
 */
export class JsonRenderer implements CliRendererLike {
  private readonly traceId = randomUUID();
  private readonly command: string;
  private spinnerCounter = 0;

  constructor(command: string) {
    this.command = command;
  }

  /** Public accessor for the per-invocation trace id. */
  getTraceId(): string {
    return this.traceId;
  }

  intro(title: string): void {
    this.emit({ level: 'info', type: 'intro', msg: title });
  }

  outro(message: string): void {
    this.emit({ level: 'success', type: 'outro', msg: message });
  }

  cancelled(message: string): void {
    this.emit({ level: 'warn', type: 'cancelled', msg: message });
  }

  step(message: string): void {
    this.emit({ level: 'info', type: 'message', step: true, msg: message });
  }

  info(message: string): void {
    this.emit({ level: 'info', type: 'message', msg: message });
  }

  success(message: string): void {
    this.emit({ level: 'success', type: 'message', msg: message });
  }

  warn(message: string): void {
    this.emit({ level: 'warn', type: 'message', msg: message });
  }

  error(message: string): void {
    this.emit({ level: 'error', type: 'message', msg: message });
  }

  startSpinner(message: string): SpinnerHandle {
    this.spinnerCounter++;
    const id = this.spinnerCounter;
    this.emit({ level: 'info', type: 'spinner-start', spinnerId: id, msg: message });
    return {
      stop: (doneMessage?: string) => {
        this.emit({
          level: 'info',
          type: 'spinner-stop',
          spinnerId: id,
          msg: doneMessage ?? message,
        });
      },
    };
  }

  outputPaths(title: string, entries: readonly PathEntry[]): void {
    this.emit({
      level: 'info',
      type: 'output-paths',
      msg: title,
      entries: entries.map(e => ({ label: e.label, value: e.value })),
    });
  }

  outputFiles(title: string, entries: readonly OutputFileEntry[]): void {
    this.emit({
      level: 'info',
      type: 'output-files',
      msg: title,
      entries: entries.map(e => ({
        name: e.name,
        size: e.size,
        ...(e.gzipSize !== undefined ? { gzipSize: e.gzipSize } : {}),
      })),
    });
  }

  diagnostic(diagnostic: Diagnostic): void {
    this.emit({ level: 'error', type: 'diagnostic', diagnostic });
  }

  separator(): void {
    this.emit({ level: 'info', type: 'separator' });
  }

  private emit(payload: Record<string, unknown>): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      command: this.command,
      traceId: this.traceId,
      ...payload,
    });
    process.stdout.write(`${line}\n`);
  }
}
