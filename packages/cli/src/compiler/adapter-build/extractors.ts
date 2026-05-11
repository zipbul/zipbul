import { extractRelations } from '@zipbul/gildash';
import type { CodeRelation, ExpressionValue, ExtractedSymbol } from '@zipbul/gildash';

import { buildCalleeResolver } from '../define-call-shape';

import { diag } from './diag';
import {
  ensureUnique,
  readIdentifierArray,
  readIdentifierField,
  readPipelineField,
} from './parse-helpers';
import { findDefineAdapterCall, relativeFromRoot, type SourceFile, type SourceTree } from './source-tree';
import type {
  AdapterConstructorSchema,
  ContextMethodSignature,
  ContextNamespaceProperty,
  ContextNamespacesSchema,
  DecoratorSchema,
  PeerContract,
  PipelineSchema,
} from './interfaces';

export interface ExtractedAdapterDefinition {
  readonly adapterId: string;
  readonly contextType: string;
  /**
   * Pipeline schema *before* enum-member resolution. The `phaseMembers` /
   * `stepMembers` fields are filled later in the build flow once the source
   * tree has been walked (`resolveEnumMembers`).
   */
  readonly pipelineSchema: Omit<PipelineSchema, 'phaseMembers' | 'stepMembers'>;
  /** Identifier names from `defineAdapter({ provides: [...] })`, or empty when omitted. */
  readonly providesIdents: readonly string[];
}

export function extractAdapterDefinition(entry: SourceFile): ExtractedAdapterDefinition {
  const found = findDefineAdapterCall(entry.symbols, entry);

  if (found === null) {
    throw diag({
      reason: `No \`defineAdapter()\` export found in ${entry.filePath}.`,
      file: entry.filePath,
    });
  }

  const { call: adapterCall, symbol } = found;

  // Anchor downstream diagnostics at the defineAdapter() call site, using
  // gildash's pre-resolved span (line/column) on the variable symbol.
  const posCtx = { position: { line: symbol.span.start.line, column: symbol.span.start.column } };

  const adapterId = readIdentifierField(adapterCall, 'adapter');

  if (adapterId === null) {
    throw diag({
      reason: `defineAdapter() must receive a config object whose \`adapter\` field is a class identifier reference.`,
      file: entry.filePath,
      ...posCtx,
    });
  }

  const phaseEnum = readIdentifierField(adapterCall, 'phase');
  const stepEnum = readIdentifierField(adapterCall, 'step');
  const contextType = readIdentifierField(adapterCall, 'context');

  if (phaseEnum === null || stepEnum === null) {
    throw diag({
      reason: `defineAdapter() must declare \`phase\` and \`step\` fields as enum identifier references.`,
      file: entry.filePath,
      ...posCtx,
    });
  }

  if (contextType === null) {
    throw diag({
      reason: `defineAdapter() must declare \`context\` field as a Context class identifier reference.`,
      file: entry.filePath,
      ...posCtx,
    });
  }

  const pipeline = readPipelineField(adapterCall);

  if (pipeline === null) {
    throw diag({
      reason: `defineAdapter() must declare a non-empty \`pipeline\` array of qualified enum members (e.g. \`HttpPhase.OnRequest\`, \`HttpStep.ResolveRoute\`, \`CoreStep.Handler\`).`,
      file: entry.filePath,
      ...posCtx,
    });
  }

  const providesIdents = readProvidesField(adapterCall, entry.filePath);

  return {
    adapterId,
    contextType,
    pipelineSchema: {
      $schemaName: 'adapter.pipeline-schema',
      phaseEnum,
      stepEnum,
      pipeline,
    },
    providesIdents,
  };
}

