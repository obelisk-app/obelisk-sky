// The guides at /guides and /es/guides: content/guides/<lang>/<slug>.md turned into
// plain HTML pages that read without JavaScript, for people and for search engines.
// Writes client/guides/** and client/es/guides/** (Vite inputs, client/vite.config.ts;
// gitignored), client/public/sitemap.xml, and each guide's link card under
// client/public/og/guides (drawn once per title and picture; committed).
//
// A guide is Markdown with frontmatter (title, description, seoTitle?, seoDescription?,
// hero, publishedAt, updatedAt, tags, howTo?) and three tags of its own, as in obelisk-dex:
//   <Shot name="minimap" caption="…" />   a picture from content/guides/media.json
//   <Clip name="ride" caption="…" />      a muted looping clip (poster first)
//   <Callout>Markdown</Callout>           a note in a frosted card
// The pictures are encoded by scripts/guide-media.mjs (media.lock.json).
//
//   node scripts/build-guides.mjs [--check]   (--check: validate only, write nothing)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { Marked } from 'marked';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content', 'guides');
const CLIENT = join(ROOT, 'client');
const SITE = 'https://sky.obelisk.ar';
const LANGS = ['en', 'es'];
const CHECK = process.argv.includes('--check');
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const media = JSON.parse(readFileSync(join(CONTENT, 'media.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(CONTENT, 'media.lock.json'), 'utf8'));

const WORDS = {
  en: {
    locale: 'en_US', guides: 'Guides', home: 'Obelisk Sky', enter: 'Enter', enterIsland: 'Enter the island',
    indexTitle: 'Obelisk Sky guides: the Nostr village, step by step',
    indexH1: 'Guides', indexKicker: 'Obelisk Sky',
    indexLead: 'How to get into the village, find your channels, make your character yours and hang out: everything Obelisk Sky does, with pictures.',
    indexDescription: 'Step-by-step guides to Obelisk Sky, the 3D Nostr village: log in, walk to channels, change your look, ride, swim, drink mate, join calls and play.',
    read: (n) => `${n} min read`, updated: 'Updated', related: 'More guides', allGuides: 'All guides',
    ctaTitle: 'The island is up. Come in.', ctaNote: 'Free, in your browser. Walk around as a guest or log in with Nostr.',
    part: 'Part of Obelisk', lang: 'Language', breadcrumb: 'Breadcrumb', clipLabel: 'Clip',
    date: (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  },
  es: {
    locale: 'es_AR', guides: 'Guías', home: 'Obelisk Sky', enter: 'Entrar', enterIsland: 'Entrar a la isla',
    indexTitle: 'Guías de Obelisk Sky: el pueblo de Nostr, paso a paso',
    indexH1: 'Guías', indexKicker: 'Obelisk Sky',
    indexLead: 'Cómo entrar al pueblo, encontrar tus canales, armar tu personaje y pasarla bien: todo lo que hace Obelisk Sky, con imágenes.',
    indexDescription: 'Guías paso a paso de Obelisk Sky, el pueblo 3D de Nostr: entrá, caminá a los canales, cambiá tu look, montá, nadá, tomá mate, sumate a llamadas y jugá.',
    read: (n) => `${n} min de lectura`, updated: 'Actualizada', related: 'Más guías', allGuides: 'Todas las guías',
    ctaTitle: 'La isla está arriba. Pasá.', ctaNote: 'Gratis, en tu navegador. Recorrela como invitado o entrá con Nostr.',
    part: 'Parte de Obelisk', lang: 'Idioma', breadcrumb: 'Ruta', clipLabel: 'Clip',
    date: (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  },
};

const errors = [];
const fail = (msg) => errors.push(msg);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const prefix = (lang) => (lang === 'en' ? '' : `/${lang}`);
const guideUrl = (lang, slug) => `${prefix(lang)}/guides${slug ? `/${slug}` : ''}`;
const abs = (path) => `${SITE}${path}`;
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

// ── content ──
function loadGuides(lang) {
  const dir = join(CONTENT, lang);
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const slug = f.slice(0, -3);
    if (!SLUG.test(slug)) fail(`${lang}/${f}: the file name is not a slug`);
    const { data, content } = matter(readFileSync(join(dir, f), 'utf8'));
    const fm = { ...data, publishedAt: ymd(data.publishedAt), updatedAt: ymd(data.updatedAt), tags: data.tags ?? [] };
    for (const k of ['title', 'description', 'hero', 'publishedAt', 'updatedAt', 'order']) if (fm[k] === undefined) fail(`${lang}/${slug}: no ${k}`);
    const words = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    return { lang, slug, fm, body: content, minutes: Math.max(1, Math.round(words / 220)) };
  }).sort((a, b) => a.fm.order - b.fm.order);
}

/** A media entry's picture in `lang`: { src, small?, width, height, poster? }. */
function asset(name, lang, where) {
  const m = lock[name];
  if (!m || !media[name]) { fail(`${where}: no media "${name}" (content/guides/media.json, then scripts/guide-media.mjs)`); return null; }
  const alt = media[name].alt?.[lang];
  if (!alt) fail(`${where}: media "${name}" has no ${lang} alt text`);
  if (m.kind === 'clip') return { kind: 'clip', ...m, alt };
  const v = m.perLang ? m[lang] : m.en;
  return { kind: 'shot', ...v, alt };
}

function figureHtml(a, caption, opts = {}) {
  if (!a) return '';
  const cap = caption ? `<figcaption>${esc(caption)}</figcaption>` : '';
  const style = opts.maxWidth ? ` style="max-width:${Number(opts.maxWidth)}px"` : '';
  if (a.kind === 'clip') {
    return `<figure class="g-fig g-clip"${style}><video muted loop playsinline disablepictureinpicture preload="none" poster="${a.poster}" width="${a.width}" height="${a.height}" aria-label="${esc(a.alt)}"><source src="${a.src}" type="video/mp4" /></video>${cap}</figure>`;
  }
  const srcset = a.small && a.small !== a.src ? ` srcset="${a.small} 640w, ${a.src} ${a.width}w" sizes="(max-width: 760px) 100vw, 720px"` : '';
  const tall = a.height > a.width ? ' g-tall' : '';
  return `<figure class="g-fig${tall}"${style}><img src="${a.src}"${srcset} alt="${esc(a.alt)}" width="${a.width}" height="${a.height}" loading="lazy" decoding="async" />${cap}</figure>`;
}

const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)=(?:"([^"]*)"|\{([^}]*)\})/g)].map((m) => [m[1], m[2] ?? m[3]]));

/** The body as HTML, and every picture and clip it shows (for JSON-LD and the sitemap). */
function renderBody(g) {
  const marked = new Marked({ gfm: true });
  const used = [];
  const blocks = [];
  const hold = (html) => `\n\n<!--block:${blocks.push(html) - 1}-->\n\n`;
  let src = g.body.replace(/<Callout>([\s\S]*?)<\/Callout>/g, (_, inner) => hold(`<aside class="g-callout">${marked.parse(inner.trim())}</aside>`));
  src = src.replace(/<(Shot|Clip)\s([^>]*?)\/>/g, (_, tag, rest) => {
    const a = attrs(rest);
    const item = asset(a.name, g.lang, `${g.lang}/${g.slug}`);
    if (item && (tag === 'Clip') !== (item.kind === 'clip')) fail(`${g.lang}/${g.slug}: <${tag} name="${a.name}"> is a ${item.kind}`);
    if (item) used.push({ name: a.name, caption: a.caption, ...item });
    return hold(figureHtml(item, a.caption, a));
  });
  if (/<(Shot|Clip|Callout)\b/.test(src)) fail(`${g.lang}/${g.slug}: a <Shot>, <Clip> or <Callout> the build couldn't read`);
  let html = marked.parse(src);
  html = html.replace(/<!--block:(\d+)-->/g, (_, i) => blocks[Number(i)]);
  // Headings get ids, so a section can be linked to.
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_, n, inner) => {
    const id = inner.replace(/<[^>]+>/g, '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `<h${n} id="${id}">${inner}</h${n}>`;
  });
  // Links out of the site open in a new tab.
  html = html.replace(/<a href="(https?:\/\/(?!sky\.obelisk\.ar)[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"');
  return { html, used };
}

// ── page parts ──
const SOCIAL = `<span class="foot-social">
      <a href="https://www.instagram.com/obelisk.ar" target="_blank" rel="noopener" aria-label="Instagram @obelisk.ar" title="Instagram @obelisk.ar"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="6" width="20" height="20" rx="6"/><circle cx="16" cy="16" r="5"/><circle class="dot" cx="21.6" cy="10.4" r="1"/></svg></a>
      <a href="https://www.youtube.com/@obelisk_ar" target="_blank" rel="noopener" aria-label="YouTube @obelisk_ar" title="YouTube @obelisk_ar"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="8" width="24" height="16" rx="5"/><path class="play" d="M13.5 12.5 20 16l-6.5 3.5Z"/></svg></a>
      <a href="https://x.com/obelisk_ar" target="_blank" rel="noopener" aria-label="X @obelisk_ar" title="X @obelisk_ar"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 7h5l13 18h-5Z"/><path d="M25 7l-7.5 8.4M7 25l7.5-8.4"/></svg></a>
    </span>`;

function head({ lang, title, description, path, alt, ogImage, ogAlt, type = 'website', article, jsonld, noindex }) {
  const w = WORDS[lang];
  const other = LANGS.filter((l) => l !== lang);
  const alternates = alt
    ? [...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${abs(alt(l))}" />`), `<link rel="alternate" hreflang="x-default" href="${abs(alt('en'))}" />`].join('\n  ')
    : '';
  const art = article
    ? [`<meta property="article:published_time" content="${article.publishedAt}" />`, `<meta property="article:modified_time" content="${article.updatedAt}" />`, ...article.tags.map((t) => `<meta property="article:tag" content="${esc(t)}" />`)].join('\n  ')
    : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-video-preview:-1'}" />
  <meta name="theme-color" content="#cfeaff" />
  ${noindex ? '' : `<link rel="canonical" href="${abs(path)}" />`}
  ${alternates}
  <meta property="og:type" content="${type}" />
  <meta property="og:site_name" content="Obelisk Sky" />
  <meta property="og:locale" content="${w.locale}" />
  ${other.map((l) => `<meta property="og:locale:alternate" content="${WORDS[l].locale}" />`).join('\n  ')}
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${abs(path)}" />
  <meta property="og:image" content="${abs(ogImage)}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${esc(ogAlt)}" />
  ${art}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@obelisk_ar" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${abs(ogImage)}" />
  <meta name="twitter:image:alt" content="${esc(ogAlt)}" />
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" href="/brand/sky-mark-flat.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/src/landing/landing.css" />
  <link rel="stylesheet" href="/src/guides/guides.css" />
  ${(jsonld ?? []).map(ld).join('\n  ')}
</head>`;
}

// The landing page's own header (client/index.html) in the page's language, its words from
// src/landing/copy.ts, so the two never drift apart. Its anchors point back at the landing
// page; the EN | ES pill links to this page in the other language instead of switching in place.
const LANDING_HEADER = readFileSync(join(CLIENT, 'index.html'), 'utf8').match(/<header class="nav">[\s\S]*?<\/header>/)[0];
const COPY_SRC = readFileSync(join(CLIENT, 'src', 'landing', 'copy.ts'), 'utf8');
function landingWords(lang) {
  const block = lang === 'en' ? COPY_SRC.slice(COPY_SRC.indexOf('const en'), COPY_SRC.indexOf('const es')) : COPY_SRC.slice(COPY_SRC.indexOf('const es'), COPY_SRC.indexOf('export const COPY'));
  return Object.fromEntries([...block.matchAll(/'([\w.]+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)].map((m) => [m[1], (m[2] ?? m[3]).replace(/\\(.)/g, '$1')]));
}

function nav(lang, langHref) {
  const words = landingWords(lang);
  const q = lang === 'en' ? '' : `?lang=${lang}`;
  const pills = LANGS.map((l) => (l === lang
    ? `<a href="${langHref(l)}" hreflang="${l}" aria-current="true">${l.toUpperCase()}</a>`
    : `<a href="${langHref(l)}" hreflang="${l}" lang="${l}">${l.toUpperCase()}</a>`)).join('');
  const header = LANDING_HEADER
    .replace(/href="\/guides" data-i18n="nav.guides" data-i18n-href="href.guides"/, `href="${guideUrl(lang)}" aria-current="page" data-i18n="nav.guides"`)
    .replace(/data-i18n="([\w.]+)">[^<]*</g, (m, key) => (words[key] ? `data-i18n="${key}">${esc(words[key])}<` : m))
    .replace(/href="#/g, `href="/${q}#`)
    .replace(/href="\/app"/g, `href="/app${q}"`)
    .replace(/class="nav-brand" href="\/"/, `class="nav-brand" href="/${q}"`)
    .replace(/<div class="lang"[\s\S]*?<\/div>/, `<div class="lang" role="group" aria-label="${WORDS[lang].lang}">${pills}</div>`);
  return `<div class="sky" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
  ${header}`;
}

function foot(lang) {
  const w = WORDS[lang];
  return `<section class="cta">
      <span class="cta-mark"><img src="/brand/sky-mark.svg" alt="" width="96" height="96" /></span>
      <h2>${esc(w.ctaTitle)}</h2>
      <p class="g-cta-note">${esc(w.ctaNote)}</p>
      <a class="btn" href="/app${lang === 'en' ? '' : `?lang=${lang}`}">${w.enterIsland}</a>
    </section>
  </main>
  <footer class="foot">
    <a href="/${lang === 'en' ? '' : `?lang=${lang}`}">Obelisk Sky</a>
    <a href="${guideUrl(lang)}">${w.guides}</a>
    <a href="https://obelisk.ar" target="_blank" rel="noopener">${w.part}</a>
    <a href="https://nostr-wot.com" target="_blank" rel="noopener">nostr-wot</a>
    <a href="https://lacrypta.ar" target="_blank" rel="noopener">La Crypta</a>
    <a href="https://github.com/obelisk-app/obelisk-sky" target="_blank" rel="noopener">GitHub</a>
    ${SOCIAL}
  </footer>
  <script type="module" src="/src/guides/guides.ts"></script>
</body>
</html>
`;
}

function card(g, lang) {
  const hero = asset(g.fm.hero, lang, `${lang}/${g.slug} hero`);
  // A clip plays in its card (guides.ts, as the articles' clips do); its small poster shows until then.
  const media = hero?.kind === 'clip'
    ? `<video muted loop playsinline disablepictureinpicture preload="none" poster="${hero.cardPoster}" width="640" height="360" aria-hidden="true"><source src="${hero.card}" type="video/mp4" /></video>`
    : `<img src="${hero?.small ?? hero?.src}" alt="" width="640" height="360" loading="lazy" decoding="async" />`;
  return `<li><a class="g-card" href="${guideUrl(lang, g.slug)}">${media}<span class="g-card-body"><b>${esc(g.fm.title)}</b><span>${esc(g.fm.description)}</span><small>${WORDS[lang].read(g.minutes)}</small></span></a></li>`;
}

const ORG = { '@type': 'Organization', name: 'Obelisk', url: 'https://obelisk.ar', logo: abs('/brand/sky-mark.svg') };

// ── link cards ──
const OG_DIR = join(CLIENT, 'public', 'og', 'guides');
const markSvg = readFileSync(join(CLIENT, 'public', 'brand', 'sky-mark.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace('<svg ', '<svg x="552" y="64" width="96" height="96" ');
function wrap(text, max) {
  const lines = [''];
  for (const word of text.split(' ')) {
    const cur = lines[lines.length - 1];
    if (cur && (cur + ' ' + word).length > max) lines.push(word);
    else lines[lines.length - 1] = cur ? `${cur} ${word}` : word;
  }
  return lines;
}
/** The guide's 1200×630 card, as make-og.mjs draws the site's: the picture behind a sky band, the
 *  words in the middle 630 px (WhatsApp crops to a centred square). Drawn again only when its
 *  words or picture change; the URL carries a hash of the file. */
async function ogCard(key, title, picture) {
  const id = createHash('sha256').update(JSON.stringify([title, picture, markSvg.length, 3])).digest('hex').slice(0, 8);
  const file = join(OG_DIR, `${key}.${id}.jpg`);
  const url = `/og/guides/${key}.${id}.jpg`;
  if (existsSync(file) || CHECK) return url;
  mkdirSync(dirname(file), { recursive: true });
  for (const f of readdirSync(dirname(file))) if (f.startsWith(`${key.split('/').pop()}.`)) rmSync(join(dirname(file), f));
  const T = 'font-family="Inter, DejaVu Sans, sans-serif" text-anchor="middle"';
  const lines = wrap(title, 18).slice(0, 4);
  const y0 = 340 - (lines.length - 1) * 27;
  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0.12" stop-color="#cfeaff" stop-opacity="0"/><stop offset="0.3" stop-color="#cfeaff" stop-opacity="0.9"/>
    <stop offset="0.7" stop-color="#cfeaff" stop-opacity="0.9"/><stop offset="0.88" stop-color="#cfeaff" stop-opacity="0"/>
  </linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  ${markSvg}
  <text x="600" y="${y0 - 70}" ${T} font-size="24" font-weight="700" fill="#3f7f12">OBELISK SKY · ${key.startsWith('es/') ? 'GUÍAS' : 'GUIDES'}</text>
  ${lines.map((l, i) => `<text x="600" y="${y0 + i * 54}" ${T} font-size="46" font-weight="800" fill="#0f2a44">${esc(l)}</text>`).join('\n  ')}
  <text x="600" y="560" ${T} font-size="26" font-weight="700" fill="#3f7f12">sky.obelisk.ar</text>
</svg>`;
  await sharp(join(CLIENT, 'public', picture)).resize(1200, 630, { fit: 'cover' })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 84, mozjpeg: true }).toFile(file);
  return url;
}

// ── build ──
const byLang = Object.fromEntries(LANGS.map((l) => [l, loadGuides(l)]));
const slugs = (l) => byLang[l].map((g) => g.slug).sort().join(',');
for (const l of LANGS) if (slugs(l) !== slugs('en')) fail(`${l}: the guides are not the same as English's (${slugs(l)} vs ${slugs('en')})`);

const pages = [];   // { path, html }
const sitemap = []; // { path, alt, lastmod, images, videos }
const fullTitle = (g) => g.fm.seoTitle ?? `${g.fm.title} | Obelisk Sky`;

for (const lang of LANGS) {
  const w = WORDS[lang];
  const list = byLang[lang];
  for (const g of list) {
    const where = `${lang}/${g.slug}`;
    const title = fullTitle(g);
    const description = g.fm.seoDescription ?? g.fm.description;
    if (title.length > 65) fail(`${where}: title is ${title.length} characters (65 at most; set seoTitle)`);
    if (description.length < 70 || description.length > 160) fail(`${where}: description is ${description.length} characters (70–160; set seoDescription)`);
    const { html: body, used } = renderBody(g);
    const hero = asset(g.fm.hero, lang, `${where} hero`);
    const heroPic = hero?.kind === 'clip' ? hero.poster : hero?.src;
    const og = hero ? await ogCard(`${lang}/${g.slug}`, g.fm.title, heroPic) : '/og.jpg';
    const path = guideUrl(lang, g.slug);
    const related = list.filter((o) => o.slug !== g.slug);
    const media = [{ name: g.fm.hero, caption: '', ...hero }, ...used].filter((m) => m.src);
    const images = [...new Map(media.map((m) => [m.kind === 'clip' ? m.poster : m.src, m])).entries()].map(([src, m]) => ({ src, alt: m.alt }));
    const videos = [...new Map(media.filter((m) => m.kind === 'clip').map((m) => [m.src, m])).values()];
    const jsonld = [
      {
        '@context': 'https://schema.org', '@type': 'Article', headline: g.fm.title, description,
        inLanguage: lang, datePublished: g.fm.publishedAt, dateModified: g.fm.updatedAt, keywords: g.fm.tags.join(', '),
        mainEntityOfPage: abs(path), url: abs(path), image: [abs(og), ...images.map((i) => abs(i.src))],
        author: ORG, publisher: ORG,
        isPartOf: { '@type': 'WebSite', name: 'Obelisk Sky', url: `${SITE}/` },
        about: { '@type': 'SoftwareApplication', name: 'Obelisk Sky', applicationCategory: 'SocialNetworkingApplication', operatingSystem: 'Web browser', url: `${SITE}/`, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
        video: videos.map((v) => ({ '@type': 'VideoObject', name: v.alt, description: v.caption || v.alt, thumbnailUrl: abs(v.poster), contentUrl: abs(v.src), uploadDate: g.fm.publishedAt, duration: `PT${Math.round(v.seconds)}S` })),
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Obelisk Sky', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: w.guides, item: abs(guideUrl(lang)) },
          { '@type': 'ListItem', position: 3, name: g.fm.title, item: abs(path) },
        ],
      },
    ];
    if (g.fm.howTo) {
      // The steps are the guide's own `## ` headings under its how-to section, in order.
      jsonld.push({ '@context': 'https://schema.org', '@type': 'HowTo', name: g.fm.howTo.name, inLanguage: lang, image: abs(og), totalTime: g.fm.howTo.totalTime, step: g.fm.howTo.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text, url: `${abs(path)}#${s.anchor}` })) });
      for (const s of g.fm.howTo.steps) if (!body.includes(`id="${s.anchor}"`)) fail(`${where}: howTo step "${s.name}" points at #${s.anchor}, which no heading has`);
    }
    const html = `${head({ lang, title, description, path, alt: (l) => guideUrl(l, g.slug), ogImage: og, ogAlt: hero?.alt ?? g.fm.title, type: 'article', article: g.fm, jsonld })}
<body class="g-page">
  ${nav(lang, (l) => guideUrl(l, g.slug))}
  <main>
    <article class="g-article">
      <nav class="g-crumbs" aria-label="${w.breadcrumb}"><a href="/${lang === 'en' ? '' : `?lang=${lang}`}">Obelisk Sky</a><span aria-hidden="true">/</span><a href="${guideUrl(lang)}">${w.guides}</a></nav>
      <header class="g-head">
        <h1>${esc(g.fm.title)}</h1>
        <p class="lead">${esc(g.fm.description)}</p>
        <p class="g-meta"><span>${w.updated} <time datetime="${g.fm.updatedAt}">${w.date(g.fm.updatedAt)}</time></span><span>${w.read(g.minutes)}</span></p>
      </header>
      ${figureHtml(hero, '', {}).replace('class="g-fig', 'class="g-fig g-hero')}
      <div class="g-body">
${body}
      </div>
    </article>
    <section class="g-related">
      <h2>${w.related}</h2>
      <ul class="g-grid">${related.map((o) => card(o, lang)).join('')}</ul>
      <p class="g-all"><a class="btn ghost" href="${guideUrl(lang)}">${w.allGuides}</a></p>
    </section>
    ${foot(lang)}`;
    pages.push({ path: `${path}/index.html`, html });
    sitemap.push({ path, alt: (l) => guideUrl(l, g.slug), lastmod: g.fm.updatedAt, images, videos: videos.map((v) => ({ ...v, title: v.alt })) });
  }

  // The index.
  const path = guideUrl(lang);
  const lastmod = list.map((g) => g.fm.updatedAt).sort().pop();
  const indexOg = await ogCard(`${lang}/index`, w.indexH1 === 'Guides' ? 'Guides to the Nostr village' : 'Guías del pueblo de Nostr', lock['island-orbit'].poster);
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: w.indexTitle, description: w.indexDescription, inLanguage: lang, url: abs(path), isPartOf: { '@type': 'WebSite', name: 'Obelisk Sky', url: `${SITE}/` },
      mainEntity: { '@type': 'ItemList', itemListElement: list.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(guideUrl(lang, g.slug)), name: g.fm.title })) } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Obelisk Sky', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: w.guides, item: abs(path) },
    ] },
  ];
  if (w.indexTitle.length > 65) fail(`${lang} index: title too long`);
  if (w.indexDescription.length > 160) fail(`${lang} index: description too long (${w.indexDescription.length})`);
  const html = `${head({ lang, title: w.indexTitle, description: w.indexDescription, path, alt: (l) => guideUrl(l), ogImage: indexOg, ogAlt: media['island-orbit'].alt[lang], jsonld })}
<body class="g-page">
  ${nav(lang, (l) => guideUrl(l))}
  <main>
    <section class="g-index-head">
      <p class="kicker">${w.indexKicker}</p>
      <h1>${w.indexH1}</h1>
      <p class="lead">${esc(w.indexLead)}</p>
    </section>
    <ul class="g-grid g-index">${list.map((g) => card(g, lang)).join('')}</ul>
    ${foot(lang)}`;
  pages.push({ path: `${path}/index.html`, html });
  sitemap.push({ path, alt: (l) => guideUrl(l), lastmod, images: [], videos: [] });
}

