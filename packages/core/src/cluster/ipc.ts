import type { ZipbulValue } from '@zipbul/common';

import type { RPCMessage, RPCResponse, RpcPending } from './interfaces';
import type { Promisified, RpcArgs, RpcCallable, RpcResult } from './types';

type PromisifiedRecord = Record<string, (...args: RpcArgs) => Promise<RpcResult>>;

type PartialPromisifiedRecord = Partial<PromisifiedRecord>;

type RecordCandidate =
  | ZipbulValue
  | Worker
  | RPCMessage
  | RPCResponse
  | typeof globalThis
  | PromisifiedRecord
  | PartialPromisifiedRecord;

function isRecord(value: RecordCandidate): value is Record<string, ZipbulValue> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function isWorkerScope(value: RecordCandidate): value is Worker {
  if (!isRecord(value)) {
    return false;
  }

  const addEventListener = value.addEventListener;
  const postMessage = value.postMessage;

  return typeof addEventListener === 'function' && typeof postMessage === 'function';
}

function isRpcMessage(value: RecordCandidate): value is RPCMessage {
  if (!isRecord(value)) {
    return false;
  }

  const id = value.id;
  const method = value.method;
  const args = value.args;

  return typeof id === 'string' && id.length > 0 && typeof method === 'string' && method.length > 0 && Array.isArray(args);
}

function isRpcResponse(value: RecordCandidate): value is RPCResponse {
  if (!isRecord(value)) {
    return false;
  }

  const id = value.id;
  const error = value.error;

  if (typeof id !== 'string' || id.length === 0) {
    return false;
  }

  if (error !== undefined && typeof error !== 'string') {
    return false;
  }

  return true;
}

function isPromisifiedApi<T extends Record<string, RpcCallable>>(
  value: Partial<Promisified<T>> | ZipbulValue,
  methods: ReadonlyArray<keyof T>,
): value is Promisified<T> {
  if (!isRecord(value)) {
    return false;
  }

  for (const method of methods) {
    const candidate = value[String(method)];

    if (typeof candidate !== 'function') {
      return false;
    }
  }

  return true;
}

function ensurePromisifiedApi<T extends Record<string, RpcCallable>>(
  value: Partial<Promisified<T>> | ZipbulValue,
  methods: ReadonlyArray<keyof T>,
): Promisified<T> {
  if (!isPromisifiedApi(value, methods)) {
    throw new Error('RPC proxy missing required methods');
  }

  return value;
}

export function expose<T extends Record<string, RpcCallable>>(obj: T): void {
  const self = globalThis;

  if (!isWorkerScope(self)) {
    throw new Error('RPC expose requires a worker context');
  }

  self.addEventListener('message', (event: MessageEvent<ZipbulValue>) => {
    void (async () => {
      if (!isRpcMessage(event.data)) {
        return;
      }

      const data = event.data;

      try {
        const handler = obj[data.method];

        if (typeof handler !== 'function') {
          throw new Error(`Method ${data.method} not found`);
        }

        const result = await Promise.resolve(handler(...data.args));
        const response: RPCResponse = { id: data.id, result };

        self.postMessage(response);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const response: RPCResponse = { id: data.id, error: message };

        self.postMessage(response);
      }
    })();
  });
}

export function wrap<T extends Record<string, RpcCallable>>(worker: Worker, methods: ReadonlyArray<keyof T>): Promisified<T> {
  const pending = new Map<string, RpcPending>();

  worker.addEventListener('message', (event: MessageEvent<ZipbulValue>) => {
    if (!isRpcResponse(event.data)) {
      return;
    }

    const data = event.data;
    const promise = pending.get(data.id);

    if (!promise) {
      return;
    }

    if (typeof data.error === 'string') {
      promise.reject(new Error(data.error));
    } else {
      promise.resolve(data.result);
    }

    pending.delete(data.id);
  });

  const api: Partial<Promisified<T>> = {};

  for (const method of methods) {
    api[method] = async (...args: RpcArgs) => {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const message: RPCMessage = { id, method: String(method), args };

        pending.set(id, { resolve, reject });
        worker.postMessage(message);
      });
    };
  }

  return ensurePromisifiedApi(api, methods);
}
