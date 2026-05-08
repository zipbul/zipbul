import { join, resolve } from 'node:path';

import { DiagnosticError } from '../../diagnostics';
import { withAtomicEmit, installCancellation } from '../../common';
import { validateDefineCallShape } from '../define-call-shape';

import type {
  AdapterConstructorSchema,
  AdapterManifest,
  BuildAdapterOptions,
  BuildAdapterResult,
  ContextNamespacesSchema,
  DecoratorSchema,
  PeerContract,
  PipelineSchema,
} from './interfaces';

import { diag } from './diag';
import { serializeJson } from './serialize';
import { collectSourceTree, pickEntrySourceFile, type SourceFile, type SourceTree } from './source-tree';
import { readPackageJson, validateAdapterKind, validatePackageFields } from './package-validation';
import { runCodegen } from './codegen';
import {
  extractAdapterConstructorSchema,
  extractAdapterDefinition,
  extractContextNamespaces,
  extractDecoratorSchema,
  extractPeerContract,
  resolveEnumMembers,
  validateClassExports,
  validateNoBuiltinMiddleware,
  validatePipeline,
} from './extractors';

export type { SourceFile, SourceTree };

/**
 * Pure extraction phase — given a parsed source tree, produce all the
 * adapter manifest objects in memory without any disk IO. Shared by:
 *
 * - `buildAdapter` (external adapter package path) — the result is then
 *   serialized to `dist/<*.json>` and `runCodegen` runs.
 * - `AdapterDefinitionResolver` (user-app inline path) — the result is
 *   wrapped into a synthetic `ReadAdapterManifestResult` and passed to
 *   `synthesizeAdapterExtraction` directly.
 *
 * The `enforceAdapterPurity` flag drives the `validateNoBuiltinMiddleware`
 * check: external adapter packages must be pure (no factory-wrapped
 * `defineMiddleware` / `defineGuard` / `defineExceptionFilter` in their
 * source); user-app inline adapters live in the same source tree as
 * middleware factories, so the check would always fail there.
 *
 * @public
 */
export interface CompileAdapterInputs {
  readonly sourceTree: SourceTree;
  /** If undefined, the file containing `defineAdapter(...)` is auto-picked. */
  readonly entry?: SourceFile;
  /** Package root used for diagnostic file paths. */
  readonly packageRoot: string;
  /** Whether to enforce adapter purity (no inline middleware). */
  readonly enforceAdapterPurity: boolean;
}

/**
 * In-memory output of {@link compileAdapter}. Mirrors the on-disk manifest
 * tree but without the relative-path indirection.
 *
 * @public
 */
export interface CompiledAdapter {
  readonly adapterId: string;
  readonly pipelineSchema: PipelineSchema;
  readonly decoratorSchema: DecoratorSchema;
  readonly peerContract: PeerContract;
  readonly contextNamespaces: ContextNamespacesSchema;
  readonly constructorSchema: AdapterConstructorSchema;
  readonly adapterManifest: AdapterManifest;
}

/**
 * Compiles an adapter package into a `dist/` tree of manifests + JS/d.ts.
 * Atomic emit via `.staging/` → `dist/` rename. Source resolution uses the
 * package's `module` field (TS source-tree entry) or `src/index.ts` as
 * fallback.
 */
export async function buildAdapter(options: BuildAdapterOptions = {}): Promise<BuildAdapterResult> {
  const packageRoot = resolve(options.packageRoot ?? process.cwd());
  const outDir = resolve(packageRoot, 'dist');
  const verbose = options.verbose === true;

  // Install SIGINT/SIGTERM handlers — staging dir is registered with the
  // scope below so an interrupted build cleans up before exit, leaving any
  // prior dist/ intact.
  const cancel = installCancellation();
  try {
    return await runBuildAdapter(packageRoot, outDir, cancel, verbose);
  } finally {
    cancel.dispose();
  }
}

/**
 * Pure extractor: source tree → adapter manifest objects. No disk IO.
 *
 * @public
 */
