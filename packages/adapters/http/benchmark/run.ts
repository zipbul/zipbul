import { $ } from 'bun';
import { join } from 'node:path';

interface BombardierResult {
  readonly result: {
    readonly rps: {
      readonly mean: number;
    };
    readonly latency: {
      readonly mean: number;
      readonly percentiles: Record<string, number>;
    };
  };
}

interface RoundResult {
  name: string;
  requestsPerSecond: number;
  latencyAvgUs: number;
  latencyP50Us: number;
  latencyP99Us: number;
}

interface AggregatedResult {
  name: string;
  requestsPerSecond: number;
  latencyAvgUs: number;
  latencyP50Us: number;
  latencyP99Us: number;
  allRps: readonly number[];
  successCount: number;
}

interface ServerDefinition {
  readonly name: string;
  readonly appDir: string;
  readonly buildScript: string;
  readonly entryFile: string;
  readonly port: number;
}

const BASE_PORT = 4000;
const EXPECTED_BODY = JSON.stringify({ message: 'Hello, World!' });

const SERVERS: readonly ServerDefinition[] = [
  { name: 'Bun.serve', appDir: 'apps/bun-serve', buildScript: 'build', entryFile: 'dist/main.js', port: BASE_PORT },
  { name: 'Zipbul', appDir: 'apps/zipbul', buildScript: 'build', entryFile: 'dist/entry.js', port: BASE_PORT + 1 },
  { name: 'Elysia', appDir: 'apps/elysia', buildScript: 'build', entryFile: 'dist/main.js', port: BASE_PORT + 2 },
  { name: 'Hono', appDir: 'apps/hono', buildScript: 'build', entryFile: 'dist/main.js', port: BASE_PORT + 3 },
  { name: 'Fastify', appDir: 'apps/fastify', buildScript: 'build', entryFile: 'dist/main.js', port: BASE_PORT + 4 },
  { name: 'Express', appDir: 'apps/express', buildScript: 'build', entryFile: 'dist/main.js', port: BASE_PORT + 5 },
  { name: 'NestJS+Express', appDir: 'apps/nestjs-express', buildScript: 'build', entryFile: 'dist/main.js', port: BASE_PORT + 6 },
  { name: 'NestJS+Fastify', appDir: 'apps/nestjs-fastify', buildScript: 'build', entryFile: 'dist/main.js', port: BASE_PORT + 7 },
];

const ROUNDS = 5;
const BENCHMARK_DURATION = '10s';
const BENCHMARK_CONNECTIONS = 64;
const WARMUP_REQUESTS = 5000;
const SERVER_STARTUP_WAIT_MS = 8000;
const COOLDOWN_MS = 3000;
const SERVER_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function formatMicroseconds(us: number): string {
  if (us >= 1_000_000) {
    return `${(us / 1_000_000).toFixed(2)}s`;
  }
  if (us >= 1_000) {
    return `${(us / 1_000).toFixed(2)}ms`;
  }
  return `${us.toFixed(0)}us`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }

  return sorted[mid]!;
}

function shuffle<T>(array: readonly T[]): T[] {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }

  return result;
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();

      if (response.status === 200 && body === EXPECTED_BODY) {
        return true;
      }
    } catch {
    }

    await Bun.sleep(100);
  }

  return false;
}

async function waitForPortRelease(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/`);
      await response.text();
      await Bun.sleep(200);
    } catch {
      return true;
    }
  }

  return false;
}

function parseBombardierJson(raw: string, name: string): RoundResult {
  const data = JSON.parse(raw) as BombardierResult;
  const result = data.result;

  return {
    name,
    requestsPerSecond: result.rps.mean,
    latencyAvgUs: result.latency.mean,
    latencyP50Us: result.latency.percentiles['50'] ?? 0,
    latencyP99Us: result.latency.percentiles['99'] ?? 0,
  };
}

async function prepareServerBuild(server: ServerDefinition): Promise<void> {
  const appDir = join(import.meta.dir, server.appDir);

  if (server.name === 'Zipbul') {
    await $`rm -rf ${join(appDir, '.zipbul/cache')} ${join(appDir, '.zipbul/manifest.json')} ${join(appDir, '.zipbul/runtime-report.json')} ${join(appDir, 'dist')}`.quiet();
  } else {
    await $`rm -rf ${join(appDir, 'dist')}`.quiet();
  }

  await $`bun run ${server.buildScript}`.cwd(appDir).quiet();
}

async function prepareBenchmarks(): Promise<void> {
  for (const server of SERVERS) {
    console.log(`Preparing ${server.name} benchmark app...`);
    await prepareServerBuild(server);
  }
}

async function benchmarkServer(server: ServerDefinition): Promise<RoundResult | undefined> {
  const url = `http://localhost:${server.port}/`;
  const appDir = join(import.meta.dir, server.appDir);

  const serverProcess = Bun.spawn(['bun', 'run', server.entryFile], {
    cwd: appDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NODE_ENV: 'production', BENCH_PORT: String(server.port) },
  });

  try {
    const ready = await waitForServer(url, SERVER_STARTUP_WAIT_MS);
    if (!ready) {
      const stdout = await new Response(serverProcess.stdout).text();
      const stderr = await new Response(serverProcess.stderr).text();
      console.error(`    [SKIP] ${server.name} failed to start on :${server.port}`);
      if (stdout.length > 0) {
        console.error(`    stdout: ${stdout.trim().split('\n').slice(-5).join(' | ')}`);
      }
      if (stderr.length > 0) {
        console.error(`    stderr: ${stderr.trim().split('\n').slice(-5).join(' | ')}`);
      }
      return undefined;
    }

    await $`bombardier -n ${WARMUP_REQUESTS} -p r -o pt ${url}`.quiet();

    const output = await $`bombardier -c ${BENCHMARK_CONNECTIONS} -d ${BENCHMARK_DURATION} -l -p r -o json ${url}`.text();
    return parseBombardierJson(output, server.name);
  } finally {
    serverProcess.kill();
    await waitForPortRelease(server.port, COOLDOWN_MS);
  }
}

