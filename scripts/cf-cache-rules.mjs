// Cloudflare Cache Rules for sky.obelisk.ar, through the Rulesets API.
//
// Cloudflare caches only some extensions by default, and .glb isn't one:
// without these rules every model came from the origin through the tunnel
// (`cf-cache-status: DYNAMIC`) even with a year's immutable header.
//
//   1. /assets/, /models/, /media/, /landing/: cached at the edge, for as
//      long as the origin says (a year for hashed names, server/index.ts
//      `cacheControl`; a plain model name says no-cache and isn't kept).
//   2. /sounds/: the browser keeps what the origin says (`no-cache`), not the
//      zone's 4 h Browser Cache TTL, so a re-cut track shows up at once.
//
// Only the rules with our refs are touched; any other rule in the zone's
// cache-settings phase is kept as it is. Safe to run again.
//
//   CF_API_TOKEN=… [CF_ZONE_ID=…] [SKY_HOST=sky.obelisk.ar] npm run cf:cache [-- --dry-run]
//
// The token needs Zone › Cache Rules › Edit (and Zone › Zone › Read when
// CF_ZONE_ID isn't given, to look the zone up by name).

const API = 'https://api.cloudflare.com/client/v4';
const HOST = process.env.SKY_HOST || 'sky.obelisk.ar';
const TOKEN = process.env.CF_API_TOKEN;
const DRY = process.argv.includes('--dry-run');
const PHASE = 'http_request_cache_settings';

const prefixes = (list) => list.map((p) => `starts_with(http.request.uri.path, "${p}")`).join(' or ');

export const RULES = [
  {
    ref: 'sky_static_edge_cache',
    description: `${HOST}: cache hashed bundles, models and media at the edge (origin TTL)`,
    expression: `(http.host eq "${HOST}" and (${prefixes(['/assets/', '/models/', '/media/', '/landing/'])}))`,
    action: 'set_cache_settings',
    action_parameters: { cache: true, edge_ttl: { mode: 'respect_origin' }, browser_ttl: { mode: 'respect_origin' } },
    enabled: true,
  },
  {
    ref: 'sky_sounds_browser_ttl',
    description: `${HOST}: sounds keep the origin's no-cache in the browser`,
    expression: `(http.host eq "${HOST}" and ${prefixes(['/sounds/'])})`,
    action: 'set_cache_settings',
    action_parameters: { browser_ttl: { mode: 'respect_origin' } },
    enabled: true,
  },
];

async function cf(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) {
    const err = new Error(`${method} ${path}: HTTP ${r.status} ${JSON.stringify(j.errors ?? j)}`);
    err.status = r.status;
    throw err;
  }
  return j.result;
}

async function zoneId() {
  if (process.env.CF_ZONE_ID) return process.env.CF_ZONE_ID;
  const parts = HOST.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const name = parts.slice(i).join('.');
    const zones = await cf('GET', `/zones?name=${encodeURIComponent(name)}`);
    if (zones.length) return zones[0].id;
  }
  throw new Error(`no zone found for ${HOST}; set CF_ZONE_ID`);
}

async function main() {
  if (!TOKEN) { console.error('CF_API_TOKEN is not set'); process.exit(1); }
  const zone = await zoneId();
  const path = `/zones/${zone}/rulesets/phases/${PHASE}/entrypoint`;
  let current = [];
  try {
    current = (await cf('GET', path)).rules ?? [];
  } catch (e) {
    if (e.status !== 404) throw e; // 404: the zone has no cache rules yet
  }
  const ours = new Set(RULES.map((r) => r.ref));
  // Rules we keep keep their id; their read-only fields go.
  const keep = current.filter((r) => !ours.has(r.ref)).map(({ version, last_updated, ...r }) => r);
  const next = [...keep, ...RULES];
  console.log(`zone ${zone}, phase ${PHASE}`);
  console.log(`current: ${current.map((r) => r.ref || r.id).join(', ') || '(none)'}`);
  console.log(`after:   ${next.map((r) => r.ref).join(', ')}`);
  if (DRY) {
    console.log(JSON.stringify(RULES, null, 2));
    console.log('dry run: nothing changed');
    return;
  }
  await cf('PUT', path, { rules: next });
  console.log('cache rules updated');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
