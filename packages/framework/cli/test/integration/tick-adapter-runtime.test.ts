/**
 * E2E runtime test for the inline TickAdapter shipped in `examples/src/tick/`.
 *
 * Builds the full examples app (external HttpAdapter + inline TickAdapter)
 * via `zb build`, boots `dist/entry.js` as a subprocess, then asserts:
 *
 * 1. HttpAdapter still serves real HTTP (200 + middleware-set headers).
 * 2. TickAdapter scheduler fires periodic rounds.
 * 3. OnTick middleware runs BEFORE the handler on every round.
 * 4. `getAdapterContext()` inside the handler returns the same instance the
 *    handler received — proves `runInAdapterContext` wrap is active.
 * 5. The `round` counter monotonically increases across ticks.
 *
 * This is the regression guard the inline-adapter contract was missing —
 * everything below the resolver/extractor surface (executePipeline,
 * dispatchRequest, runPipeline, applyConfig middleware wiring) is now exercised by
 * a real subprocess boot.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const examplesRoot = join(import.meta.dir, '../../../../../examples');
const entryFile = join(examplesRoot, 'dist/entry.js');

async function ensureBuilt(): Promise<void> {
  // Force a fresh build for test isolation — a stale dist/ from a prior
  // run could mask a regression in the current source. Cheap to rebuild
  // (~1s) and removes inter-test order dependency.
  const { rm } = await import('node:fs/promises');
  await rm(join(examplesRoot, 'dist'), { recursive: true, force: true });
  await rm(join(examplesRoot, '.zipbul'), { recursive: true, force: true });
  await rm(join(examplesRoot, '.zipbul-temp'), { recursive: true, force: true });

  // Absolute executable path: Bun.spawn resolves a relative argv[0] against
  // the parent process cwd, not the `cwd` option — a relative path here is
  // ENOENT whenever the test runner starts outside examplesRoot.
  const proc = Bun.spawn([join(examplesRoot, 'node_modules/.bin/zb'), 'build'], {
    cwd: examplesRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const exit = await proc.exited;
  if (exit !== 0) {
    const stderr = proc.stderr ? await new Response(proc.stderr).text() : '';
    const stdout = proc.stdout ? await new Response(proc.stdout).text() : '';
    throw new Error(`examples build failed (exit ${String(exit)}):\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
}

interface ServerHandle {
  proc: ReturnType<typeof Bun.spawn>;
  stdoutText: string;
}

async function bootServer(): Promise<ServerHandle> {
  const proc = Bun.spawn(['bun', entryFile], {
    cwd: examplesRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });

  // Read stdout in the background so we can grep it after stop.
  let stdoutText = '';
  if (proc.stdout) {
    void (async () => {
      for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
        stdoutText += new TextDecoder().decode(chunk);
      }
    })();
  }

  // Wait for "Listening" line so HTTP is ready.
  const start = performance.now();
  while (performance.now() - start < 5_000) {
    if (stdoutText.includes('Listening on :5000')) break;
    await Bun.sleep(50);
  }

  return { proc, get stdoutText() { return stdoutText; } } as unknown as ServerHandle;
}

let server: ServerHandle;

beforeAll(async () => {
  await ensureBuilt();
  server = await bootServer();
});

afterAll(async () => {
  if (server?.proc !== undefined) {
    server.proc.kill('SIGINT');
    await server.proc.exited;
  }
});

describe('examples — inline TickAdapter coexisting with external HttpAdapter', () => {
  it('HttpAdapter serves HTTP requests with global middleware applied', async () => {
    const res = await fetch('http://localhost:5000/users');
    expect(res.status).toBe(200);
    // request-timing middleware (registered globally in examples main.ts)
    // writes X-Response-Time — proves the middleware → handler chain ran.
    expect(res.headers.get('X-Response-Time')).toMatch(/^\d+(\.\d+)?ms$/);

    const users: unknown = await res.json();
    expect(Array.isArray(users)).toBe(true);
  });

  it('TickAdapter scheduler fires periodic rounds with middleware → handler chain', async () => {
    // Wait long enough for at least 2 rounds (interval is 1500ms in main.ts).
    await Bun.sleep(3_500);

    // Strip ANSI escape codes — server output is colorized in the
    // captured stdout, which interferes with positional regex matching.
    const log = server.stdoutText.replace(/\[[0-9;]*m/g, '');

    // Multiple rounds — round counter increments.
    expect(log).toMatch(/round=1\b/);
    expect(log).toMatch(/round=2\b/);

    // Middleware fires before handler on each round (audit precedes heartbeat).
    const auditPositions = [...log.matchAll(/audit fired for tick=(\d+)/g)].map(m => ({
      tick: m[1]!,
      pos: m.index!,
    }));
    const heartbeatPositions = [...log.matchAll(/round=(\d+) tick=(\d+) ambient/g)].map(m => ({
      round: m[1]!,
      tick: m[2]!,
      pos: m.index!,
    }));

    expect(auditPositions.length).toBeGreaterThanOrEqual(2);
    expect(heartbeatPositions.length).toBeGreaterThanOrEqual(2);

    // For each heartbeat, the matching audit (same tick) precedes it.
    for (const hb of heartbeatPositions) {
      const matchingAudit = auditPositions.find(a => a.tick === hb.tick);
      expect(matchingAudit).toBeDefined();
      if (matchingAudit !== undefined) {
        expect(matchingAudit.pos).toBeLessThan(hb.pos);
      }
    }
  });

  it('handler sees the same context via getAdapterContext (runInAdapterContext wrap)', () => {
    expect(server.stdoutText).toMatch(/same=true/);
  });
});