// A missing guide: a real 404 (server resolveStatic), in both languages at once.
pages.push({ path: '/guides/404.html', html: `${head({ lang: 'en', title: 'Guide not found | Obelisk Sky', description: 'This guide does not exist. See all the Obelisk Sky guides, or walk into the village.', path: '/guides', ogImage: '/og.jpg', ogAlt: 'Obelisk Sky', noindex: true })}
<body class="g-page">
  ${nav('en', (l) => guideUrl(l))}
  <main>
    <section class="g-index-head">
      <p class="kicker">404</p>
      <h1>Nothing here.</h1>
      <p class="lead">This guide doesn't exist (or moved). <a href="/guides">See all the guides</a>.</p>
      <p class="lead" lang="es">Esta guía no existe (o se mudó). <a href="/es/guides">Mirá todas las guías</a>.</p>
    </section>
    ${foot('en')}` });

if (errors.length) {
  console.error(`build-guides: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
if (CHECK) { console.log(`build-guides: ${pages.length} pages ok`); process.exit(0); }

for (const dir of [join(CLIENT, 'guides'), ...LANGS.filter((l) => l !== 'en').map((l) => join(CLIENT, l))]) rmSync(dir, { recursive: true, force: true });
for (const p of pages) {
  const file = join(CLIENT, p.path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, p.html);
}

const xml = (s) => esc(s).replace(/'/g, '&apos;');
const today = new Date().toISOString().slice(0, 10);
const urls = [
  { path: '/', alt: (l) => (l === 'en' ? '/' : `/?lang=${l}`), lastmod: today, images: [{ src: '/og.jpg', alt: 'Obelisk Sky' }], videos: [], single: true },
  ...sitemap,
];
writeFileSync(join(CLIENT, 'public', 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${urls.map((u) => `  <url>
    <loc>${xml(abs(u.path))}</loc>
    <lastmod>${u.lastmod}</lastmod>
${u.single ? '' : LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${xml(abs(u.alt(l)))}" />\n`).join('') + `    <xhtml:link rel="alternate" hreflang="x-default" href="${xml(abs(u.alt('en')))}" />\n`}${u.images.map((i) => `    <image:image><image:loc>${xml(abs(i.src))}</image:loc></image:image>\n`).join('')}${u.videos.map((v) => `    <video:video><video:thumbnail_loc>${xml(abs(v.poster))}</video:thumbnail_loc><video:title>${xml(v.title)}</video:title><video:description>${xml(v.caption || v.alt)}</video:description><video:content_loc>${xml(abs(v.src))}</video:content_loc><video:duration>${Math.round(v.seconds)}</video:duration></video:video>\n`).join('')}  </url>`).join('\n')}
</urlset>
`);
console.log(`build-guides: ${pages.length} pages, ${urls.length} sitemap URLs`);
