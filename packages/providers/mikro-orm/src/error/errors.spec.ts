import { test, expect } from 'bun:test';

import { MikroOrmError } from './errors';
import { MikroOrmErrorReason } from './enums';

test('MikroOrmError is an Error subclass carrying name, reason, and a namespaced message', () => {
  const err = new MikroOrmError({
    reason: MikroOrmErrorReason.ConnectionNotRegistered,
    message: "connection 'default' is not registered",
  });
  expect(err).toBeInstanceOf(Error);
  expect(err).toBeInstanceOf(MikroOrmError);
  expect(err.name).toBe('MikroOrmError');
  expect(err.reason).toBe(MikroOrmErrorReason.ConnectionNotRegistered);
  expect(err.message).toBe("@zipbul/mikro-orm: connection 'default' is not registered");
});

test('MikroOrmError forwards the cause option to Error', () => {
  const cause = new Error('underlying');
  const err = new MikroOrmError(
    { reason: MikroOrmErrorReason.StreamingUnsupported, message: 'streaming unsupported' },
    { cause },
  );
  expect(err.cause).toBe(cause);
});

test('reason discriminates instances of the single error class', () => {
  const a = new MikroOrmError({ reason: MikroOrmErrorReason.DriverNotInitialized, message: 'a' });
  const b = new MikroOrmError({ reason: MikroOrmErrorReason.PooledDriverRequiresReserve, message: 'b' });
  expect(a.reason).not.toBe(b.reason);
  expect(a).toBeInstanceOf(MikroOrmError);
  expect(b).toBeInstanceOf(MikroOrmError);
});
