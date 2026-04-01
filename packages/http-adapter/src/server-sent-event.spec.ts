import { describe, expect, it } from 'bun:test';
import { ServerSentEvent, formatSSEChunk, isAsyncIterable } from './server-sent-event';

const decoder = new TextDecoder();

function decodeChunk(chunk: Uint8Array): string {
  return decoder.decode(chunk);
}

describe('ServerSentEvent', () => {
  it('should store string data when constructed with string data and no options', () => {
    const event = new ServerSentEvent('hello');

    expect(event.data).toBe('hello');
    expect(event.event).toBeUndefined();
    expect(event.id).toBeUndefined();
    expect(event.retry).toBeUndefined();
  });

  it('should store object data as-is when constructed with object data', () => {
    const payload = { message: 'hello', count: 42 };

    const event = new ServerSentEvent(payload);

    expect(event.data).toEqual(payload);
  });

  it('should store all metadata when constructed with all options', () => {
    const event = new ServerSentEvent('data', {
      event: 'update',
      id: '123',
      retry: 5000,
    });

    expect(event.data).toBe('data');
    expect(event.event).toBe('update');
    expect(event.id).toBe('123');
    expect(event.retry).toBe(5000);
  });

  it('should store partial metadata when constructed with partial options', () => {
    const event = new ServerSentEvent('data', { event: 'ping' });

    expect(event.event).toBe('ping');
    expect(event.id).toBeUndefined();
    expect(event.retry).toBeUndefined();
  });

  it('should expose all four properties when constructed with full options', () => {
    const event = new ServerSentEvent('value', { event: 'e', id: 'i', retry: 100 });

    expect(Object.keys(event).sort()).toEqual(['data', 'event', 'id', 'retry']);
  });
});

describe('formatSSEChunk', () => {
  it('should format plain string as data field', () => {
    const result = decodeChunk(formatSSEChunk('hello'));

    expect(result).toBe('data: hello\n\n');
  });

  it('should format plain object as JSON data field', () => {
    const result = decodeChunk(formatSSEChunk({ message: 'hi' }));

    expect(result).toBe('data: {"message":"hi"}\n\n');
  });

  it('should format ServerSentEvent with data only', () => {
    const event = new ServerSentEvent({ count: 1 });

    const result = decodeChunk(formatSSEChunk(event));

    expect(result).toBe('data: {"count":1}\n\n');
  });

  it('should include event field when ServerSentEvent has event', () => {
    const event = new ServerSentEvent('payload', { event: 'update' });

    const result = decodeChunk(formatSSEChunk(event));

    expect(result).toBe('event: update\ndata: payload\n\n');
  });

  it('should include id field when ServerSentEvent has id', () => {
    const event = new ServerSentEvent('payload', { id: 'abc' });

    const result = decodeChunk(formatSSEChunk(event));

    expect(result).toBe('id: abc\ndata: payload\n\n');
  });

  it('should include retry field when ServerSentEvent has retry', () => {
    const event = new ServerSentEvent('payload', { retry: 3000 });

    const result = decodeChunk(formatSSEChunk(event));

    expect(result).toBe('retry: 3000\ndata: payload\n\n');
  });

  it('should include all fields when ServerSentEvent has all metadata', () => {
    const event = new ServerSentEvent({ status: 'ok' }, {
      event: 'heartbeat',
      id: '42',
      retry: 5000,
    });

    const result = decodeChunk(formatSSEChunk(event));

    expect(result).toBe('event: heartbeat\nid: 42\nretry: 5000\ndata: {"status":"ok"}\n\n');
  });

  it('should split multi-line string into multiple data lines', () => {
    const result = decodeChunk(formatSSEChunk('line1\nline2\nline3'));

    expect(result).toBe('data: line1\ndata: line2\ndata: line3\n\n');
  });

  it('should split string with newlines in ServerSentEvent data', () => {
    const event = new ServerSentEvent('first\nsecond');

    const result = decodeChunk(formatSSEChunk(event));

    expect(result).toBe('data: first\ndata: second\n\n');
  });

  it('should format null as data field', () => {
    const result = decodeChunk(formatSSEChunk(null));

    expect(result).toBe('data: null\n\n');
  });

  it('should format number as data field', () => {
    const result = decodeChunk(formatSSEChunk(42));

    expect(result).toBe('data: 42\n\n');
  });

  it('should format boolean as data field', () => {
    const result = decodeChunk(formatSSEChunk(true));

    expect(result).toBe('data: true\n\n');
  });

  it('should strip newline from event name', () => {
    const event = new ServerSentEvent('data', { event: 'bad\nevent' });

    const result = decodeChunk(formatSSEChunk(event));

    expect(result).toBe('event: badevent\ndata: data\n\n');
  });

  it('should strip carriage return from id', () => {
    const event = new ServerSentEvent('data', { id: 'bad\rid' });

    const result = decodeChunk(formatSSEChunk(event));

    expect(result).toBe('id: badid\ndata: data\n\n');
  });

  it('should return Uint8Array', () => {
    const result = formatSSEChunk('test');

    expect(result).toBeInstanceOf(Uint8Array);
  });
});

