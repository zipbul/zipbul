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

  if (context.adapterConfig !== undefined) {
    nextContext.adapterConfig = context.adapterConfig;
  } else if (currentContext.adapterConfig !== undefined) {
    nextContext.adapterConfig = currentContext.adapterConfig;
  }

  if (context.handlerIndex !== undefined) {
    nextContext.handlerIndex = context.handlerIndex;
  } else if (currentContext.handlerIndex !== undefined) {
    nextContext.handlerIndex = currentContext.handlerIndex;
  }

  if (context.controllerInstances !== undefined) {
    nextContext.controllerInstances = context.controllerInstances;
  } else if (currentContext.controllerInstances !== undefined) {
    nextContext.controllerInstances = currentContext.controllerInstances;
  }

  if (context.workerId !== undefined) {
    nextContext.workerId = context.workerId;
  } else if (currentContext.workerId !== undefined) {
    nextContext.workerId = currentContext.workerId;
  }

  if (context.adapterFilter !== undefined) {
    nextContext.adapterFilter = context.adapterFilter;
  } else if (currentContext.adapterFilter !== undefined) {
    nextContext.adapterFilter = currentContext.adapterFilter;
  }

  if (nextContext.container && nextContext.scopedKeys) {
    nextContext.container.setScopedKeys(nextContext.scopedKeys);
  }

  currentContext = nextContext;
}

export function getRuntimeContext(): RuntimeContext {
  return currentContext;
}
