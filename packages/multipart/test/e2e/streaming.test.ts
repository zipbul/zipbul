import { afterAll, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';

import { MultipartError } from '../../src/interfaces';
import { Multipart } from '../../src/multipart';

// ── Server Setup ─────────────────────────────────────────────────────

interface PartSummary {
  name: string;
  filename?: string;
  size: number;
  contentType: string;
}

interface ResBody {
  parts: PartSummary[];
  count: number;
  error?: string;
}

function isPartSummary(v: unknown): v is PartSummary {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.name !== 'string') return false;
  if (p.filename !== undefined && typeof p.filename !== 'string') return false;
  if (typeof p.size !== 'number') return false;
  if (typeof p.contentType !== 'string') return false;
  return true;
}

function asResBody(raw: unknown): ResBody {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`expected object response, got ${raw === null ? 'null' : typeof raw}`);
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.parts)) {
    throw new Error("response missing 'parts' array");
  }
  for (const [i, p] of r.parts.entries()) {
    if (!isPartSummary(p)) {
      throw new Error(`response parts[${i}] is not a valid PartSummary`);
    }
  }
  if (typeof r.count !== 'number') {
    throw new Error("response missing 'count' number");
  }
  if (r.error !== undefined && typeof r.error !== 'string') {
    throw new Error("response 'error' must be a string when present");
  }
  return raw as ResBody;
}

function makeResponse(body: ResBody, status = 200): Response {
  return Response.json(body, { status });
}

function partAt(json: ResBody, idx: number): PartSummary {
  const p = json.parts[idx];
  if (p === undefined) throw new Error(`expected parts[${idx}] to be present (got ${json.parts.length})`);
  return p;
}

const mp = Multipart.create({ maxFileSize: 10 * 1024 * 1024 });

let server: Server<unknown>;

function startServer(): Server<unknown> {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      try {
        const parts: PartSummary[] = [];

        for await (const part of mp.parse(request)) {
          if (part.isFile) {
            const data = await part.bytes();
            parts.push({
              name: part.name,
              filename: part.filename,
              size: data.length,
              contentType: part.contentType,
            });
          } else {
            parts.push({
              name: part.name,
              size: part.bytes().length,
              contentType: part.contentType,
            });
          }
        }

        return makeResponse({ parts, count: parts.length });
      } catch (e) {
        if (e instanceof MultipartError) {
          return makeResponse({ parts: [], count: 0, error: e.reason }, 400);
        }

        return makeResponse({ parts: [], count: 0, error: 'unknown' }, 500);
      }
    },
  });
}

server = startServer();

afterAll(() => {
  server.stop(true);
});

function url(path = '/'): string {
  return `http://localhost:${server.port}${path}`;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('multipart e2e streaming', () => {
  test('stream-parse a 1MB file', async () => {
    const size = 1024 * 1024;
    const data = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
      data[i] = i % 256;
    }

    const form = new FormData();
    form.append('bigfile', new Blob([data], { type: 'application/octet-stream' }), 'oneMB.bin');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());
    const p = partAt(json, 0);

    expect(json.count).toBe(1);
    expect(p.name).toBe('bigfile');
    expect(p.filename).toBe('oneMB.bin');
    expect(p.size).toBe(size);
    expect(p.contentType).toBe('application/octet-stream');
  });

  test('stream-parse multiple files (3 files)', async () => {
    const form = new FormData();
    form.append('alpha', new Blob(['aaa'], { type: 'text/plain' }), 'alpha.txt');
    form.append('beta', new Blob(['bbbb'], { type: 'text/plain' }), 'beta.txt');
    form.append('gamma', new Blob(['ccccc'], { type: 'image/png' }), 'gamma.png');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());
    const p0 = partAt(json, 0);
    const p1 = partAt(json, 1);
    const p2 = partAt(json, 2);

    expect(json.count).toBe(3);

    expect(p0.name).toBe('alpha');
    expect(p0.filename).toBe('alpha.txt');
    expect(p0.size).toBe(3);
    expect(p0.contentType).toStartWith('text/plain');

    expect(p1.name).toBe('beta');
    expect(p1.filename).toBe('beta.txt');
    expect(p1.size).toBe(4);
    expect(p1.contentType).toStartWith('text/plain');

    expect(p2).toEqual({
      name: 'gamma',
      filename: 'gamma.png',
      size: 5,
      contentType: 'image/png',
    });
  });

  test('stream-parse mixed fields and files', async () => {
    const form = new FormData();
    form.append('username', 'bob');
    form.append('avatar', new Blob(['img-data'], { type: 'image/jpeg' }), 'avatar.jpg');
    form.append('bio', 'Hello there');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());

    expect(json.count).toBe(3);

    const fieldParts = json.parts.filter((p) => p.filename === undefined);
    const fileParts = json.parts.filter((p) => p.filename !== undefined);

    expect(fieldParts.length).toBe(2);
    expect(fileParts.length).toBe(1);

    const avatar = fileParts[0];
    if (avatar === undefined) throw new Error('expected one file part');

    expect(avatar.name).toBe('avatar');
    expect(avatar.filename).toBe('avatar.jpg');
    expect(avatar.size).toBe(8);
  });

  test('handles aborted request gracefully', async () => {
    const controller = new AbortController();
    const form = new FormData();
    form.append(
      'file',
      new Blob(['x'.repeat(1024 * 100)], { type: 'text/plain' }),
      'big.txt',
    );

    try {
      const promise = fetch(url('/'), {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });

      setTimeout(() => controller.abort(), 1);

      await promise;
    } catch {
      // AbortError expected on client side
    }

    // Verify server is still operational after the aborted request
    const healthForm = new FormData();
    healthForm.append('ping', 'pong');

    const res = await fetch(url('/'), { method: 'POST', body: healthForm });

    expect(res.status).toBe(200);
  });

  test('large file with many chunks (500KB)', async () => {
    const size = 500 * 1024;
    const data = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
      data[i] = i % 256;
    }

    const form = new FormData();
    form.append(
      'chunked',
      new Blob([data], { type: 'application/octet-stream' }),
      'halfMB.bin',
    );

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());
    const p = partAt(json, 0);

    expect(json.count).toBe(1);
    expect(p.name).toBe('chunked');
    expect(p.size).toBe(size);
    expect(p.filename).toBe('halfMB.bin');
  });

  test('stream-parse empty form returns 0 parts', async () => {
    const form = new FormData();

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());

    expect(json.count).toBe(0);
    expect(json.parts).toEqual([]);
  });
});
