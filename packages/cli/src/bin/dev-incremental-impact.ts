import type { FileAnalysis } from '../compiler/analyzer/graph/interfaces';
import { ModuleDiscovery } from '../compiler/analyzer/module-discovery';

export interface DevIncrementalImpactLogParams {
  affectedFiles: string[];
  fileCache: Map<string, FileAnalysis>;
  moduleFileName: string;
  toProjectRelativePath: (path: string) => string;
}

export interface DevIncrementalImpactLogResult {
  affectedModules: Set<string>;
  logLine: string;
}

const formatModuleList = (modules: Iterable<string>, toProjectRelativePath: (path: string) => string): string => {
  const rendered = Array.from(modules).map(path => {
    try {
      return toProjectRelativePath(path);
    } catch {
      return path;
    }
  });

  rendered.sort((a, b) => a.localeCompare(b));

  return rendered.length > 0 ? rendered.join(', ') : '(none)';
};

export function buildDevIncrementalImpactLog(params: DevIncrementalImpactLogParams): DevIncrementalImpactLogResult {
  const { affectedFiles, fileCache, moduleFileName, toProjectRelativePath } = params;

  try {
    // Build file→module reverse map via ModuleDiscovery
    const discovery = new ModuleDiscovery(Array.from(fileCache.keys()), moduleFileName);
    const moduleMap = discovery.discover();

    // Invert moduleMap: file → module
    const fileToModule = new Map<string, string>();
    for (const [modulePath, files] of moduleMap) {
      // The module file itself maps to its own module
      fileToModule.set(modulePath, modulePath);
      for (const file of files) {
        fileToModule.set(file, modulePath);
      }
    }

    // Collect affected modules from affected files
    const affectedModules = new Set<string>();
    for (const file of affectedFiles) {
      const mod = fileToModule.get(file);
      if (mod !== undefined) {
        affectedModules.add(mod);
      }
    }

    const affected = formatModuleList(affectedModules, toProjectRelativePath);

    return { affectedModules, logLine: `🧭 증분 영향: 영향=${affected}` };
  } catch (error) {
    const rawReason = error instanceof Error ? error.message : 'Unknown impact error.';
    const reason = rawReason.replaceAll('\n', ' ').trim() || 'Unknown impact error.';

    return { affectedModules: new Set(), logLine: `⚠️ 증분 영향 계산 실패: ${reason}` };
  }
}

