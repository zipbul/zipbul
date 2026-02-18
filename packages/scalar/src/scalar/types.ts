import type { AdapterCollection, AdapterGroup, ZipbulAdapter, ZipbulRecord, Class } from '@zipbul/common';

export type DocumentTargets = 'all' | DocumentTarget[];

export interface DocumentTarget extends ZipbulRecord {
  protocol: string;
  names?: string[];
}

export type HttpTargets = 'all' | string[];

export type AdapterGroupForEachCallback = (adapter: ScalarInput, name: string) => void;

export type AdapterGroupForEach = (callback: AdapterGroupForEachCallback) => void;

export interface AdapterGroupWithName {
  forEach: AdapterGroupForEach;
}

export type AdapterGroupGetResult = ScalarInput | ZipbulAdapter | ScalarKeyedRecord;

export interface AdapterGroupWithGet {
  get: (name: string) => AdapterGroupGetResult | undefined;
}

export type AdapterGroupLike =
  | AdapterGroup<ZipbulAdapter>
  | Map<string, ScalarInput>
  | AdapterGroupWithGet
  | AdapterGroupWithName;

export interface AdapterCollectionLikeRecord {
  http?: AdapterGroupLike;
  [protocol: string]: AdapterGroupLike | undefined;
}

export type AdapterCollectionLike = AdapterCollection | AdapterCollectionLikeRecord;

export type ScalarValue = string | number | boolean | bigint | symbol | null | undefined;

export type ScalarBuiltinConstructor =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | BigIntConstructor
  | SymbolConstructor
  | ErrorConstructor;

export interface ScalarRecord {
  [key: string]: ScalarNode;
}

export interface ScalarList extends Array<ScalarNode> {}

export type ScalarNode = ScalarValue | ScalarRecord | ScalarList;

export type ScalarInput = ScalarNode | ScalarCallable | ScalarConstructor | ScalarBuiltinConstructor;

export type ScalarShallowRecord = Record<string, ScalarValue | ScalarValue[]>;

export type ScalarObjectList = ScalarRecord[];

export type ScalarKey = string | symbol;

export type ScalarKeyedRecord = Record<ScalarKey, ScalarNode | ScalarCallable>;

export type ScalarCallable = (...args: ScalarList) => ScalarValue;

export type ScalarConstructor = new (...args: ScalarList) => ScalarRecord;

export type ScalarRegistryKey = ScalarConstructor | ScalarCallable | string | symbol | Class;

export type ScalarMetadataRegistry = Map<ScalarRegistryKey, ScalarRecord>;
