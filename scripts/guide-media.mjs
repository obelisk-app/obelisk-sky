// The guides' pictures and clips (content/guides/media.json) encoded for the site:
// client/public/media/guides/<name>[-<lang>]-<width>.<hash>.webp for pictures,
// <name>.<hash>.mp4 plus its first frame as the poster for clips. Names carry a
// hash of the bytes, so Cloudflare can keep them a year (server cacheControl /media/).
// The result goes to content/guides/media.lock.json, which scripts/build-guides.mjs reads;
// an entry whose source and settings haven't changed is kept as it is, so the guides
// build without the obelisk-media checkout once the media is encoded.
//
//   node scripts/guide-media.mjs [name…]   (OBELISK_MEDIA=../obelisk-media)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = resolve(process.env.OBELISK_MEDIA || join(ROOT, '..', 'obelisk-media'));
const OUT = join(ROOT, 'client', 'public', 'media', 'guides');
const MANIFEST = join(ROOT, 'content', 'guides', 'media.json');
const LOCK = join(ROOT, 'content', 'guides', 'media.lock.json');
const LANGS = ['en', 'es'];
const CLIP_WIDTH = 1280, CLIP_FPS = 30, SHOT_WIDTHS = [1280, 640];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : {};
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

const srcPath = (src, lang) => {
  const p = src.replace('{lang}', lang);
  return p.startsWith('sky:') ? join(ROOT, p.slice(4)) : join(MEDIA, p);
};
const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
/** What decides an entry's output: its settings and its sources' sizes and times. */
function signature(entry) {
  const files = [...new Set(LANGS.map((l) => srcPath(entry.src, l)))].map((f) => {
    if (!existsSync(f)) return `${f}:missing`;
    const st = statSync(f);
    return st.isDirectory() ? `${f}:${readdirSync(f).length}` : `${f}:${st.size}:${Math.round(st.mtimeMs)}`;
  });
  return hash8(JSON.stringify({ ...entry, alt: undefined, files, CLIP_WIDTH, CLIP_FPS, SHOT_WIDTHS }));
}
/** Writes `buf` as <base>.<hash>.<ext>, dropping that base's older versions. */
function put(base, ext, buf) {
  for (const f of readdirSync(OUT)) if (f.startsWith(`${base}.`) && f.endsWith(`.${ext}`)) rmSync(join(OUT, f));
  const name = `${base}.${hash8(buf)}.${ext}`;
  writeFileSync(join(OUT, name), buf);
  return `/media/guides/${name}`;
}

async function encodeShot(name, entry) {
  const perLang = entry.src.includes('{lang}');
  const out = { kind: 'shot', perLang };
  for (const lang of perLang ? LANGS : ['en']) {
    let img = sharp(srcPath(entry.src, lang));
    if (entry.crop) {
      const [left, top, width, height] = entry.crop;
      img = img.extract({ left, top, width, height });
    }
    const buf = await img.png().toBuffer();
    const { width, height } = await sharp(buf).metadata();
    const files = {};
    for (const w of SHOT_WIDTHS) {
      const tw = Math.min(w, width);
      files[w] = put(`${name}${perLang ? `-${lang}` : ''}-${w}`, 'webp', await sharp(buf).resize({ width: tw }).webp({ quality: 82 }).toBuffer());
    }
    out[lang] = { width: Math.min(SHOT_WIDTHS[0], width), height: Math.round(height * Math.min(SHOT_WIDTHS[0], width) / width), src: files[SHOT_WIDTHS[0]], small: files[SHOT_WIDTHS[1]] };
  }
  return out;
}

function encodeClip(name, entry) {
  const tmp = mkdtempSync(join(tmpdir(), 'guide-clip-'));
  const mp4 = join(tmp, 'clip.mp4');
  const src = srcPath(entry.src, 'en');
  const input = entry.frames
    ? ['-framerate', String(entry.fps || 60), '-start_number', String(Math.round((entry.start ?? 0) * (entry.fps || 60))), '-i', join(src, '%05d.png')]
    : [...(entry.start ? ['-ss', String(entry.start)] : []), ...(entry.seconds ? ['-t', String(entry.seconds)] : []), '-i', src];
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...input, '-an',
    '-vf', `fps=${CLIP_FPS},scale='min(${CLIP_WIDTH},iw)':-2:flags=lanczos`,
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  const poster = join(tmp, 'poster.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-frames:v', '1', poster]);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', mp4], { encoding: 'utf8' }));
  const out = {
    kind: 'clip',
    width: probe.streams[0].width,
    height: probe.streams[0].height,
    seconds: Math.round(Number(probe.format.duration) * 10) / 10,
    src: put(name, 'mp4', readFileSync(mp4)),
  };
  return sharp(poster).webp({ quality: 80 }).toBuffer().then((buf) => {
    out.poster = put(`${name}-poster`, 'webp', buf);
    rmSync(tmp, { recursive: true, force: true });
    return out;
  });
}

let changed = 0;
for (const [name, entry] of Object.entries(manifest)) {
  if (name.startsWith('$') || (only.length && !only.includes(name))) continue;
  const sig = signature(entry);
  if (lock[name]?.sig === sig && !only.length) continue;
  const missing = LANGS.map((l) => srcPath(entry.src, l)).find((f) => !existsSync(f));
  if (missing) {
    if (lock[name]) { console.warn(`${name}: ${missing} is not here; keeping the encoded one`); continue; }
    throw new Error(`${name}: no source at ${missing}`);
  }
  const done = entry.kind === 'clip' ? await encodeClip(name, entry) : await encodeShot(name, entry);
  lock[name] = { sig, ...done };
  changed++;
  console.log(`${name}: ${entry.kind === 'clip' ? `${done.src} (${(statSync(join(ROOT, 'client', 'public', done.src)).size / 1024).toFixed(0)} KB)` : 'ok'}`);
}
// Entries no longer in the manifest, and their files.
for (const name of Object.keys(lock)) {
  if (manifest[name]) continue;
  for (const f of readdirSync(OUT)) if (f.startsWith(`${name}.`) || f.startsWith(`${name}-`)) rmSync(join(OUT, f));
  delete lock[name];
  changed++;
}
const sorted = Object.fromEntries(Object.keys(lock).sort().map((k) => [k, lock[k]]));
writeFileSync(LOCK, JSON.stringify(sorted, null, 2) + '\n');
console.log(`${changed} changed, ${Object.keys(sorted).length} in media.lock.json`);
