import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import type { ZipbulValue } from '@zipbul/common';

import { exposeWorker } from './rpc-expose';
import type { RpcCallable } from './types';

describe('exposeWorker', () => {
  let originalAddEventListener: typeof globalThis.addEventListener;
  let originalPostMessage: typeof globalThis.postMessage;
  let messageHandler: ((event: MessageEvent<ZipbulValue>) => void) | undefined;
  let postedMessages: unknown[];

  beforeEach(() => {
    originalAddEventListener = globalThis.addEventListener;
    originalPostMessage = globalThis.postMessage;
    postedMessages = [];
    messageHandler = undefined;

    // Mock worker scope
    const addSpy = spyOn(globalThis, 'addEventListener').mockImplementation(
      ((event: string, handler: EventListenerOrEventListenerObject) => {
        if (event === 'message' && typeof handler === 'function') {
          messageHandler = handler as (event: MessageEvent<ZipbulValue>) => void;
        }
      }) as typeof globalThis.addEventListener,
    );

    const postSpy = spyOn(globalThis, 'postMessage').mockImplementation(((data: unknown) => {
      postedMessages.push(data);
    }) as typeof globalThis.postMessage);
  });

  afterEach(() => {
    globalThis.addEventListener = originalAddEventListener;
    globalThis.postMessage = originalPostMessage;
  });

  it('should register a message handler on globalThis', () => {
    const target = { doWork: mock(() => 'result') };

    exposeWorker(target, ['doWork']);

    expect(messageHandler).toBeDefined();
  });

  it('should call the target method when a valid RPC message arrives', async () => {
    const target = { doWork: mock(() => 42) as RpcCallable };

    exposeWorker(target, ['doWork']);

    messageHandler?.({ data: { id: 'test-1', method: 'doWork', args: [] } } as MessageEvent<ZipbulValue>);

    // Wait for async handler
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(target.doWork).toHaveBeenCalledTimes(1);
    expect(postedMessages).toHaveLength(1);

    const response = postedMessages[0] as Record<string, unknown>;
    expect(response.id).toBe('test-1');
    expect(response.result).toBe(42);
    expect(response.error).toBeUndefined();
  });

  it('should reject calls to methods not in the whitelist', async () => {
    const target = {
      allowed: mock(() => 'ok') as RpcCallable,
      forbidden: mock(() => 'bad') as RpcCallable,
    };

    exposeWorker(target, ['allowed']);

    messageHandler?.({ data: { id: 'test-2', method: 'forbidden', args: [] } } as MessageEvent<ZipbulValue>);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(target.forbidden).not.toHaveBeenCalled();
    expect(postedMessages).toHaveLength(1);

    const response = postedMessages[0] as Record<string, unknown>;
    const error = response.error as Record<string, unknown>;
    expect(error.message).toContain('not exposed');
  });

  it('should serialize errors with message, name, and stack', async () => {
    const target = {
      fail: mock(() => { throw new TypeError('type mismatch'); }) as RpcCallable,
    };

    exposeWorker(target, ['fail']);

    messageHandler?.({ data: { id: 'test-3', method: 'fail', args: [] } } as MessageEvent<ZipbulValue>);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const response = postedMessages[0] as Record<string, unknown>;
    const error = response.error as Record<string, unknown>;
    expect(error.message).toBe('type mismatch');
    expect(error.name).toBe('TypeError');
    expect(typeof error.stack).toBe('string');
  });

  it('should ignore non-RPC messages', async () => {
    const target = { doWork: mock(() => 'ok') as RpcCallable };

    exposeWorker(target, ['doWork']);

    // Send a non-RPC message (missing required fields)
    messageHandler?.({ data: { type: 'not-rpc' } } as MessageEvent<ZipbulValue>);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(target.doWork).not.toHaveBeenCalled();
    expect(postedMessages).toHaveLength(0);
  });

  it('should pass arguments to the target method', async () => {
    const target = {
      add: mock((...args: readonly ZipbulValue[]) => {
        const a = args[0] as number;
        const b = args[1] as number;

        return a + b;
      }) as RpcCallable,
    };

    exposeWorker(target, ['add']);

    messageHandler?.({ data: { id: 'test-4', method: 'add', args: [3, 7] } } as MessageEvent<ZipbulValue>);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(target.add).toHaveBeenCalledWith(3, 7);

    const response = postedMessages[0] as Record<string, unknown>;
    expect(response.result).toBe(10);
  });
});
