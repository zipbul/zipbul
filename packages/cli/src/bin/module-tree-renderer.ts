import { dirname } from 'path';

import type { ModuleNode } from '../compiler/analyzer/graph/module-node';
import type { PathEntry } from './interfaces';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Locale-formatted integer (e.g. `1,234`).
 *
 * @param value - Number to format
 * @returns Formatted string
 *
 * @public
 */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Naive English pluralizer — appends `s` when {@link count} is not `1`.
 *
 * @param count - Item count
 * @param singular - Singular noun
 * @returns `"<count> <noun>[s]"`
 *
 * @public
 */
export function pluralize(count: number, singular: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : singular + 's'}`;
}

// ---------------------------------------------------------------------------
// Module tree types
// ---------------------------------------------------------------------------

export interface ModuleTreeInput {
  modules: ReadonlyMap<string, ModuleNode>;
  handlerIndex: readonly { id: string }[];
}

export interface ModuleTreeResult {
  treeLines: PathEntry[];
  handlersByController: ReadonlyMap<string, number>;
  scopeCounts: { singleton: number; request: number; transient: number };
  adapterIds: ReadonlySet<string>;
}

export interface ModuleTreeOptions {
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

/**
 * Builds a directory-based module tree with per-module statistics, scope
 * counts, adapter ids, and an optional verbose expansion of providers.
 *
 * @param input - Module graph and handler index
 * @param options - Optional flags (e.g. verbose expansion)
 * @returns Pre-computed tree lines and aggregate statistics
 *
 * @public
 */
export function buildModuleTree(input: ModuleTreeInput, options?: ModuleTreeOptions): ModuleTreeResult {
  const { modules, handlerIndex } = input;
  const verbose = options?.verbose === true;

  // ── Handlers per controller ──
  const handlersByController = new Map<string, number>();

  for (const handler of handlerIndex) {
    const hashIndex = handler.id.indexOf('#');

    if (hashIndex !== -1) {
      const className = handler.id.slice(hashIndex + 1).split('.')[0];
      if (className !== undefined) {
        handlersByController.set(className, (handlersByController.get(className) ?? 0) + 1);
      }
    }
  }

  // ── Scope counts ──
  const scopeCounts = { singleton: 0, request: 0, transient: 0 };

  for (const mod of modules.values()) {
    for (const provider of mod.providers.values()) {
      scopeCounts[provider.scope ?? 'singleton']++;
    }
  }

  // ── Adapter ids ──
  const adapterIds = new Set<string>();

  for (const handler of handlerIndex) {
    adapterIds.add(handler.id.slice(0, handler.id.indexOf(':')));
  }

  // ── Module stats helper ──
  const buildModuleStats = (mod: ModuleNode): string => {
    const parts: string[] = [];

    if (mod.providers.size > 0) {
      parts.push(pluralize(mod.providers.size, 'provider'));
    }

    if (mod.controllers.size > 0) {
      let totalHandlers = 0;

      for (const ctrl of mod.controllers) {
        totalHandlers += handlersByController.get(ctrl) ?? 0;
      }

      parts.push(pluralize(mod.controllers.size, 'controller'));

      if (totalHandlers > 0) {
        parts.push(pluralize(totalHandlers, 'handler'));
      }
    }

    return parts.join(', ');
  };

  // ── Build parent-child map from directory containment ──
  const moduleEntries = Array.from(modules.entries())
    .map(([path, mod]) => ({ path, dir: dirname(path), mod }))
    .sort((entryA, entryB) => entryA.dir.length - entryB.dir.length);

  const childrenOf = new Map<string, ModuleNode[]>();

  for (const entry of moduleEntries) {
    childrenOf.set(entry.path, []);
  }

  for (let index = 1; index < moduleEntries.length; index++) {
    const entry = moduleEntries[index];
    if (entry === undefined) continue;
    let parentPath: string | undefined;

    for (let parentIndex = index - 1; parentIndex >= 0; parentIndex--) {
      const candidate = moduleEntries[parentIndex];
      if (candidate === undefined) continue;

      if (entry.dir.startsWith(candidate.dir + '/') || entry.dir === candidate.dir) {
        parentPath = candidate.path;
        break;
      }
    }

    if (parentPath !== undefined) {
      childrenOf.get(parentPath)?.push(entry.mod);
    }
  }

  // ── Walk tree ──
  const treeLines: PathEntry[] = [];

  const walkTree = (mod: ModuleNode, modPath: string, prefix: string, isLast: boolean, isRoot: boolean): void => {
    const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
    const stats = buildModuleStats(mod);
    const label = `${prefix}${connector}${mod.name}`;
    treeLines.push({ label, value: stats });

    const children = (childrenOf.get(modPath) ?? [])
      .sort((childA, childB) => childA.name.localeCompare(childB.name));
    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

    children.forEach((child, childIndex) => {
      walkTree(child, child.filePath, childPrefix, childIndex === children.length - 1, false);
    });
  };

  const root = moduleEntries[0];
  if (root !== undefined) {
    walkTree(root.mod, root.path, '', true, true);
  }

  // ── Summary parts ──
  const scopeParts = Object.entries(scopeCounts)
    .filter(([, count]) => count > 0)
    .map(([scope, count]) => `${formatCount(count)} ${scope}`);

  const adapterParts = Array.from(adapterIds)
    .sort()
    .map(id => `${id} (${formatCount(handlerIndex.filter(h => h.id.startsWith(id + ':')).length)} handlers)`);

  const summaryParts: string[] = [];

  if (scopeParts.length > 0) {
    summaryParts.push(`💉 ${scopeParts.join(', ')}`);
  }

  if (adapterParts.length > 0) {
    summaryParts.push(`🔌 ${adapterParts.join(', ')}`);
  }

  // ── Verbose expansion (build-only) ──
  if (verbose) {
    const verboseLines: PathEntry[] = [...treeLines];

    verboseLines.push({ label: '', value: '' });

    for (const mod of modules.values()) {
      if (mod.providers.size === 0 && mod.controllers.size === 0) {
        continue;
      }

      const items: PathEntry[] = [];

      for (const [token, provider] of [...mod.providers.entries()].sort(([tokenA], [tokenB]) => tokenA.localeCompare(tokenB))) {
        items.push({ label: `  ${token}`, value: provider.scope ?? 'singleton' });
      }

      for (const ctrl of [...mod.controllers].sort()) {
        const count = handlersByController.get(ctrl) ?? 0;
        items.push({ label: `  ${ctrl}`, value: count > 0 ? pluralize(count, 'handler') : 'controller' });
      }

      verboseLines.push({ label: `${mod.name}`, value: '' });
      verboseLines.push(...items);
    }

    if (summaryParts.length > 0) {
      verboseLines.push({ label: '', value: '' });
      verboseLines.push({ label: summaryParts.join(' · '), value: '' });
    }

    return { treeLines: verboseLines, handlersByController, scopeCounts, adapterIds };
  }

  if (summaryParts.length > 0) {
    treeLines.push({ label: '', value: '' });
    treeLines.push({ label: summaryParts.join(' · '), value: '' });
  }

  return { treeLines, handlersByController, scopeCounts, adapterIds };
}
