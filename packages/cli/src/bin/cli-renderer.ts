import * as clack from '@clack/prompts';
import pc from 'picocolors';

import type { Diagnostic } from '../diagnostics';
import type { CliRendererLike, OutputFileEntry, PathEntry, SpinnerHandle } from './interfaces';

const SPINNER_FRAMES = ['✧', '✦', '✶', '✦'];
const SPINNER_INTERVAL_MS = 120;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1_048_576;
const BYTES_PER_GB = 1_073_741_824;

/** 24-bit true color — theme-independent, vibrant modern tones. */
const RGB_RED = '\x1b[38;2;255;107;131m';
const RGB_GREEN = '\x1b[38;2;126;201;110m';
const RGB_YELLOW = '\x1b[38;2;240;198;116m';
const RGB_BLUE = '\x1b[38;2;130;170;255m';
const RGB_CYAN = '\x1b[38;2;137;221;255m';
const RGB_BG_CYAN = '\x1b[48;2;137;221;255m';
const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_BLACK = '\x1b[30m';

const BRAND_SYMBOL = '✦';

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) {
    return `${formatNumber(bytes)} B`;
  }

  if (bytes < BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_KB).toFixed(2)} kB`;
  }

  if (bytes < BYTES_PER_GB) {
    return `${(bytes / BYTES_PER_MB).toFixed(2)} MB`;
  }

  return `${(bytes / BYTES_PER_GB).toFixed(2)} GB`;
}

/**
 * CLI output renderer backed by `@clack/prompts` + `picocolors`.
 *
 * All log-level methods use `clack.log.message()` with custom bright symbols
 * for a branded, modern look. Section headers use the `✦` brand symbol.
 *
 * @public
 */
export class CliRenderer implements CliRendererLike {
  private pauseActiveSpinner: (() => void) | null = null;
  private resumeActiveSpinner: (() => void) | null = null;

  /**
   * Prints a framed intro banner with a bright cyan brand badge.
   *
   * @param title - Command name appended after the badge (e.g. `"build"`)
   * @public
   */
  intro(title: string): void {
    const badge = `${RGB_BG_CYAN}${ANSI_BOLD}${ANSI_BLACK} ${BRAND_SYMBOL} zipbul ${ANSI_RESET}`;
    clack.intro(`${badge} ${title}`);
  }

  /**
   * Prints a framed outro banner.
   *
   * @param message - Closing message
   * @public
   */
  outro(message: string): void {
    clack.outro(`${RGB_GREEN}${message}${ANSI_RESET}`);
  }

  /**
   * Prints a cancellation notice (e.g. on SIGINT).
   *
   * @param message - Cancellation reason
   * @public
   */
  cancelled(message: string): void {
    clack.cancel(message);
  }

  /**
   * Logs a neutral step message with a dimmed diamond symbol.
   *
   * @param message - Step description
   * @public
   */
  step(message: string): void {
    this.withSpinnerPaused(() => {
      clack.log.message(message, { symbol: pc.dim('◇') });
    });
  }

  /**
   * Logs an informational message with a bright blue symbol.
   *
   * @param message - Info text
   * @public
   */
  info(message: string): void {
    this.withSpinnerPaused(() => {
      clack.log.message(message, { symbol: `${RGB_BLUE}●${ANSI_RESET}` });
    });
  }

  /**
   * Logs a success message with a bright green checkmark.
   *
   * @param message - Success text
   * @public
   */
  success(message: string): void {
    this.withSpinnerPaused(() => {
      clack.log.message(`${RGB_GREEN}${message}${ANSI_RESET}`, {
        symbol: `${RGB_GREEN}✓${ANSI_RESET}`,
      });
    });
  }

  /**
   * Logs a warning message with a bright yellow triangle.
   *
   * @param message - Warning text
   * @public
   */
  warn(message: string): void {
    this.withSpinnerPaused(() => {
      clack.log.message(`${RGB_YELLOW}${message}${ANSI_RESET}`, {
        symbol: `${RGB_YELLOW}▲${ANSI_RESET}`,
      });
    });
  }

  /**
   * Logs an error message with a bright red cross.
   *
   * @param message - Error text
   * @public
   */
  error(message: string): void {
    this.withSpinnerPaused(() => {
      clack.log.message(`${RGB_RED}${message}${ANSI_RESET}`, {
        symbol: `${RGB_RED}✖${ANSI_RESET}`,
      });
    });
  }

  /**
   * Prints a timestamped separator line to visually group watch events.
   *
   * @public
   */
  separator(): void {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${hours}:${minutes}:${seconds}`;

    this.withSpinnerPaused(() => {
      clack.log.message(pc.dim(`─── ${timestamp} ${'─'.repeat(30)}`));
    });
  }

  /**
   * Starts a custom spinner and returns a handle to stop it.
   *
   * Uses animated spark frames during progress, then a bright green `✦` on completion.
   * Automatically pauses when other log methods are called mid-spin.
   *
   * @param message - Spinner label shown while active
   * @returns A {@link SpinnerHandle} whose `stop()` completes the spinner
   * @public
   */
  startSpinner(message: string): SpinnerHandle {
    if (!process.stdout.isTTY) {
      return {
        stop: (doneMessage?: string) => {
          clack.log.message(doneMessage ?? message, {
            symbol: `${RGB_GREEN}${BRAND_SYMBOL}${ANSI_RESET}`,
          });
        },
      };
    }

    let frameIndex = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const draw = (): void => {
      const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
      process.stdout.write(`\r${RGB_YELLOW}${frame}${ANSI_RESET}  ${message}\x1B[K`);
      frameIndex++;
    };

    const pause = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      process.stdout.write('\r\x1B[K');
    };

    const resume = (): void => {
      if (timer === null) {
        timer = setInterval(draw, SPINNER_INTERVAL_MS);
        draw();
      }
    };

    process.stdout.write('\x1B[?25l');
    timer = setInterval(draw, SPINNER_INTERVAL_MS);
    draw();

    this.pauseActiveSpinner = pause;
    this.resumeActiveSpinner = resume;

    return {
      stop: (doneMessage?: string): void => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        this.pauseActiveSpinner = null;
        this.resumeActiveSpinner = null;
        const display = doneMessage ?? message;
        process.stdout.write(`\r${RGB_GREEN}${BRAND_SYMBOL}${ANSI_RESET}  ${display}\x1B[K\n`);
        process.stdout.write('\x1B[?25h');
      },
    };
  }

  /**
   * Renders a titled group of label/value path entries.
   *
   * Uses branded `✦` as the group header symbol, with labels dimmed and values in bright cyan.
   *
   * @param title - Group title (e.g. `"Project"`, `"Output"`)
   * @param entries - Label/value pairs to display
   * @public
   */
  outputPaths(title: string, entries: readonly PathEntry[]): void {
    const maxLabelLength = Math.max(...entries.map(entry => entry.label.length));

    const lines = entries
      .map(entry => `${pc.dim(entry.label.padEnd(maxLabelLength))}  ${RGB_CYAN}${entry.value}${ANSI_RESET}`);

    const symbol = `${RGB_CYAN}${BRAND_SYMBOL}${ANSI_RESET}`;
    clack.log.message(`${ANSI_BOLD}${title}${ANSI_RESET}\n${lines.join('\n')}`, { symbol });
  }

  /**
   * Renders a titled table of files with their sizes and a total row.
   *
   * @param title - Section title (e.g. `"📦 Output"`)
   * @param entries - Files with byte sizes
   * @public
   */
  outputFiles(title: string, entries: readonly OutputFileEntry[]): void {
    const hasGzip = entries.some(entry => entry.gzipSize !== undefined);
    const formattedSizes = entries.map(entry => formatBytes(entry.size));
    const formattedGzips = hasGzip
      ? entries.map(entry => entry.gzipSize !== undefined ? formatBytes(entry.gzipSize) : '')
      : [];
    const maxNameLength = Math.max(...entries.map(entry => entry.name.length));
    const maxSizeLength = Math.max(...formattedSizes.map(size => size.length));
    const maxGzipLength = hasGzip ? Math.max(...formattedGzips.map(size => size.length)) : 0;

    const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
    const totalFormatted = formatBytes(totalSize);
    const totalGzipSize = hasGzip ? entries.reduce((sum, entry) => sum + (entry.gzipSize ?? 0), 0) : 0;
    const totalGzipFormatted = hasGzip ? formatBytes(totalGzipSize) : '';

    const sizeHeader = pc.dim('Size'.padStart(maxSizeLength));
    const gzipHeader = hasGzip ? `  ${pc.dim('Gzip'.padStart(maxGzipLength))}` : '';
    const headerLine = `${''.padEnd(maxNameLength)}  ${sizeHeader}${gzipHeader}`;

    const lines: string[] = [headerLine];

    for (let index = 0; index < entries.length; index++) {
      const sizeCol = pc.bold(formattedSizes[index].padStart(maxSizeLength));
      const gzipCol = hasGzip ? `  ${pc.dim(formattedGzips[index].padStart(maxGzipLength))}` : '';
      lines.push(`${pc.dim(entries[index].name.padEnd(maxNameLength))}  ${sizeCol}${gzipCol}`);
    }

    const separatorLength = maxNameLength + 2 + maxSizeLength + (hasGzip ? 2 + maxGzipLength : 0);
    lines.push(pc.dim('─'.repeat(separatorLength)));

    const totalSizeCol = `${ANSI_BOLD}${RGB_CYAN}${totalFormatted.padStart(maxSizeLength)}${ANSI_RESET}`;
    const totalGzipCol = hasGzip ? `  ${ANSI_BOLD}${RGB_CYAN}${totalGzipFormatted.padStart(maxGzipLength)}${ANSI_RESET}` : '';
    lines.push(`${pc.dim('Total'.padEnd(maxNameLength))}  ${totalSizeCol}${totalGzipCol}`);

    const symbol = `${RGB_CYAN}${BRAND_SYMBOL}${ANSI_RESET}`;
    clack.log.message(`${ANSI_BOLD}${title}${ANSI_RESET}\n${lines.join('\n')}`, { symbol });
  }

  /**
   * Renders a diagnostic error with location and fix hint.
   *
   * @param diagnostic - Structured diagnostic to display
   * @public
   */
  diagnostic(diagnostic: Diagnostic): void {
    const header = `${ANSI_BOLD}${RGB_RED}Diagnostic Error${ANSI_RESET}`;
    const parts: string[] = [header, diagnostic.why];

    if (diagnostic.where !== undefined) {
      const location = diagnostic.where.symbol !== undefined
        ? `${diagnostic.where.file} (${diagnostic.where.symbol})`
        : diagnostic.where.file;

      parts.push(`${pc.dim('at')} ${location}`);
    }

    if (diagnostic.how !== undefined) {
      parts.push(`${pc.dim('fix:')} ${diagnostic.how}`);
    }

    clack.log.message(parts.join('\n'), { symbol: `${RGB_RED}✖${ANSI_RESET}` });
  }

  /**
   * Pauses the active spinner (if any), runs a function, then resumes.
   *
   * Prevents interleaved output when log methods are called during a spin.
   */
  private withSpinnerPaused(fn: () => void): void {
    this.pauseActiveSpinner?.();
    fn();
    this.resumeActiveSpinner?.();
  }
}
