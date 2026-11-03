// sky.obelisk.ar: static host for the client, plus the chat's link unfurler.
//
// v2 has no relay connection and no keys on the server: the browser logs in
// with the user's own signer and talks to the relay itself.
//
//   GET /                  landing page (dist/client/index.html)
//   GET /app               the village (dist/client/app/index.html); old /?relay= links redirect here
//   GET /guides, /es/guides the guides (dist/client/guides/…/index.html, built by scripts/build-guides.mjs)
//   GET /healthz           JSON status
//   GET /api/link-preview  OpenGraph unfurl for chat links (server/linkPreview.ts)
//   GET /api/avatar        a profile picture whose host sends no CORS (server/avatarProxy.ts)
//   /api/lacrypta-tickets/ La Crypta's Halloween checkout, which sends no CORS (server/ticketProxy.ts)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLinkPreview } from './linkPreview';
import { handleAvatar } from './avatarProxy';
import { handleTickets, TICKETS_PREFIX } from './ticketProxy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3024);
const HOST = process.env.HOST || '127.0.0.1';
const STATIC_DIR = join(ROOT, 'dist', 'client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.stl': 'model/stl',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// The model loader reads textures embedded in .glb files through blob: URLs
// and decodes meshopt geometry with WebAssembly ('wasm-unsafe-eval' allows
// compiling wasm, not eval of script). The client connects to relays (wss:) and loads profile pictures from
// anywhere (img-src https:). Scripts and styles are first-party only, plus
// Google Fonts for the bubble typefaces. LABITCONF's stage plays a YouTube
// embed and the totem monitor on its lawn shows totemcillo (frame-src,
// world/youtubeStage.ts, world/totemMonitor.ts TOTEM_ORIGIN).
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'microphone=(self), camera=(self), display-capture=(self)',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
    "connect-src 'self' wss: https: blob: data:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; " +
    "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://totemcillo.vercel.app; frame-ancestors 'self'",
};

/** `fallback`: no such file, so a page stands in (never cached for long).
 *  `status`: 404 for a missing guide, whose page says so (a landing page sent
 *  as a 200 there would be indexed as the guide). */
export function resolveStatic(pathname: string): { file: string; rel: string; fallback: boolean; status: number } | null {
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  } catch {
    return null;
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/app' || rel === '/app/') rel = '/app/index.html';
  // A page's folder serves its index.html (/guides, /es/guides/<slug>).
  if (!extname(rel) && existsSync(join(STATIC_DIR, rel, 'index.html'))) rel = join(rel, 'index.html');
  let file = join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR)) return null;
  // Unknown paths: the village under /app, a 404 under the guides, the landing page elsewhere.
  const fallback = !existsSync(file) || statSync(file).isDirectory();
  if (fallback && isGuidePath(rel)) return { file: join(STATIC_DIR, 'guides', '404.html'), rel, fallback, status: 404 };
  if (fallback) file = join(STATIC_DIR, rel.startsWith('/app/') ? 'app/index.html' : 'index.html');
  return { file, rel, fallback, status: 200 };
}

const isGuidePath = (rel: string) => /^\/(?:es\/)?guides(?:\/|$)/.test(rel) || rel.startsWith('/es/');

/** Links shared before the landing page existed (`/?relay=…`, `/?time=…`)
 *  opened the village: send them to /app with the same query. */
export function redirectFor(pathname: string, search: string): string | null {
  // A guide's address has no trailing slash (its canonical); /es alone is the landing page in Spanish.
  if (pathname === '/es' || pathname === '/es/') return '/?lang=es';
  if (/^\/(?:es\/)?guides(?:\/[a-z0-9-]+)?\/$/.test(pathname)) return pathname.slice(0, -1) + search;
  // A relay invite link: the village reads `?invite=` and keeps the code
  // (client/src/nostr/invite.ts). The server only rewrites the address.
  const invite = /^\/invite\/([A-Za-z0-9_-]{1,64})\/?$/.exec(pathname);
  if (invite) {
    const q = new URLSearchParams(search);
    const out = new URLSearchParams({ invite: invite[1] });
    const relay = q.get('relay');
    if (relay) out.set('relay', relay);
    return `/app?${out.toString()}`;
  }
  if (pathname !== '/' || !search) return null;
  const q = new URLSearchParams(search);
  return q.has('relay') || q.has('time') ? `/app${search}` : null;
}

/** A content-hashed name, `<name>.<8 hex>.<ext>` (scripts/hash-assets.mjs, scripts/guide-media.mjs). */
const HASHED = /\.[0-9a-f]{8}\.[a-z0-9]+$/;

/** Hashed bundles, models under their hashed names (the client asks for
 *  nothing else, client/src/world/assetUrl.ts), the guides' media (hashed
 *  names) and the landing page's media (its URLs carry `?v=`) are kept a
 *  year; everything else is checked every time. Cloudflare keeps the same
 *  (scripts/cf-cache-rules.mjs). */
