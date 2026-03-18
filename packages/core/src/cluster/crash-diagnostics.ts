/**
 * Structured diagnostic information extracted from crash events.
 *
 * Each variant corresponds to a specific event type that `handleCrash()` receives.
 *
 * @public
 */
export type CrashDiagnostics =
  | ErrorDiagnostics
  | CloseEventDiagnostics
  | ErrorEventDiagnostics
  | MessageEventDiagnostics
  | UnknownEventDiagnostics;

interface ErrorDiagnostics {
  readonly type: 'error';
  readonly message: string;
  readonly name: string;
  readonly stack: string | undefined;
  readonly error: Error;
}

interface CloseEventDiagnostics {
  readonly type: 'close';
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

interface ErrorEventDiagnostics {
  readonly type: 'error-event';
  readonly message: string;
  readonly error: Error | undefined;
  readonly stack: string | undefined;
  readonly filename: string;
  readonly lineno: number;
  readonly colno: number;
}

interface MessageEventDiagnostics {
  readonly type: 'message-event';
  readonly message: string;
}

interface UnknownEventDiagnostics {
  readonly type: 'unknown-event';
  readonly message: string;
}

/**
 * Extracts structured diagnostic information from the error/event
 * parameter passed to `handleCrash()`.
 *
 * Discriminates between `Error`, `CloseEvent`, `ErrorEvent`, `MessageEvent`,
 * and generic `Event` to extract all available diagnostic fields.
 *
 * @param input - The error or event from a worker crash.
 * @returns Structured diagnostics with a discriminated `type` field.
 * @public
 */
export function extractCrashDiagnostics(input: Error | Event): CrashDiagnostics {
  if (input instanceof Error) {
    return {
      type: 'error',
      message: input.message,
      name: input.name,
      stack: input.stack,
      error: input,
    };
  }

  if (input instanceof CloseEvent) {
    return {
      type: 'close',
      code: input.code,
      reason: input.reason,
      wasClean: input.wasClean,
    };
  }

  if (input instanceof ErrorEvent) {
    const innerError = input.error instanceof Error ? input.error : undefined;

    return {
      type: 'error-event',
      message: innerError?.message ?? input.message,
      error: innerError,
      stack: innerError?.stack,
      filename: input.filename,
      lineno: input.lineno,
      colno: input.colno,
    };
  }

  if (input instanceof MessageEvent) {
    const dataSummary = typeof input.data === 'string'
      ? input.data
      : JSON.stringify(input.data) ?? 'unknown';

    return {
      type: 'message-event',
      message: dataSummary,
    };
  }

  return {
    type: 'unknown-event',
    message: input.type,
  };
}
