import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

import type { ImportRegistryEntry } from './interfaces';

import { PathResolver, compareCodePoint } from '../../common';

export class ImportRegistry {
  private imports = new Map<string, ImportRegistryEntry>();
  private aliases = new Set<string>();
  private fileClassMap = new Map<string, string>();
  /** Resolved package name cache: directory path → package name or null */
  private packageNameCache = new Map<string, string | null>();

  /**
   * @param outputDir - Directory where generated files live (for relative path computation).
   * @param projectSrcDir - The project's source directory. Paths outside this directory
   *   are treated as external dependencies and resolved to package names.
   *   When omitted, all paths use relative resolution.
   */
  constructor(
    private outputDir: string,
    private projectSrcDir?: string,
  ) {}

  public getAlias(className: string, filePath: string): string {
    const key = `${filePath}::${className}`;
    const existing = this.fileClassMap.get(key);

    if (existing !== undefined) {
      return existing;
    }

    let alias = className;
    let counter = 1;

    while (this.aliases.has(alias)) {
      alias = `${className}_${counter++}`;
    }

    this.aliases.add(alias);
    this.fileClassMap.set(key, alias);

    const importPath = this.resolveImportPath(filePath);

    this.imports.set(alias, { path: importPath, alias, originalName: className });

    return alias;
  }

  /**
   * Resolves a file path to an import specifier.
   *
   * - Non-absolute paths (e.g. `@zipbul/common`) pass through as-is.
   * - Absolute paths inside `projectSrcDir` become relative imports.
   * - Absolute paths outside `projectSrcDir` resolve to the nearest package name.
   * - Falls back to relative path if package name resolution fails.
   */
  private resolveImportPath(filePath: string): string {
    // Non-absolute paths (package names, bare specifiers) pass through
    if (!filePath.startsWith('/') && !filePath.startsWith('\\') && !filePath.match(/^[a-zA-Z]:/)) {
      return filePath;
    }

    // If no srcDir specified, use relative path (backward compatible)
    if (this.projectSrcDir === undefined) {
      return PathResolver.getRelativeImportPath(this.outputDir + '/dummy.ts', filePath);
    }

    // Path inside project source → relative import
    if (filePath.startsWith(this.projectSrcDir)) {
      return PathResolver.getRelativeImportPath(this.outputDir + '/dummy.ts', filePath);
    }

    // Path in node_modules → resolve to package name
    if (filePath.includes('/node_modules/')) {
      const packageName = this.resolvePackageName(filePath);

      if (packageName !== null) {
        return packageName;
      }
    }

    // Workspace package source or other external paths → relative import (deep import)
    return PathResolver.getRelativeImportPath(this.outputDir + '/dummy.ts', filePath);
  }

  /**
   * Walks up from a file path to find the nearest package.json and returns its name.
   * Results are cached per directory.
   */
  private resolvePackageName(filePath: string): string | null {
    let dir = dirname(filePath);

    for (let depth = 0; depth < 15; depth++) {
      const cached = this.packageNameCache.get(dir);

      if (cached !== undefined) {
        return cached;
      }

      const packageJsonPath = join(dir, 'package.json');

      if (existsSync(packageJsonPath)) {
        try {
          const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

          if (typeof content.name === 'string' && content.name.length > 0) {
            this.packageNameCache.set(dir, content.name);
            return content.name;
          }
        } catch {
          // Malformed package.json — skip
        }
      }

      const parentDir = dirname(dir);

      if (parentDir === dir) break;

      dir = parentDir;
    }

    this.packageNameCache.set(dirname(filePath), null);
    return null;
  }

  public addImport(name: string, filePath: string): string {
    return this.getAlias(name, filePath);
  }

  public getImportStatements(): string[] {
    const sorted = Array.from(this.imports.values()).sort((a, b) => {
      const pathDiff = compareCodePoint(a.path, b.path);

      if (pathDiff !== 0) {
        return pathDiff;
      }

      const nameDiff = compareCodePoint(a.originalName, b.originalName);

      if (nameDiff !== 0) {
        return nameDiff;
      }

      return compareCodePoint(a.alias, b.alias);
    });

    return sorted.map(info => {
      if (info.alias === info.originalName) {
        return `import { ${info.originalName} } from "${info.path}";`;
      }

      return `import { ${info.originalName} as ${info.alias} } from "${info.path}";`;
    });
  }
}
