export { CardKeyError } from './card-key';

export class CardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardValidationError';
  }
}

export class CardNotFoundError extends Error {
  constructor(key: string) {
    super(`Card not found: ${key}`);
    this.name = 'CardNotFoundError';
  }
}

export class CardAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`Card already exists: ${key}`);
    this.name = 'CardAlreadyExistsError';
  }
}

export class CardRenameSamePathError extends Error {
  constructor() {
    super('No-op rename: source and target paths are identical');
    this.name = 'CardRenameSamePathError';
  }
}

export class RelationTypeError extends Error {
  constructor(type: string, allowed: readonly string[]) {
    super(`Invalid relation type "${type}". Allowed: ${allowed.join(', ')}`);
    this.name = 'RelationTypeError';
  }
}
