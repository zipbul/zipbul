import type { RuntimeContext } from './interfaces';

let currentContext: RuntimeContext = {};

export function registerRuntimeContext(context: RuntimeContext): void {
  const nextContext: RuntimeContext = {};

  if (context.metadataRegistry !== undefined) {
    nextContext.metadataRegistry = context.metadataRegistry;
  } else if (currentContext.metadataRegistry !== undefined) {
    nextContext.metadataRegistry = currentContext.metadataRegistry;
  }

  if (context.scopedKeys !== undefined) {
    nextContext.scopedKeys = context.scopedKeys;
  } else if (currentContext.scopedKeys !== undefined) {
    nextContext.scopedKeys = currentContext.scopedKeys;
  }

  if (context.container !== undefined) {
    nextContext.container = context.container;
  } else if (currentContext.container !== undefined) {
    nextContext.container = currentContext.container;
  }

  if (context.isAotRuntime !== undefined) {
    nextContext.isAotRuntime = context.isAotRuntime;
  } else if (currentContext.isAotRuntime !== undefined) {
    nextContext.isAotRuntime = currentContext.isAotRuntime;
  }

  if (nextContext.container && nextContext.scopedKeys) {
    nextContext.container.setScopedKeys(nextContext.scopedKeys);
  }

  currentContext = nextContext;
}

export function getRuntimeContext(): RuntimeContext {
  return currentContext;
}
