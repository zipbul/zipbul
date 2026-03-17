import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { ZipbulValue } from '@zipbul/common';

import { wrapWorker } from './rpc-proxy';
import { RpcTimeoutError, RpcAbortedError } from './errors';

interface MockWorker {
  postMessage: ReturnType<typeof mock>;
  addEventListener: ReturnType<typeof mock>;
  removeEventListener: ReturnType<typeof mock>;
  messageHandler: ((event: MessageEvent<ZipbulValue>) => void) | undefined;
}

function createMockWorker(): MockWorker {
  const mockWorker: MockWorker = {
    postMessage: mock(),
    addEventListener: mock(),
    removeEventListener: mock(),
    messageHandler: undefined,
  };

  mockWorker.addEventListener.mockImplementation((event: string, handler: (event: MessageEvent<ZipbulValue>) => void) => {
    if (event === 'message') {
      mockWorker.messageHandler = handler;
    }
  });

  return mockWorker;
}

function simulateResponse(worker: MockWorker, id: string, result?: ZipbulValue, error?: { message: string; name: string; stack?: string }): void {
  const response: Record<string, unknown> = { id };

  if (result !== undefined) {
    response.result = result;
  }

  if (error !== undefined) {
    response.error = error;
  }

  worker.messageHandler?.({ data: response } as MessageEvent<ZipbulValue>);
}

type WorkerApi = Record<string, (...args: readonly ZipbulValue[]) => ZipbulValue>;

describe('wrapWorker', () => {
  let worker: MockWorker;

  beforeEach(() => {
    worker = createMockWorker();
  });

  it('should create proxy with all specified methods', () => {
    const proxy = wrapWorker<WorkerApi>(worker as unknown as Worker, ['init', 'getStats']);

    expect(typeof proxy.api.init).toBe('function');
    expect(typeof proxy.api.getStats).toBe('function');
  });

  it('should send RPC message with correct format when method is called', () => {
    const proxy = wrapWorker<WorkerApi>(worker as unknown as Worker, ['init']);

    void proxy.api.init(1, { test: true });

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const message = worker.postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(message.method).toBe('init');
    expect(message.args).toEqual([1, { test: true }]);
    expect(typeof message.id).toBe('string');
  });

  it('should resolve with result from worker response', async () => {
    const proxy = wrapWorker<WorkerApi>(worker as unknown as Worker, ['getStats']);
    const expected = { cpu: 0.5, memory: 1024 };

    const resultPromise = proxy.api.getStats();
    const sentMessage = worker.postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    simulateResponse(worker, sentMessage.id as string, expected);

    const result = await resultPromise;
    expect(result).toEqual(expected);
  });

  it('should reject with deserialized error from worker response', async () => {
    const proxy = wrapWorker<WorkerApi>(worker as unknown as Worker, ['init']);

    const resultPromise = proxy.api.init();
    const sentMessage = worker.postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    simulateResponse(worker, sentMessage.id as string, undefined, { message: 'fail', name: 'TestError' });

    await expect(resultPromise).rejects.toThrow('fail');
  });

  it('should reject with RpcTimeoutError when response does not arrive within timeout', async () => {
    const proxy = wrapWorker<WorkerApi>(worker as unknown as Worker, ['init'], 50);

    await expect(proxy.api.init()).rejects.toBeInstanceOf(RpcTimeoutError);
  });

  it('should reject all pending with RpcAbortedError on dispose', async () => {
    const proxy = wrapWorker<WorkerApi>(worker as unknown as Worker, ['init', 'getStats']);

    const promise1 = proxy.api.init();
    const promise2 = proxy.api.getStats();

    proxy.dispose();

    await expect(promise1).rejects.toBeInstanceOf(RpcAbortedError);
    await expect(promise2).rejects.toBeInstanceOf(RpcAbortedError);
  });

  it('should remove message listener on dispose', () => {
    const proxy = wrapWorker<WorkerApi>(worker as unknown as Worker, ['init']);

    proxy.dispose();

    expect(worker.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('should ignore responses for unknown message ids', async () => {
    const proxy = wrapWorker<WorkerApi>(worker as unknown as Worker, ['init']);

    const initPromise = proxy.api.init();
    simulateResponse(worker, 'unknown-id', 'should-be-ignored');

    // The init call is still pending — dispose to clean up
    proxy.dispose();

    // init should reject with RpcAbortedError (not the unknown response)
    await expect(initPromise).rejects.toBeInstanceOf(RpcAbortedError);
  });
});
