import type { HttpMethodDecoratorOptions } from './interfaces';

export const Get =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Post =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Put =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Delete =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Patch =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Options =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
export const Head =
  (_pathOrOptions?: string | HttpMethodDecoratorOptions): MethodDecorator =>
  () => {};
