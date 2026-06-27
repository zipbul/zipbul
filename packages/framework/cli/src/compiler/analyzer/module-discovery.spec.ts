import { describe, expect, it } from 'bun:test';

// MUST: MUST-3 (defineModule validation)

import { ModuleDiscovery } from './module-discovery';

describe('ModuleDiscovery', () => {
  it('should assign files to the closest module directory when nested modules exist', () => {
    const files = [
      '/app/src/__module__.ts',
      '/app/src/a/__module__.ts',
      '/app/src/a/service.ts',
      '/app/src/a/sub/feature.ts',
      '/app/src/root.ts',
    ];
    const discovery = new ModuleDiscovery(files, '__module__.ts');
    const result = discovery.discover();
    const rootModuleFiles = result.get('/app/src/__module__.ts');
    const aModuleFiles = result.get('/app/src/a/__module__.ts');

    expect(rootModuleFiles ? Array.from(rootModuleFiles.values()).sort() : []).toEqual(['/app/src/root.ts']);
    expect(aModuleFiles ? Array.from(aModuleFiles.values()).sort() : []).toEqual([
      '/app/src/a/service.ts',
      '/app/src/a/sub/feature.ts',
    ]);
  });

  it('should track orphan files when files are outside any module directory', () => {
    const files = ['/app/src/__module__.ts', '/app/other.ts'];
    const discovery = new ModuleDiscovery(files, '__module__.ts');

    discovery.discover();

    const orphans = Array.from(discovery.getOrphans().values());

    expect(orphans).toEqual(['/app/other.ts']);
  });

  it('should handle nested modules correctly when multiple module roots exist', () => {
    const files = [
      '/app/src/__module__.ts',
      '/app/src/features/__module__.ts',
      '/app/src/features/users/__module__.ts',
      '/app/src/features/users/user.service.ts',
      '/app/src/features/shared.ts',
      '/app/src/app.ts',
    ];
    const discovery = new ModuleDiscovery(files, '__module__.ts');
    const result = discovery.discover();
    const rootModuleFiles = result.get('/app/src/__module__.ts');
    const featuresModuleFiles = result.get('/app/src/features/__module__.ts');
    const usersModuleFiles = result.get('/app/src/features/users/__module__.ts');

    expect(rootModuleFiles ? Array.from(rootModuleFiles.values()).sort() : []).toEqual(['/app/src/app.ts']);
    expect(featuresModuleFiles ? Array.from(featuresModuleFiles.values()).sort() : []).toEqual(['/app/src/features/shared.ts']);
    expect(usersModuleFiles ? Array.from(usersModuleFiles.values()).sort() : []).toEqual(['/app/src/features/users/user.service.ts']);
  });

  it('should prioritize deeper module when a file matches multiple modules', () => {
    const files = [
      '/app/src/__module__.ts',
      '/app/src/features/__module__.ts',
      '/app/src/features/service.ts',
    ];
    const discovery = new ModuleDiscovery(files, '__module__.ts');
    const result = discovery.discover();
    const rootModuleFiles = result.get('/app/src/__module__.ts');
    const featuresModuleFiles = result.get('/app/src/features/__module__.ts');

    expect(rootModuleFiles ? Array.from(rootModuleFiles.values()) : []).toEqual([]);
    expect(featuresModuleFiles ? Array.from(featuresModuleFiles.values()) : []).toEqual(['/app/src/features/service.ts']);
  });

  it('should handle empty file list when no files are provided', () => {
    const files: string[] = [];
    const discovery = new ModuleDiscovery(files, '__module__.ts');
    const result = discovery.discover();

    expect(result.size).toBe(0);
    expect(discovery.getOrphans().size).toBe(0);
  });

  it('should handle only module files when no non-module files exist', () => {
    const files = [
      '/app/src/__module__.ts',
      '/app/src/features/__module__.ts',
    ];
    const discovery = new ModuleDiscovery(files, '__module__.ts');
    const result = discovery.discover();

    expect(result.size).toBe(2);
    expect(Array.from(result.get('/app/src/__module__.ts')?.values() ?? [])).toEqual([]);
    expect(Array.from(result.get('/app/src/features/__module__.ts')?.values() ?? [])).toEqual([]);
    expect(discovery.getOrphans().size).toBe(0);
  });

  it('should correctly assign files when modules have similar paths', () => {
    const files = [
      '/app/src/mod/__module__.ts',
      '/app/src/module/__module__.ts',
      '/app/src/mod/service.ts',
      '/app/src/module/service.ts',
    ];
    const discovery = new ModuleDiscovery(files, '__module__.ts');
    const result = discovery.discover();
    const modModuleFiles = result.get('/app/src/mod/__module__.ts');
    const moduleModuleFiles = result.get('/app/src/module/__module__.ts');

    expect(modModuleFiles ? Array.from(modModuleFiles.values()) : []).toEqual(['/app/src/mod/service.ts']);
    expect(moduleModuleFiles ? Array.from(moduleModuleFiles.values()) : []).toEqual(['/app/src/module/service.ts']);
  });
});