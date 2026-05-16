export interface BunFileLike {
  exists(): Promise<boolean>;
  text(): Promise<string>;
}

export interface FileSetup {
  readonly existsByPath: Map<string, boolean>;
  readonly textByPath: Map<string, string>;
}
