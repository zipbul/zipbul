import { describe, it, expect } from 'bun:test';
import { Get, Post, Put, Delete, Patch, Options, Head, Method } from './method.decorator';
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

  it('should return a callable decorator that does not throw when applied to a method', () => {
    // Arrange
    const decorator = Get('/test');
    const method = (): void => {};
    const context = { kind: 'method', name: 'findAll' } as ClassMethodDecoratorContext;

    // Act & Assert
    expect(() => decorator(method, context)).not.toThrow();
  });
});

describe('@Method type-level forbidden HTTP methods (compile-time)', () => {
  // 이 spec 의 핵심 가치는 런타임이 아닌 **타입 시스템 레벨** 거부.
  // tsc --noEmit 가 이 파일을 통과한다면 @ts-expect-error 가 정확히 매칭된 것.
  // 매칭 실패 시 'Unused @ts-expect-error' 에러로 빌드 실패 — 이게 type-level 보장.

  it('rejects literal "TRACE" at compile time', () => {
    // @ts-expect-error — TRACE is permanently forbidden (XST risk)
    const _a = Method('TRACE', '/x');
    void _a;
  });

  it('rejects literal "CONNECT" at compile time', () => {
    // @ts-expect-error — CONNECT is for forward proxies, not origin servers
    const _a = Method('CONNECT', '/x');
    void _a;
  });

  it('rejects lowercase "trace" via Uppercase<> (case-insensitive)', () => {
    // @ts-expect-error — Uppercase<'trace'> = 'TRACE' → forbidden
    const _a = Method('trace', '/x');
    void _a;
  });

  it('rejects mixed-case "Trace" via Uppercase<>', () => {
    // @ts-expect-error — Uppercase<'Trace'> = 'TRACE' → forbidden
    const _a = Method('Trace', '/x');
    void _a;
  });

  it('rejects mixed-case "Connect" via Uppercase<>', () => {
    // @ts-expect-error — Uppercase<'Connect'> = 'CONNECT' → forbidden
    const _a = Method('Connect', '/x');
    void _a;
  });

  it('accepts valid custom methods like "PURGE"', () => {
    expect(typeof Method('PURGE', '/cache/:k')).toBe('function');
  });

  it('accepts valid custom methods like "PROPFIND"', () => {
    expect(typeof Method('PROPFIND', '/dav')).toBe('function');
  });

  it('accepts valid custom methods like "LINK"', () => {
    expect(typeof Method('LINK', '/x')).toBe('function');
  });
});
