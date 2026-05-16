import type { BootstrapState } from './interfaces';

let currentContext: BootstrapState = {};

export function registerBootstrapState(context: BootstrapState): void {
  const nextContext: BootstrapState = {};

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

export function getBootstrapState(): BootstrapState {
  return currentContext;
}

/**
 * Resets the module-global bootstrap state to its initial empty form.
 *
 * **Test-only.** Production never calls this; clearing live runtime state
 * mid-process would break any active adapter or request scope. Used by
 * `@zipbul/testing` between `compile()` invocations to guarantee no field
 * leaks from a previous test app.
 *
 * @public
 */
export function resetBootstrapState(): void {
  currentContext = {};
}

/**
 * Purges the metadata registry from the runtime context.
 * Called after bootstrap to enforce INVARIANTS §4 (Metadata Volatility).
 *
 * @public
 */
export function clearMetadataRegistry(): void {
  if (currentContext.isAotRuntime) {
    currentContext.metadataRegistry = undefined;
    return;
  }

  currentContext.metadataRegistry?.clear();
  currentContext.metadataRegistry = undefined;
}
