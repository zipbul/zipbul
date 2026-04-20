import { describe, it, expect } from 'bun:test';

import { WorkerState } from './enums';
import { InvalidStateTransitionError } from './errors';
import { transition, createSlot, disposeSlot } from './worker-state';
import type { RpcCallable } from './types';

type TestRpc = Record<string, RpcCallable>;

describe('transition', () => {
  it('should transition Spawning → Ready', () => {
    const slot = createSlot<TestRpc>(0);

    const result = transition(slot, WorkerState.Spawning, WorkerState.Ready);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Ready);
  });

  it('should transition Ready → Initializing', () => {
    const slot = createSlot<TestRpc>(0);
    transition(slot, WorkerState.Spawning, WorkerState.Ready);

    const result = transition(slot, WorkerState.Ready, WorkerState.Initializing);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Initializing);
  });

  it('should transition Initializing → Running', () => {
    const slot = createSlot<TestRpc>(0);
    transition(slot, WorkerState.Spawning, WorkerState.Ready);
    transition(slot, WorkerState.Ready, WorkerState.Initializing);

    const result = transition(slot, WorkerState.Initializing, WorkerState.Running);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Running);
  });

  it('should transition Running → Draining', () => {
    const slot = createSlot<TestRpc>(0);
    transition(slot, WorkerState.Spawning, WorkerState.Ready);
    transition(slot, WorkerState.Ready, WorkerState.Initializing);
    transition(slot, WorkerState.Initializing, WorkerState.Running);

    const result = transition(slot, WorkerState.Running, WorkerState.Draining);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Draining);
  });

  it('should transition Draining → Destroying', () => {
    const slot = createSlot<TestRpc>(0);
    slot.state = WorkerState.Draining;

    const result = transition(slot, WorkerState.Draining, WorkerState.Destroying);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Destroying);
  });

  it('should transition Destroying → Terminated', () => {
    const slot = createSlot<TestRpc>(0);
    slot.state = WorkerState.Destroying;

    const result = transition(slot, WorkerState.Destroying, WorkerState.Terminated);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Terminated);
  });

  it('should transition Spawning → Crashed', () => {
    const slot = createSlot<TestRpc>(0);

    const result = transition(slot, WorkerState.Spawning, WorkerState.Crashed);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Crashed);
  });

  it('should transition Running → Crashed', () => {
    const slot = createSlot<TestRpc>(0);
    slot.state = WorkerState.Running;

    const result = transition(slot, WorkerState.Running, WorkerState.Crashed);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Crashed);
  });

  it('should transition Crashed → Reviving', () => {
    const slot = createSlot<TestRpc>(0);
    slot.state = WorkerState.Crashed;

    const result = transition(slot, WorkerState.Crashed, WorkerState.Reviving);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Reviving);
  });

  it('should transition Reviving → Spawning', () => {
    const slot = createSlot<TestRpc>(0);
    slot.state = WorkerState.Reviving;

    const result = transition(slot, WorkerState.Reviving, WorkerState.Spawning);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Spawning);
  });

  it('should transition Spawning → Terminated when shutdown', () => {
    const slot = createSlot<TestRpc>(0);

    const result = transition(slot, WorkerState.Spawning, WorkerState.Terminated);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Terminated);
  });

  it('should transition Destroying → Crashed when terminateInitiated is false', () => {
    const slot = createSlot<TestRpc>(0);
    slot.state = WorkerState.Destroying;

    const result = transition(slot, WorkerState.Destroying, WorkerState.Crashed);

    expect(result).toBe(true);
    expect(slot.state as WorkerState).toBe(WorkerState.Crashed);
  });

  it('should reject transition when from state does not match current', () => {
    const slot = createSlot<TestRpc>(0);

    const result = transition(slot, WorkerState.Ready, WorkerState.Initializing);

    expect(result).toBe(false);
    expect(slot.state as WorkerState).toBe(WorkerState.Spawning);
  });

  it('should throw on invalid transition', () => {
    const slot = createSlot<TestRpc>(0);
    slot.state = WorkerState.Initializing;

    expect(() => transition(slot, WorkerState.Initializing, WorkerState.Draining)).toThrow(InvalidStateTransitionError);
  });

  it('should throw on transition from Terminated', () => {
    const slot = createSlot<TestRpc>(0);
    slot.state = WorkerState.Terminated;

    expect(() => transition(slot, WorkerState.Terminated, WorkerState.Spawning)).toThrow(InvalidStateTransitionError);
  });

  it('should clear timers on transition', () => {
    const slot = createSlot<TestRpc>(0);
    const timer = setTimeout(() => {}, 10_000);
    slot.timers.add(timer);

    transition(slot, WorkerState.Spawning, WorkerState.Ready);

    expect(slot.timers.size).toBe(0);
  });
});

describe('createSlot', () => {
  it('should create a slot with default values', () => {
    const slot = createSlot<TestRpc>(5);

    expect(slot.id).toBe(5);
    expect(slot.state as WorkerState).toBe(WorkerState.Spawning);
    expect(slot.generation).toBe(0);
    expect(slot.terminateInitiated).toBe(false);
    expect(slot.readyReceived).toBe(false);
    expect(slot.native).toBeUndefined();
    expect(slot.remote).toBeUndefined();
    expect(slot.rpcProxy).toBeUndefined();
    expect(slot.handlers.size).toBe(0);
    expect(slot.timers.size).toBe(0);
    expect(slot.reviveAttempts).toBe(0);
    expect(slot.healthCheckFailures).toBe(0);
  });
});

describe('disposeSlot', () => {
  it('should clear handlers and timers', () => {
    const slot = createSlot<TestRpc>(0);
    slot.handlers.set('test', (() => {}) as EventListener);
    slot.timers.add(setTimeout(() => {}, 10_000));

    disposeSlot(slot);

    expect(slot.handlers.size).toBe(0);
    expect(slot.timers.size).toBe(0);
  });

  it('should null native and remote references', () => {
    const slot = createSlot<TestRpc>(0);

    disposeSlot(slot);

    expect(slot.native).toBeUndefined();
    expect(slot.remote).toBeUndefined();
    expect(slot.rpcProxy).toBeUndefined();
  });
});