function readProvidesField(call: import('@zipbul/gildash').ExpressionCall, filePath: string): readonly string[] {
  const firstArg = call.arguments[0];
  if (firstArg === undefined || firstArg.kind !== 'object') return [];

  for (const prop of firstArg.properties) {
    if (prop.kind === 'spread') continue;
    if (prop.key.kind !== 'string' || prop.key.value !== 'provides') continue;

    if (prop.value.kind !== 'array') {
      throw diag({
        reason: `defineAdapter({ provides }) must be an array literal of identifier references when present.`,
        file: filePath,
      });
    }

    const out: string[] = [];

    for (let i = 0; i < prop.value.elements.length; i += 1) {
      const element = prop.value.elements[i]!;
      if (element.kind !== 'identifier') {
        throw diag({
          reason: `defineAdapter({ provides }) element [${i}] must be an identifier reference (e.g. a ContextKey class), got ${element.kind}.`,
          file: filePath,
          how: 'Pass identifiers directly: `provides: [SomeContextKey, AnotherKey]`. Spreads, calls, and literals are not supported.',
        });
      }
      out.push(element.name);
    }

    return out;
  }

  return [];
}

/**
 * Validates Adapter / Context class exports.
 * - Adapter class must be exported (so user app can `new` it).
 * - Context class must be exported (declaration merging target).
 * - A package may declare exactly one Adapter class.
 */
export function validateClassExports(tree: SourceTree, extracted: ExtractedAdapterDefinition, packageRoot: string): void {
  const { adapterId, contextType } = extracted;

  let adapterFound: { exported: boolean; count: number } = { exported: false, count: 0 };
  let contextFound: { exported: boolean } = { exported: false };

  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class') continue;

      if (symbol.name === adapterId) {
        adapterFound = { exported: adapterFound.exported || symbol.isExported, count: adapterFound.count + 1 };
      }

      if (symbol.name === contextType) {
        contextFound = { exported: contextFound.exported || symbol.isExported };
      }
    }
  }

  if (adapterFound.count === 0) {
    throw diag({
      reason: `Adapter class \`${adapterId}\` not declared anywhere under ${packageRoot}/src/.`,
      file: packageRoot,
    });
  }

  if (adapterFound.count > 1) {
    throw diag({
      reason: `Adapter class \`${adapterId}\` declared ${adapterFound.count} times under ${packageRoot}/src/. Only one declaration is allowed.`,
      file: packageRoot,
    });
  }

  if (!adapterFound.exported) {
    throw diag({
      reason: `Adapter class \`${adapterId}\` must be exported from the adapter package so user apps can instantiate it.`,
      file: packageRoot,
    });
  }

  if (!contextFound.exported) {
    throw diag({
      reason: `Context class \`${contextType}\` must be exported from the adapter package so declaration-merging consumers can reference it.`,
      file: packageRoot,
    });
  }
}

/**
 * Validates the pipeline against the imported phase/step enums.
 *
 * - Every `pipeline[i].qualifier` must be the `phase`/`step` enum identifier
 *   passed to `defineAdapter()`, OR a known external consumer-rank qualifier
 *   (currently only `CoreStep`).
 * - For locally-resolvable enums, each `pipeline[i].name` must be a member.
 * - Pipeline must contain exactly one `CoreStep.Handler`.
 * - Phase / step enum members must be uniquely named.
 */
