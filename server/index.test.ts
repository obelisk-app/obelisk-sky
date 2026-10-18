import { describe, it, expect } from 'vitest';
import { TOTEM_ORIGIN } from '../client/src/world/totemMonitor';
process.env.NODE_ENV = 'test';
const { resolveStatic, redirectFor, SECURITY_HEADERS } = await import('./index');

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
  });
  it('sends old village links (/?relay=, /?time=) to /app', () => {
    expect(redirectFor('/', '?relay=public.obelisk.ar')).toBe('/app?relay=public.obelisk.ar');
    expect(redirectFor('/', '?time=night')).toBe('/app?time=night');
    expect(redirectFor('/', '?lang=es')).toBeNull();
    expect(redirectFor('/', '')).toBeNull();
    expect(redirectFor('/app', '?relay=x')).toBeNull();
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
