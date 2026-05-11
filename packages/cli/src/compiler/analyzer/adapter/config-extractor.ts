import type { FileAnalysis } from '../graph/interfaces';

import { isErr } from '@zipbul/result';
import { AstParser } from '../parser';

/**
 * Collects package entry files referenced by non-relative imports across all file analyses.
 *
 * @param fileMap - Map of file paths to their analysis results.
 * @returns Sorted array of unique entry file paths.
 * @public
 */
export function collectPackageEntryFiles(fileMap: Map<string, FileAnalysis>): string[] {
  const entryFiles = new Set<string>();

  for (const analysis of fileMap.values()) {
    const importEntries = analysis.importEntries ?? [];

    for (const entry of importEntries) {
      if (entry.isRelative) {
        continue;
      }

      const resolved = normalizeTsEntry(entry.resolvedSource);

      if (resolved !== null) {
        entryFiles.add(resolved);

        if (!entry.resolvedSource.endsWith('.ts')) {
          entryFiles.add(`${entry.resolvedSource}/index.ts`);
        }
      }
    }
  }

  return Array.from(entryFiles.values()).sort((a, b) => a.localeCompare(b));
}

/**
 * Normalizes a file path to ensure it ends with `.ts`.
 *
 * @param rawPath - The raw file path.
 * @returns Normalized path ending in `.ts`, or `null` if the path is empty.
 * @public
 */
export function normalizeTsEntry(rawPath: string): string | null {
  if (rawPath.length === 0) {
    return null;
  }

  if (rawPath.endsWith('.ts')) {
    return rawPath;
  }

  return `${rawPath}.ts`;
}

/**
 * Retrieves or parses a file analysis from the file map.
 * If the file is not cached, reads and parses it on demand.
 *
 * @param filePath - The file path to look up.
 * @param fileMap - Map of file paths to their analysis results.
 * @param parser - AST parser instance for on-demand file parsing.
 * @returns The file analysis, or `null` if the file does not exist or fails to parse.
 * @public
 */
export async function getFileAnalysis(filePath: string, fileMap: Map<string, FileAnalysis>, parser: AstParser): Promise<FileAnalysis | null> {
  const cached = fileMap.get(filePath);

  if (cached) {
    return cached;
  }

  const normalizedPath = filePath.endsWith('.ts') ? filePath : filePath + '.ts';
  const normalized = fileMap.get(normalizedPath);

  if (normalized) {
    return normalized;
  }

  if (!(await Bun.file(normalizedPath).exists())) {
    return null;
  }

  const fileContent = await Bun.file(normalizedPath).text();
  const parseResult = await parser.parse(filePath, fileContent);

  if (isErr(parseResult)) {
    return null;
  }

  const analysis: FileAnalysis = {
    filePath,
    classes: parseResult.classes,
    reExports: parseResult.reExports,
    exports: parseResult.exports,
  };

  if (parseResult.defineModuleCalls !== undefined) {
    analysis.defineModuleCalls = parseResult.defineModuleCalls;
  }

  if (parseResult.imports !== undefined) {
    analysis.imports = parseResult.imports;
  }

  if (parseResult.importEntries !== undefined) {
    analysis.importEntries = parseResult.importEntries;
  }

  if (parseResult.exportedValues !== undefined) {
    analysis.exportedValues = parseResult.exportedValues;
  }

  if (parseResult.localValues !== undefined) {
    analysis.localValues = parseResult.localValues;
  }

  if (parseResult.moduleDefinition !== undefined) {
    analysis.moduleDefinition = parseResult.moduleDefinition;
  }

  if (parseResult.enums !== undefined) {
    analysis.enums = parseResult.enums;
  }

  fileMap.set(normalizedPath, analysis);

  return analysis;
}