export function validatePipeline(tree: SourceTree, extracted: ExtractedAdapterDefinition, entryFilePath: string): void {
  const { phaseEnum, stepEnum, pipeline } = extracted.pipelineSchema;

  const phaseMembers = resolveEnumMembers(tree, phaseEnum);
  const stepMembers = resolveEnumMembers(tree, stepEnum);

  let handlerCount = 0;

  for (let index = 0; index < pipeline.length; index += 1) {
    const ref = pipeline[index]!;

    if (ref.qualifier === 'CoreStep' && ref.name === 'Handler') {
      handlerCount += 1;
      continue;
    }

    if (ref.qualifier === phaseEnum) {
      if (phaseMembers !== null && !phaseMembers.has(ref.name)) {
        throw diag({
          reason: `pipeline[${index}] = \`${ref.qualifier}.${ref.name}\` — \`${ref.name}\` is not a member of \`${phaseEnum}\`. Members: [${[...phaseMembers].sort().join(', ')}].`,
          file: entryFilePath,
        });
      }
      continue;
    }

    if (ref.qualifier === stepEnum) {
      if (stepMembers !== null && !stepMembers.has(ref.name)) {
        throw diag({
          reason: `pipeline[${index}] = \`${ref.qualifier}.${ref.name}\` — \`${ref.name}\` is not a member of \`${stepEnum}\`. Members: [${[...stepMembers].sort().join(', ')}].`,
          file: entryFilePath,
        });
      }
      continue;
    }

    if (ref.qualifier === 'CoreStep') {
      // Other CoreStep members are accepted without local resolution —
      // `@zipbul/core` is external and trusted.
      continue;
    }

    throw diag({
      reason: `pipeline[${index}] = \`${ref.qualifier}.${ref.name}\` — qualifier \`${ref.qualifier}\` is not the configured \`phase\` (\`${phaseEnum}\`) or \`step\` (\`${stepEnum}\`) enum, nor \`CoreStep\`.`,
      file: entryFilePath,
    });
  }

  if (handlerCount !== 1) {
    throw diag({
      reason: `pipeline must contain exactly one consumer-rank step (\`CoreStep.Handler\`) — found ${handlerCount}.`,
      file: entryFilePath,
    });
  }
}

/**
 * Resolves an enum's member name set from the source tree, returning `null`
 * when the enum is declared outside the package (external import — trusted).
 *
 * Supports both `enum Foo { A, B }` and `const Foo = { A: 'A' } as const`.
 * Detects duplicate member declarations at the raw-key level — TS rejects
 * duplicate enum members at compile time, but const-object idioms can slip
 * duplicates through.
 */
export function resolveEnumMembers(tree: SourceTree, enumName: string): ReadonlySet<string> | null {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.name !== enumName) continue;

      if (symbol.kind === 'enum') {
        const members = new Set<string>();
        const dupes = new Set<string>();
        for (const member of symbol.members ?? []) {
          if (typeof member.name === 'string' && member.name.length > 0) {
            if (members.has(member.name)) dupes.add(member.name);
            members.add(member.name);
          }
        }
        if (dupes.size > 0) {
          throw diag({
            reason: `enum \`${enumName}\` has duplicate member name(s): [${[...dupes].join(', ')}].`,
            file: file.filePath,
          });
        }
        return members;
      }

      if (symbol.kind === 'variable' && symbol.initializer !== undefined && symbol.initializer.kind === 'object') {
        const members = new Set<string>();
        const dupes = new Set<string>();
        for (const prop of symbol.initializer.properties) {
          if (prop.kind === 'spread') continue;
          if (prop.key.kind === 'string') {
            if (members.has(prop.key.value)) dupes.add(prop.key.value);
            members.add(prop.key.value);
          }
        }
        if (dupes.size > 0) {
          throw diag({
            reason: `const enum-object \`${enumName}\` has duplicate key(s): [${[...dupes].join(', ')}].`,
            file: file.filePath,
          });
        }
        return members;
      }
    }
  }

  return null;
}

/**
 * Builds `dist/peer-contract.json` from:
 * 1. The adapter class's `clusterStrategy` instance property (default: Shared).
 * 2. `defineAdapter({ provides })` field — already extracted into `providesIdents`.
 * 3. Source-tree-wide imports from `@zipbul/core` and `@zipbul/common` —
 *    the entire set of peer symbols the adapter actually uses.
 */
export function extractPeerContract(
  tree: SourceTree,
  adapterId: string,
  providesIdents: readonly string[],
  packageRoot: string,
): PeerContract {
  const clusterStrategy = readClusterStrategy(tree, adapterId, packageRoot);
  const peerSymbols = collectPeerSymbols(tree);

  return {
    $schemaName: 'adapter.peer-contract',
    clusterStrategy,
    provides: providesIdents,
    peerSymbols,
  };
}

