// sky.obelisk.ar: static host for the client, plus the chat's link unfurler.
//
// v2 has no relay connection and no keys on the server: the browser logs in
// with the user's own signer and talks to the relay itself.
//
//   GET /                  landing page (dist/client/index.html)
//   GET /app               the village (dist/client/app/index.html); old /?relay= links redirect here
//   GET /healthz           JSON status
//   GET /api/link-preview  OpenGraph unfurl for chat links (server/linkPreview.ts)
//   GET /api/avatar        a profile picture whose host sends no CORS (server/avatarProxy.ts)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLinkPreview } from './linkPreview';
import { handleAvatar } from './avatarProxy';

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
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.stl': 'model/stl',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
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

export function resolveStatic(pathname: string): { file: string; rel: string } | null {
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  } catch {
    return null;
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/app' || rel === '/app/') rel = '/app/index.html';
  let file = join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR)) return null;
  // Unknown paths: the village under /app, the landing page elsewhere.
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, rel.startsWith('/app/') ? 'app/index.html' : 'index.html');
  return { file, rel };
}

/** Links shared before the landing page existed (`/?relay=…`, `/?time=…`)
 *  opened the village: send them to /app with the same query. */
export function redirectFor(pathname: string, search: string): string | null {
  if (pathname !== '/' || !search) return null;
  const q = new URLSearchParams(search);
  return q.has('relay') || q.has('time') ? `/app${search}` : null;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const hit = resolveStatic(pathname);
  if (!hit) { res.writeHead(400).end(); return; }
  if (!existsSync(hit.file)) { res.writeHead(503).end('client not built'); return; }
  const type = MIME[extname(hit.file)] || 'application/octet-stream';
  const immutable = hit.rel.startsWith('/assets/') || hit.rel.startsWith('/models/');
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(hit.file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, built: existsSync(join(STATIC_DIR, 'index.html')) && existsSync(join(STATIC_DIR, 'app', 'index.html')) }));
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
  if (to) { res.writeHead(302, { location: to, 'cache-control': 'no-cache' }).end(); return; }
  serveStatic(req, res, url.pathname);
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => console.log(`obelisk-sky static on http://${HOST}:${PORT}`));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { server.close(); process.exit(0); });
}
