import { parseArgs } from 'util';

import type { CommandOptions } from './interfaces';

import { Logger } from '@zipbul/logger';
import { dev } from './dev';
import { build } from './build';
import { buildAdapter, watchAdapter } from '../compiler/adapter-build';
import { DiagnosticError } from '../diagnostics';
import { CliRenderer } from './cli-renderer';

const renderer = new CliRenderer();

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
  options: {
    profile: {
      type: 'string',
    },
    verbose: {
      type: 'boolean',
      short: 'v',
    },
    lib: {
      type: 'boolean',
    },
    'out-dir': {
      type: 'string',
    },
    'dry-run': {
      type: 'boolean',
    },
    'check-only': {
      type: 'boolean',
    },
    quiet: {
      type: 'boolean',
      short: 'q',
    },
    format: {
      type: 'string',
    },
    'with-self-test': {
      type: 'boolean',
    },
    watch: {
      type: 'boolean',
    },
  },
});
const command = positionals[0];
const verbose = values.verbose === true;

const resolveLogLevel = (): 'trace' | 'debug' | 'info' => {
  if (verbose) {
    return 'trace';
  }

  return command === 'dev' ? 'debug' : 'info';
};

const logLevel = resolveLogLevel();
process.env.LOG_LEVEL = logLevel;
Logger.configure({ level: logLevel });

const USAGE_TEXT = [
  'Usage: zb <command> [options]',
  '',
  'Commands:',
  '  dev              Generate AOT artifacts and watch',
  '  build            Generate build output',
  '  build adapter    Compile an adapter package (zipbul.kind === "adapter")',
  '',
  'Common options:',
  '  --profile <minimal|standard|full>',
  '  --lib            Build as library (inject __augments metadata for npm packages)',
  '  --verbose, -v    Show detailed build information',
  '',
  'Adapter build options (zb build adapter):',
  '  --out-dir <path> Override output directory (default: dist)',
  '  --dry-run        Validate + canonicalize without writing files',
  '  --check-only     Compare freshly-produced manifests against on-disk dist (CI gate)',
  '  --quiet, -q      Suppress info output; emit only diagnostics',
  '  --format=json    Emit machine-friendly JSON to stdout; diagnostics to stderr',
  '  --with-self-test Run strict self-test (re-compile .d.ts + Bun import smoke)',
  '  --watch          Re-build on source changes (debounced)',
  '',
  'Exit codes:',
  '  0  Success',
  '  1  Compile / contract failure',
  '  2  Environment / usage error',
].join('\n');

const printUsage = (): void => {
  renderer.info(USAGE_TEXT);
};

const reportInvalidCommand = (value: string | undefined): void => {
  const commandValue = value ?? '(missing)';
  renderer.error(`Unsupported command: ${commandValue}.`);
};

const createCommandOptions = (): CommandOptions => {
  const profile = typeof values.profile === 'string' ? values.profile : undefined;
  const verbose = values.verbose === true;
  const options: CommandOptions = {};

  if (profile !== undefined) {
    options.profile = profile;
  }

  if (verbose) {
    options.verbose = true;
  }

  if (values.lib === true) {
    options.lib = true;
  }

  return options;
};

const commandOptions = createCommandOptions();

try {
  switch (command) {
    case 'dev':
      await dev(commandOptions);
      break;
    case 'build': {
      const subCommand = positionals[1];

      if (subCommand === 'adapter') {
        const jsonMode = values.format === 'json';
        const adapterOpts = {
          ...(typeof values['out-dir'] === 'string' ? { outDir: values['out-dir'] } : {}),
          ...(values['dry-run'] === true ? { dryRun: true as const } : {}),
          ...(values['check-only'] === true ? { checkOnly: true as const } : {}),
          ...(values.quiet === true ? { quiet: true as const } : {}),
          ...(values['with-self-test'] === true ? { withSelfTest: true as const } : {}),
        };

        if (values.watch === true) {
          // Item 102 — watch mode. Initial build runs synchronously; further
          // rebuilds fire via fs.watch + debounce. SIGINT teardown is left to
          // process default — closing watchers on exit is best-effort.
          await watchAdapter({
            ...adapterOpts,
            onRebuild(result, error) {
              if (error !== null) {
                renderer.error(`watch: rebuild failed — ${error.message}`);
                return;
              }
              if (result === null) return;
              if (values.quiet !== true) {
                renderer.info(`watch: rebuilt ${result.adapterId}`);
              }
            },
          });
          // Keep the process alive — Node exits when no handles remain, but
          // fs.watch counts as a handle so we never reach this comment.
          break;
        }

        try {
          const result = await buildAdapter(adapterOpts);

          if (jsonMode) {
            // Item 85 — machine-friendly JSON to stdout. stderr stays clean.
            process.stdout.write(`${JSON.stringify({
              ok: true,
              adapterId: result.adapterId,
              manifestPath: result.manifestPath,
              checked: result.checked ?? false,
              artifacts: result.artifacts ?? [],
            })}\n`);
          } else if (values.quiet !== true) {
            if (adapterOpts.checkOnly === true) {
              renderer.info(`Adapter manifest check OK: ${result.adapterId}`);
            } else if (adapterOpts.dryRun === true) {
              renderer.info(`Adapter manifest dry-run OK: ${result.adapterId} → (would write to ${result.manifestPath})`);
            } else {
              renderer.info(`Built adapter manifest: ${result.adapterId} → ${result.manifestPath}`);
            }
          }
        } catch (error) {
          if (jsonMode) {
            const why = error instanceof DiagnosticError ? error.diagnostic.why : (error instanceof Error ? error.message : String(error));
            const where = error instanceof DiagnosticError ? error.diagnostic.where : undefined;
            // Item 85 — JSON diagnostic to stderr; exit code carries the failure.
            process.stderr.write(`${JSON.stringify({ ok: false, why, where: where ?? null })}\n`);
            process.exitCode = 1;
            break;
          }
          throw error;
        }

        break;
      }

      await build(commandOptions);
      break;
    }
    case undefined:
      reportInvalidCommand(command);
      printUsage();
      process.exitCode = 2;
      break;
    default:
      reportInvalidCommand(command);
      printUsage();
      process.exitCode = 2;
  }
} catch (error) {
  if (error instanceof DiagnosticError) {
    renderer.diagnostic(error.diagnostic);
  } else {
    renderer.error(error instanceof Error ? error.message : 'Unknown error.');
  }

  // Item 98 — exit code 1 = compile/contract failure, 2 = environment/usage error.
  // DiagnosticError represents a contract violation against the adapter source.
  process.exitCode = 1;
}