function readClusterStrategy(
  tree: SourceTree,
  adapterId: string,
  packageRoot: string,
): 'Shared' | 'Exclusive' {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class' || symbol.name !== adapterId) continue;

      const member = (symbol.members ?? []).find(
        (m): m is ExtractedSymbol => m.kind === 'property' && m.name === 'clusterStrategy',
      );

      if (member === undefined || member.initializer === undefined) {
        // Missing → default Shared.
        return 'Shared';
      }

      const init = member.initializer;

      if (init.kind === 'member' && (init.property === 'Shared' || init.property === 'Exclusive')) {
        return init.property;
      }

      if (init.kind === 'string' && (init.value === 'Shared' || init.value === 'Exclusive')) {
        return init.value;
      }

      throw diag({
        reason: `\`${adapterId}.clusterStrategy\` in ${file.filePath} must be \`ClusterStrategy.Shared\` or \`ClusterStrategy.Exclusive\` (or the equivalent string literal).`,
        file: file.filePath,
      });
    }
  }

  throw diag({
    reason: `Adapter class \`${adapterId}\` not found while resolving clusterStrategy under ${packageRoot}/src/.`,
    file: packageRoot,
  });
}

export function extractContextNamespaces(
  tree: SourceTree,
  contextType: string,
  packageRoot: string,
): ContextNamespacesSchema {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class' || symbol.name !== contextType) continue;

      const methods: ContextMethodSignature[] = [];
      const namespaces: ContextNamespaceProperty[] = [];

      // A namespace can be defined by either a property/field, a getter, or
      // a setter. When a class has both `get foo(): T` and `set foo(v: T)`,
      // both members surface with `member.name === 'foo'` — the first one we
      // see installs the namespace, subsequent same-name entries are de-duped.
      const seenNamespaceNames = new Set<string>();

      // Namespace types that are middleware augment targets must be a single
      // class/interface identifier. Union, optional, generic-arg, array, and
      // other compound types cannot be the LHS of `interface X { ... }`
      // declaration merging — they are members of the context surface but
      // NOT augment targets, so we record them with `type: null` so downstream
      // code skips merging into them.
      const isSingleIdentifierType = (t: string | null | undefined): boolean => {
        if (typeof t !== 'string') return false;
        return /^[A-Za-z_$][\w$]*$/.test(t.trim());
      };

      for (const member of symbol.members ?? []) {
        if (member.modifiers.includes('private') || member.modifiers.includes('protected')) continue;
        if (member.modifiers.includes('static')) continue;
        if (typeof member.name !== 'string' || member.name.length === 0) continue;

        if (member.kind === 'property') {
          if (seenNamespaceNames.has(member.name)) continue;
          seenNamespaceNames.add(member.name);
          const rawType = member.returnType ?? null;
          namespaces.push({
            name: member.name,
            type: isSingleIdentifierType(rawType) ? rawType : null,
          });
          continue;
        }

        if (member.kind !== 'method') continue;

        switch (member.methodKind) {
          case 'method':
          case undefined: {
            const params = (member.parameters ?? []).map(p => ({
              name: p.name,
              type: p.type ?? null,
            }));
            methods.push({
              name: member.name,
              params,
              returnType: member.returnType ?? null,
            });
            break;
          }

          case 'getter': {
            if (seenNamespaceNames.has(member.name)) break;
            seenNamespaceNames.add(member.name);
            const rawType = member.returnType ?? null;
            namespaces.push({
              name: member.name,
              type: isSingleIdentifierType(rawType) ? rawType : null,
            });
            break;
          }

          case 'setter': {
            if (seenNamespaceNames.has(member.name)) break;
            seenNamespaceNames.add(member.name);
            const rawType = member.parameters?.[0]?.type ?? null;
            namespaces.push({
              name: member.name,
              type: isSingleIdentifierType(rawType) ? rawType : null,
            });
            break;
          }

          case 'constructor':
            // Extracted separately by `extractAdapterConstructorSchema`.
            break;
        }
      }

      methods.sort((a, b) => a.name.localeCompare(b.name));
      namespaces.sort((a, b) => a.name.localeCompare(b.name));

      return {
        $schemaName: 'adapter.context-namespaces',
        contextType,
        methods,
        namespaces,
      };
    }
  }

  throw diag({
    reason: `Context class \`${contextType}\` not found anywhere under ${packageRoot}/src/.`,
    file: packageRoot,
  });
}

