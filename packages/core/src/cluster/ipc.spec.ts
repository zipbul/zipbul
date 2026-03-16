import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { ZipbulValue } from '@zipbul/common';

import { wrap } from './ipc';

// ── Helpers ─────────────────────────────────────────────────────────

interface MockWorker {
  postMessage: ReturnType<typeof mock>;
  addEventListener: ReturnType<typeof mock>;
  messageHandler: ((event: MessageEvent<ZipbulValue>) => void) | undefined;
}

function createMockWorker(): MockWorker {
  const mockWorker: MockWorker = {
    postMessage: mock(),
    addEventListener: mock(),
    messageHandler: undefined,
  };

  mockWorker.addEventListener.mockImplementation((event: string, handler: (event: MessageEvent<ZipbulValue>) => void) => {
    if (event === 'message') {
      mockWorker.messageHandler = handler;
    }
  });

  return mockWorker;
}

function simulateResponse(mockWorker: MockWorker, id: string, result?: ZipbulValue, error?: string): void {
  const response: Record<string, unknown> = { id };

  if (result !== undefined) {
    response.result = result;
  }

  if (error !== undefined) {
    response.error = error;
  }

  mockWorker.messageHandler?.({ data: response } as MessageEvent<ZipbulValue>);
}

type WorkerApi = Record<string, (...args: readonly ZipbulValue[]) => ZipbulValue>;

// ── Tests ───────────────────────────────────────────────────────────

describe('wrap', () => {
  let mockWorker: MockWorker;

  beforeEach(() => {
    mockWorker = createMockWorker();
  });

  it('should create proxy with all specified methods', () => {
    // Arrange
    const methods = ['init', 'bootstrap', 'destroy', 'getStats'] as const;

    // Act
    const proxy = wrap<WorkerApi>(mockWorker as unknown as Worker, methods);

    // Assert
    expect(typeof proxy.init).toBe('function');
    expect(typeof proxy.bootstrap).toBe('function');
    expect(typeof proxy.destroy).toBe('function');
    expect(typeof proxy.getStats).toBe('function');
  });

  it('should return undefined for methods not in the wrap list', () => {
    // Arrange
    const methods = ['init'] as const;

    // Act
    const proxy = wrap<WorkerApi>(mockWorker as unknown as Worker, methods);

    // Assert
    const proxyRecord = proxy as unknown as Record<string, unknown>;
    expect(proxyRecord.bootstrap).toBeUndefined();
    expect(proxyRecord.destroy).toBeUndefined();
    expect(proxyRecord.getStats).toBeUndefined();
  });

  it('should send RPC message when proxy method is called', () => {
    // Arrange
    const methods = ['init'] as const;
    const proxy = wrap<WorkerApi>(mockWorker as unknown as Worker, methods);

    // Act
    void proxy.init(1, { entryModule: { className: 'App' } });

    // Assert
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1);
    const message = mockWorker.postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(message.method).toBe('init');
    expect(message.args).toEqual([1, { entryModule: { className: 'App' } }]);
    expect(typeof message.id).toBe('string');
    expect((message.id as string).length).toBeGreaterThan(0);
  });

  it('should resolve with result from worker response', async () => {
    // Arrange
    const methods = ['getStats'] as const;
    const proxy = wrap<WorkerApi>(mockWorker as unknown as Worker, methods);
    const expectedResult = { cpu: 0.5, memory: 1024 };

    // Act
    const resultPromise = proxy.getStats();

    // Extract the message id that was sent
    const sentMessage = mockWorker.postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    const messageId = sentMessage.id as string;

    // Simulate worker response
    simulateResponse(mockWorker, messageId, expectedResult);

    // Assert
    const result = await resultPromise;
    expect(result).toEqual(expectedResult);
  });
});
