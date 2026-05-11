import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from 'bun:test';

import { ConsoleTransport } from './console';
import type { LogMessage } from '../interfaces';

/**
 * Direct ConsoleTransport tests — verify the agent-line plain format and
 * the stdout/stderr split contract. Logger-level tests use TestTransport,
 * but the on-the-wire shape rendered by `'plain'` mode needs its own
 * checks because it's the one piece downstream agents actually grep.
 */
describe('ConsoleTransport plain format', () => {
  let stdoutSpy: Mock<typeof process.stdout.write>;
  let stderrSpy: Mock<typeof process.stderr.write>;

  beforeEach(() => {
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  const baseMessage = (overrides: Partial<LogMessage> = {}): LogMessage => ({
    level: 'info',
    msg: 'hello',
    time: 0,
    ...overrides,
  });

  function transport(): ConsoleTransport {
    return new ConsoleTransport({ format: 'plain' });
  }

  function lastWrite(spy: Mock<typeof process.stdout.write>): string {
    const call = spy.mock.calls[spy.mock.calls.length - 1];
    return call ? String(call[0]) : '';
  }

  it('renders "<level>: <msg>\\n" when context absent', () => {
    transport().log(baseMessage({ msg: 'plain message' }));
    expect(lastWrite(stdoutSpy)).toBe('info: plain message\n');
  });

  it('renders "<level>: [<context>] <msg>\\n" when context present', () => {
    transport().log(baseMessage({ context: 'build', msg: 'scanned 42 files' }));
    expect(lastWrite(stdoutSpy)).toBe('info: [build] scanned 42 files\n');
  });

  it('joins context and fn as "<context>/<fn>"', () => {
    transport().log(baseMessage({ context: 'build', fn: 'scan', msg: 'done' }));
    expect(lastWrite(stdoutSpy)).toBe('info: [build/scan] done\n');
  });

  it('renders "[<fn>]" when only fn present', () => {
    transport().log(baseMessage({ fn: 'lonely', msg: 'm' }));
    expect(lastWrite(stdoutSpy)).toBe('info: [lonely] m\n');
  });

  it('appends primitive metadata as "key=value" trailer', () => {
    transport().log(baseMessage({ context: 'build', msg: 'done', count: 42, ok: true }));
    expect(lastWrite(stdoutSpy)).toBe('info: [build] done count=42 ok=true\n');
  });

  it('quotes string values containing whitespace or =', () => {
    transport().log(baseMessage({ msg: 'm', label: 'has space', expr: 'k=v' }));
    const out = lastWrite(stdoutSpy);
    expect(out).toContain('label="has space"');
    expect(out).toContain('expr="k=v"');
  });

  it('renders workerId and reqId fields with explicit prefixes', () => {
    transport().log(baseMessage({ workerId: 3, reqId: 'r-abc', msg: 'serving' }));
    expect(lastWrite(stdoutSpy)).toBe('info: serving worker=3 req=r-abc\n');
  });

  it('routes trace/debug/info to stdout', () => {
    const t = transport();
    for (const level of ['trace', 'debug', 'info'] as const) {
      t.log(baseMessage({ level, msg: level }));
    }
    expect(stdoutSpy.mock.calls.length).toBe(3);
    expect(stderrSpy.mock.calls.length).toBe(0);
  });

  it('routes warn/error/fatal to stderr', () => {
    const t = transport();
    for (const level of ['warn', 'error', 'fatal'] as const) {
      t.log(baseMessage({ level, msg: level }));
    }
    expect(stderrSpy.mock.calls.length).toBe(3);
    expect(stdoutSpy.mock.calls.length).toBe(0);
  });

  it('emits err.stack on stderr after the header line', () => {
    const err = new Error('boom');
    transport().log(baseMessage({ level: 'error', msg: 'failed', err }));
    // Two stderr writes: the header line, then the stack.
    expect(stderrSpy.mock.calls.length).toBe(2);
    const headerLine = String(stderrSpy.mock.calls[0]![0]);
    const stackLine = String(stderrSpy.mock.calls[1]![0]);
    expect(headerLine).toBe('error: failed\n');
    expect(stackLine).toContain('Error: boom');
  });

  it('renders Loggable metadata via toLog() inspection', () => {
    transport().log(baseMessage({
      msg: 'm',
      // Note: Loggable surfaced via metadata field formatField path
      payload: { toLog: () => ({ a: 1, b: 'x' }) },
    } as unknown as LogMessage));
    const out = lastWrite(stdoutSpy);
    expect(out).toContain('payload=');
    expect(out).toContain('a: 1');
  });

  it('json format emits one JSON line to stdout regardless of level', () => {
    const t = new ConsoleTransport({ format: 'json' });
    t.log(baseMessage({ level: 'error', msg: 'err' }));
    const out = lastWrite(stdoutSpy);
    const parsed: unknown = JSON.parse(out);
    expect(typeof parsed).toBe('object');
    expect((parsed as { level: string }).level).toBe('error');
    expect((parsed as { msg: string }).msg).toBe('err');
    expect(stderrSpy.mock.calls.length).toBe(0);
  });
});
