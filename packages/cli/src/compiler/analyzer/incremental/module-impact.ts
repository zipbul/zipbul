import type { FileAnalysis } from '../graph/interfaces';

import { ModuleDiscovery } from '../module-discovery';

export interface ModuleImpact {
  changedModules: Set<string>;
  affectedModules: Set<string>;
}

export function buildModuleImpact(
  fileMap: Map<string, FileAnalysis>,
  moduleFileName: string,
  changedFiles: string[],
): ModuleImpact {
  if (changedFiles.length === 0) {
    return { changedModules: new Set(), affectedModules: new Set() };
  }

  const uniqueChanged = Array.from(new Set(changedFiles));

  uniqueChanged.forEach(file => {
    if (!fileMap.has(file)) {
      throw new Error(`[Zipbul AOT] Changed file not recognized: ${file}`);
    }
  });

  const filePaths = Array.from(fileMap.keys());
  const discovery = new ModuleDiscovery(filePaths, moduleFileName);
  const moduleMap = discovery.discover();
  const orphans = discovery.getOrphans();

  if (orphans.size > 0) {
    throw new Error(`[Zipbul AOT] Orphan files detected: ${Array.from(orphans).join(', ')}`);
  }

  const fileToModule = new Map<string, string>();

  for (const [modulePath, files] of moduleMap.entries()) {
    fileToModule.set(modulePath, modulePath);

    for (const file of files.values()) {
      fileToModule.set(file, modulePath);
    }
  }

  const resolveFile = (rawPath: string): string | null => {
    if (fileMap.has(rawPath)) {
      return rawPath;
    }

    const withTs = `${rawPath}.ts`;

    if (fileMap.has(withTs)) {
      return withTs;
    }

    const withIndex = `${rawPath}/index.ts`;

    if (fileMap.has(withIndex)) {
      return withIndex;
    }

    return null;
  };

  const reverseDeps = new Map<string, Set<string>>();

  for (const analysis of fileMap.values()) {
    const deps = new Set<string>();
    const importEntries = analysis.importEntries ?? [];

    for (const entry of importEntries) {
      if (!entry.isRelative) {
        continue;
      }

      const resolved = resolveFile(entry.resolvedSource);

      if (resolved !== null) {
        deps.add(resolved);
      }
    }

    const reExports = analysis.reExports ?? [];

    for (const entry of reExports) {
      const resolved = resolveFile(entry.module);

      if (resolved !== null) {
        deps.add(resolved);
      }
    }

    for (const dep of deps) {
      const dependents = reverseDeps.get(dep) ?? new Set<string>();

      dependents.add(analysis.filePath);
      reverseDeps.set(dep, dependents);
    }
  }

  const affectedFiles = new Set<string>();
  const queue = [...uniqueChanged];

  for (const file of uniqueChanged) {
    affectedFiles.add(file);
  }

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    const dependents = reverseDeps.get(current);

    if (!dependents) {
      continue;
    }

    for (const dependent of dependents) {
      if (affectedFiles.has(dependent)) {
        continue;
      }

      affectedFiles.add(dependent);
      queue.push(dependent);
    }
  }

  const changedModules = new Set<string>();
  const affectedModules = new Set<string>();

  for (const file of uniqueChanged) {
    const modulePath = fileToModule.get(file);

    if (modulePath) {
      changedModules.add(modulePath);
    }
  }

  for (const file of affectedFiles) {
    const modulePath = fileToModule.get(file);

    if (modulePath) {
      affectedModules.add(modulePath);
    }
  }

  return { changedModules, affectedModules };
}
