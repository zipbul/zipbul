import { describe, expect, it, mock } from 'bun:test';

import { installCancellation } from './cancellation';
import type { CliRendererLike } from '../bin/interfaces';

function makeSilentRenderer(): CliRendererLike {
  return {
    intro: mock(() => {}),
    outro: mock(() => {}),
    cancelled: mock(() => {}),
    step: mock(() => {}),
    info: mock(() => {}),
    success: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    startSpinner: mock(() => ({ stop: mock(() => {}) })),
    outputPaths: mock(() => {}),
    outputFiles: mock(() => {}),
    diagnostic: mock(() => {}),
    separator: mock(() => {}),
  };
}

describe('installCancellation', () => {
  it('returns a non-aborted signal initially', () => {
    const cancel = installCancellation({ renderer: makeSilentRenderer() });
    try {
      expect(cancel.signal.aborted).toBe(false);
    } finally {
      cancel.dispose();
    }
  });

  it('dispose removes the SIGINT/SIGTERM listeners it added', () => {
    const before = process.listenerCount('SIGINT');
    const cancel = installCancellation({ renderer: makeSilentRenderer() });
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    cancel.dispose();
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('registerCleanup stores callbacks (not yet invoked at registration time)', () => {
    const cancel = installCancellation({ renderer: makeSilentRenderer() });
    try {
      const cleanup = mock(() => {});
      cancel.registerCleanup(cleanup);
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      cancel.dispose();
    }
  });

  it('multiple installCancellation calls each add their own SIGINT listener', () => {
    const before = process.listenerCount('SIGINT');
    const a = installCancellation({ renderer: makeSilentRenderer() });
    const b = installCancellation({ renderer: makeSilentRenderer() });
    try {
      expect(process.listenerCount('SIGINT')).toBe(before + 2);
    } finally {
      a.dispose();
      b.dispose();
      expect(process.listenerCount('SIGINT')).toBe(before);
    }
  });

  it('signal is an AbortSignal that downstream APIs can consume', () => {
    const cancel = installCancellation({ renderer: makeSilentRenderer() });
    try {
      // Round-trip through AbortController would be the integration test;
      // here we just confirm the surface is the standard AbortSignal API.
      expect(cancel.signal).toBeInstanceOf(AbortSignal);
      expect(typeof cancel.signal.addEventListener).toBe('function');
      expect(typeof cancel.signal.removeEventListener).toBe('function');
    } finally {
      cancel.dispose();
    }
  });
});
