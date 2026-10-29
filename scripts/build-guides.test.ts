import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

describe('guides', () => {
  // Same slugs in every language, titles and descriptions within search limits, every
  // picture encoded with alt text, every how-to step on a heading (scripts/build-guides.mjs).
  it('build, as checked by the generator', () => {
    expect(execFileSync('node', ['scripts/build-guides.mjs', '--check'], { cwd: root, encoding: 'utf8' })).toMatch(/pages ok/);
  });
  it('point every picture at a file that is there', () => {
    const lock = JSON.parse(readFileSync(join(root, 'content/guides/media.lock.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    const urls = JSON.stringify(lock).match(/\/media\/guides\/[^"]+/g)!;
    expect(urls.length).toBeGreaterThan(20);
    for (const u of urls) expect(() => readFileSync(join(root, 'client/public', u)), u).not.toThrow();
  });
});
