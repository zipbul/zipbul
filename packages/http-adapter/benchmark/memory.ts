/**
 * 8개 서버 메모리 프로파일링.
 *
 * 각 서버에 대해:
 *   1. boot 직후 baseline RSS
 *   2. warmup 5k 요청
 *   3. 10s × 64 conn 부하
 *   4. 부하 후 idle 2s
 *   5. leak 감지 (peak - baseline, steady - peak)
 *
 * /proc/<pid>/status 로 RSS(KB) 읽어 MB 환산.
 */
import { $ } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface ServerDefinition {
  readonly name: string;
  readonly appDir: string;
  readonly entryFile: string;
  readonly port: number;
}

interface MemorySnapshot {
  readonly label: string;
  readonly rssMb: number;
  readonly timestampMs: number;
}

interface MemoryResult {
  readonly name: string;
  readonly baselineMb: number;
  readonly warmupMb: number;
  readonly peakMb: number;
  readonly steadyMb: number;
  readonly postLoadIdleMb: number;
  readonly leakCandidate: number;
  readonly snapshots: readonly MemorySnapshot[];
}

const BASE_PORT = 4100;
const EXPECTED_BODY = JSON.stringify({ message: 'Hello, World!' });

const SERVERS: readonly ServerDefinition[] = [
  { name: 'Bun.serve', appDir: 'apps/bun-serve', entryFile: 'dist/main.js', port: BASE_PORT },
  { name: 'Zipbul', appDir: 'apps/zipbul', entryFile: 'dist/entry.js', port: BASE_PORT + 1 },
  { name: 'Elysia', appDir: 'apps/elysia', entryFile: 'dist/main.js', port: BASE_PORT + 2 },
  { name: 'Hono', appDir: 'apps/hono', entryFile: 'dist/main.js', port: BASE_PORT + 3 },
  { name: 'Fastify', appDir: 'apps/fastify', entryFile: 'dist/main.js', port: BASE_PORT + 4 },
  { name: 'Express', appDir: 'apps/express', entryFile: 'dist/main.js', port: BASE_PORT + 5 },
  { name: 'NestJS+Express', appDir: 'apps/nestjs-express', entryFile: 'dist/main.js', port: BASE_PORT + 6 },
  { name: 'NestJS+Fastify', appDir: 'apps/nestjs-fastify', entryFile: 'dist/main.js', port: BASE_PORT + 7 },
];

const BENCH_DURATION = '10s';
const BENCH_CONNECTIONS = 64;
const WARMUP_REQUESTS = 5000;
const STARTUP_WAIT_MS = 8000;
const POST_LOAD_IDLE_MS = 2000;
const SAMPLE_INTERVAL_MS = 250;
const PORT_RELEASE_MS = 3000;

function readRssMb(pid: number): number | undefined {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
    const match = status.match(/VmRSS:\s*(\d+)\s*kB/);
    if (match === null) return undefined;
    return parseInt(match[1]!, 10) / 1024;
  } catch {
    return undefined;
  }
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.status === 200 && body === EXPECTED_BODY) return true;
    } catch {
      // retry
    }
    await Bun.sleep(100);
  }
  return false;
}