describe('isAsyncIterable', () => {
  it('should return true for async generator', () => {
    async function* generate() {
      yield 1;
    }

    expect(isAsyncIterable(generate())).toBe(true);
  });

  it('should return true for object with Symbol.asyncIterator', () => {
    const iterable = {
      [Symbol.asyncIterator]() {
        return { next: () => Promise.resolve({ done: true, value: undefined }) };
      },
    };

    expect(isAsyncIterable(iterable)).toBe(true);
  });

  it('should return false for regular array', () => {
    expect(isAsyncIterable([1, 2, 3])).toBe(false);
  });

  it('should return false for regular generator', () => {
    function* generate() {
      yield 1;
    }

    expect(isAsyncIterable(generate())).toBe(false);
  });

  it('should return false for null', () => {
    expect(isAsyncIterable(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isAsyncIterable(undefined)).toBe(false);
  });

  it('should return false for string', () => {
    expect(isAsyncIterable('hello')).toBe(false);
  });

  it('should return false for number', () => {
    expect(isAsyncIterable(42)).toBe(false);
  });

  it('should return false for Promise', () => {
    expect(isAsyncIterable(Promise.resolve(1))).toBe(false);
  });
});

describe('formatSSEChunk — id NULL character sanitization', () => {
  it('should strip NULL characters from id field', () => {
    const event = new ServerSentEvent('data', { id: 'test\0inject' });
    const frame = decodeChunk(formatSSEChunk(event));

    expect(frame).toContain('id: testinject');
    expect(frame).not.toContain('\0');
  });

  it('should strip multiple NULL characters from id field', () => {
    const event = new ServerSentEvent('data', { id: '\0a\0b\0' });
    const frame = decodeChunk(formatSSEChunk(event));

    expect(frame).toContain('id: ab');
  });

  it('should strip both newlines and NULL from id field', () => {
    const event = new ServerSentEvent('data', { id: 'a\nb\0c\rd' });
    const frame = decodeChunk(formatSSEChunk(event));

    expect(frame).toContain('id: abcd');
  });
});

describe('formatSSEChunk — retry validation', () => {
  it('should include retry field for valid non-negative integer', () => {
    const event = new ServerSentEvent('data', { retry: 3000 });
    const frame = decodeChunk(formatSSEChunk(event));

    expect(frame).toContain('retry: 3000');
  });

  it('should include retry field for zero', () => {
    const event = new ServerSentEvent('data', { retry: 0 });
    const frame = decodeChunk(formatSSEChunk(event));

    expect(frame).toContain('retry: 0');
  });

  it('should omit retry field for negative value', () => {
    const event = new ServerSentEvent('data', { retry: -1 });
    const frame = decodeChunk(formatSSEChunk(event));

    expect(frame).not.toContain('retry:');
  });

  it('should omit retry field for floating-point value', () => {
    const event = new ServerSentEvent('data', { retry: 3.5 });
    const frame = decodeChunk(formatSSEChunk(event));

    expect(frame).not.toContain('retry:');
  });

  it('should omit retry field for NaN', () => {
    const event = new ServerSentEvent('data', { retry: NaN });
    const frame = decodeChunk(formatSSEChunk(event));

    expect(frame).not.toContain('retry:');
  });

  it('should omit retry field for Infinity', () => {
    const event = new ServerSentEvent('data', { retry: Infinity });
    const frame = decodeChunk(formatSSEChunk(event));

    expect(frame).not.toContain('retry:');
  });
});
