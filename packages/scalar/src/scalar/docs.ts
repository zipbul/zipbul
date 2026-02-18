import { getRuntimeContext } from '@zipbul/core';

import type { Doc } from './interfaces';
import type { ScalarMetadataRegistry, ScalarRecord, ScalarRegistryKey } from './types';

import { isMap } from '../common';
import { OpenApiFactory } from '../spec-factory';

type RuntimeMetadataRegistry = ReturnType<typeof getRuntimeContext>['metadataRegistry'];

type RuntimeRegistryValue = NonNullable<RuntimeMetadataRegistry> extends Map<infer _K, infer V> ? V : never;

function isScalarRecord(value: ScalarRecord | RuntimeRegistryValue): value is ScalarRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveRegistry(registry: ScalarMetadataRegistry | undefined): ScalarMetadataRegistry | undefined {
  if (registry !== undefined) {
    return registry;
  }

  const runtimeRegistry: RuntimeMetadataRegistry | ScalarMetadataRegistry = getRuntimeContext().metadataRegistry;

  if (!runtimeRegistry) {
    return undefined;
  }

  const converted = new Map<ScalarRegistryKey, ScalarRecord>();

  for (const [key, meta] of runtimeRegistry.entries()) {
    if (isScalarRecord(meta)) {
      converted.set(key, meta);
    }
  }

  return converted;
}

export function buildDocsForHttpAdapters(httpAdapterNames: string[], registry?: ScalarMetadataRegistry): Doc[] {
  const registryValue = resolveRegistry(registry);

  if (registryValue === undefined) {
    throw new Error('Scalar: No Metadata Registry found. Ensure app.init() completes before Scalar binding.');
  }

  if (!isMap(registryValue)) {
    const found = typeof registryValue;

    throw new Error(`Scalar: Invalid Metadata Registry. Expected Map, got: ${found}`);
  }

  const spec = OpenApiFactory.create(registryValue, {
    title: 'API Docs',
    version: '1.0.0',
  });

  return httpAdapterNames.map(name => ({
    docId: `openapi:http:${name}`,
    spec,
  }));
}
