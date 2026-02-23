import { describe, it, expect } from 'bun:test';
import { RestController, Controller } from './class.decorator';

describe('RestController', () => {
  it('should return ClassDecorator when called with no args', () => {
    // Act
    const decorator = RestController();

    // Assert
    expect(typeof decorator).toBe('function');
  });

  it('should return ClassDecorator when called with path string', () => {
    // Act
    const decorator = RestController('users');

    // Assert
    expect(typeof decorator).toBe('function');
  });

  it('should return ClassDecorator when called with path and adapterIds option', () => {
    // Act
    const decorator = RestController('api', { adapterIds: ['http'] });

    // Assert
    expect(typeof decorator).toBe('function');
  });

  it('should return ClassDecorator when called with path and full options (version + adapterIds)', () => {
    // Act
    const decorator = RestController('api', { version: '1', adapterIds: ['http', 'ws'] });

    // Assert
    expect(typeof decorator).toBe('function');
  });

  it('should return ClassDecorator when called with path and empty options object', () => {
    // Act
    const decorator = RestController('users', {});

    // Assert
    expect(typeof decorator).toBe('function');
  });

  it('should not throw when decorator applied to a class', () => {
    // Arrange
    const decorator = RestController('test');
    class TestTarget {}

    // Act & Assert
    expect(() => decorator(TestTarget)).not.toThrow();
  });

  it('should return independent decorators on repeated calls', () => {
    // Act
    const a = RestController();
    const b = RestController();

    // Assert
    expect(typeof a).toBe('function');
    expect(typeof b).toBe('function');
    expect(a).not.toBe(b);
  });
});

describe('Controller', () => {
  it('should return ClassDecorator when called with no args', () => {
    // Act
    const decorator = Controller();

    // Assert
    expect(typeof decorator).toBe('function');
  });
});
