import type { ZipbulValue } from '@zipbul/common';

import type { RPCErrorPayload, RPCMessage, RPCResponse } from './interfaces';
import type { RpcCallable } from './types';

type RecordCandidate = ZipbulValue | RPCMessage;

function isRecord(value: RecordCandidate): value is Record<string, ZipbulValue> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function isWorkerScope(value: typeof globalThis): value is typeof globalThis & Worker {
  return typeof value.addEventListener === 'function' && typeof value.postMessage === 'function';
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

/**
 * Serializes an error into an RPCErrorPayload with message, name, and stack.
 *
 * @param error - The caught error.
 * @returns A plain object safe for postMessage.
 */
function serializeError(error: unknown): RPCErrorPayload {
  if (error instanceof Error) {
    const payload: RPCErrorPayload = {
      message: error.message,
      name: error.name,
    };

    if (error.stack !== undefined) {
      payload.stack = error.stack;
    }

    return payload;
  }

  return {
    message: String(error),
    name: 'Error',
  };
}

/**
 * Exposes an object's methods to the parent thread via RPC.
 *
 * Only methods listed in `allowedMethods` can be called remotely.
 * Any attempt to call an unlisted method is rejected with an error response.
 *
 * Must be called from a worker context (globalThis must have addEventListener and postMessage).
 *
 * @param targetObject - The object whose methods are exposed.
 * @param allowedMethods - Whitelist of method names that can be called via RPC.
 *
 * @public
 */
export function exposeWorker<T extends Record<string, RpcCallable>>(
  targetObject: T,
  allowedMethods: ReadonlyArray<keyof T>,
): void {
  const self = globalThis;

  if (!isWorkerScope(self)) {
    throw new Error('RPC expose requires a worker context');
  }

  const methodSet = new Set<string>(allowedMethods.map(String));

  self.addEventListener('message', (event: MessageEvent<ZipbulValue>) => {
    void (async () => {
      if (!isRpcMessage(event.data)) {
        return;
      }

      const payload = event.data;

      try {
        if (!methodSet.has(payload.method)) {
          throw new Error(`Method "${payload.method}" is not exposed`);
        }

        const handler = targetObject[payload.method];

        if (typeof handler !== 'function') {
          throw new Error(`Method "${payload.method}" is not a function`);
        }

        const result = await Promise.resolve(handler(...payload.args));
        const response: RPCResponse = { id: payload.id, result };

        self.postMessage(response);
      } catch (error) {
        const response: RPCResponse = { id: payload.id, error: serializeError(error) };

        self.postMessage(response);
      }
    })();
  });
}
