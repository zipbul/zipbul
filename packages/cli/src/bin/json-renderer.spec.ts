import { describe, expect, it, spyOn } from 'bun:test';

import { JsonRenderer } from './json-renderer';

function captureStdout(fn: () => void): string[] {
  const lines: string[] = [];
  const writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    if (typeof chunk === 'string') {
      lines.push(...chunk.split('\n').filter(l => l.length > 0));
    }
    return true;
  });
  try {
    fn();
  } finally {
    writeSpy.mockRestore();
  }
  return lines;
}

describe('JsonRenderer', () => {
  it('emits one JSON object per line with traceId/command/ts/level/type', () => {
    const r = new JsonRenderer('build');
    const lines = captureStdout(() => {
      r.intro('build');
      r.info('hello');
    });

    expect(lines.length).toBe(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed.command).toBe('build');
      expect(typeof parsed.traceId).toBe('string');
      expect((parsed.traceId as string).length).toBeGreaterThan(0);
      expect(typeof parsed.ts).toBe('string');
      expect(typeof parsed.level).toBe('string');
      expect(typeof parsed.type).toBe('string');
    }
  });

  it('reuses the same traceId across all events from one renderer', () => {
    const r = new JsonRenderer('build');
    const lines = captureStdout(() => {
      r.intro('a');
      r.warn('b');
      r.success('c');
      r.error('d');
    });

    const ids = lines.map(l => (JSON.parse(l) as { traceId: string }).traceId);
    expect(new Set(ids).size).toBe(1);
  });

  it('emits diagnostic events with structured payload', () => {
    const r = new JsonRenderer('build adapter');
    const lines = captureStdout(() => {
      r.diagnostic({ why: 'missing peer', where: { file: 'pkg.ts' } });
    });

    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.level).toBe('error');
    expect(parsed.type).toBe('diagnostic');
    expect(parsed.diagnostic).toEqual({ why: 'missing peer', where: { file: 'pkg.ts' } });
  });

  it('spinner-start and spinner-stop share the same spinnerId', () => {
    const r = new JsonRenderer('dev');
    const lines = captureStdout(() => {
      const handle = r.startSpinner('compiling');
      handle.stop('done');
    });

    expect(lines.length).toBe(2);
    const start = JSON.parse(lines[0]!) as { type: string; spinnerId: number };
    const stop = JSON.parse(lines[1]!) as { type: string; spinnerId: number };
    expect(start.type).toBe('spinner-start');
    expect(stop.type).toBe('spinner-stop');
    expect(start.spinnerId).toBe(stop.spinnerId);
  });

  it('outputPaths emits entries array', () => {
    const r = new JsonRenderer('build');
    const lines = captureStdout(() => {
      r.outputPaths('Project', [{ label: 'Root', value: '/x' }, { label: 'Source', value: 'src' }]);
    });

    const parsed = JSON.parse(lines[0]!) as { type: string; entries: unknown };
    expect(parsed.type).toBe('output-paths');
    expect(parsed.entries).toEqual([{ label: 'Root', value: '/x' }, { label: 'Source', value: 'src' }]);
  });

  it('getTraceId returns the in-use uuid', () => {
    const r = new JsonRenderer('build');
    const id = r.getTraceId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const lines = captureStdout(() => { r.info('x'); });
    const emitted = (JSON.parse(lines[0]!) as { traceId: string }).traceId;
    expect(emitted).toBe(id);
  });
});