async function benchmarkServerWithRetry(server: ServerDefinition): Promise<RoundResult | undefined> {
  for (let attempt = 1; attempt <= SERVER_ATTEMPTS; attempt++) {
    const result = await benchmarkServer(server);

    if (result !== undefined) {
      return result;
    }

    if (attempt < SERVER_ATTEMPTS) {
      console.error(`    [RETRY] ${server.name} retrying (${attempt + 1}/${SERVER_ATTEMPTS})...`);
      await Bun.sleep(RETRY_DELAY_MS);
    }
  }

  return undefined;
}

function aggregate(allResults: ReadonlyMap<string, readonly RoundResult[]>): AggregatedResult[] {
  const aggregated: AggregatedResult[] = [];

  for (const [name, rounds] of allResults) {
    if (rounds.length === 0) {
      continue;
    }

    const rpsValues = rounds.map(round => round.requestsPerSecond);
    const avgValues = rounds.map(round => round.latencyAvgUs);
    const p50Values = rounds.map(round => round.latencyP50Us);
    const p99Values = rounds.map(round => round.latencyP99Us);

    aggregated.push({
      name,
      requestsPerSecond: median(rpsValues),
      latencyAvgUs: median(avgValues),
      latencyP50Us: median(p50Values),
      latencyP99Us: median(p99Values),
      allRps: rpsValues,
      successCount: rounds.length,
    });
  }

  return aggregated;
}

function printResults(results: readonly AggregatedResult[]): void {
  const sorted = [...results].sort((first, second) => second.requestsPerSecond - first.requestsPerSecond);
  const baseline = sorted[0]!;

  console.log('\n' + '='.repeat(110));
  console.log('  HTTP Benchmark Results (GET / -> JSON)');
  console.log('='.repeat(110));

  const nameWidth = 18;
  const rpsWidth = 14;
  const avgWidth = 12;
  const p50Width = 12;
  const p99Width = 12;
  const ratioWidth = 10;
  const okWidth = 8;
  const roundsWidth = 32;

  console.log(
    '  ' +
    'Framework'.padEnd(nameWidth) +
    'req/s'.padStart(rpsWidth) +
    'avg'.padStart(avgWidth) +
    'p50'.padStart(p50Width) +
    'p99'.padStart(p99Width) +
    'ratio'.padStart(ratioWidth) +
    'ok'.padStart(okWidth) +
    'rounds (req/s)'.padStart(roundsWidth),
  );
  console.log('-'.repeat(110));

  for (const result of sorted) {
    const ratio = result.requestsPerSecond / baseline.requestsPerSecond;
    const ratioStr = result === baseline ? '(baseline)' : `x${ratio.toFixed(2)}`;
    const roundsStr = result.allRps.map(rps => Math.round(rps / 1000) + 'k').join(' ');

    console.log(
      '  ' +
      result.name.padEnd(nameWidth) +
      Math.round(result.requestsPerSecond).toLocaleString().padStart(rpsWidth) +
      formatMicroseconds(result.latencyAvgUs).padStart(avgWidth) +
      formatMicroseconds(result.latencyP50Us).padStart(p50Width) +
      formatMicroseconds(result.latencyP99Us).padStart(p99Width) +
      ratioStr.padStart(ratioWidth) +
      `${result.successCount}/${ROUNDS}`.padStart(okWidth) +
      roundsStr.padStart(roundsWidth),
    );
  }

  console.log('='.repeat(110));
  console.log(`  ${ROUNDS} rounds (shuffled) | median | ${BENCHMARK_CONNECTIONS} conn | ${BENCHMARK_DURATION}/round | warmup ${WARMUP_REQUESTS} reqs | cooldown ${COOLDOWN_MS}ms | attempts ${SERVER_ATTEMPTS}`);
  console.log('='.repeat(110) + '\n');
}

async function main(): Promise<void> {
  console.log('Checking bombardier...');

  try {
    await $`which bombardier`.quiet();
  } catch {
    console.error('bombardier not found. Install: https://github.com/codesenberg/bombardier');
    process.exit(1);
  }

  await prepareBenchmarks();

  const allResults = new Map<string, RoundResult[]>();

  for (const server of SERVERS) {
    allResults.set(server.name, []);
  }

  for (let round = 1; round <= ROUNDS; round++) {
    const shuffled = shuffle(SERVERS);
    const order = shuffled.map(server => server.name).join(', ');
    console.log(`\n===== Round ${round}/${ROUNDS} [${order}] =====`);

    for (const server of shuffled) {
      process.stdout.write(`  ${server.name} (:${server.port})... `);
      const result = await benchmarkServerWithRetry(server);

      if (result !== undefined) {
        allResults.get(server.name)!.push(result);
        console.log(`${Math.round(result.requestsPerSecond).toLocaleString()} req/s`);
      } else {
        console.log('failed');
      }
    }
  }

  const aggregated = aggregate(allResults);
  printResults(aggregated);
}

await main();
