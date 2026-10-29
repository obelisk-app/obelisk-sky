// The login SDK (@nostr-wot/ui) writes its own words in English, with no
// way to pass others (obelisk-dex shows them in English too). In Spanish,
// while the login modal is open, its texts, placeholders and labels are
// swapped for these as they appear.
//
// A few of them obelisk-dex's generated-profile step finds by their English
// (vendor services/shell/desktop/generated-profile.ts) and takes over: it
// writes the About label in its own words, hides the "Optional." line and
// listens to the about field. Swapped before it saw them, a new account's
// "about" was never saved. So those texts are left to dex (`DEX_TAKES`), and
// the about field's placeholder is swapped only once dex has marked the field
// (`DEX_MARKS`).

const ES: Record<string, string> = {
  'Sign in to Nostr': 'Conectate a Nostr',
  'Close': 'Cerrar',
  'Nostr Connect QR code': 'Código QR de Nostr Connect',
  'Action required': 'Falta un paso',
  'Advanced': 'Avanzado',
  'Advanced ▾': 'Avanzado ▾',
  'Approve the request in your signer app, then this will continue automatically. Click to open ↗': 'Aprobá el pedido en tu app firmadora y esto sigue solo. Tocá para abrirla ↗',
  'Back this up': 'Guardá esto',
  'before': 'antes',
  "you continue. Lose it and your identity is gone — there's no recovery.": 'de seguir. Si la perdés, perdés tu identidad: no hay forma de recuperarla.',
  'Browser extension with NIP-07 signer + Web of Trust spam filtering ↗': 'Extensión del navegador con firmador NIP-07 y filtro de spam por red de confianza ↗',
  'Browser extension': 'Extensión del navegador',
  'Continue': 'Continuar',
  'Copy npub': 'Copiar npub',
  'Copy nsec': 'Copiar nsec',
  'Create a new account': 'Crear una cuenta nueva',
  'Display name': 'Nombre',
  'Download .txt': 'Descargar .txt',
  'Generates a fresh keypair on this device': 'Genera un par de claves nuevo en este dispositivo',
  'Get the Nostr WoT extension': 'Instalá la extensión Nostr WoT',
  'I have backed up my nsec. I understand that losing it means losing access to this account permanently.': 'Guardé mi nsec. Entiendo que si la pierdo, pierdo el acceso a esta cuenta para siempre.',
  'Loading…': 'Cargando…',
  'nsec or 64-char hex — risky in browsers': 'nsec o hex de 64 caracteres: riesgoso en el navegador',
  'Paste a bunker:// URI from your remote signer': 'Pegá una URI bunker:// de tu firmador remoto',
  'Paste a bunker:// URI from your remote signer.': 'Pegá una URI bunker:// de tu firmador remoto.',
  'Paste private key': 'Pegar clave privada',
  'Private key or key file': 'Clave privada o archivo de clave',
  'Paste your nsec, or upload the key file you saved': 'Pegá tu nsec o subí el archivo de clave que guardaste',
  'I already have an account': 'Ya tengo una cuenta',
  'or': 'o',
  'Upload key file': 'Subir archivo de clave',
  'The .txt you saved when you created the account': 'El .txt que guardaste al crear la cuenta',
  'No private key (nsec) found in that file.': 'No encontramos una clave privada (nsec) en ese archivo.',
  'That file is too big to be a key file.': 'Ese archivo es demasiado grande para ser un archivo de clave.',
  "Couldn't read that file.": 'No pudimos leer ese archivo.',
  '⬇ Download your key file': '⬇ Descargá tu archivo de clave',
  '✓ Key file saved (download again)': '✓ Archivo de clave guardado (descargar de nuevo)',
  'Save it somewhere safe. To log in again, upload it or paste the nsec inside.': 'Guardalo en un lugar seguro. Para volver a entrar, subilo o pegá la nsec que tiene adentro.',
  'NIP-46 — Amber, Nsec.app': 'NIP-46: Amber, Nsec.app',
  'Picture URL': 'URL de la foto',
  'Private key (nsec) — keep secret': 'Clave privada (nsec): no la compartas',
  'Public key (npub)': 'Clave pública (npub)',
  'Remote signer (bunker)': 'Firmador remoto (bunker)',
  'Restart': 'Reiniciar',
  'Scan QR': 'Escanear QR',
  'Scan with Amber, Nsec.app, Keychat, or any NIP-46 signer.': 'Escaneá con Amber, Nsec.app, Keychat o cualquier firmador NIP-46.',
  'Set up your profile': 'Armá tu perfil',
  'Skip for now': 'Saltear por ahora',
  '← Back': '← Volver',
  '⚠️ Pasting your private key into a web page is risky. Prefer a browser extension (NIP-07) or a remote signer (NIP-46) when possible.': '⚠️ Pegar tu clave privada en una página web es riesgoso. Si podés, usá una extensión del navegador (NIP-07) o un firmador remoto (NIP-46).',
  'Your new key': 'Tu clave nueva',
  'Invalid nsec': 'nsec inválida',
  'Paste an nsec1… or a 64-char hex private key.': 'Pegá una nsec1… o una clave privada hex de 64 caracteres.',
  'Builder, chef, occasional cyclist.': 'Programo, cocino, ando en bici.',
  'nsec1… or 64-char hex': 'nsec1… o hex de 64 caracteres',
  'Open in signer app': 'Abrir en la app firmadora',
  'Copied': 'Copiado',
  'Could not copy': 'No se pudo copiar',
  'Copy connect URI': 'Copiar URI de conexión',
  'Paste URI': 'Pegar URI',
  'Connecting': 'Conectando',
  'Connect': 'Conectar',
  'Publishing': 'Publicando',
  'Save profile and continue': 'Guardar perfil y seguir',
  'Remember on this device': 'Recordar en este dispositivo',
  'No NIP-07 extension detected. Install Alby, nos2x, or another Nostr signer extension and reload.': 'No encontramos una extensión NIP-07. Instalá Alby, nos2x u otra extensión firmadora de Nostr y recargá.',
  'Signing in': 'Entrando',
  'Sign in': 'Entrar',
};

