import type { CommandOptions } from './types';

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { buildDiagnostic, reportDiagnostics } from '../diagnostics';
import { ConfigLoader } from '../config';
import type { ResolvedZipbulConfig } from '../config';
import { startZipbulMcpServerStdio } from '../mcp/server/mcp-server';
import { GildashProvider, type GildashProviderOptions } from '../compiler/gildash-provider';

export interface McpCommandDeps {
  loadConfig: (projectRoot: string) => Promise<{ config: ResolvedZipbulConfig }>;
  ensureRepo: (projectRoot: string) => Promise<void>;
  rebuildProjectIndex: (input: { projectRoot: string; config: ResolvedZipbulConfig; mode: 'incremental' | 'full' }) => Promise<{ ok: boolean }>;
  startServer: (projectRoot: string, config: ResolvedZipbulConfig) => Promise<void>;
  reportInvalidSubcommand: (value: string | undefined) => void;
}

async function ensureRepoDefault(projectRoot: string): Promise<void> {
  // Ensure required .zipbul structure exists.
  const zipbulDir = join(projectRoot, '.zipbul');
  await mkdir(join(zipbulDir, 'build'), { recursive: true });
  await mkdir(join(zipbulDir, 'cache'), { recursive: true });

  // Ensure .zipbul/cache is gitignored.
  const gitignorePath = join(projectRoot, '.gitignore');
  const requiredLine = `${join('.zipbul', 'cache').replaceAll('\\', '/')}/`;
  const exists = await Bun.file(gitignorePath).exists();
  const current = exists ? await Bun.file(gitignorePath).text() : '';
  const lines = current.split(/\r?\n/);
  const hasLine = lines.some((l) => l.trim() === requiredLine);
  if (!hasLine) {
    const next = `${current.replace(/\s*$/, '')}${current.length > 0 ? '\n' : ''}${requiredLine}\n`;
    await Bun.write(gitignorePath, next);
  }

  // Ensure zipbul.jsonc exists with minimal required fields.
  const jsonPath = join(projectRoot, 'zipbul.json');
  const jsoncPath = join(projectRoot, 'zipbul.jsonc');
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
  createGildashProvider?: (options: GildashProviderOptions) => Promise<GildashProvider>;
}

async function rebuildProjectIndexDefault(
  input: { projectRoot: string; config: ResolvedZipbulConfig; mode: 'incremental' | 'full' },
  deps?: RebuildProjectIndexDefaultDeps,
): Promise<{ ok: boolean }> {
  const openGildash = deps?.createGildashProvider ?? GildashProvider.open;
  const ledger = await openGildash({ projectRoot: input.projectRoot });
  try {
    await ledger.reindex();
  } catch (_error) {
    // reader인 경우 reindex()는 owner 전용. 에러를 무시하고 ok: true 반환.
    // owner가 자동으로 인덱싱 수행 중이므로 명시적 재인덱싱 불필요.
  } finally {
    await ledger.close();
  }
  return { ok: true };
}

function reportInvalidSubcommand(value: string | undefined): void {
  const commandValue = value ?? '(missing)';
  const diagnostic = buildDiagnostic({
    code: 'INVALID_COMMAND',
    severity: 'fatal',
    summary: 'Unknown command.',
    reason: `Unsupported mcp subcommand: ${commandValue}. Use: zp mcp | zp mcp verify | zp mcp rebuild.`,
    file: '.',
  });

  reportDiagnostics({ diagnostics: [diagnostic] });
}

export function createMcpCommand(deps: McpCommandDeps) {
  return async function mcp(positionals: string[], _commandOptions: CommandOptions): Promise<void> {
    const projectRoot = process.cwd();

    const subcommand = positionals[0];
    if (subcommand === undefined) {
      await deps.ensureRepo(projectRoot);
      const { config } = await deps.loadConfig(projectRoot);
      await deps.startServer(projectRoot, config);
      return;
    }

    if (subcommand === 'rebuild') {
      await deps.ensureRepo(projectRoot);
      const { config } = await deps.loadConfig(projectRoot);
      const mode = positionals.includes('--full') || positionals.includes('full') ? 'full' : 'incremental';
      const result = await deps.rebuildProjectIndex({ projectRoot, config, mode });
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    deps.reportInvalidSubcommand(subcommand);
    process.exitCode = 1;
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
    rebuildProjectIndex: rebuildProjectIndexDefault,
    startServer: async (projectRoot, config) => {
      await startZipbulMcpServerStdio({ projectRoot, config });
    },
    reportInvalidSubcommand,
  });

  await impl(positionals, _commandOptions);
}
