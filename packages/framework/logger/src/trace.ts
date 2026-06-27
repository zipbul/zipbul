import { RequestContext } from './async-storage';

export function Trace() {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ) {
    const methodName = String(context.name);

    return function (this: This, ...args: Args): Return {
      const className = (this as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown';
      const qualifiedName = `${className}.${methodName}`;

      return RequestContext.run({ fn: qualifiedName }, () => {
        return target.apply(this, args);
      }) as Return;
    };
  };
}
