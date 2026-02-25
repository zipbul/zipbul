import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import type { LogMessage, Transport } from '../interfaces';

import { TestTransport } from '../transports/test';

describe('TestTransport', () => {
  it('should start with empty messages', () => {
    // Arrange
    const transport = new TestTransport();

    // Assert
    expect(transport.messages).toEqual([]);
  });

  it('should push message to messages array on log', () => {
    // Arrange
    const transport = new TestTransport();
    const message: LogMessage = { level: 'info', msg: 'hello', time: 1 };

    // Act
    transport.log(message);

    // Assert
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0]).toBe(message);
  });

  it('should accumulate messages in order', () => {
    // Arrange
    const transport = new TestTransport();
    const msg1: LogMessage = { level: 'info', msg: 'first', time: 1 };
    const msg2: LogMessage = { level: 'warn', msg: 'second', time: 2 };
    const msg3: LogMessage = { level: 'error', msg: 'third', time: 3 };

    // Act
    transport.log(msg1);
    transport.log(msg2);
    transport.log(msg3);

    // Assert
    expect(transport.messages).toEqual([msg1, msg2, msg3]);
  });

  it('should store message with all fields intact', () => {
    // Arrange
    const transport = new TestTransport();
    const err = new Error('test');
    const message: LogMessage = {
      level: 'error',
      msg: 'full',
      time: 42,
      context: 'MyService',
      fn: 'doWork',
      reqId: 'req-1',
      workerId: 3,
      err,
      custom: 'value',
    };

    // Act
    transport.log(message);

    // Assert
    const stored = transport.messages[0]!;

    expect(stored.level).toBe('error');
    expect(stored.msg).toBe('full');
    expect(stored.time).toBe(42);
    expect(stored.context).toBe('MyService');
    expect(stored.fn).toBe('doWork');
    expect(stored.reqId).toBe('req-1');
    expect(stored.workerId).toBe(3);
    expect(stored.err).toBe(err);
    expect(stored.custom).toBe('value');
  });
});
