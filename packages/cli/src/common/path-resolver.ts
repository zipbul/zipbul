import { relative, dirname, sep, join } from 'path';

export class PathResolver {
  static getRelativeImportPath(generatedFilePath: string, sourceFilePath: string): string {
    const fromDir = dirname(generatedFilePath);
    let relativePath = relative(fromDir, sourceFilePath);

    if (!relativePath.startsWith('.')) {
      relativePath = `./${relativePath}`;
    }

    return relativePath.replace(/\.(ts|js|jsx)$/, '');
  }

  static normalize(path: string): string {
    return path.split(sep).join('/');
  }
}

/**
 * Computes candidate `.ts` source paths from a `dist/` build output path.
 *
 * When a package's `package.json#exports` points at `./dist/index.js`,
 * `Bun.resolveSync` returns the dist path. The AOT compiler needs the
 * TypeScript source — this helper enumerates the conventional candidate
 * paths (root and `src/`) without performing any filesystem I/O.
 *
 * Returns `null` for paths already pointing at `.ts`/`.d.ts` or for paths
 * that do not contain a `/dist/` segment.
 *
 * @public
 */
export function distToSourceCandidates(resolvedPath: string): readonly string[] | null {
  if (resolvedPath.endsWith('.ts') || resolvedPath.endsWith('.d.ts')) {
    return null;
  }

  const distSegmentIndex = resolvedPath.lastIndexOf('/dist/');

  if (distSegmentIndex === -1) {
    return null;
  }

  const packageRoot = resolvedPath.slice(0, distSegmentIndex);
  const relativePath = resolvedPath.slice(distSegmentIndex + 6).replace(/\.js$/, '.ts');

  return [
    join(packageRoot, relativePath),
    join(packageRoot, 'src', relativePath),
  ];
}
