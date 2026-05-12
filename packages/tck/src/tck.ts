import { TestApplication, type TckApplicationOptions } from './test-application';

export class Tck {
  private constructor() {}

  static createApplication(opts: TckApplicationOptions): Promise<TestApplication> {
    return TestApplication.create(opts);
  }
}
