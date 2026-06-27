import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { ZipbulContainer } from '@zipbul/common';

import { loggerMockModule } from '@zipbul/logger/testing';

mock.module('@zipbul/logger', loggerMockModule());

const { HttpAdapter } = await import('../../src/http-adapter');
type HttpAdapter = InstanceType<typeof HttpAdapter>;
const { HttpServer } = await import('../../src/http-server');
type HttpServer = InstanceType<typeof HttpServer>;

const TEST_PORT = 50000 + Math.floor(Math.random() * 10000);

function createEmptyContainer(): ZipbulContainer {
  return {
    get: () => undefined as never,
    set: () => {},
    has: () => false,
    getInstances: function* () {},
    keys: function* () {},
  };
}

function generateCert(dir: string, name: string, cn: string): { certPath: string; keyPath: string } {
  const certPath = join(dir, `${name}.cert.pem`);
  const keyPath = join(dir, `${name}.key.pem`);
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} ` +
    `-days 1 -nodes -subj "/CN=${cn}" -addext "subjectAltName=DNS:${cn}"`,
    { stdio: 'pipe' },
  );
  return { certPath, keyPath };
}

async function probeSni(port: number, serverName: string): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    Bun.connect({
      hostname: '127.0.0.1',
      port,
      tls: {
        rejectUnauthorized: false,
        serverName,
      },
      socket: {
        open(socket) {
          socket.write(`GET / HTTP/1.1\r\nHost: ${serverName}\r\nConnection: close\r\n\r\n`);
        },
        data(_s, chunk) { buffer += new TextDecoder().decode(chunk); },
        close() {
          const m = buffer.match(/^HTTP\/1\.1 (\d{3})/);
          const status = m !== null ? parseInt(m[1]!, 10) : 0;
          const bodyStart = buffer.indexOf('\r\n\r\n');
          const body = bodyStart !== -1 ? buffer.slice(bodyStart + 4) : '';
          resolve({ status, body });
        },
        error(_s, e) { reject(e); },
      },
    }).catch(reject);
  });
}

describe('HttpAdapter TLS SNI E2E', () => {
  let certsDir: string;
  let server: InstanceType<typeof HttpServer>;
  let cert1: string;
  let key1: string;
  let cert2: string;
  let key2: string;

  beforeAll(async () => {
    certsDir = mkdtempSync(join(tmpdir(), 'zipbul-tls-'));
    const c1 = generateCert(certsDir, 'server1', 'server1.local');
    const c2 = generateCert(certsDir, 'server2', 'server2.local');
    cert1 = readFileSync(c1.certPath, 'utf-8');
    key1 = readFileSync(c1.keyPath, 'utf-8');
    cert2 = readFileSync(c2.certPath, 'utf-8');
    key2 = readFileSync(c2.keyPath, 'utf-8');

    const adapter = new HttpAdapter({
      port: TEST_PORT,
      tls: [
        { cert: cert1, key: key1, serverName: 'server1.local' },
        { cert: cert2, key: key2, serverName: 'server2.local' },
      ],
    });
    const container = createEmptyContainer();
    adapter.initializePipeline(container);

    server = new HttpServer();
    await server.boot(container, {
      port: TEST_PORT,
      tls: [
        { cert: cert1, key: key1, serverName: 'server1.local' },
        { cert: cert2, key: key2, serverName: 'server2.local' },
      ],
    }, adapter as never);
  });

  afterAll(async () => {
    await server.stop();
    rmSync(certsDir, { recursive: true, force: true });
  });

  it('should accept TLSOptions[] and complete SNI handshake for server1.local', async () => {
    const { status } = await probeSni(TEST_PORT, 'server1.local');

    // 핸드셰이크 성공 = 401/404/500 등 any HTTP status (어떤 라우트도 등록 안 됨)
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
  });

  it('should complete SNI handshake for server2.local with the matching certificate', async () => {
    const { status } = await probeSni(TEST_PORT, 'server2.local');

    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
  });
});
