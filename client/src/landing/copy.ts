// The landing page's words, in English and Spanish. index.html carries the
// English inline (for crawlers and first paint); landing.ts swaps by
// `data-i18n` key.

export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

const en = {
  'meta.title': 'Obelisk Sky: walk into Nostr conversations',
  'nav.features': 'Features',
  'nav.how': 'How it works',
  'nav.enter': 'Enter',
  'hero.kicker': 'A 3D village for Obelisk',
  'hero.title': 'Walk into Nostr conversations.',
  'hero.lead': 'Every channel is a house on a floating island. Walk in, sit down for mate, join calls, play games.',
  'hero.enter': 'Enter the island',
  'hero.obelisk': 'What is Obelisk?',
  'hero.note': 'Free, and it all runs in your browser.',
  'features.title': 'A chat you can walk around in',
  'features.lead': 'A real Obelisk client, laid out as a village.',
  'f.house.t': 'Every channel is a house',
  'f.house.d': 'Busier channel, bigger house.',
  'f.walk.t': 'Walk to the conversation',
  'f.walk.d': 'Post somewhere, walk there.',
  'f.live.t': 'Live, together',
  'f.live.d': 'See others move in real time.',
  'f.voice.t': 'Voice calls',
  'f.voice.d': 'Talk from a channel\'s house.',
  'f.games.t': 'Games',
  'f.games.d': 'Chain Reaction, played on Nostr.',
  'f.mate.t': 'Mate, café, parrilla',
  'f.mate.d': 'Sit down on the plaza.',
  'f.park.t': 'Calisthenics park',
  'f.park.d': 'Bars, dips and a running track.',
  'f.look.t': 'Your own look',
  'f.look.d': 'Body, outfit, hair, colours.',
  'f.key.t': 'Your key, your browser',
  'f.key.d': 'No keys on the server.',
  'f.relay.t': 'Any NIP-29 relay',
  'f.relay.d': 'Any community gets its own island.',
  'how.title': 'How it works',
  'how.1.t': 'Log in with Nostr',
  'how.1.d': 'Extension, remote signer or key.',
  'how.2.t': 'Pick a relay',
  'how.2.d': 'public.obelisk.ar or any NIP-29 relay.',
  'how.3.t': 'Walk in',
  'how.3.d': 'Find a house and say hi.',
  'social.title': 'Follow Obelisk',
  'social.lead': "News, videos and what's next, wherever you scroll.",
  'social.follow': 'Follow',
  'cta.title': 'The island is up. Come in.',
  'cta.enter': 'Enter the island',
  'footer.part': 'Part of Obelisk',
} as const;

export type CopyKey = keyof typeof en;

const es: Record<CopyKey, string> = {
  'meta.title': 'Obelisk Sky: entrá caminando a las charlas de Nostr',
  'nav.features': 'Qué tiene',
  'nav.how': 'Cómo funciona',
  'nav.enter': 'Entrar',
  'hero.kicker': 'Un pueblo 3D para Obelisk',
  'hero.title': 'Entrá al mundo de Nostr, caminando.',
  'hero.lead': 'Cada canal es una casa en una isla flotante. Entrá, tomate un mate, sumate a llamadas, jugá.',
  'hero.enter': 'Entrar a la isla',
  'hero.obelisk': '¿Qué es Obelisk?',
  'hero.note': 'Gratis, y todo corre en tu navegador.',
  'features.title': 'Un chat que podés recorrer',
  'features.lead': 'Un cliente real de Obelisk, armado como un pueblo.',
  'f.house.t': 'Cada canal es una casa',
  'f.house.d': 'Canal más activo, casa más grande.',
  'f.walk.t': 'Caminá hacia la charla',
  'f.walk.d': 'Escribís en un canal, caminás hasta ahí.',
  'f.live.t': 'En vivo, juntos',
  'f.live.d': 'Mirá a los demás moverse en vivo.',
  'f.voice.t': 'Llamadas de voz',
  'f.voice.d': 'Hablá desde la casa de un canal.',
  'f.games.t': 'Juegos',
  'f.games.d': 'Chain Reaction, jugado en Nostr.',
  'f.mate.t': 'Mate, café, parrilla',
  'f.mate.d': 'Sentate en la plaza.',
  'f.park.t': 'Plaza de calistenia',
  'f.park.d': 'Barras, fondos y una pista.',
  'f.look.t': 'Tu propio look',
  'f.look.d': 'Cuerpo, ropa, pelo, colores.',
  'f.key.t': 'Tu clave, tu navegador',
  'f.key.d': 'El servidor no guarda claves.',
  'f.relay.t': 'Cualquier relay NIP-29',
  'f.relay.d': 'Cada comunidad tiene su isla.',
  'how.title': 'Cómo funciona',
  'how.1.t': 'Entrá con Nostr',
  'how.1.d': 'Extensión, firmante remoto o clave.',
  'how.2.t': 'Elegí un relay',
  'how.2.d': 'public.obelisk.ar o cualquier relay NIP-29.',
  'how.3.t': 'Entrá caminando',
  'how.3.d': 'Buscá una casa y saludá.',
  'social.title': 'Seguí a Obelisk',
  'social.lead': 'Novedades, videos y lo que se viene, en tus redes.',
  'social.follow': 'Seguir',
  'cta.title': 'La isla ya está arriba. Pasá.',
  'cta.enter': 'Entrar a la isla',
  'footer.part': 'Parte de Obelisk',
};

export const COPY: Record<Lang, Record<CopyKey, string>> = { en, es };

const STORE_KEY = 'obelisk-sky/lang';

const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** `?lang=` wins, then the remembered choice, then the browser's language. */
export function pickLang(search: string, stored: string | null, browser: readonly string[]): Lang {
  const q = new URLSearchParams(search).get('lang');
  if (isLang(q)) return q;
  if (isLang(stored)) return stored;
  for (const l of browser) {
    const base = l.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

export function storedLang(): string | null {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

export function rememberLang(lang: Lang): void {
  try { localStorage.setItem(STORE_KEY, lang); } catch { /* private mode */ }
}
