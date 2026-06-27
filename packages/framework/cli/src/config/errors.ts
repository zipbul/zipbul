export class ConfigLoadError extends Error {
  public readonly sourcePath?: string;

  constructor(message: string, sourcePath?: string) {
    super(message);

    this.name = 'ConfigLoadError';

    if (sourcePath !== undefined) {
      this.sourcePath = sourcePath;
    }
  }
}