export function extractAdapterConstructorSchema(
  tree: SourceTree,
  adapterId: string,
  packageRoot: string,
): AdapterConstructorSchema {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class' || symbol.name !== adapterId) continue;

      const ctor = (symbol.members ?? []).find(
        (m): m is ExtractedSymbol => m.kind === 'method' && m.methodKind === 'constructor',
      );

      if (ctor === undefined) {
        return {
          $schemaName: 'adapter.constructor-schema',
          optionsParam: null,
          optional: true,
        };
      }

      const params = ctor.parameters ?? [];
      const first = params[0];

      if (first === undefined) {
        return {
          $schemaName: 'adapter.constructor-schema',
          optionsParam: null,
          optional: true,
        };
      }

      if (params.length > 1) {
        throw diag({
          reason: `Adapter class \`${adapterId}\` (in ${file.filePath}) constructor must accept at most one options parameter. Found ${params.length}.`,
          file: file.filePath,
        });
      }

      return {
        $schemaName: 'adapter.constructor-schema',
        optionsParam: { name: first.name, type: first.type ?? null },
        optional: first.isOptional === true,
      };
    }
  }

  throw diag({
    reason: `Adapter class \`${adapterId}\` not found while resolving constructor schema under ${packageRoot}/src/.`,
    file: packageRoot,
  });
}

/**
 * Adapter packages must be *pure protocol adapters* — they may not embed
 * `defineMiddleware()` / `defineGuard()` / `defineExceptionFilter()` calls.
 * Cross-cutting concerns (cookies / body parsing / compression / request id /
 * leader election etc.) belong in separate middleware library packages
 * compiled with `zb build middleware`.
 */
export function validateNoBuiltinMiddleware(tree: SourceTree, packageRoot: string): void {
  const FORBIDDEN_ORIGINALS = new Set(['defineMiddleware', 'defineGuard', 'defineExceptionFilter']);
  const offenders: Array<{ exportName: string; sourceFile: string; original: string; callee: string }> = [];

  for (const file of tree) {
    const sourceFile = relativeFromRoot(file.filePath, packageRoot);
    const resolver = buildCalleeResolver({ filePath: sourceFile, parsed: file.parsed });
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'variable' || !symbol.isExported) continue;
      const init = symbol.initializer;
      if (init === undefined || init.kind !== 'call') continue;
      const original = resolver.resolveCalleeText(init.callee);
      if (original === null || !FORBIDDEN_ORIGINALS.has(original)) continue;
      offenders.push({ exportName: symbol.name, sourceFile, original, callee: init.callee });
    }
  }

  if (offenders.length === 0) return;

  const formatted = offenders
    .sort((a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.exportName.localeCompare(b.exportName))
    .map(o => `  - ${o.sourceFile} :: ${o.exportName} = ${o.callee}(...)  // resolves to ${o.original}`)
    .join('\n');

  throw diag({
    reason: `Adapter packages must be pure protocol adapters and may not embed middleware/guards/exception-filters. Move the following exports to a separate library package (compile with \`zb build middleware\`):\n${formatted}`,
    file: packageRoot,
    how: 'Create a new package with `"zipbul": { "kind": "middleware" }` in package.json, move the offending exports there, then build it with `zb build middleware` and depend on it from the user app.',
  });
}

