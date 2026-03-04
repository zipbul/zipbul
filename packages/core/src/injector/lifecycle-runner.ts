import type { Container } from './container';
import type { ContainerValue } from './types';

interface WithOnInit {
  onInit(): Promise<void> | void;
}

interface WithOnDestroy {
  onDestroy(): Promise<void> | void;
}

function hasOnInit(instance: ContainerValue): instance is ContainerValue & WithOnInit {
  return (
    typeof instance === 'object' &&
    instance !== null &&
    'onInit' in instance &&
    typeof (instance as Record<string, unknown>).onInit === 'function'
  );
}

function hasOnDestroy(instance: ContainerValue): instance is ContainerValue & WithOnDestroy {
  return (
    typeof instance === 'object' &&
    instance !== null &&
    'onDestroy' in instance &&
    typeof (instance as Record<string, unknown>).onDestroy === 'function'
  );
}

/**
 * Invokes onInit() on all singleton instances in registration order.
 * Only triggers singletons that have already been instantiated.
 *
 * @param container - The root container
 * @public
 */
export async function runInitHooks(container: Container): Promise<void> {
  const order = container.getRegistrationOrder();

  for (const token of order) {
    const registration = container.getRegistration(token);

    if (!registration || registration.scope !== 'singleton') {
      continue;
    }

    if (!container.has(token)) {
      continue;
    }

    let instance: ContainerValue;

    try {
      instance = container.get(token);
    } catch {
      continue;
    }

    if (hasOnInit(instance)) {
      await instance.onInit();
    }
  }
}

/**
 * Invokes onDestroy() on all singleton instances in reverse registration order.
 *
 * @param container - The root container
 * @public
 */
export async function runDestroyHooks(container: Container): Promise<void> {
  const order = [...container.getRegistrationOrder()].reverse();
  const visited = new Set<ContainerValue>();

  for (const token of order) {
    const registration = container.getRegistration(token);

    if (!registration || registration.scope !== 'singleton') {
      continue;
    }

    let instance: ContainerValue;

    try {
      instance = container.get(token);
    } catch {
      continue;
    }

    if (visited.has(instance)) {
      continue;
    }

    visited.add(instance);

    if (hasOnDestroy(instance)) {
      await instance.onDestroy();
    }
  }
}
