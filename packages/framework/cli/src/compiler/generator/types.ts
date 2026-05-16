export interface GeneratedBlockParams {
  code: string;
  matcher: RegExp;
  name: string;
}

export interface MetadataRegistryModule {
  metadataRegistry: Map<string, string>;
}

export interface ScopedKeysMapModule {
  scopedKeysMap: Map<string, string>;
}

export interface DeepFreezeModule {
  deepFreeze: (obj: import('../analyzer/types').AnalyzerValue) => import('../analyzer/types').AnalyzerValue;
}
