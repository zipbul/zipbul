import { mock } from 'bun:test';

/**
 * Spies for a single mocked `Logger` instance. Pass to {@link loggerMockModule}
 * when a spec needs to assert log calls.
 */
export interface LoggerMockSpies {
  trace: ReturnType<typeof mock>;
  debug: ReturnType<typeof mock>;
  info: ReturnType<typeof mock>;
  warn: ReturnType<typeof mock>;
  error: ReturnType<typeof mock>;
  fatal: ReturnType<typeof mock>;
}

export function createLoggerMockSpies(): LoggerMockSpies {
  return {
    trace: mock(),
    debug: mock(),
    info: mock(),
    warn: mock(),
    error: mock(),
    fatal: mock(),
  };
}

/**
 * Factory for `mock.module('@zipbul/logger', ...)` that implements the full
 * external static + instance surface of `Logger`, plus the other public
 * symbols re-exported from `@zipbul/logger`.
 *
 * Bun's `mock.module()` is process-wide (no spec-scoped variant). Every spec
 * that mocks `@zipbul/logger` must implement every static method that any
 * sibling spec running in the same process might call, otherwise the
 * first-loaded mock leaks an incomplete API into all later specs. This helper
 * centralises that contract.
 *
 * @param spies - Optional shared spies for assertion. Omit for silence-only mocking.
 */
export function loggerMockModule(spies?: LoggerMockSpies): () => Record<string, unknown> {
  return () => ({
    Logger: class {
      static inherit(): LoggerMockSpies {
        return spies ?? createLoggerMockSpies();
      }
      static configure(): void {}
      static runScoped<T>(_logger: unknown, fn: () => T): T {
        return fn();
      }
      constructor(..._args: unknown[]) {}
      child(): LoggerMockSpies {
        return spies ?? createLoggerMockSpies();
      }
      trace(): void {}
      debug(): void {}
      info(): void {}
      warn(): void {}
      error(): void {}
      fatal(): void {}
      time(): void {}
      timeEnd(): void {}
    },
    Trace: () => () => {},
    TestTransport: class {},
    ConsoleTransport: class {},
  });
}
