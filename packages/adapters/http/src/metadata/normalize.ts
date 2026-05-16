import type { Class } from '@zipbul/common';
import type {
  ClassMetadata as CoreClassMetadata,
  ConstructorParamMetadata as CoreConstructorParamMetadata,
  DecoratorMetadata as CoreDecoratorMetadata,
} from '@zipbul/core';

import type { ClassMetadata } from '../interfaces';
import type { MetadataRegistryKey, ParamTypeReference } from '../types';

export function normalizeMetadataRegistry(
  registry:
    | Map<MetadataRegistryKey, ClassMetadata | CoreClassMetadata>
    | Map<Class, ClassMetadata | CoreClassMetadata>
    | undefined,
): Map<MetadataRegistryKey, ClassMetadata> | undefined {
  if (!registry) {
    return undefined;
  }

  const normalized = new Map<MetadataRegistryKey, ClassMetadata>();

  for (const [key, value] of registry.entries()) {
    if (isClassToken(key)) {
      normalized.set(key, toHttpClassMetadata(value));
    }
  }

  return normalized;
}

function toHttpClassMetadata(value: ClassMetadata | CoreClassMetadata): ClassMetadata {
  if (isHttpClassMetadata(value)) {
    return value;
  }

  const result: ClassMetadata = {};

  if (value.decorators !== undefined) {
    (result as { decorators: readonly CoreDecoratorMetadata[] }).decorators = normalizeCoreDecorators(value.decorators);
  }
  if (value.constructorParams !== undefined) {
    (result as { constructorParams: readonly CoreConstructorParamMetadata[] }).constructorParams = normalizeCoreConstructorParams(value.constructorParams);
  }

  return result;
}

export function isHttpClassMetadata(value: ClassMetadata | CoreClassMetadata): value is ClassMetadata {
  return 'methods' in value || 'className' in value;
}

function normalizeCoreDecorators(decorators: readonly CoreDecoratorMetadata[]): readonly CoreDecoratorMetadata[] {
  return decorators.map(decorator => ({ name: decorator.name }));
}

function normalizeCoreConstructorParams(params: readonly CoreConstructorParamMetadata[]): readonly CoreConstructorParamMetadata[] {
  return params.map(param => {
    const type = isProviderToken(param.type) ? param.type : undefined;
    const decorators = param.decorators ? normalizeCoreDecorators(param.decorators) : undefined;

    return {
      ...(type !== undefined ? { type } : {}),
      ...(decorators !== undefined ? { decorators } : {}),
    };
  });
}

export function isProviderToken(value: CoreConstructorParamMetadata['type']): value is ParamTypeReference {
  return typeof value === 'string' || typeof value === 'symbol' || typeof value === 'function';
}

function isClassToken(value: MetadataRegistryKey | Class): value is MetadataRegistryKey {
  return typeof value === 'function';
}
