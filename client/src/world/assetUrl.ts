// Model URLs with the file's content hash in the name (`town/wall.1a2b3c4d.glb`),
// from the manifest scripts/hash-assets.mjs writes before the build. Those are
// cached a year by the browser and Cloudflare; a changed file gets a new name.
// The dev server (and tests) serve client/public as it is: plain names.

const found = import.meta.glob<Record<string, string>>('../generated/model-manifest.json', { eager: true, import: 'default' });
const MANIFEST: Record<string, string> = import.meta.env.PROD ? (Object.values(found)[0] ?? {}) : {};

/** `/models/<rel>`, hashed in a production build. `rel` is relative to models/, with its extension. */
export function modelUrl(rel: string): string {
  return `/models/${MANIFEST[rel] ?? rel}`;
}
