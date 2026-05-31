import { RequestContext } from './async-storage';

export function Trace() {
  return function <This, Args extends unknown[], Return>(
    original: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ): (this: This, ...args: Args) => Return {
    const methodName = String(context.name);

    return function (this: This, ...args: Args): Return {
      const className = (this as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown';
      const qualifiedName = `${className}.${methodName}`;

      return RequestContext.run({ fn: qualifiedName }, () => original.apply(this, args));
    };
  };
}
