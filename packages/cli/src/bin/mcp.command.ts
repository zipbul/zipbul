import type { CommandOptions } from './types';

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { buildDiagnostic, reportDiagnostics } from '../diagnostics';
import { ConfigLoader } from '../config';
import type { ResolvedBunnerConfig } from '../config';
import { bunnerCacheDirPath } from '../common/bunner-paths';
import { indexProject } from '../mcp/index/index-project';
import { verifyProject } from '../mcp/verify/verify-project';
import { startBunnerMcpServerStdio } from '../mcp/server/mcp-server';
import { closeDb, createDb } from '../store/connection';
import { OwnerElection } from '../watcher/owner-election';
import { emitReindexSignal } from '../watcher/reindex-signal';

export interface McpCommandDeps {
  loadConfig: (projectRoot: string) => Promise<{ config: ResolvedBunnerConfig }>;
  ensureRepo: (projectRoot: string) => Promise<void>;
  verifyProject: (input: { projectRoot: string; config: ResolvedBunnerConfig }) => Promise<{ ok: boolean; errors: any[]; warnings: any[] }>; 
  rebuildProjectIndex: (input: { projectRoot: string; config: ResolvedBunnerConfig; mode: 'incremental' | 'full' }) => Promise<{ ok: boolean }>;
  startServer: (projectRoot: string, config: ResolvedBunnerConfig) => Promise<void>;
  reportInvalidSubcommand: (value: string | undefined) => void;
}

async function ensureRepoDefault(projectRoot: string): Promise<void> {
  // Ensure required .bunner structure exists.
  const bunnerDir = join(projectRoot, '.bunner');
  await mkdir(join(bunnerDir, 'cards'), { recursive: true });
  await mkdir(join(bunnerDir, 'build'), { recursive: true });
  await mkdir(join(bunnerDir, 'cache'), { recursive: true });

  // Ensure .bunner/cache is gitignored.
  const gitignorePath = join(projectRoot, '.gitignore');
  const requiredLine = `${join('.bunner', 'cache').replaceAll('\\', '/')}/`;
  const exists = await Bun.file(gitignorePath).exists();
  const current = exists ? await Bun.file(gitignorePath).text() : '';
  const lines = current.split(/\r?\n/);
  const hasLine = lines.some((l) => l.trim() === requiredLine);
  if (!hasLine) {
    const next = `${current.replace(/\s*$/, '')}${current.length > 0 ? '\n' : ''}${requiredLine}\n`;
    await Bun.write(gitignorePath, next);
  }

  // Ensure bunner.jsonc exists with minimal required fields.
  const jsonPath = join(projectRoot, 'bunner.json');
  const jsoncPath = join(projectRoot, 'bunner.jsonc');
  const jsonExists = await Bun.file(jsonPath).exists();
  const jsoncExists = await Bun.file(jsoncPath).exists();

  if (!jsonExists && !jsoncExists) {
    const minimal = {
      sourceDir: './src',
      entry: './src/main.ts',
      module: { fileName: 'module.ts' },
    };
    await Bun.write(jsoncPath, `${JSON.stringify(minimal, null, 2)}\n`);
  }
}

export interface RebuildProjectIndexDefaultDeps {
  createOwnerElection?: (input: { projectRoot: string; pid: number }) => { acquire: () => { role: 'owner' | 'reader' }; release: () => void };
  emitReindexSignal?: typeof emitReindexSignal;
  nowMs?: () => number;
  pid?: number;

  createDb?: typeof createDb;
  closeDb?: typeof closeDb;
  indexProject?: typeof indexProject;
}

async function rebuildProjectIndexDefault(
  input: { projectRoot: string; config: ResolvedBunnerConfig; mode: 'incremental' | 'full' },
  deps?: RebuildProjectIndexDefaultDeps,
): Promise<{ ok: boolean }> {
  const pid = deps?.pid ?? process.pid;
  const nowMs = deps?.nowMs ?? (() => Date.now());
  const emit = deps?.emitReindexSignal ?? emitReindexSignal;
  const createOwnerElection = deps?.createOwnerElection ?? ((i: { projectRoot: string; pid: number }) => new OwnerElection(i));

  const election = createOwnerElection({ projectRoot: input.projectRoot, pid });
  const res = election.acquire();

  if (res.role === 'reader') {
    await emit({ projectRoot: input.projectRoot, pid, nowMs });
    election.release();
    return { ok: true };
  }

  const createDbFn = deps?.createDb ?? createDb;
  const closeDbFn = deps?.closeDb ?? closeDb;
  const indexProjectFn = deps?.indexProject ?? indexProject;

  const dbPath = join(bunnerCacheDirPath(input.projectRoot), 'index.sqlite');
  const db = createDbFn(dbPath);
  try {
    await indexProjectFn({ projectRoot: input.projectRoot, config: input.config as any, db, mode: input.mode });
    return { ok: true };
  } finally {
    closeDbFn(db);
    election.release();
  }
}

function reportInvalidSubcommand(value: string | undefined): void {
  const commandValue = value ?? '(missing)';
  const diagnostic = buildDiagnostic({
    code: 'INVALID_COMMAND',
    severity: 'fatal',
    summary: 'Unknown command.',
    reason: `mcp does not accept subcommands/options. Use: bunner mcp (got: ${commandValue}).`,
    file: '.',
  });

  reportDiagnostics({ diagnostics: [diagnostic] });
}

export function createMcpCommand(deps: McpCommandDeps) {
  return async function mcp(positionals: string[], _commandOptions: CommandOptions): Promise<void> {
    if (positionals.length > 0) {
      deps.reportInvalidSubcommand(positionals[0]);
      process.exitCode = 1;
      return;
    }

    const projectRoot = process.cwd();
    await deps.ensureRepo(projectRoot);
    const { config } = await deps.loadConfig(projectRoot);
    await deps.startServer(projectRoot, config);
  };
}

export const __testing__ = {
  createMcpCommand,
  rebuildProjectIndexDefault,
};

export async function mcp(positionals: string[], _commandOptions: CommandOptions): Promise<void> {
  const impl = createMcpCommand({
    loadConfig: ConfigLoader.load,
    ensureRepo: ensureRepoDefault,
    verifyProject,
    rebuildProjectIndex: rebuildProjectIndexDefault,
    startServer: async (projectRoot, config) => {
      await startBunnerMcpServerStdio({ projectRoot, config });
    },
    reportInvalidSubcommand,
  });

  await impl(positionals, _commandOptions);
}
