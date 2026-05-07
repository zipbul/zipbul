/**
 * Unit tests for the inline TickAdapter — exercise the contract guards
 * added in response to adversarial review:
 *
 *   1. `intervalMs` constructor validation rejects 0/negative/NaN.
 *   2. `addMiddlewares()` after `start()` throws (silent no-op was the
 *      footgun: cachedHandlers are resolved at boot and never re-checked).
 *   3. `drain(timeoutMs)` returns within the deadline even when an in-flight
 *      tick handler hangs — the indefinite `await this.inflight` in `stop()`
 *      is unsuitable for production shutdown.
 *
 * The Adapter base requires a wired pipeline container to register
 * middleware (validateAdapterCompatibility runs through `instanceof`); we
 * stub that with a minimal container fake.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { ApplicationContext } from '@zipbul/common';

import { TickAdapter, TickPhase } from './tick';

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

describe('TickAdapter — addMiddlewares lifecycle guard', () => {
  it('throws when addMiddlewares is called after start() (cachedHandlers populated)', async () => {
    const adapter = new TickAdapter({ intervalMs: 1_000_000 });

    // Force `cachedHandlers` non-null without scheduling a real timer by
    // calling start() with no handlers — the empty path returns early but
    // does not populate cachedHandlers. So we pre-seed via the contract
    // path: attach a fake bootstrap with one (synthetic) handler entry.
    // For the lifecycle guard we don't need actual ticks to fire — only
    // that the post-start guard throws.

    // Lazy hack: invoke the same code path by directly setting a
    // cachedHandlers value via `start()` with the assumption that the
    // empty-handler short-circuit returns *before* cache population.
    // Instead, test the guard explicitly using a fake bootstrap state.
    const { registerBootstrapState } = await import('@zipbul/core');
    registerBootstrapState({ handlerIndex: [], controllerInstances: new Map() });

    const fakeAppCtx = {} as ApplicationContext;
    await adapter.start(fakeAppCtx);
    // start() with empty handlers logs idle and returns *without*
    // populating cachedHandlers — so the guard does NOT trip in that path.
    // That's correct: idle adapter accepts late MW registrations because
    // the dispatch path won't read from cachedHandlers.

    // Now seed cachedHandlers indirectly to simulate a populated boot.
    // The guard fires when the adapter has booted with handlers.
    (adapter as unknown as { cachedHandlers: readonly unknown[] }).cachedHandlers = [{}];

    expect(() => adapter.addMiddlewares(TickPhase.OnTick, [])).toThrow(
      /addMiddlewares\(\) must be called before app\.start\(\)/,
    );
  });

  it('allows addMiddlewares before start()', () => {
    const adapter = new TickAdapter({ intervalMs: 1_000_000 });
    // Cached handlers null at construction.
    expect(() => adapter.addMiddlewares(TickPhase.OnTick, [])).not.toThrow();
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