async function waitForPortRelease(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/`);
      await response.text();
      await Bun.sleep(200);
    } catch {
      return;
    }
  }
}

async function profileServer(server: ServerDefinition): Promise<MemoryResult | undefined> {
  const appDir = join(import.meta.dir, server.appDir);
  const url = `http://localhost:${server.port}/`;

  const proc = Bun.spawn(['bun', 'run', server.entryFile], {
    cwd: appDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NODE_ENV: 'production', BENCH_PORT: String(server.port) },
  });

  try {
    const ready = await waitForServer(url, STARTUP_WAIT_MS);
    if (!ready) return undefined;

    const pid = proc.pid;
    const snapshots: MemorySnapshot[] = [];
    const takeSample = (label: string): void => {
      const rss = readRssMb(pid);
      if (rss !== undefined) snapshots.push({ label, rssMb: rss, timestampMs: Date.now() });
    };

    // 안정화 대기 (GC 반영)
    await Bun.sleep(500);
    takeSample('baseline');
    const baselineMb = snapshots[snapshots.length - 1]!.rssMb;

    // Warmup
    await $`bombardier -n ${WARMUP_REQUESTS} -p r -o pt ${url}`.quiet();
    await Bun.sleep(300);
    takeSample('warmup');
    const warmupMb = snapshots[snapshots.length - 1]!.rssMb;

    // 부하 중 연속 샘플링
    const loadStart = Date.now();
    const samplerHandle = (async () => {
      while (Date.now() - loadStart < 10_000) {
        takeSample('load');
        await Bun.sleep(SAMPLE_INTERVAL_MS);
      }
    })();

    await $`bombardier -c ${BENCH_CONNECTIONS} -d ${BENCH_DURATION} -l -p r -o pt ${url}`.quiet();
    await samplerHandle;

    // peak
    const loadSamples = snapshots.filter(s => s.label === 'load');
    const peakMb = loadSamples.length > 0 ? Math.max(...loadSamples.map(s => s.rssMb)) : warmupMb;
    const steadyMb = loadSamples.length > 0 ? loadSamples[loadSamples.length - 1]!.rssMb : warmupMb;

    // idle 회수
    await Bun.sleep(POST_LOAD_IDLE_MS);
    takeSample('post-load-idle');
    const postLoadIdleMb = snapshots[snapshots.length - 1]!.rssMb;

    const leakCandidate = postLoadIdleMb - baselineMb;

    return {
      name: server.name,
      baselineMb,
      warmupMb,
      peakMb,
      steadyMb,
      postLoadIdleMb,
      leakCandidate,
      snapshots,
    };
  } finally {
    proc.kill();
    await waitForPortRelease(server.port, PORT_RELEASE_MS);
  }
}

function printResults(results: readonly MemoryResult[]): void {
  console.log('\n' + '='.repeat(116));
  console.log('  HTTP Memory Profile (RSS MB @ boot → warmup → load peak → load steady → post-load idle)');
  console.log('='.repeat(116));
  const sorted = [...results].sort((a, b) => a.peakMb - b.peakMb);
  console.log(
    '  ' +
    'Framework'.padEnd(18) +
    'baseline'.padStart(10) +
    'warmup'.padStart(10) +
    'peak'.padStart(10) +
    'steady'.padStart(10) +
    'post-idle'.padStart(12) +
    'leakΔ'.padStart(10) +
    'samples'.padStart(10),
  );
  console.log('-'.repeat(116));
  for (const r of sorted) {
    console.log(
      '  ' +
      r.name.padEnd(18) +
      `${r.baselineMb.toFixed(1)}M`.padStart(10) +
      `${r.warmupMb.toFixed(1)}M`.padStart(10) +
      `${r.peakMb.toFixed(1)}M`.padStart(10) +
      `${r.steadyMb.toFixed(1)}M`.padStart(10) +
      `${r.postLoadIdleMb.toFixed(1)}M`.padStart(12) +
      `${r.leakCandidate >= 0 ? '+' : ''}${r.leakCandidate.toFixed(1)}M`.padStart(10) +
      `${r.snapshots.length}`.padStart(10),
    );
  }
  console.log('='.repeat(116));
  console.log(`  ${BENCH_DURATION} × ${BENCH_CONNECTIONS} conn × warmup ${WARMUP_REQUESTS} | sampled every ${SAMPLE_INTERVAL_MS}ms | post-load idle ${POST_LOAD_IDLE_MS}ms`);
  console.log('  leakΔ = post-load idle − baseline (GC 이후 잔류). 작을수록 좋음.');
  console.log('='.repeat(116) + '\n');
}

async function main(): Promise<void> {
  try {
    await $`which bombardier`.quiet();
  } catch {
    console.error('bombardier not found');
    process.exit(1);
  }

  const results: MemoryResult[] = [];
  for (const server of SERVERS) {
    process.stdout.write(`  Profiling ${server.name} (:${server.port})... `);
    const r = await profileServer(server);
    if (r !== undefined) {
      results.push(r);
      console.log(
        `peak ${r.peakMb.toFixed(1)}M, leakΔ ${r.leakCandidate >= 0 ? '+' : ''}${r.leakCandidate.toFixed(1)}M`,
      );
    } else {
      console.log('failed to start');
    }
  }
  printResults(results);
}

await main();
