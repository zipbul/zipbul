import { describe, expect, it } from 'bun:test';

import { Logger } from './logger';
import { RequestContext } from './async-storage';
import { TestTransport } from './transports/test';
import { Trace } from './trace';

describe('Trace', () => {
  const setup = (): TestTransport => {
    const transport = new TestTransport();

    Logger.configure({ level: 'trace', transports: [transport] });

    return transport;
  };

  it('should set fn to ClassName.methodName in ALS', () => {
    // Arrange
    const transport = setup();

    class MyService {
      private logger = new Logger(this);

      @Trace()
      doWork() {
        this.logger.info('inside');
      }
    }

    const svc = new MyService();

    // Act
    svc.doWork();

    // Assert
    expect(transport.messages[0]!.fn).toBe('MyService.doWork');
  });

  it('should pass through arguments to original method', () => {
    // Arrange
    setup();
    let receivedArgs: unknown[] = [];

    class Svc {
      @Trace()
      work(a: number, b: string) {
        receivedArgs = [a, b];
      }
    }

    const svc = new Svc();

    // Act
    svc.work(42, 'hello');

    // Assert
    expect(receivedArgs).toEqual([42, 'hello']);
  });

  it('should preserve return value of original method', () => {
    // Arrange
    setup();

    class Svc {
      @Trace()
      compute() {
        return 99;
      }
    }

    const svc = new Svc();

    // Act
    const result = svc.compute();

    // Assert
    expect(result).toBe(99);
  });

  it('should preserve this context', () => {
    // Arrange
    setup();

    class Svc {
      value = 'secret';

      @Trace()
      getValue() {
        return this.value;
      }
    }

    const svc = new Svc();

    // Act
    const result = svc.getValue();

    // Assert
    expect(result).toBe('secret');
  });

  it('should work with async methods', async () => {
    // Arrange
    const transport = setup();

    class Svc {
      private logger = new Logger(this);

      @Trace()
      async process() {
        await Promise.resolve();
        this.logger.info('async-done');

        return 'ok';
      }
    }

    const svc = new Svc();

    // Act
    const result = await svc.process();

    // Assert
    expect(result).toBe('ok');
    expect(transport.messages[0]!.fn).toBe('Svc.process');
  });

  it('should use Unknown when this has no constructor', () => {
    // Arrange
    setup();

    class Svc {
      @Trace()
      doWork() {
        const ctx = RequestContext.getContext();

        return ctx?.fn;
      }
    }

    const svc = new Svc();
    const fn = svc.doWork.bind(Object.create(null));

    // Act
    const result = fn();

    // Assert
    expect(result).toBe('Unknown.doWork');
  });

  it('nested @Trace should set innermost fn', () => {
    // Arrange
    const transport = setup();

    class Outer {
      private logger = new Logger(this);

      @Trace()
      run(inner: Inner) {
        this.logger.info('outer-log');
        inner.work();
        this.logger.info('outer-after');
      }
    }

    class Inner {
      private logger = new Logger(this);

      @Trace()
      work() {
        this.logger.info('inner-log');
      }
    }

    const outer = new Outer();
    const inner = new Inner();

    // Act
    outer.run(inner);

    // Assert
    expect(transport.messages[0]!.fn).toBe('Outer.run');
    expect(transport.messages[1]!.fn).toBe('Inner.work');
    expect(transport.messages[2]!.fn).toBe('Outer.run');
  });

  it('concurrent Trace calls should have isolated fn values', async () => {
    // Arrange
    const transport = setup();

    class Svc {
      private logger = new Logger(this);

      @Trace()
      async slow() {
        await new Promise(r => setTimeout(r, 20));
        this.logger.info('slow-done');
      }

      @Trace()
      async fast() {
        await new Promise(r => setTimeout(r, 5));
        this.logger.info('fast-done');
      }
    }

    const svc = new Svc();

    // Act
    await Promise.all([svc.slow(), svc.fast()]);

    // Assert
    const slowMsg = transport.messages.find(m => m.msg === 'slow-done')!;
    const fastMsg = transport.messages.find(m => m.msg === 'fast-done')!;

    expect(slowMsg.fn).toBe('Svc.slow');
    expect(fastMsg.fn).toBe('Svc.fast');
  });
});
