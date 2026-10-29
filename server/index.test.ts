import { describe, it, expect } from 'vitest';
import { TOTEM_ORIGIN } from '../client/src/world/totemMonitor';
process.env.NODE_ENV = 'test';
const { resolveStatic, redirectFor, SECURITY_HEADERS, parseRange, cacheControl, countryCookie } = await import('./index');

describe('static host', () => {
  it('never resolves outside the client build', () => {
    for (const p of ['/../../.env', '/..%2f..%2f.env', '/%2e%2e/%2e%2e/etc/passwd']) {
      const r = resolveStatic(p);
      expect(r === null || r.file.includes('/dist/client/')).toBe(true);
    }
  });
  it('serves the landing page at / and the village under /app', () => {
    expect(resolveStatic('/')!.file).toMatch(/dist\/client\/index\.html$/);
    for (const p of ['/app', '/app/', '/app/some/deep/link']) expect(resolveStatic(p)!.file, p).toMatch(/dist\/client\/app\/index\.html$/);
    expect(resolveStatic('/nowhere')!.file).toMatch(/dist\/client\/index\.html$/);
    expect(resolveStatic('/application')!.file).toMatch(/dist\/client\/index\.html$/);
    expect(resolveStatic('/assets/x.js')!.rel).toBe('/assets/x.js');
    // A missing file is a fallback page, never kept a year under an asset's URL.
    expect(resolveStatic('/landing/nope.mp4')!.fallback).toBe(true);
  });
  it('keeps hashed bundles, models and the landing media a year, and checks pages every time', () => {
    for (const p of ['/assets/app-x.js', '/models/town/a.glb', '/landing/island-orbit.mp4', '/media/guides/plaza.1a2b3c4d.mp4']) expect(cacheControl(p), p).toMatch(/max-age=31536000, immutable/);
    for (const p of ['/index.html', '/app/index.html', '/og.jpg', '/sounds/manifest.json', '/guides/index.html', '/sitemap.xml']) expect(cacheControl(p), p).toBe('no-cache');
  });
  it('answers byte ranges, as Safari needs to play the landing video', () => {
    expect(parseRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
    for (const h of ['bytes=100-', 'bytes=5-2', 'bytes=-0']) expect(parseRange(h, 100), h).toBe('unsatisfiable');
    for (const h of [undefined, '', 'bytes=-', 'bytes=0-1,5-9', 'items=0-1']) expect(parseRange(h, 100), String(h)).toBeNull();
  });
  it('sends old village links (/?relay=, /?time=) to /app', () => {
    expect(redirectFor('/', '?relay=public.obelisk.ar')).toBe('/app?relay=public.obelisk.ar');
    expect(redirectFor('/', '?time=night')).toBe('/app?time=night');
    expect(redirectFor('/', '?lang=es')).toBeNull();
    expect(redirectFor('/', '')).toBeNull();
    // Relay invite links go to the village, carrying only the code and the relay.
    expect(redirectFor('/invite/Xk3abc_-9', '?relay=public.obelisk.ar')).toBe('/app?invite=Xk3abc_-9&relay=public.obelisk.ar');
    expect(redirectFor('/invite/Xk3abc', '')).toBe('/app?invite=Xk3abc');
    expect(redirectFor('/invite/Xk3abc', '?relay=a.example&evil=1')).toBe('/app?invite=Xk3abc&relay=a.example');
    expect(redirectFor('/invite/bad%20code', '')).toBeNull();
    expect(redirectFor('/invite/', '')).toBeNull();
    expect(redirectFor('/app', '?relay=x')).toBeNull();
  });
  it('hands the page the visitor\'s country from Cloudflare, and nothing it cannot use', () => {
    expect(countryCookie('AR')).toBe('sky-country=AR; Path=/; Max-Age=86400; SameSite=Lax');
    expect(countryCookie(' es ')).toMatch(/^sky-country=ES;/);
    for (const h of [undefined, '', 'XX', 'T1', 'ARG', 'A1;x=1']) expect(countryCookie(h), String(h)).toBeNull();
  });
  it('gives each guide one address, without a trailing slash', () => {
    expect(redirectFor('/guides/', '')).toBe('/guides');
    expect(redirectFor('/guides/getting-started/', '?x=1')).toBe('/guides/getting-started?x=1');
    expect(redirectFor('/es/guides/', '')).toBe('/es/guides');
    expect(redirectFor('/es/', '')).toBe('/?lang=es');
    expect(redirectFor('/guides', '')).toBeNull();
    expect(redirectFor('/guides/getting-started', '')).toBeNull();
  });
  it('answers a missing guide with a 404 page, not the landing page', () => {
    for (const p of ['/guides/nope', '/es/guides/nope', '/es/whatever', '/guides/a/b.png']) {
      const r = resolveStatic(p)!;
      expect(r.status, p).toBe(404);
      expect(r.file, p).toMatch(/dist\/client\/guides\/404\.html$/);
    }
    expect(resolveStatic('/nowhere')!.status).toBe(200);
    expect(resolveStatic('/app/x')!.status).toBe(200);
  });
  it('serves no keys and allows only first-party scripts', () => {
    expect(SECURITY_HEADERS['content-security-policy']).toContain("script-src 'self'");
    expect(SECURITY_HEADERS['content-security-policy']).toContain('connect-src');
    // GLB textures load through blob: URLs; meshopt decodes with WebAssembly.
    expect(SECURITY_HEADERS['content-security-policy']).toMatch(/connect-src[^;]*blob:/);
    expect(SECURITY_HEADERS['content-security-policy']).toMatch(/script-src[^;]*'wasm-unsafe-eval'/);
    expect(SECURITY_HEADERS['content-security-policy']).not.toMatch(/'unsafe-eval'/);
    // LABITCONF's stage: a YouTube embed, and no other frames.
    expect(SECURITY_HEADERS['content-security-policy']).toMatch(/frame-src https:\/\/www.youtube-nocookie.com/);
  });
  it('frames totemcillo for the monitor on LABITCONF\'s lawn, and nothing else new', () => {
    const frames = SECURITY_HEADERS['content-security-policy'].match(/frame-src ([^;]*)/)![1].split(' ');
    expect(frames.sort()).toEqual([TOTEM_ORIGIN, 'https://www.youtube-nocookie.com', 'https://www.youtube.com'].sort());
  });
  it('lets the page use the mic, the camera and screen sharing (calls), nothing else of the kind', () => {
    const p = SECURITY_HEADERS['permissions-policy'];
    expect(p).toContain('microphone=(self)');
    expect(p).toContain('camera=(self)');
    expect(p).toContain('display-capture=(self)');
  });
});
