import type { Class } from '@zipbul/common';

import type { CombinedMetadata, CombinedMetadataInput, MetadataProperty } from './interfaces';

import { getRuntimeContext } from '../runtime/runtime-context';

function normalizeProperties(properties: CombinedMetadataInput['properties']): Record<string, MetadataProperty> {
  const normalized: Record<string, MetadataProperty> = {};

  for (const property of properties) {
    if (typeof property.name !== 'string') {
      continue;
    }

    normalized[property.name] = property;
  }

  return normalized;
}

export class MetadataConsumer {
  private static cliRegistry = new Map<Class, CombinedMetadata>();

  static registerCLIMetadata(registry: Map<Class, CombinedMetadataInput>) {
    const normalized = new Map<Class, CombinedMetadata>();

    for (const [target, entry] of registry.entries()) {
      normalized.set(target, {
        className: entry.className,
        properties: normalizeProperties(entry.properties),
        decorators: entry.decorators,
        constructorParams: entry.constructorParams,
        methods: entry.methods,
      });
    }

    this.cliRegistry = normalized;
  }

  static getCombinedMetadata(target: Class): CombinedMetadata {
    if (this.cliRegistry.size === 0) {
      const runtimeRegistry = getRuntimeContext().metadataRegistry;

      if (runtimeRegistry) {
        const runtimeMeta = runtimeRegistry.get(target);

        if (runtimeMeta) {
          return {
            className: target.name,
            properties: {},
          };
        }
      }

      return { className: target.name, properties: {} };
    }

    const cliMeta = this.cliRegistry.get(target);

    if (!cliMeta) {
      return { className: target.name, properties: {} };
    }

    return {
      className: cliMeta.className || target.name,
      properties: cliMeta.properties,
      decorators: cliMeta.decorators,
      constructorParams: cliMeta.constructorParams,
      methods: cliMeta.methods,
    };
  }
}
