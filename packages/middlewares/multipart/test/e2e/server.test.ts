import { afterAll, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';

import { MultipartErrorReason } from '../../src/enums';
import { MultipartError } from '../../src/interfaces';
import { Multipart } from '../../src/multipart';

// ── Server Setup ─────────────────────────────────────────────────────

interface FileInfo {
  filename?: string;
  size: number;
  contentType: string;
}

interface ResBody {
  _files: Record<string, FileInfo>;
  username?: string;
  email?: string;
  name?: string;
  greeting?: string;
  index?: string;
  tag?: string | string[];
  error?: string;
  message?: string;
  [key: string]: unknown;
}

function isFileInfo(v: unknown): v is FileInfo {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  if (f.filename !== undefined && typeof f.filename !== 'string') return false;
  if (typeof f.size !== 'number') return false;
  if (typeof f.contentType !== 'string') return false;
  return true;
}

function asResBody(raw: unknown): ResBody {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`expected object response, got ${raw === null ? 'null' : typeof raw}`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r._files !== 'object' || r._files === null || Array.isArray(r._files)) {
    throw new Error("response '_files' must be an object");
  }
  for (const [k, v] of Object.entries(r._files)) {
    if (!isFileInfo(v)) {
      throw new Error(`response _files.${k} is not a valid FileInfo`);
    }
  }
  for (const optStr of ['username', 'email', 'name', 'greeting', 'index', 'error', 'message'] as const) {
    if (r[optStr] !== undefined && typeof r[optStr] !== 'string') {
      throw new Error(`response field '${optStr}' must be a string when present`);
    }
  }
  if (r.tag !== undefined && typeof r.tag !== 'string'
    && !(Array.isArray(r.tag) && r.tag.every((x) => typeof x === 'string'))) {
    throw new Error("response 'tag' must be string or string[] when present");
  }
  return raw as ResBody;
}

function makeResponse(body: ResBody, status = 200): Response {
  return Response.json(body, { status });
}

const mp = Multipart.create({ maxFileSize: 1024 * 1024, maxFiles: 5, maxFields: 20 });

let server: Server<unknown>;