export function compileAdapter(inputs: CompileAdapterInputs): CompiledAdapter {
  const { sourceTree, packageRoot, enforceAdapterPurity } = inputs;
  const entryFile = inputs.entry ?? pickEntrySourceFile(sourceTree, packageRoot);
  const extracted = extractAdapterDefinition(entryFile);

  const collected: DiagnosticError[] = [];
  const collectFrom = (fn: () => void): void => {
    try { fn(); } catch (cause) {
      if (cause instanceof DiagnosticError) {
        collected.push(cause);
      } else {
        throw cause;
      }
    }
  };
  collectFrom(() => validatePipeline(sourceTree, extracted, entryFile.filePath));
  collectFrom(() => validateClassExports(sourceTree, extracted, packageRoot));

  if (collected.length > 0) {
    if (collected.length === 1) throw collected[0]!;
    const lines = collected.map(e => `  - ${e.diagnostic.why}`).join('\n');
    throw diag('CONTRACT', {
      reason: `${collected.length} validation errors:\n${lines}`,
      file: packageRoot,
    });
  }

  const decoratorSchema = extractDecoratorSchema(sourceTree, extracted.adapterId, packageRoot);
  const peerContract = extractPeerContract(
    sourceTree,
    extracted.adapterId,
    extracted.providesIdents,
    packageRoot,
  );
  const contextNamespaces = extractContextNamespaces(
    sourceTree,
    extracted.contextType,
    packageRoot,
  );
  const constructorSchema = extractAdapterConstructorSchema(
    sourceTree,
    extracted.adapterId,
    packageRoot,
  );

  if (enforceAdapterPurity) {
    validateNoBuiltinMiddleware(sourceTree, packageRoot);
  }

  const phaseMembers = resolveEnumMembers(sourceTree, extracted.pipelineSchema.phaseEnum);
  const stepMembers = resolveEnumMembers(sourceTree, extracted.pipelineSchema.stepEnum);
  const pipelineSchema: PipelineSchema = {
    ...extracted.pipelineSchema,
    phaseMembers: phaseMembers === null ? [] : [...phaseMembers],
    stepMembers: stepMembers === null ? [] : [...stepMembers],
  };

  const adapterManifest: AdapterManifest = {
    $schemaName: 'adapter.manifest',
    adapterId: extracted.adapterId,
    manifests: {
      'pipeline-schema': 'pipeline-schema.json',
      'decorator-schema': 'decorator-schema.json',
      'peer-contract': 'peer-contract.json',
      'context-namespaces': 'context-namespaces.json',
      'adapter-constructor-schema': 'adapter-constructor-schema.json',
    },
  };

  return {
    adapterId: extracted.adapterId,
    pipelineSchema,
    decoratorSchema,
    peerContract,
    contextNamespaces,
    constructorSchema,
    adapterManifest,
  };
}

async function runBuildAdapter(
  packageRoot: string,
  outDir: string,
  cancel: ReturnType<typeof installCancellation>,
  verbose: boolean,
): Promise<BuildAdapterResult> {
  const pkgJson = await readPackageJson(packageRoot);
  validateAdapterKind(pkgJson, packageRoot);
  if (verbose) {
    console.log('adapter: package=%s root=%s', pkgJson.name ?? '(unnamed)', packageRoot);
  }

  const sourceTree = await collectSourceTree(packageRoot);
  validateDefineCallShape(sourceTree.map(f => ({ filePath: f.filePath, parsed: f.parsed })));
  if (verbose) {
    console.log('adapter: source tree %d file(s)', sourceTree.length);
  }

  validatePackageFields(pkgJson, packageRoot);

  const compiled = compileAdapter({
    sourceTree,
    packageRoot,
    enforceAdapterPurity: true,
  });

  const childArtifacts: Array<{ readonly relPath: string; readonly content: string }> = [
    { relPath: 'pipeline-schema.json', content: serializeJson(compiled.pipelineSchema) },
    { relPath: 'decorator-schema.json', content: serializeJson(compiled.decoratorSchema) },
    { relPath: 'peer-contract.json', content: serializeJson(compiled.peerContract) },
    { relPath: 'context-namespaces.json', content: serializeJson(compiled.contextNamespaces) },
    { relPath: 'adapter-constructor-schema.json', content: serializeJson(compiled.constructorSchema) },
  ];

  const manifestPath = join(outDir, 'adapter.manifest.json');

  const artifacts: Array<{ readonly relPath: string; readonly content: string }> = [
    ...childArtifacts,
    // Top-level manifest written last — indexes the other paths.
    { relPath: 'adapter.manifest.json', content: serializeJson(compiled.adapterManifest) },
  ];

  // Atomic emit: write to staging, then swap. On failure staging is removed
  // and prior dist/ is preserved. SIGINT/SIGTERM also cleans staging via
  // the cancellation scope.
  await withAtomicEmit(
    {
      finalDir: outDir,
      stagingDir: `${outDir}.staging`,
      registerCleanup: cancel.registerCleanup,
    },
    async (stagingDir) => {
      for (const artifact of artifacts) {
        await Bun.write(join(stagingDir, artifact.relPath), artifact.content);
        if (verbose) {
          console.log('adapter: emit %s (%d bytes)', artifact.relPath, artifact.content.length);
        }
      }

      await runCodegen(packageRoot, stagingDir, cancel.signal);
    },
  );

  if (verbose) {
    console.log('adapter: id=%s manifest=%s', compiled.adapterId, manifestPath);
  }

  return { adapterId: compiled.adapterId, manifestPath };
}