function collectPeerSymbols(tree: SourceTree): { [packageName: string]: readonly string[] } {
  const PEER_PACKAGES = new Set(['@zipbul/core', '@zipbul/common']);
  const collected = new Map<string, Set<string>>();

  for (const pkg of PEER_PACKAGES) {
    collected.set(pkg, new Set());
  }

  for (const file of tree) {
    const relations: readonly CodeRelation[] = extractRelations(file.parsed.program, file.filePath);

    for (const rel of relations) {
      if (rel.type !== 'imports' && rel.type !== 'type-references') continue;
      if (rel.specifier === undefined) continue;
      if (!PEER_PACKAGES.has(rel.specifier)) continue;
      if (rel.dstSymbolName === null || rel.dstSymbolName === '*') continue;

      collected.get(rel.specifier)!.add(rel.dstSymbolName);
    }
  }

  const out: { [packageName: string]: readonly string[] } = {};

  for (const [pkg, symbols] of collected) {
    out[pkg] = [...symbols].sort();
  }

  return out;
}

/**
 * Locates the adapter class by name across the source tree, then reads its
 * `decorators` instance property to derive the controller / handlers /
 * options identifiers.
 */
export function extractDecoratorSchema(
  tree: SourceTree,
  adapterId: string,
  packageRoot: string,
): DecoratorSchema {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class' || symbol.name !== adapterId) continue;

      const decoratorsMember = (symbol.members ?? []).find(
        (m): m is ExtractedSymbol => m.kind === 'property' && m.name === 'decorators',
      );

      if (decoratorsMember === undefined || decoratorsMember.initializer === undefined) {
        throw diag({
          reason: `Adapter class \`${adapterId}\` in ${file.filePath} must declare a \`decorators\` instance property of shape \`{ controller, handlers, options? }\`.`,
          file: file.filePath,
        });
      }

      return readAdapterEntryDecorators(decoratorsMember.initializer, file.filePath, adapterId);
    }
  }

  throw diag({
    reason: `Adapter class \`${adapterId}\` not found anywhere under ${packageRoot}/src/.`,
    file: packageRoot,
  });
}

function readAdapterEntryDecorators(
  init: ExpressionValue,
  filePath: string,
  adapterId: string,
): DecoratorSchema {
  if (init.kind !== 'object') {
    throw diag({
      reason: `Adapter class \`${adapterId}\` (in ${filePath}) decorators property must be an object literal.`,
      file: filePath,
    });
  }

  let controller: string | null = null;
  let handlers: readonly string[] | null = null;
  let options: readonly string[] = [];

  for (const prop of init.properties) {
    if (prop.kind === 'spread') continue;
    if (prop.key.kind !== 'string') continue;

    const fieldName = prop.key.value;

    if (fieldName === 'controller') {
      if (prop.value.kind !== 'identifier') {
        throw diag({
          reason: `decorators.controller in ${filePath} must be a single identifier reference (exactly 1).`,
          file: filePath,
        });
      }
      controller = prop.value.name;
    } else if (fieldName === 'handlers') {
      handlers = readIdentifierArray(prop.value, 'decorators.handlers', filePath);

      if (handlers.length === 0) {
        throw diag({
          reason: `decorators.handlers in ${filePath} must contain at least one identifier reference.`,
          file: filePath,
        });
      }
    } else if (fieldName === 'options') {
      options = readIdentifierArray(prop.value, 'decorators.options', filePath);
    }
  }

  if (controller === null) {
    throw diag({
      reason: `decorators.controller missing in ${filePath}.`,
      file: filePath,
    });
  }

  if (handlers === null) {
    throw diag({
      reason: `decorators.handlers missing in ${filePath}.`,
      file: filePath,
    });
  }

  ensureUnique([controller, ...handlers, ...options], filePath);

  return {
    $schemaName: 'adapter.decorator-schema',
    controller,
    handlers,
    options,
  };
}