function startServer(): Server<unknown> {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      try {
        const { fields, files } = await mp.parseAll(request);

        const fileInfo: Record<string, FileInfo> = {};
        for (const [key, parts] of files) {
          const last = parts[parts.length - 1];
          if (last === undefined) continue;
          const data = await last.bytes();
          fileInfo[key] = {
            filename: last.filename,
            size: data.length,
            contentType: last.contentType,
          };
        }

        const body: ResBody = { _files: fileInfo };
        for (const [key, values] of fields) {
          body[key] = values.length === 1 ? values[0] : values;
        }

        return makeResponse(body);
      } catch (e) {
        if (e instanceof MultipartError) {
          return makeResponse({ _files: {}, error: e.reason, message: e.message }, 400);
        }

        return makeResponse({ _files: {}, error: 'unknown' }, 500);
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

function fileOf(json: ResBody, key: string): FileInfo {
  const f = json._files[key];
  if (f === undefined) throw new Error(`expected _files.${key} to be present`);
  return f;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('multipart e2e server', () => {
  test('fields-only form submission', async () => {
    const form = new FormData();
    form.append('username', 'alice');
    form.append('email', 'alice@example.com');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());

    expect(json.username).toBe('alice');
    expect(json.email).toBe('alice@example.com');
    expect(json._files).toEqual({});
  });

  test('file upload via FormData', async () => {
    const form = new FormData();
    const content = 'Hello, world!';
    form.append('file', new Blob([content], { type: 'text/plain' }), 'hello.txt');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());
    const file = fileOf(json, 'file');

    expect(file.filename).toBe('hello.txt');
    expect(file.size).toBe(content.length);
    expect(file.contentType).toStartWith('text/plain');
  });

  test('multiple file uploads', async () => {
    const form = new FormData();
    form.append('doc', new Blob(['file-a'], { type: 'text/plain' }), 'a.txt');
    form.append('image', new Blob(['file-b'], { type: 'image/png' }), 'b.png');
    form.append('data', new Blob(['file-c'], { type: 'application/json' }), 'c.json');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());
    const doc = fileOf(json, 'doc');
    const image = fileOf(json, 'image');
    const data = fileOf(json, 'data');

    expect(doc.filename).toBe('a.txt');
    expect(image.filename).toBe('b.png');
    expect(data.filename).toBe('c.json');
    expect(doc.size).toBe(6);
    expect(image.size).toBe(6);
    expect(data.size).toBe(6);
  });

  test('invalid Content-Type returns 400 with InvalidContentType', async () => {
    const res = await fetch(url('/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    });

    expect(res.status).toBe(400);

    const json = asResBody(await res.json());

    expect(json.error).toBe(MultipartErrorReason.InvalidContentType);
  });

  test('empty form returns 200 with empty files', async () => {
    const form = new FormData();

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());

    expect(json._files).toEqual({});
  });

  test('binary file upload (PNG header bytes)', async () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.append('avatar', new Blob([pngHeader], { type: 'image/png' }), 'avatar.png');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());

    expect(json._files.avatar).toEqual({
      filename: 'avatar.png',
      size: 8,
      contentType: 'image/png',
    });
  });

  test('large file upload (100KB) succeeds', async () => {
    const size = 100 * 1024;
    const data = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
      data[i] = i % 256;
    }

    const form = new FormData();
    form.append('bigfile', new Blob([data], { type: 'application/octet-stream' }), 'big.bin');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());
    const bigfile = fileOf(json, 'bigfile');

    expect(bigfile.size).toBe(size);
    expect(bigfile.filename).toBe('big.bin');
  });

  test('exceeding maxFiles limit returns 400 TooManyFiles', async () => {
    const form = new FormData();

    for (let i = 0; i < 6; i++) {
      form.append(`file${i}`, new Blob([`content-${i}`], { type: 'text/plain' }), `f${i}.txt`);
    }

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(400);

    const json = asResBody(await res.json());

    expect(json.error).toBe(MultipartErrorReason.TooManyFiles);
  });

  test('exceeding maxFields limit returns 400 TooManyFields', async () => {
    const form = new FormData();

    for (let i = 0; i < 21; i++) {
      form.append(`field${i}`, `value${i}`);
    }

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(400);

    const json = asResBody(await res.json());

    expect(json.error).toBe(MultipartErrorReason.TooManyFields);
  });

  test('UTF-8 form fields (Korean text)', async () => {
    const form = new FormData();
    form.append('name', '김철수');
    form.append('greeting', '안녕하세요, 세계!');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());

    expect(json.name).toBe('김철수');
    expect(json.greeting).toBe('안녕하세요, 세계!');
  });

  test('multiple values for same field name returns array', async () => {
    const form = new FormData();
    form.append('tag', 'javascript');
    form.append('tag', 'typescript');
    form.append('tag', 'bun');

    const res = await fetch(url('/'), { method: 'POST', body: form });

    expect(res.status).toBe(200);

    const json = asResBody(await res.json());

    expect(json.tag).toEqual(['javascript', 'typescript', 'bun']);
  });

  test('concurrent requests all succeed', async () => {
    const requests = Array.from({ length: 5 }, (_, i) => {
      const form = new FormData();
      form.append('index', String(i));
      form.append('file', new Blob([`data-${i}`], { type: 'text/plain' }), `file-${i}.txt`);

      return fetch(url('/'), { method: 'POST', body: form });
    });

    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const bodies = await Promise.all(
      responses.map(async (r) => asResBody(await r.json())),
    );
    const indices = bodies.map((b) => b.index).sort();

    expect(indices).toEqual(['0', '1', '2', '3', '4']);

    for (const body of bodies) {
      expect(body._files.file).toBeDefined();
    }
  });
});
