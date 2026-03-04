import { describe, it, expect } from 'bun:test';
import { defineAdapter } from './define-adapter';
import { ReservedPipeline } from './types';
import type { AdapterPipelines, AdapterEntryDecorators } from './types';
import type { ZipbulAdapter, Context } from '../interfaces';

// -- Test fixtures --

const controllerDeco = () => {};
const getDeco = () => {};
const postDeco = () => {};

class FakeAdapter implements ZipbulAdapter {
  readonly name = 'fake';

  readonly pipeline: AdapterPipelines = [
    'BeforeRequest',
    ReservedPipeline.Guards,
    ReservedPipeline.Handler,
    'AfterRequest',
  ];

  readonly decorators: AdapterEntryDecorators = {
    controller: controllerDeco,
    handler: [getDeco, postDeco],
  };

  async start(_context: Context): Promise<void> {}
  async stop(): Promise<void> {}
}

describe('defineAdapter', () => {
  it('should return the exact same class reference (===)', () => {
    // Arrange & Act
    const result = defineAdapter(FakeAdapter);

    // Assert
    expect(result).toBe(FakeAdapter);
  });

  it('should return identical results when called multiple times', () => {
    // Arrange & Act
    const result1 = defineAdapter(FakeAdapter);
    const result2 = defineAdapter(FakeAdapter);

    // Assert
    expect(result1).toBe(result2);
    expect(result1).toBe(FakeAdapter);
  });

  it('should preserve adapter class instance properties', () => {
    // Arrange
    const AdapterClass = defineAdapter(FakeAdapter);

    // Act
    const instance = new AdapterClass();

    // Assert
    expect(instance.name).toBe('fake');
    expect(instance.pipeline).toEqual([
      'BeforeRequest',
      ReservedPipeline.Guards,
      ReservedPipeline.Handler,
      'AfterRequest',
    ]);
    expect(instance.decorators.controller).toBe(controllerDeco);
    expect(instance.decorators.handler).toEqual([getDeco, postDeco]);
  });
});
