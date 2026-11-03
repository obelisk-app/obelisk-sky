// Links into the Cloudflare dashboard for sky's edge cache (cf-cache-rules.mjs).
//
//   npm run cf:links
//
// Prints two ways in, pick one:
//
//   1. A token link: the "Create API token" page with the token already named
//      and its permissions picked (Zone › Zone › Read, Zone › Cache Rules ›
//      Edit). Create it, then run `CF_API_TOKEN=… npm run cf:cache`.
//      Cloudflare doesn't document the template key for Cache Rules (its key
//      list is known to be off, cloudflare-docs#29825), so check the permission
//      rows on that page before Continue: add "Zone › Cache Rules › Edit" (in
//      newer dashboards "Cache Settings › Edit") by hand if it isn't there, and
//      narrow Zone Resources to the zone.
//   2. The zone's Cache Rules page, to make the same rules by hand: the
//      expression and settings of each rule are printed below the link.
//
// SKY_HOST (default sky.obelisk.ar) picks the host the rules match; CF_ZONE
// (default: the host minus its first label) the zone the links open.

import { RULES } from './cf-cache-rules.mjs';

const HOST = process.env.SKY_HOST || 'sky.obelisk.ar';
const ZONE = process.env.CF_ZONE || HOST.split('.').slice(1).join('.');
const DASH = 'https://dash.cloudflare.com';

export function tokenLink(name = `obelisk-sky cache rules (${ZONE})`) {
  const permissions = [
    { key: 'zone', type: 'read' },
    { key: 'cache_settings', type: 'edit' },
  ];
  const q = new URLSearchParams({
    permissionGroupKeys: JSON.stringify(permissions),
    accountId: '*',
    zoneId: 'all',
    name,
  });
  return `${DASH}/profile/api-tokens?${q}`;
}

/** `:account` lets the dashboard pick (or ask for) the account the zone is in. */
export function cacheRulesLink(zone = ZONE) {
  return `${DASH}/?to=/:account/${zone}/caching/cache-rules`;
}

function describe(rule) {
  const p = rule.action_parameters;
  const parts = [];
  if (p.cache) parts.push('Cache eligibility: Eligible for cache');
  if (p.edge_ttl?.mode === 'respect_origin') parts.push('Edge TTL: Use cache-control header if present (respect origin)');
  if (p.browser_ttl?.mode === 'respect_origin') parts.push('Browser TTL: Respect origin TTL');
  return parts;
}

function main() {
  console.log(`Cloudflare edge cache for ${HOST} (zone ${ZONE})\n`);
  console.log('1. Create the API token (permissions pre-filled; check them before Continue):');
  console.log(`   ${tokenLink()}`);
  console.log('   Needs: Zone › Zone › Read and Zone › Cache Rules › Edit, Zone Resources: Include › Specific zone ›', ZONE);
  console.log(`   Then: cd ${process.cwd()} && CF_API_TOKEN=<token> npm run cf:cache -- --dry-run, and again without --dry-run\n`);
  console.log('2. Or make the rules by hand on the zone\'s Cache Rules page:');
  console.log(`   ${cacheRulesLink()}`);
  for (const rule of RULES) {
    console.log(`\n   Rule "${rule.description}"`);
    console.log('   Custom filter expression (Edit expression):');
    console.log(`     ${rule.expression}`);
    for (const line of describe(rule)) console.log(`   ${line}`);
  }
  console.log(`\nCheck: curl -sI https://${HOST}/models/<a hashed .glb from dist/client/models> twice; the second says cf-cache-status: HIT`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
