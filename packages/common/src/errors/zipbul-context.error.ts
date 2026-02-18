export class ZipbulContextError extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'ZipbulContextError';
  }
}
