import { describe, it, expect } from 'bun:test';
import { Get, Post, Put, Delete, Patch, Options, Head } from './method.decorator';
import type { HttpMethodDecoratorOptions } from './interfaces';

describe('HTTP method decorators', () => {
  it('should return MethodDecorator when Get is called with no args', () => {
    // Act
    const decorator = Get();

    // Assert
    expect(typeof decorator).toBe('function');
  });

  it('should return MethodDecorator when Get is called with string path', () => {
    // Act
    const decorator = Get('/users');

    // Assert
    expect(typeof decorator).toBe('function');
  });

  it('should return MethodDecorator when Get is called with options object', () => {
    // Arrange
    const options: HttpMethodDecoratorOptions = { path: '/items', version: '2' };

    // Act
    const decorator = Get(options);

    // Assert
    expect(typeof decorator).toBe('function');
  });

  it('should each return a MethodDecorator for all 7 HTTP method decorators', () => {
    // Act & Assert
    const decorators = [Get(), Post(), Put(), Delete(), Patch(), Options(), Head()];

    for (const decorator of decorators) {
      expect(typeof decorator).toBe('function');
    }

    expect(decorators).toHaveLength(7);
  });

  it('should return a callable decorator that does not throw when applied to a method descriptor', () => {
    // Arrange
    const decorator = Get('/test');
    const target = {};
    const propertyKey = 'findAll';
    const descriptor: PropertyDescriptor = {
      value: () => {},
      writable: true,
      enumerable: false,
      configurable: true,
    };

    // Act & Assert
    expect(() => decorator(target, propertyKey, descriptor)).not.toThrow();
  });
});
