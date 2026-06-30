import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import type { Loggable } from './interfaces';

import { Logger } from './logger';
import { RequestContext } from "@zipbul/request-context";
import { TestTransport } from './transports/test';

describe('Logger', () => {
  let transport: TestTransport;

  afterEach(() => {
    Logger.configure({ level: 'info' });
    globalThis.WORKER_ID = undefined;
  });

  const setup = (level: string = 'trace'): TestTransport => {
    transport = new TestTransport();
    Logger.configure({ level: level as any, transports: [transport] });

    return transport;
  };

  it('should log message with string context', () => {
    // Arrange
    setup();
    const logger = new Logger('MyService');

    // Act
    logger.info('hello');

    // Assert
    expect(transport.messages[0]!.context).toBe('MyService');
  });

  it('should log message with class instance context', () => {
    // Arrange
    setup();

    class OrderService {}

    const logger = new Logger(new OrderService());

    // Act
    logger.info('hi');

    // Assert
    expect(transport.messages[0]!.context).toBe('OrderService');
  });

  it('should log message with function context', () => {
    // Arrange
    setup();

    function myHandler() {}

    const logger = new Logger(myHandler);

    // Act
    logger.info('test');

    // Assert
    expect(transport.messages[0]!.context).toBe('myHandler');
  });

  it('should emit to all configured transports', () => {
    // Arrange
    const t1 = new TestTransport();
    const t2 = new TestTransport();

    Logger.configure({ level: 'trace', transports: [t1, t2] });

    const logger = new Logger('test');

    // Act
    logger.info('broadcast');

    // Assert
    expect(t1.messages).toHaveLength(1);
    expect(t2.messages).toHaveLength(1);
    expect(t1.messages[0]!.msg).toBe('broadcast');
    expect(t2.messages[0]!.msg).toBe('broadcast');
  });

  it('should merge ALS context into log message', () => {
    // Arrange
    setup();
    const logger = new Logger('test');

    // Act
    RequestContext.run({ reqId: 'r1', userId: 'u1' }, () => {
      logger.info('with-als');
    });

    // Assert
    expect(transport.messages[0]!.reqId).toBe('r1');
    expect(transport.messages[0]!.userId).toBe('u1');
  });

  it('should merge child metadata into log message', () => {
    // Arrange
    setup();
    const logger = new Logger('test');
    const child = logger.child({ fn: 'doWork', traceId: 'trace-1' });

    // Act
    child.info('child-msg');

    // Assert
    expect(transport.messages[0]!.fn).toBe('doWork');
    expect(transport.messages[0]!.traceId).toBe('trace-1');
    expect(transport.messages[0]!.context).toBe('test');
  });

  it('should merge per-call object args into message', () => {
    // Arrange
    setup();
    const logger = new Logger('test');

    // Act
    logger.info('with-args', { requestPath: '/api/orders' });

    // Assert
    expect(transport.messages[0]!.requestPath).toBe('/api/orders');
  });

  it('should set err field from Error arg', () => {
    // Arrange
    setup();
    const logger = new Logger('test');
    const error = new Error('boom');

    // Act
    logger.error('failed', error);

    // Assert
    expect(transport.messages[0]!.err).toBe(error);
  });

  it('should merge Loggable arg via toLog', () => {
    // Arrange
    setup();
    const logger = new Logger('test');
    const loggable: Loggable = {
      toLog: () => ({ duration: 42, method: 'GET' }),
    };

    // Act
    logger.info('request', loggable);

    // Assert
    expect(transport.messages[0]!.duration).toBe(42);
    expect(transport.messages[0]!.method).toBe('GET');
  });

  it('should use custom transports from configure', () => {
    // Arrange
    const custom = new TestTransport();

    Logger.configure({ level: 'trace', transports: [custom] });

    const logger = new Logger('test');

    // Act
    logger.info('custom');

    // Assert
    expect(custom.messages).toHaveLength(1);
  });

  it('should default to ConsoleTransport when no transports in configure', () => {
    // Arrange — configure without transports option
    const consoleSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);

    Logger.configure({ level: 'trace', format: 'json' });

    const logger = new Logger('test');

    // Act
    logger.info('default-transport');

    // Assert — ConsoleTransport should have been used (writes to stdout in json mode)
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should include workerId in message when set', () => {
    // Arrange
    setup();
    globalThis.WORKER_ID = 7;

    const logger = new Logger('test');

    // Act
    logger.info('worker');

    // Assert
    expect(transport.messages[0]!.workerId).toBe(7);
  });

  it('should not log when level is below threshold', () => {
    // Arrange
    setup('warn');
    const logger = new Logger('test');

    // Act
    logger.info('should-not-appear');
    logger.debug('also-not');

    // Assert
    expect(transport.messages).toHaveLength(0);
  });

  it('should omit context when constructor arg is undefined', () => {
    // Arrange
    setup();
    const logger = new Logger();

    // Act
    logger.info('no-context');

    // Assert
    expect(transport.messages[0]!.context).toBeUndefined();
  });

  it('should omit context when object has empty constructor name', () => {
    // Arrange
    setup();
    const obj = Object.create(null);

    const logger = new Logger(obj);

    // Act
    logger.info('no-name');

    // Assert
    expect(transport.messages[0]!.context).toBeUndefined();
  });

  it('should log when level equals configured threshold', () => {
    // Arrange
    setup('warn');
    const logger = new Logger('test');

    // Act
    logger.warn('at-threshold');

    // Assert
    expect(transport.messages).toHaveLength(1);
  });

  it('should handle empty args array', () => {
    // Arrange
    setup();
    const logger = new Logger('test');

    // Act
    logger.info('no-args');

    // Assert
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0]!.msg).toBe('no-args');
  });

  it('should compose ALS < child < per-call in correct priority order', () => {
    // Arrange
    setup();
    const logger = new Logger('test');
    const child = logger.child({ fn: 'childFn', tag: 'child' });

    // Act
    RequestContext.run({ fn: 'alsFn', tag: 'als', reqId: 'r1' }, () => {
      child.info('composed', { tag: 'percall' });
    });

    // Assert
    const msg = transport.messages[0]!;

    // fn: child overrides ALS
    expect(msg.fn).toBe('childFn');
    // tag: per-call overrides child
    expect(msg.tag).toBe('percall');
    // reqId: from ALS, not overridden
    expect(msg.reqId).toBe('r1');
  });

  it('should use new transports after re-configure', () => {
    // Arrange
    const old = new TestTransport();
    const fresh = new TestTransport();

    Logger.configure({ level: 'trace', transports: [old] });

    const logger = new Logger('test');

    logger.info('to-old');
    Logger.configure({ level: 'trace', transports: [fresh] });
    logger.info('to-fresh');

    // Assert
    expect(old.messages).toHaveLength(1);
    expect(fresh.messages).toHaveLength(1);
    expect(old.messages[0]!.msg).toBe('to-old');
    expect(fresh.messages[0]!.msg).toBe('to-fresh');
  });

  it('should produce independent messages on repeated log calls', () => {
    // Arrange
    setup();
    const logger = new Logger('test');

    // Act
    logger.info('first');
    logger.info('second');

    // Assert
    expect(transport.messages).toHaveLength(2);
    expect(transport.messages[0]!.msg).toBe('first');
    expect(transport.messages[1]!.msg).toBe('second');
  });

  it('child should return new Logger with merged metadata', () => {
    // Arrange
    setup();
    const parent = new Logger('test');
    const child1 = parent.child({ fn: 'a' });
    const child2 = child1.child({ fn: 'b', extra: 'val' });

    // Act
    child2.info('deep');

    // Assert
    const msg = transport.messages[0]!;

    expect(msg.fn).toBe('b');
    expect(msg.extra).toBe('val');
    expect(msg.context).toBe('test');
  });

  // ── Format specifier interpolation ──
  it('interpolates %s/%d format specifiers from primitive args', () => {
    setup();
    const logger = new Logger('test');
    logger.info('scanned %d files in %d ms (%s)', 42, 1234, 'fast');
    expect(transport.messages[0]!.msg).toBe('scanned 42 files in 1234 ms (fast)');
  });

  it('leaves message unchanged when format specifier absent', () => {
    setup();
    const logger = new Logger('test');
    logger.info('static text', 99, 'ignored');
    expect(transport.messages[0]!.msg).toBe('static text');
  });

  it('separates primitives (interpolated) from objects (metadata) in same call', () => {
    setup();
    const logger = new Logger('test');
    logger.info('handler %s', 'getUser', { route: '/users/:id', method: 'GET' });
    expect(transport.messages[0]!.msg).toBe('handler getUser');
    expect(transport.messages[0]!.route).toBe('/users/:id');
    expect(transport.messages[0]!.method).toBe('GET');
  });

  it('forwards unknown-typed args through util.format without crash', () => {
    setup();
    const logger = new Logger('test');
    const value: unknown = 7;
    logger.info('value=%d', value);
    expect(transport.messages[0]!.msg).toBe('value=7');
  });

  // ── time() / timeEnd() ──
  it('time/timeEnd emits "<label>: <ms>ms" at info level', () => {
    setup();
    const logger = new Logger('test');
    logger.time('phase');
    logger.timeEnd('phase');
    const msg = transport.messages[0]!;
    expect(msg.level).toBe('info');
    expect(msg.context).toBe('test');
    expect(msg.msg).toMatch(/^phase: \d+(\.\d+)?ms$/);
  });

  it('timeEnd warns and returns silently when label was never started', () => {
    setup();
    const logger = new Logger('test');
    logger.timeEnd('never-started');
    const msg = transport.messages[0]!;
    expect(msg.level).toBe('warn');
    expect(msg.msg).toContain('never-started');
  });

  it('timeEnd is reusable — same label can be timed again after end', () => {
    setup();
    const logger = new Logger('test');
    logger.time('reused');
    logger.timeEnd('reused');
    logger.time('reused');
    logger.timeEnd('reused');
    expect(transport.messages.filter(m => m.level === 'info').length).toBe(2);
    expect(transport.messages.filter(m => m.level === 'warn').length).toBe(0);
  });

  it('timers are isolated per Logger instance', () => {
    setup();
    const a = new Logger('a');
    const b = new Logger('b');
    a.time('shared');
    // b never started 'shared' — timeEnd should warn
    b.timeEnd('shared');
    const msg = transport.messages[0]!;
    expect(msg.level).toBe('warn');
    expect(msg.context).toBe('b');
  });
});
