import { Glob } from 'bun';
import { join, resolve, dirname } from 'path';

import type { CollectedClass, CliRendererLike } from '../interfaces';

import { isErr } from '@zipbul/result';
import type { AstParser, FileAnalysis } from '../../compiler/analyzer';
import { compareCodePoint } from '../../common';
import { buildDiagnostic, DiagnosticError } from '../../diagnostics';
import { buildFileAnalysis } from './build-analysis';

// ---------------------------------------------------------------------------
// dist -> source resolution
// ---------------------------------------------------------------------------

/**
 * Maps a dist/ build output path back to the original TypeScript source.
 *
 * When a package.json `exports` field points to `./dist/index.js`,
 * `Bun.resolveSync` returns the dist path. The AOT compiler needs
 * the TypeScript source, so we check the package root and `src/`
 * for a matching `.ts` file.
 */
async function resolveDistToSource(resolvedPath: string): Promise<string | null> {
  const distSegmentIndex = resolvedPath.lastIndexOf('/dist/');

  if (distSegmentIndex === -1) {
    return null;
  }

  const packageRoot = resolvedPath.slice(0, distSegmentIndex);
  const relative = resolvedPath.slice(distSegmentIndex + 6).replace(/\.js$/, '.ts');

  const rootCandidate = join(packageRoot, relative);

  if (await Bun.file(rootCandidate).exists()) {
    return rootCandidate;
  }

  const srcCandidate = join(packageRoot, 'src', relative);

  if (await Bun.file(srcCandidate).exists()) {
    return srcCandidate;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Scan result
// ---------------------------------------------------------------------------

export interface ScanResult {
  fileMap: Map<string, FileAnalysis>;
  allClasses: CollectedClass[];
}

// ---------------------------------------------------------------------------
// Scan parameters
// ---------------------------------------------------------------------------

export interface ScanParams {
  projectRoot: string;
  srcDir: string;
  entry: string;
  parser: AstParser;
  scanFiles: (options: { glob: Glob; baseDir: string }) => Promise<string[]>;
  resolveImport: (specifier: string, fromDir: string) => string;
  renderer: CliRendererLike;
}

// ---------------------------------------------------------------------------
// File scanner
// ---------------------------------------------------------------------------

/**
 * Scans source files starting from the entry point, follows imports via BFS,
 * parses each file, and collects analysis results and class metadata.
 *
 * @param params - Scan configuration
 * @returns Collected file analyses, content hashes, classes, and cache stats
 *
 * @public
 */
export async function scanAndParseFiles(params: ScanParams): Promise<ScanResult> {
  const {
    projectRoot,
    srcDir,
    entry,
    parser,
    scanFiles,
    resolveImport,
    renderer,
  } = params;

  const fileMap = new Map<string, FileAnalysis>();
  const allClasses: CollectedClass[] = [];

  const userMain = resolve(projectRoot, entry);
  const visited = new Set<string>();
  const queue: string[] = [userMain];
  const glob = new Glob('**/*.ts');
  const srcFiles = await scanFiles({ glob, baseDir: srcDir });

  for (const file of srcFiles) {
    const fullPath = join(srcDir, file);

    if (fullPath !== userMain) {
      queue.push(fullPath);
    }
  }

  async function enqueueImports(
    imports: Record<string, string> | undefined,
    reExports: readonly { module: string }[],
    fromFilePath: string,
  ): Promise<void> {
    const pathsToFollow = new Set<string>();

    if (imports !== undefined) {
      Object.values(imports).forEach(p => pathsToFollow.add(p));
    }

    if (reExports.length > 0) {
      reExports.forEach(re => pathsToFollow.add(re.module));
    }

    const orderedPaths = Array.from(pathsToFollow).sort(compareCodePoint);

    for (const rawImportPath of orderedPaths) {
      let resolvedPath = rawImportPath;

      if (!resolvedPath.startsWith('/') && !resolvedPath.match(/^[a-zA-Z]:/)) {
        try {
          resolvedPath = resolveImport(resolvedPath, dirname(fromFilePath));
        } catch {
          if (rawImportPath.startsWith('.') || rawImportPath.startsWith('/')) {
            renderer.warn(`Could not resolve import '${rawImportPath}' in '${fromFilePath}'`);
          }

          continue;
        }
      }

      if (resolvedPath && !resolvedPath.endsWith('.ts') && !resolvedPath.endsWith('.d.ts')) {
        if (await Bun.file(resolvedPath + '.ts').exists()) {
          resolvedPath += '.ts';
        } else if (await Bun.file(resolvedPath + '/index.ts').exists()) {
          resolvedPath += '/index.ts';
        } else {
          const sourceCandidate = await resolveDistToSource(resolvedPath);

          if (sourceCandidate !== null) {
            resolvedPath = sourceCandidate;
          }
        }
      }

      if (resolvedPath && !visited.has(resolvedPath) && !resolvedPath.endsWith('.d.ts') && resolvedPath.endsWith('.ts')) {
        const normalizedPath = resolvedPath.replaceAll('\\', '/');

        if (!normalizedPath.includes('/node_modules/')) {
          queue.push(resolvedPath);
        }
      }
    }
  }

  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const filePath = queue[queueIndex] as string;
    queueIndex++;

    if (visited.has(filePath)) {
      continue;
    }

    visited.add(filePath);

    if (!filePath.endsWith('.ts')) {
      continue;
    }

    if (filePath.endsWith('.d.ts')) {
      continue;
    }

    try {
      const fileContent = await Bun.file(filePath).text();

      const parseResult = await parser.parse(filePath, fileContent);

      if (isErr(parseResult)) {
        throw new DiagnosticError(parseResult.data);
      }

      const classInfos = parseResult.classes.map(meta => ({ metadata: meta, filePath }));

      allClasses.push(...classInfos);

      const analysis = buildFileAnalysis(filePath, parseResult);

      fileMap.set(filePath, analysis);

      await enqueueImports(parseResult.imports, parseResult.reExports, filePath);
    } catch (error) {
      if (error instanceof DiagnosticError) {
        throw error;
      }

      const reason = error instanceof Error ? error.message : 'Unknown parse error.';

      throw new DiagnosticError(
        buildDiagnostic({ reason, file: filePath }),
        { cause: error },
      );
    }
  }

  return { fileMap, allClasses };
}
