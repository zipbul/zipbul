/**
 * Unit tests for the inline TickAdapter — exercise the contract guards
 * added in response to adversarial review:
 *
 *   1. `intervalMs` constructor validation rejects 0/negative/NaN.
 *   2. `drain(timeoutMs)` returns within the deadline even when an in-flight
 *      tick handler hangs — the indefinite `await this.inflight` in `stop()`
 *      is unsuitable for production shutdown.
 *
 * Middleware is registered declaratively on the module (see ../module), not
 * through a runtime method, so there is no late-registration footgun to guard.
 */
import { describe, expect, it, mock } from 'bun:test';

import { TickAdapter } from './tick';

describe('TickAdapter — constructor validation', () => {
  it('rejects intervalMs <= 0', () => {
    expect(() => new TickAdapter({ intervalMs: 0 })).toThrow(/intervalMs must be a finite positive number/);
    expect(() => new TickAdapter({ intervalMs: -100 })).toThrow(/intervalMs/);
  });

  it('rejects non-finite intervalMs', () => {
    expect(() => new TickAdapter({ intervalMs: Number.POSITIVE_INFINITY })).toThrow(/intervalMs/);
    expect(() => new TickAdapter({ intervalMs: Number.NaN })).toThrow(/intervalMs/);
  });

  it('rejects maxRounds <= 0', () => {
    expect(() => new TickAdapter({ maxRounds: 0 })).toThrow(/maxRounds/);
    expect(() => new TickAdapter({ maxRounds: -1 })).toThrow(/maxRounds/);
  });

  it('accepts default options (no args)', () => {
    expect(() => new TickAdapter()).not.toThrow();
  });
});

describe('TickAdapter — drain(timeoutMs)', () => {
  it('returns within the deadline when an in-flight handler hangs', async () => {
    const adapter = new TickAdapter({ intervalMs: 50 });

    // Inject a never-resolving inflight to simulate a stuck handler.
    let release: (() => void) | null = null;
    const stuck = new Promise<void>((resolve) => { release = resolve; });
    (adapter as unknown as { inflight: Promise<void> }).inflight = stuck;
    // Pretend a timer is active so drain takes the timeout branch.
    (adapter as unknown as { timer: ReturnType<typeof setInterval> | null }).timer = setInterval(() => {}, 1_000_000);

    const warn = mock(() => {});
    (adapter as unknown as { logger: { warn: (m: string) => void } }).logger = { warn };

    const start = performance.now();
    await adapter.drain(120);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(800);
    expect(warn).toHaveBeenCalledTimes(1);

    // Release the stuck promise so the test process exits cleanly.
    if (release !== null) (release as () => void)();
  });

  it('returns immediately when nothing is in flight', async () => {
    const adapter = new TickAdapter({ intervalMs: 1_000_000 });
    const start = performance.now();
    await adapter.drain(100);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
