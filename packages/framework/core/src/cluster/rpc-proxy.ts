import type { ZipbulValue } from '@zipbul/common';

import { RpcAbortedError, RpcTimeoutError } from './errors';
import type { RPCErrorPayload, RPCMessage, RPCResponse, RpcPending, RpcProxy } from './interfaces';
import type { Promisified, RpcArgs, RpcCallable, RpcResult } from './types';

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

type RecordCandidate = ZipbulValue | RPCResponse;

function isRecord(value: RecordCandidate): value is Record<string, ZipbulValue> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function isRpcResponse(value: RecordCandidate): value is RPCResponse {
  if (!isRecord(value)) {
    return false;
  }

  const id = value.id;

  if (typeof id !== 'string' || id.length === 0) {
    return false;
  }

  return true;
}

function isPromisifiedApi<T extends Record<string, RpcCallable>>(
  value: Partial<Promisified<T>> | ZipbulValue,
  methods: ReadonlyArray<keyof T>,
): value is Promisified<T> {
  if (!isRecord(value as RecordCandidate)) {
    return false;
  }

  const record = value as Record<string, ZipbulValue>;

  for (const method of methods) {
    if (typeof record[String(method)] !== 'function') {
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

/**
 * Reconstructs an Error from a serialized RPCErrorPayload.
 *
 * @param payload - The serialized error from the worker.
 * @returns An Error with the original name, message, and stack.
 */
function deserializeError(payload: RPCErrorPayload): Error {
  const error = new Error(payload.message);
  error.name = payload.name;

  if (payload.stack !== undefined) {
    error.stack = payload.stack;
  }

  return error;
}

/**
 * Creates an RPC proxy for a Worker with timeout and disposable lifecycle.
 *
 * Every RPC call has a configurable timeout. If the worker does not respond
 * within the timeout, the pending promise is rejected with RpcTimeoutError.
 *
 * On dispose(), all pending promises are rejected with RpcAbortedError
 * and the message event listener is removed from the worker.
 *
 * @param worker - The native Worker to communicate with.
 * @param methods - Method names to expose on the proxy.
 * @param timeoutMs - Per-call timeout in milliseconds. Defaults to 30s.
 * @returns An RpcProxy with the promisified API and a dispose() method.
 *
 * @public
 */
export function wrapWorker<T extends Record<string, RpcCallable>>(
  worker: Worker,
  methods: ReadonlyArray<keyof T>,
  timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
): RpcProxy<T> {
  const pending = new Map<string, RpcPending>();

  const messageHandler = (event: MessageEvent<ZipbulValue>) => {
    if (!isRpcResponse(event.data)) {
      return;
    }

    const payload = event.data;
    const entry = pending.get(payload.id);

    if (!entry) {
      return;
    }

    clearTimeout(entry.timer);
    pending.delete(payload.id);

    if (payload.error !== undefined) {
      entry.reject(deserializeError(payload.error));
    } else {
      entry.resolve(payload.result);
    }
  };

  worker.addEventListener('message', messageHandler);

  const api: Partial<Promisified<T>> = {};

  for (const method of methods) {
    const methodName = String(method);

    api[method] = ((...args: RpcArgs) => {
      return new Promise<Awaited<RpcResult>>((resolve, reject) => {
        const id = crypto.randomUUID();
        const message: RPCMessage = { id, method: methodName, args };

        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new RpcTimeoutError(methodName, timeoutMs));
        }, timeoutMs);

        pending.set(id, { resolve, reject, timer });
        worker.postMessage(message);
      });
    }) as Promisified<T>[keyof T];
  }

  const dispose = () => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new RpcAbortedError('Worker terminated'));
      pending.delete(id);
    }

    worker.removeEventListener('message', messageHandler);
  };

  return {
    api: ensurePromisifiedApi(api, methods),
    dispose,
  };
}
