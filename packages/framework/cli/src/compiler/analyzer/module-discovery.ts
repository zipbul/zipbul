import { basename, dirname, sep } from 'path';

import { compareCodePoint } from '../../common';

export class ModuleDiscovery {
  private moduleMap: Map<string, Set<string>> = new Map();
  private orphanFiles: Set<string> = new Set();

  constructor(
    private filePaths: string[],
    private moduleFileName: string,
  ) {}

  public discover(): Map<string, Set<string>> {
    const modules = this.filePaths.filter(p => basename(p) === this.moduleFileName);
    const sortedModules = [...modules].sort((a, b) => {
      const diff = b.length - a.length;

      if (diff !== 0) {
        return diff;
      }

      return compareCodePoint(a, b);
    });
    const sortedFiles = [...this.filePaths].sort(compareCodePoint);

    this.moduleMap.clear();
    this.orphanFiles.clear();
    sortedModules.forEach(m => this.moduleMap.set(m, new Set()));

    for (const file of sortedFiles) {
      if (basename(file) === this.moduleFileName) {
        continue;
      }

      let assigned = false;
      const fileDir = dirname(file);

      for (const modPath of sortedModules) {
        const modDir = dirname(modPath);

        if (fileDir === modDir || fileDir.startsWith(modDir + sep)) {
          this.moduleMap.get(modPath)?.add(file);

          assigned = true;

          break;
        }
      }

      if (!assigned) {
        this.orphanFiles.add(file);
      }
    }

    return this.moduleMap;
  }

  public getOrphans(): Set<string> {
    return this.orphanFiles;
  }
}
