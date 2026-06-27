/**
 * Micro-benchmarks for the @zipbul/cookie hot paths (Bun + mitata). Run: `bun run bench`.
 * Measures the codec (serialize / parse) and the crypto layer (sign / encrypt) so the "Bun-native /
 * optimized" claims are backed by numbers rather than assertion. Not shipped (dev-only).
 */
import { bench, run } from 'mitata';
import { Cookie } from 'bun';

import { CookieParser, CookieJar, SameSite } from '../index';

const SIGNING_SECRET = 'gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg';
const ENCRYPTION_SECRET = '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4';

const plain = CookieParser.create();
const signing = CookieParser.create({ secrets: [SIGNING_SECRET] });
const encrypting = CookieParser.create({ encryptionSecret: ENCRYPTION_SECRET });

const cookie = new Cookie('session', 'user:42', { path: '/', secure: true, httpOnly: true, sameSite: SameSite.Lax });
const cookieWithExpires = new Cookie('session', 'user:42', { path: '/', secure: true, expires: new Date(Date.UTC(2030, 0, 1)) });
const inboundHeader = 'sid=abc123; theme=dark; _ga=GA1.2.345678.9012; locale=en-US; cart=a%2Cb%2Cc';
const cookieToProtect = new Cookie('session', JSON.stringify({ userId: 42, role: 'admin' }));

bench('serialize — no expires', () => { plain.serialize(cookie); });
bench('serialize — with expires (Expires rewrite path)', () => { plain.serialize(cookieWithExpires); });
bench('parse — 5-cookie inbound header (CookieJar)', () => { new CookieJar(plain, inboundHeader); });
bench('sign (HMAC, cached key)', () => { signing.sign(cookieToProtect); });
bench('encrypt (AES-256-GCM)', async () => { await encrypting.encrypt(cookieToProtect); });

await run();
