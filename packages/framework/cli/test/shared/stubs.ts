import type { BunFileLike, FileSetup } from './interfaces';

export function createBunFileStub(setup: FileSetup, path: string): BunFileLike {
  return {
    exists: async () => setup.existsByPath.get(path) ?? false,
    text: async () => setup.textByPath.get(path) ?? '',
  };
}
