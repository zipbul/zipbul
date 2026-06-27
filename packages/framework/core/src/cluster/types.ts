import type { ZipbulValue } from '@zipbul/common';

export type ClusterWorkerId = number;

export type RpcArg = ZipbulValue;

export type RpcArgs = ReadonlyArray<RpcArg>;

export type RpcResult = ZipbulValue | Promise<ZipbulValue>;

export type RpcCallable = (...args: RpcArgs) => RpcResult;

export type ClusterInitParams<_T> = ZipbulValue | undefined;

/**
 * Bootstrap parameters for a worker
 * @description The type for the bootstrap parameters
 */
export type ClusterBootstrapParams<_T> = ZipbulValue | undefined;

export type Promisified<T extends Record<string, RpcCallable>> = {
  [K in keyof T]: (...args: RpcArgs) => Promise<Awaited<RpcResult>>;
};