/** Texts dex's generated-profile step rewrites or hides itself (see the top). */
export const DEX_TAKES = new Set(['About', 'Optional. You can fill these in later from any Nostr client.']);

/** Placeholders dex's step finds a field by: swapped once dex has set this data attribute on it. */
export const DEX_MARKS: Record<string, string> = { 'Builder, chef, occasional cyclist.': 'data-obelisk-tracked' };

/** The Spanish for one of the SDK's texts, keeping its spaces; null if it has none. */
export function spanishFor(text: string): string | null {
  const core = text.trim();
  const es = ES[core];
  if (!es) return null;
  const lead = text.slice(0, text.indexOf(core)), trail = text.slice(text.indexOf(core) + core.length);
  return lead + es + trail;
}

/** Is this node part of the SDK's modal (its classes start with `nui-`)? */
const inSdk = (el: Element | null): boolean => !!el?.closest('[class*="nui-"]');

/** Translate every SDK text, placeholder and label under `root`. */
export function translateSdk(root: Node): void {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n: Node | null = root; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (!inSdk(n.parentElement)) continue;
      const es = spanishFor(n.nodeValue ?? '');
      if (es !== null && es !== n.nodeValue) n.nodeValue = es;
    } else if (n.nodeType === Node.ELEMENT_NODE && inSdk(n as Element)) {
      const el = n as Element;
      for (const attr of ['placeholder', 'aria-label', 'title']) {
        const v = el.getAttribute(attr);
        const mark = attr === 'placeholder' && v ? DEX_MARKS[v.trim()] : undefined;
        if (mark && !el.hasAttribute(mark)) continue;
        const es = v && spanishFor(v);
        if (es && es !== v) el.setAttribute(attr, es);
      }
    }
  }
}

/** Keep translating the SDK's modal under `root` as it renders; returns a stop function. */
export function watchSdk(root: HTMLElement): () => void {
  translateSdk(root);
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') translateSdk(r.target);
      else if (r.type === 'attributes') translateSdk(r.target);
      else for (const n of r.addedNodes) translateSdk(n);
    }
  });
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title', ...new Set(Object.values(DEX_MARKS))] });
  return () => obs.disconnect();
}