export function cacheControl(rel: string): string {
  const immutable = rel.startsWith('/assets/') || rel.startsWith('/landing/') || rel.startsWith('/media/')
    || (rel.startsWith('/models/') && HASHED.test(rel));
  return immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/** The precompressed copy of `file` to send (`.br`, then `.gz`, written by
 *  scripts/hash-assets.mjs beside the file) for this `Accept-Encoding`. */
export function pickEncoding(accept: string | string[] | undefined, file: string, exists: (f: string) => boolean = existsSync): { encoding: 'br' | 'gzip'; file: string } | null {
  const a = (Array.isArray(accept) ? accept.join(',') : accept ?? '').toLowerCase();
  const offered = (name: string) => a.split(',').some((p) => {
    const [token, ...params] = p.trim().split(';');
    return token.trim() === name && !params.some((x) => /^\s*q\s*=\s*0(\.0*)?\s*$/.test(x));
  });
  if (offered('br') && exists(`${file}.br`)) return { encoding: 'br', file: `${file}.br` };
  if (offered('gzip') && exists(`${file}.gz`)) return { encoding: 'gzip', file: `${file}.gz` };
  return null;
}

/** One `Range: bytes=…` span of a `size`-byte file: `null` to send it whole
 *  (no header, several spans, not bytes), `'unsatisfiable'` for a 416. Safari
 *  plays a <video> only from a server that answers ranges. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number, end: number;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

/** The visitor's country as Cloudflare sees it (`cf-ipcountry`), handed to the page as the
 *  `sky-country` cookie so the landing page and the village can start in Spanish for a visitor
 *  from a Spanish-speaking country (client/src/landing/copy.ts `pickLang`). Null when there is
 *  no usable country (no Cloudflare, `XX` unknown, `T1` Tor). */
export function countryCookie(header: string | string[] | undefined): string | null {
  const c = (Array.isArray(header) ? header[0] : header)?.trim().toUpperCase();
  if (!c || !/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1') return null;
  return `sky-country=${c}; Path=/; Max-Age=86400; SameSite=Lax`;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const hit = resolveStatic(pathname);
  if (!hit) { res.writeHead(400).end(); return; }
  if (!existsSync(hit.file)) { res.writeHead(503).end('client not built'); return; }
  const st = statSync(hit.file);
  const compressible = existsSync(`${hit.file}.br`) || existsSync(`${hit.file}.gz`);
  const enc = pickEncoding(req.headers['accept-encoding'], hit.file);
  const lastModified = new Date(Math.floor(st.mtimeMs / 1000) * 1000);
  const headers = {
    ...SECURITY_HEADERS,
    'content-type': MIME[extname(hit.file)] || 'application/octet-stream',
    'cache-control': hit.fallback ? 'no-cache' : cacheControl(hit.rel),
    'accept-ranges': enc ? 'none' : 'bytes',
    'last-modified': lastModified.toUTCString(),
    ...(compressible ? { vary: 'accept-encoding' } : {}),
    ...(enc ? { 'content-encoding': enc.encoding } : {}),
    ...(extname(hit.file) === '.html' && countryCookie(req.headers['cf-ipcountry']) ? { 'set-cookie': countryCookie(req.headers['cf-ipcountry'])! } : {}),
  };
  // Revalidation of a `no-cache` file (sounds, the manifest, pages) that hasn't changed.
  const since = Date.parse(String(req.headers['if-modified-since'] ?? ''));
  if (hit.status === 200 && !hit.fallback && !Number.isNaN(since) && lastModified.getTime() <= since) {
    res.writeHead(304, headers).end();
    return;
  }
  if (enc) {
    // The compressed copy, whole: ranges are only for media, which isn't compressed.
    res.writeHead(hit.status, { ...headers, 'content-length': statSync(enc.file).size });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(enc.file).pipe(res);
    return;
  }
  const size = st.size;
  const range = hit.status === 200 ? parseRange(req.headers.range, size) : null;
  if (range === 'unsatisfiable') { res.writeHead(416, { ...headers, 'cache-control': 'no-cache', 'content-range': `bytes */${size}` }).end(); return; }
  if (range) res.writeHead(206, { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${size}`, 'content-length': range.end - range.start + 1 });
  else res.writeHead(hit.status, { ...headers, 'content-length': size });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(hit.file, range ?? {}).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, built: existsSync(join(STATIC_DIR, 'index.html')) && existsSync(join(STATIC_DIR, 'app', 'index.html')) }));
    return;
  }
  if (url.pathname.startsWith(TICKETS_PREFIX)) {
    handleTickets(req, res, url).catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (url.pathname === '/api/link-preview') {
    handleLinkPreview(req, res, url).catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
    return;
  }
  if (url.pathname === '/api/avatar') {
    handleAvatar(req, res, url).catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
    return;
  }
  const to = redirectFor(url.pathname, url.search);
  // A guide's address without its trailing slash is the same page for good (301); the rest may change.
  if (to) { res.writeHead(/^\/(?:es\/)?guides\//.test(url.pathname) ? 301 : 302, { location: to, 'cache-control': 'no-cache' }).end(); return; }
  serveStatic(req, res, url.pathname);
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => console.log(`obelisk-sky static on http://${HOST}:${PORT}`));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { server.close(); process.exit(0); });
}
