import { RequestContext } from './async-storage';

export function Trace() {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const original = descriptor.value;
    const methodName = String(propertyKey);

    descriptor.value = function (this: any, ...args: any[]) {
      const className = this?.constructor?.name ?? 'Unknown';
      const qualifiedName = `${className}.${methodName}`;

      return RequestContext.run({ fn: qualifiedName }, () => {
        return original.apply(this, args);
      });
    };
  };
}
