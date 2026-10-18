import { nip19, type VerifiedEvent } from 'nostr-tools';
import type * as THREE from 'three';
import { renderContent } from './ui/content';
import { openPings as listPings, pingReason, pingTitle, type PingCursors, type PingReason } from './nostr/pings';
import type { ServerMsg, WireGroup, WireMessage } from './nostr/wire';
import { channelsOnly, forumThreads, homeOf } from './nostr/forum';
import { hexToNpub } from '@nostr-wot/data';
import { Feed, type FeedAccess } from './nostr/feed';
import { deletionTemplate, joinTemplate, messageTemplate, publishToGroup, publishSigned, reactionTemplate } from './nostr/publish';
import type { WireReaction } from './nostr/wire';
import { FOOT_SPEEDS, JUMP_SPEED, PlayerController, RIDE_SPEEDS, SWIM_SPEEDS, placeAt } from './player/controller';
import { hereCounts, speakerPlace, bubbleShown } from './ui/livePlaces';
import { InputState, isTyping, mountJoystick } from './player/input';
import { ChatPanel } from './ui/chatPanel';
import { ReadState, countUnread } from './nostr/readstate';
import { mentionedPubkeys } from './nostr/sanitize';
import { putProfile, setProfileRequester, clearProfiles } from './nostr/profileStore';
import { setRoofPing } from './world/buildings';
import { EMPTY_LAYOUT } from '@/constants/relay/channel-layout';
import { EMPTY_THEMES, ThemeStore, resolveTheme, themesTemplate, type ThemeConfig } from './nostr/themes';
import { guardHub, guestAuthor, guestPubkey, guestReason, isGuest, setGuest, type GuestReason } from './nostr/guest';
import { GuestFeed } from './guest/feed';
import { NPCS } from './guest/script';
import { loadGuestLook, saveGuestLook } from './guest/look';
import { openThemeEditor } from './ui/themeEditor';
import { GameBook, createTable, joinTable, startTable, moveOnTable, resignTable, cancelTable, timeoutOnTable, claimableTimeout, gameMarker, type CRSizeKey } from './games/book';
import { GamePanel } from './ui/gamePanel';
import { AvatarStore, DEFAULT_AVATAR, avatarTemplate, type Avatar } from './nostr/avatars';
import { ActivityBeacon, ActivityStore, activityTemplate, emoteActivity, emoteOfActivity, hereSpotId, parseSpot, type Activity, type Claim } from './nostr/activity';
import { MotionBeacon, MotionStore, motionTemplate } from './nostr/motion';
import { closeCreator, openCreator } from './ui/creator';
import { CallRoom, RECONNECT_DELAYS, awayCountdown } from './voice/callRoom';
import { WatchView, isVoiceKind } from './ui/theaterPanel';
import { TOTEM, TOTEM_URL, inTotemZone } from './world/totemMonitor';
import { LiveCalls, liveForTheater } from './nostr/liveCalls';
import { openControlsGuide, maybeShowControlsGuide, isTouch } from './ui/controlsGuide';
import { obeliskNoteUrl, obeliskProfileUrl } from './ui/obeliskLinks';
import { onPlaceChange, SETTLE_WALKING } from './ui/chatAuto';
import { SidePanel } from './ui/sidePanel';
import { initOrientation, lockLandscape } from './ui/orientation';
import { t as tr } from './i18n/app';
import { wireCard } from './ui/cardSheet';
import { DmPanel } from './ui/dmPanel';
import { EmoteMenu } from './ui/emoteMenu';
import type { EmoteKind } from './world/emotes';
import { DmStore } from './nostr/dm';
import { PrivateCall } from './voice/privateCall';
import { MembersStore } from './nostr/members';
import { relayIdentity } from './nostr/branding';
import { PresenceTracker, type Presence } from './nostr/presence';
import { SPANS, binCounts, dragRange, peakLabel, spanSeconds, timeToX, topPeaks, type SpanId } from './ui/history';
import { PrefsStore, type Prefs } from './prefs';
import { openSettings, SETTINGS_WORDS } from './ui/settings';
import { lang } from './i18n/lang';
import { vw, kindLabel } from './i18n/village';
import { openRelayModal } from './ui/relayModal';
import { LoadingScreen, loadAt } from './ui/loading';
import { FirstState } from './ui/firstState';
import { installVoiceBridge } from './shims/bridge';
import { dist, hashStr, ISLAND_R, type Vec2 } from './world/layout';
import { readBoard } from '@/utils/games/chain-reaction/board-view';
import { ANONYMOUS_IDENTITY, activeRelay, DEFAULT_GROUP_RELAY, normalizeRelay, profileRelays, setActiveRelay, SUGGESTED_RELAYS } from './nostr/hub';
import { pageHub } from './nostr/hub';
import { SessionManager, type LoginArgs, type Session } from './nostr/session';
import { registerHost } from './shims/host';
import { editOwnProfile, fetchOwnProfile, initialOf } from './nostr/ownProfile';
import type { ProfileEditorInitial } from '@/types/session/profile';
import { Soundscape } from './sound';
import { openZapSheet } from './ui/zapSheet';
import { connectWallet, forgetWallet, loadWallet, walletKindFor, walletView } from './wallet/wallet';
import { sendZap, ZapPaymentUnconfirmed } from './wallet/zap';
import { zapTotal } from './nostr/state';
import { parseZapCommand, zapCommandMessage } from './wallet/zapCommand';
import { EmoteMusic } from './audio/emoteMusic';
import { PlaceMusic } from './audio/placeMusic';
import { Minimap } from './ui/minimap';
import { ALL_MODELS, preload } from './world/assets';
import { defaultLook, preloadPeople } from './people/people';
import type { LandmarkId } from './world/landmarks';
import { NOSTR_WOT_PUBKEY, NOSTR_WOT_SITE } from './world/landmarks/nostrwot';
import { DEFAULT_SOCIAL_RELAYS } from '@/constants/social/relays';
import { pubkeyColor } from './world/character';
import { Director } from './world/director';
import { Player, findEpisodes, type Ev, type PlayerStatus } from './world/player';
import { World, type Seat, type StationKind } from './world/world';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nowSec = () => Math.floor(Date.now() / 1000);
/** History mode: the panel under the village, and how far back it shows. */
let historyOn = false;
let historySpan: SpanId = '7d';
const OBELISK_APP = 'https://obelisk.ar/app';

const world = new World($('scene'), $('overlay'));
// The island in a corner, with the houses, the people and you (ui/minimap.ts); a house on the big map walks you there.
const minimap = new Minimap($('app'), world.plan, (id) => world.hooks.onGroupClick?.(id));
minimap.setShown(false);
const director = new Director();
const sound = new Soundscape();
// Music near people dancing or working out, only where it's heard (audio/emoteMusic.ts).
const emoteMusic = new EmoteMusic(() => sound.audio());
// Cumbia at the parrilla, a guitar by the campfires (audio/placeMusic.ts).
const placeMusic = new PlaceMusic(() => sound.audio());
let musicTimer = 0;
let relayHost = 'public.obelisk.ar';
let groups: WireGroup[] = [];
/** `groups` by id (rebuilt when the list changes), for forum lookups. */
let groupsById: { of: WireGroup[]; map: Map<string, WireGroup> } = { of: groups, map: new Map() };
function groupMap(): Map<string, WireGroup> {
  if (groupsById.of !== groups) groupsById = { of: groups, map: new Map(groups.map((g) => [g.id, g])) };
  return groupsById.map;
}
/** The forum a group sits under, if any (nostr/forum.ts); itself otherwise. */
const homeOfGroup = (id: string): string => homeOf(id, groupMap());
/** The channel list's rows: every group but a forum's children, which nest under it there. Every group
 *  keeps its own house: a forum's child may be a real channel (openGym's), not only a thread. */
const listRows = (): WireGroup[] => channelsOnly(groups);
/** A row's groups: itself, and a forum's children. */
const groupsIn = (row: string): WireGroup[] => groups.filter((g) => g.id === row || homeOfGroup(g.id) === row);
let ready = false;
let pending: ServerMsg[] = [];

const player = new Player(director, renderStatus, () => {
  // A seek rebuilds the village: flash a soft white wipe so the teleport reads as a cut.
  const w = $('wipe');
  w.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => w.classList.remove('on')));
  world.overlay.clearBubbles();
});

// ── local preferences ────────────────────────────────────────────────────

const prefs = new PrefsStore();
const timeParam = new URLSearchParams(location.search).get('time');

function applyPrefs(p: Prefs): void {
  world.applyPrefs(timeParam && ['day', 'sunset', 'night'].includes(timeParam) ? { ...p, timeOfDay: timeParam as Prefs['timeOfDay'] } : p);
  document.documentElement.style.setProperty('--chat-alpha', String(p.chatOpacity));
  $('feed').hidden = !p.feed;
  minimap.setShown(p.minimap && ready);
  minimap.rotate = p.minimapRotate;
  sound.setVolume(p.volume);
  if (soundUnlocked) sound.setEnabled(p.sound);
  emoteMusic.enabled = p.emoteMusic;
  placeMusic.enabled = p.placeMusic;
  sound.ambience = p.ambience;
  sound.footsteps = p.footsteps;
  const btn = (act: string) => document.querySelector<HTMLButtonElement>(`.controls [data-act="${act}"]`);
  btn('director')?.classList.toggle('on', p.autoDirector);
  btn('signs')?.classList.toggle('on', p.signs);
  btn('tilt')?.classList.toggle('on', p.tiltShift);
  const time = btn('time');
  if (time) { time.classList.toggle('on', p.timeOfDay !== 'auto'); time.title = `${SETTINGS_WORDS[lang].time}: ${SETTINGS_WORDS[lang].time_[p.timeOfDay]}`; }
  const snd = btn('sound');
  if (snd) {
    snd.classList.toggle('on', p.sound);
    (snd.querySelector('.mute') as SVGElement | null)?.style.setProperty('display', p.sound ? 'none' : '');
    (snd.querySelector('.wave') as SVGElement | null)?.style.setProperty('display', p.sound ? '' : 'none');
  }
}

// Browsers only start audio after a gesture they accept (a key, a click, a
// finger lifted; not a touch going down), and phones and hidden tabs
// suspend it again: remembered "sound on" waits for one, and every gesture
// wakes audio that is on but held.
let soundUnlocked = false;
const unlockSound = (e: Event) => {
  if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') return; // not a gesture to browsers
  if (!soundUnlocked) {
    soundUnlocked = true;
    sound.setEnabled(prefs.get().sound);
  }
  sound.wake();
};
for (const type of ['pointerup', 'touchend', 'keydown', 'click']) window.addEventListener(type, unlockSound, { capture: true, passive: true });

prefs.onChange(applyPrefs);

// ── relays (one village per relay) ───────────────────────────────────────

const urlRelay = normalizeRelay(new URLSearchParams(location.search).get('relay') ?? '');
setActiveRelay(urlRelay ?? (prefs.get().relay || DEFAULT_GROUP_RELAY));

function knownRelays(): string[] {
  return [...new Set([...SUGGESTED_RELAYS, ...prefs.get().customRelays, activeRelay()])];
}

/** The relay switcher shows the relay as it presents itself: its operator's
 *  branding or NIP-11 name and icon (nostr/branding.ts); the domain until then. */
let relayShown = '';
function renderRelayName(): void {
  const relay = activeRelay();
  const host = relay.replace(/^wss?:\/\//, '').replace(/\/$/, '');
  const btn = $('relay-btn');
  btn.title = vw.switchRelay(host);
  if (relayShown === relay) return;
  relayShown = relay;
  ($('relay-name') as HTMLElement).textContent = host;
  btn.querySelector('.relay-ico img')?.remove();
  btn.classList.remove('has-icon');
  // Deferred: this first runs during start-up, before the hub exists.
  setTimeout(() => void relayIdentity(hub, relay).then((id) => {
    if (relayShown !== relay) return;
    if (id.name) ($('relay-name') as HTMLElement).textContent = id.name;
    // The first icon that actually loads (a dead branding link falls back).
    const tryIcon = (i: number): void => {
      if (i >= id.icons.length || relayShown !== relay) return;
      const img = document.createElement('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        if (relayShown !== relay) return;
        btn.querySelector('.relay-ico img')?.remove();
        btn.querySelector('.relay-ico')?.prepend(img);
        btn.classList.add('has-icon');
      };
      img.onerror = () => tryIcon(i + 1);
      img.src = id.icons[i];
    };
    tryIcon(0);
  }), 0);
}

/** Go to another relay's village: new subscriptions, AUTH only there. */
function switchRelay(url: string): void {
  if (url === activeRelay()) return;
  void call.leave();
  setActiveRelay(url);
  prefs.set({ relay: url });
  renderRelayName();
  session.setRelay();
  const u = new URL(location.href);
  u.searchParams.set('relay', url.replace(/^wss:\/\//, ''));
  history.replaceState(null, '', u);
  if (session.current) { startReadState(); startFeed(); }
  toast(vw.nowIn(url.replace(/^wss?:\/\//, '')));
}

$('relay-btn').addEventListener('click', () => openRelayModal($('app'), {
  active: activeRelay,
  relays: knownRelays,
  custom: () => prefs.get().customRelays,
  addRelay: (url) => prefs.set({ customRelays: [...prefs.get().customRelays, url] }),
  removeRelay: (url) => prefs.set({ customRelays: prefs.get().customRelays.filter((r) => r !== url) }),
  switchTo: switchRelay,
  groups: () => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
  categories: () => ({ names: themes?.categoryNames ?? {}, of: themes?.categoryOf ?? {} }),
  unread: (id) => (readState && session.current ? countUnread(msgsOf(id), readState.cursorFor(id), session.current.pubkey) : 0),
  goTo: (id) => {
    const slot = world.slotFor(id);
    if (controller && slot) { controller.walkTo(slot.yard); world.cam.played(); }
    else showGroup(id);
  },
}));

// The village opens LIVE and stays live: replays only play when asked for
// (the replay button, or a click on the timeline).
player.autoStory = false;

world.hooks = {
  onSay: (pk, groupId, text, to, instant) => {
    if (instant) return;
    addFeed(pk, groupId, text, to);
    sound.blip(pk);
  },
  // Messages are seen and heard only at the speaker's place (ui/livePlaces.ts).
  hears: (pk, groupId) => bubbleShown(place, speakerPlace(isLivePk(pk), standingPlace(pk), groupId)),
  onPersonClick: (pk) => showPerson(pk),
  onGroupClick: (id) => {
    // Something for you there (the "@"): open the chat at it and go.
    const ping = pingIn.get(id);
    if (ping) { goToMessage(ping.m); return; }
    // The gym is openGym's: its card, and walk over.
    if (id === world.gymChannel) showGym(id);
    const slot = world.slotFor(id);
    if (controller && slot) { controller.walkTo(slot.yard); world.cam.played(); return; }
    showGroup(id);
  },
  onZap: () => sound.coin(),
  // Everyone drawn gets a name and picture, posted or not (obelisk-dex asks wherever it shows a pubkey).
  onPersonMade: (pk) => feed?.state.watch(pk),
  onContext: (ok) => {
    // The phone took the graphics away (short of memory): say so, and if
    // they don't come back by themselves, offer a reload.
    clearTimeout(contextTimer);
    if (ok) { toast(vw.gfxBack); return; }
    toast(vw.gfxStopped);
    contextTimer = setTimeout(() => {
      if (world.contextLost) toast(vw.gfxGone, () => location.reload());
    }, 5000);
  },
  onArrive: () => sound.whoosh(),
};

// Handy for poking at the scene from the console.
(window as unknown as { __sky: unknown }).__sky = {
  world: () => world, player: () => player, director: () => director, session: () => session, chat: () => chat, groups: () => groups, controller: () => controller, activity: () => activity, motion: () => motion,
  dm: () => ({ open: openDm, panel: dmPanel, store: dms, call: pcall }),
  /** What the last frame cost: draw calls, triangles, lights in the scene, the quality level, recent fps. */
  perf: async () => {
    // Count one whole frame (every pass of the post chain), not just the last draw.
    const info = world.renderer.info;
    info.autoReset = false;
    info.reset();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = { calls: info.render.calls, triangles: info.render.triangles };
    info.autoReset = true;
    let lights = 0, lightsOn = 0;
    world.scene.traverse((o) => { if ((o as THREE.Light).isLight && !(o as THREE.Light & { isAmbientLight?: boolean }).isAmbientLight) { lights++; if (o.visible) lightsOn++; } });
    const avg = frameTimes.length ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
    return { ...out, programs: info.programs?.length ?? 0, lights, lightsOn, level: world.post.level, fps: avg ? Math.round(1 / avg) : 0 };
  },
};
if (import.meta.env.DEV) {
  // Dev server only (never in a production build): log in with a hex key
  // so headless checks can exercise the signed-in path.
  (window as unknown as { __skyDevLogin: unknown }).__skyDevLogin = async (skHex: string) => {
    const { PrivateKeySigner } = await import('@nostr-wot/signers');
    const signer = new PrivateKeySigner(skHex);
    freshLogin = true;
    await session.login({ signer, pubkey: await signer.getPublicKey(), method: 'import' });
  };
}

// ── boot ─────────────────────────────────────────────────────────────────

/** The loading screen waits this long at most for the village's first state. */
const FIRST_STATE_WAIT_MS = 6000;
/** Resolved by any snapshot through `handle` (the relay's feed, or any other). */
const firstState = new FirstState();
/** The stored session is still being restored (its feed may be about to start). */
let restoringSession = true;
/** Is a first state on its way? A feed is running (or a session is being
 *  restored) and the relay hasn't refused us. A feed of another kind that
 *  sends a snapshot through `handle` counts here too. A snapshot already
 *  queued in `pending` counts as arrived. */
function villageStateComing(): boolean {
  if (pending.some((m) => m.t === 'snapshot')) firstState.arrived();
  if (isGuest()) return true; // the guest island's snapshot is local and comes at once
  if ($('relay-btn').dataset.state === 'refused') return false;
  return feed !== null || restoringSession;
}

void (async () => {
  // The island from straight above: a map from the plan at once, then the
  // real ground (no models needed) behind the same view while the town and
  // nature kits load, then the people (bodies, outfits, hair, animations).
  const loading = new LoadingScreen($('loading'), world.plan);
  renderRelayName();
  applyPrefs(prefs.get());
  world.post.holdLevel(true);
  world.buildGround();
  world.cam.holdTopDown(ISLAND_R);
  // The preview renders until the frame loop takes over (it keeps going
  // through the warm-up below, so the island never freezes behind the bar).
  let looping = false;
  // Paused while the warm-up draws its own frames (the bar and clouds go on).
  let warming = false;
  const preview = (): void => {
    if (looping) return;
    if (!warming) world.frame();
    requestAnimationFrame(preview);
  };
  requestAnimationFrame(() => { preview(); loading.showWorld(); });
  await preload(ALL_MODELS, (d, t) => loading.setProgress(loadAt('models', d / t)));
  world.setGroups([], new Map()); // the empty island, before any relay data
  applyPrefs(prefs.get()); // again: grass needs the island built
  await preloadPeople((d, t) => loading.setProgress(loadAt('people', d / t)));
  // The village's first state (houses, villagers, you): logged in, the
  // feed's snapshot is waited for, a few seconds at most.
  loading.setProgress(loadAt('village', 0));
  await firstState.wait(villageStateComing, FIRST_STATE_WAIT_MS);
  ready = true;
  applyPrefs(prefs.get()); // the minimap shows now the village is there
  // Everything that arrived while loading is built, and the people it
  // brings are placed, while the loading screen still covers them.
  for (const m of pending) handle(m);
  pending = [];
  const cmds = director.take();
  if (cmds.length) world.apply(cmds);
  loading.setProgress(loadAt('village', 1));
  // Then every shader those first frames need is compiled by drawing them
  // behind the screen: once it says loaded, the swing doesn't stall.
  warming = true;
  await world.warmUp((f) => loading.setProgress(loadAt('warm', f)));
  loading.setProgress(1);
  looping = true;
  requestAnimationFrame(loop);
  $('app').classList.remove('booting');
  // The swing starts as the screen fades: the village is moving as it shows.
  world.cam.playIntro();
  void loading.done();
  // The chat's React islands (message bar, rich bodies) are big lazy chunks:
  // fetch and parse them once the intro has landed, while nobody's typing yet.
  const idle = (cb: () => void) => ((window as unknown as { requestIdleCallback?: (f: () => void, o?: object) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500)))(cb, { timeout: 8000 });
  const afterIntro = (): void => { if (world.cam.inIntro) setTimeout(afterIntro, 250); else idle(() => chat.preload()); };
  afterIntro();
})();

// ── session + feed ───────────────────────────────────────────────────────
// No server keys: the browser reads the relay as the signed-in user, through
// the same RelayHub obelisk-dex uses. Logged out, or refused by the relay, you
// get the guest island instead (guest/): scripted, local, nothing published.

// On the guest island the hub publishes nothing (nostr/guest.ts).
const hub = guardHub(pageHub());
const session = new SessionManager(hub);
let feed: Feed | GuestFeed | null = null;

/** Who you are in the village: your account, or on the guest island the tab's guest. */
function myPk(): string | null {
  return session.current?.pubkey ?? (isGuest() ? guestAuthor() : null);
}
/** Counts logins and logouts (the profile editor drops a save begun for another account). */
let sessionGen = 0;
/** Your kind 0 as last read or published (the editor's starting point; sky's profile cache keeps only a few fields). */
let ownKind0: Parameters<typeof initialOf>[0] = null;
/** The profile editor module, once loaded (React, obelisk-dex's form). Declared here: session.onChange closes it. */
let profileMount: typeof import('./profile/ProfileMount') | null = null;

// ── districts (sky-only theme config, operator-authored) ─────────────────

let themes: ThemeStore | null = null;

function applyDistricts(): void {
  if (isGuest()) {
    // No operator here: every house by its name (a "Fitness" house is the sports district's).
    world.setDistricts(new Map(groups.map((g) => [g.id, resolveTheme(g, EMPTY_THEMES, {})] as const)));
    const btn = document.querySelector<HTMLButtonElement>('.controls [data-act="districts"]');
    if (btn) btn.hidden = true;
    return;
  }
  if (!themes) return;
  const map = new Map(groups.map((g) => [g.id, resolveTheme(g, themes!.config, themes!.categoryOf)] as const));
  world.setDistricts(map);
  const btn = document.querySelector<HTMLButtonElement>('.controls [data-act="districts"]');
  if (btn) btn.hidden = !session.current || session.current.pubkey !== themes.operator;
}

async function saveThemes(cfg: ThemeConfig): Promise<string | null> {
  const out = await publishToGroup(hub, (t) => session.sign(t), themesTemplate(activeRelay(), cfg, themes?.config.updatedAt ?? 0));
  return out.ok ? null : out.reason;
}

function startFeed(): void {
  // Back from the guest island (a login, a relay switch): the real village.
  setGuest(null);
  feed?.stop();
  themes?.stop();
  themes = new ThemeStore(hub, activeRelay());
  themes.onChange(applyDistricts);
  void themes.start();
  resetVillage();
  avatars.stop();
  avatars = new AvatarStore(hub);
  avatars.onChange((pk, a) => world.setAvatar(pk, a));
  avatars.start();
  // Your look and pet follow you: the cached copy shows at once, and a relay
  // that doesn't have it (or has an older one) gets the same signed event.
  const me = session.current?.pubkey;
  if (me) {
    void avatars.syncOwn(me, async (ev) => (await publishSigned(hub, ev as VerifiedEvent)).ok)
      .then((r) => { if (r === 'republished') console.info('[sky] look copied to', activeRelay()); });
  }
  startActivity();
  book = new GameBook();
  book.onChange((id) => { gamePanel.refresh(id); scheduleTables(); });
  const f: Feed = new Feed(hub, {
    onMsg: (m) => (ready ? handle(m) : pending.push(m)),
    onAccess: (a, reason) => {
      if (a !== 'refused') { renderAccess(a, reason); return; }
      if (reason) console.info('[sky] relay refused:', reason);
      // Not admitted: the guest island meanwhile (after this callback returns).
      setTimeout(() => { if (feed === f && session.current) startGuest('refused'); }, 0);
    },
    onGame: (ev) => book.ingest(ev),
  });
  feed = f;
  f.start();
  clearProfiles();
  setProfileRequester((pk) => f.state.watch(pk));
  // Your own picture and name, from the profile relays, even before you post.
  if (session.current) f.state.watch(session.current.pubkey);
}

function resetVillage(): void {
  pending = [];
  groups = [];
  player.events = [];
  player.seek(nowSec(), false);
  if (ready) world.clearGroups();
}

/**
 * The guest island (guest/, nostr/guest.ts): for a visitor who isn't logged
 * in, or an account the relay refuses. Scripted houses and villagers, your
 * character and your words kept in this tab; no calls, DMs or zaps, and
 * nothing signed or published.
 */
function startGuest(why: GuestReason): void {
  const s = session.current;
  const me = s?.pubkey ?? guestPubkey();
  if (feed instanceof GuestFeed && guestReason() === why && guestAuthor() === me) { renderAccess(why); return; }
  feed?.stop();
  feed = null;
  themes?.stop();
  themes = null;
  readState?.stop();
  readState = null;
  dms?.stop();
  dms = null;
  dmPanel.close();
  pcall.hangup();
  void call.leave();
  avatars.stop();
  activity.stop();
  motion.stop();
  stopTheater();
  world.syncClaims([]);
  setGuest(why, me);
  if (world.cam.firstPerson) toggleFirstPerson();
  world.setPlayer(null);
  controller = null;
  resetVillage();
  if (!s) {
    // Reads only, as nobody (the hub wants an identity before any query).
    hub.setIdentity(ANONYMOUS_IDENTITY);
    const p = { pubkey: me, name: vw.guestName, avatar: null, nip05: null, loaded: true };
    world.setProfile(p);
    putProfile(p);
  }
  const look = loadGuestLook(me);
  if (look) world.setAvatar(me, look);
  const g = new GuestFeed(hub, { onMsg: (m) => (ready ? handle(m) : pending.push(m)) }, {
    lang,
    relay: activeRelay(),
    me,
    guestName: s ? null : vw.guestName,
    // Kind 0s from the public profile relays only: the group relay would ask for AUTH.
    profileRelays: () => profileRelays().filter((r) => r !== activeRelay()),
  });
  feed = g;
  clearProfiles();
  setProfileRequester((pk) => g.state.watch(pk));
  g.start();
  renderAccess(why);
  renderBell();
  renderCall();
}

/** The villagers' favourite places, for the world to send them wandering
 *  there (a no-op until the world learns haunts). */
function applyGuestHaunts(): void {
  for (const n of NPCS) world.setHaunts(n.pubkey, n.haunts);
}

let readState: ReadState | null = null;

/** Read cursors live on the group relay (per relay, as in the app). */
function startReadState(): void {
  readState?.stop();
  readState = null;
  const s = session.current;
  if (!s || isGuest()) return;
  const sg = s.signer;
  readState = new ReadState(hub, {
    pubkey: s.pubkey,
    sign: (t) => session.sign(t),
    // Without NIP-44 on the signer, cursors stay on this device only.
    encrypt: (pt) => (sg.nip44Encrypt ? sg.nip44Encrypt(s.pubkey, pt) : Promise.reject(new Error('no nip44'))),
    decrypt: (ct) => (sg.nip44Decrypt ? sg.nip44Decrypt(s.pubkey, ct) : Promise.reject(new Error('no nip44'))),
  });
  readState.onChange(() => { signTimer = 0; renderBell(); });
  readState.start();
}

session.onChange((s) => {
  sessionGen++;
  // Logged in: off the guest island (startFeed below opens the real village).
  if (s) setGuest(null);
  ownKind0 = null;
  closeAccountMenu();
  profileMount?.closeProfileEditor();
  renderAccount(s);
  // Logged in, the relay's own branding can be read: look again.
  relayShown = '';
  renderRelayName();
  startReadState();
  renderBell();
  if (world.cam.firstPerson) toggleFirstPerson();
  world.setPlayer(null);
  controller = null;
  chat.close();
  void call.leave();
  if (s) startFeed();
  startDms();
  if (!s) pcall.hangup();
  if (!s) { dmPanel.close(); }
  if (!s) { startGuest('logged-out'); loginMount?.resetLogin(); forgetWallet(); }
  else void loadWallet(s.pubkey);
  if (s && freshLogin) awaitEntry(s);
  else clearTimeout(entryTimer);
});

/** Logged in just now (the modal, not a reload): your entrance is shown. */
let freshLogin = false;
let entryTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Between a login and the village opening, a remote signer (bunker) has to
 * answer the relay's AUTH (and may ask you to approve it): say so, and offer
 * a retry if it goes quiet.
 */
function awaitEntry(s: Session): void {
  clearTimeout(entryTimer);
  if (s.method !== 'nip46') return;
  toast(vw.signerConnected);
  entryTimer = setTimeout(() => {
    if (session.current !== s || world.playerPk) return;
    toast(vw.signerWaiting, () => startFeed());
  }, 25_000);
}

/** The swing down from above onto your character, after a fresh login. */
function playEntrance(): void {
  if (!freshLogin) return;
  freshLogin = false;
  clearTimeout(entryTimer);
  if (world.cam.inIntro) return; // the boot intro already lands on you
  world.cam.holdTopDown(ISLAND_R);
  world.cam.playIntro(2.6);
  sound.whoosh();
}

void session.restore().then((ok) => { if (!ok) { renderAccount(null); startGuest('logged-out'); } }).finally(() => { restoringSession = false; });

// The re-hosted obelisk-dex login modal reaches sky through this host.
registerHost({
  login: (args) => { freshLogin = true; return session.login(args as LoginArgs); },
  sign: (t) => session.sign(t),
  pubkey: () => session.current?.pubkey ?? null,
  generation: () => sessionGen,
  editProfile: async (edit, assertCurrent) => {
    const s = session.current;
    if (!s) throw new Error('Not logged in');
    const ev = await editOwnProfile({ hub, pubkey: s.pubkey, sign: (t) => session.sign(t) }, edit, assertCurrent);
    ownKind0 = ev;
    // Through the feed's state, as any kind 0: the pill, badge, chat and card follow.
    feed?.state.watch(s.pubkey);
    feed?.state.ingestProfile(ev);
  },
});

/** The login module, once loaded (logging out resets it). */
let loginMount: typeof import('./login/LoginMount') | null = null;
$('login').addEventListener('click', async () => {
  loginMount ??= await import('./login/LoginMount');
  loginMount.openLogin();
});
$('logout').addEventListener('click', () => session.logout());
$('gate-login').addEventListener('click', () => $('login').click());
/** The guest banner, put away (until the reason changes). */
let gateHiddenFor: string | null = null;
$('gate-hide').addEventListener('click', () => { gateHiddenFor = $('gate').dataset.state ?? null; $('gate').hidden = true; });

function renderAccount(s: Session | null): void {
  $('login').hidden = !!s;
  $('account').hidden = !s;
  // On the guest island your kind 0 can't be published: only your look (kept here).
  ($('account-menu').querySelector('[data-act="edit-profile"]') as HTMLElement).hidden = isGuest();
  (document.querySelector('.controls [data-act="logout"]') as HTMLElement).hidden = !s;
  if (!s) return;
  const prof = world.profiles.get(s.pubkey);
  ($('account-name') as HTMLElement).textContent = prof?.name ?? shortKey(s.pubkey);
  ($('account-nip') as HTMLElement).textContent = prof?.nip05?.replace(/^_@/, '') ?? '';
  // Your picture, else your initial on your colour.
  const av = $('account-avatar');
  const src = prof?.avatar ?? null;
  if (av.dataset.src !== (src ?? '')) {
    av.dataset.src = src ?? '';
    av.replaceChildren();
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      av.append(img);
      av.style.background = '';
    } else {
      av.textContent = ([...(prof?.name ?? '?')][0] ?? '?').toUpperCase();
      av.style.background = pubkeyColor(s.pubkey);
    }
  }
}

/** Keys are never labels: a short npub, as obelisk-dex's shortNpubLabel. */
function shortKey(pk: string): string {
  const npub = hexToNpub(pk);
  return `${npub.slice(0, 9)}…${npub.slice(-4)}`;
}

/** The relay's answer, or the guest island's banner (logged out / not admitted). */
function renderAccess(a: FeedAccess | GuestReason, reason?: string): void {
  $('relay-btn').dataset.state = a;
  const gate = $('gate');
  const guest = a === 'logged-out' || a === 'refused';
  gate.dataset.state = a;
  gate.hidden = !guest || gateHiddenFor === a;
  const text = gate.querySelector('.gate-text') as HTMLElement;
  if (a === 'logged-out') text.textContent = tr('gate.guestLoggedOut');
  else if (a === 'refused') text.textContent = tr('gate.guestRefused', { relay: activeRelay().replace(/^wss?:\/\//, '') });
  else if (a === 'offline') {
    setStatus('connecting', tr('status.reconnecting'));
    if (reason) console.info('[sky] relay offline:', reason);
  }
  ($('gate-login') as HTMLElement).hidden = a !== 'logged-out';
  renderAccount(session.current);
}

function handle(m: ServerMsg): void {
  switch (m.t) {
    case 'snapshot': {
      firstState.arrived(); // the loading screen's wait (boot)
      relayHost = m.relay.replace(/^wss?:\/\//, '').replace(/\/$/, '');
      for (const p of m.profiles) { world.setProfile(p); putProfile(p); }
      renderAccount(session.current);
      groups = m.groups;
      const events: Ev[] = [
        ...m.messages.map((x): Ev => ({ k: 'msg', at: x.createdAt, m: x })),
        ...m.reactions.map((x): Ev => ({ k: 'react', at: x.createdAt, r: x })),
        ...m.zaps.map((x): Ev => ({ k: 'zap', at: x.createdAt, z: x })),
      ];
      applyDistricts();
      world.setGroups(groups, activityOf(events));
      player.load(events, nowSec());
      drawTimeline();
      enterAsPlayer();
      playEntrance();
      placeOfficial();
      if (myPk()) maybeShowControlsGuide($('app'));
      maybeWelcome();
      if (isGuest()) applyGuestHaunts();
      break;
    }
    case 'profile':
      world.setProfile(m.profile);
      putProfile(m.profile);
      scheduleChatRefresh();
      if (m.profile.pubkey === session.current?.pubkey) renderAccount(session.current);
      break;
    case 'group': {
      groups = [...groups.filter((g) => g.id !== m.group.id), m.group];
      world.setGroups(groups, activityOf(player.events));
      break;
    }
    case 'group-removed': {
      groups = groups.filter((g) => g.id !== m.id);
      // Forget everything from that channel, then rebuild the present.
      player.events = player.events.filter((e) => groupOfEv(e) !== m.id);
      world.setGroups(groups, activityOf(player.events));
      player.seek(nowSec(), true);
      if (historyOn) drawTimeline(); else player.goLive(nowSec());
      break;
    }
    case 'msg': {
      notePost(m.msg.pubkey, m.msg.createdAt * 1000);
      const me = session.current?.pubkey;
      const why = me ? pingReason(m.msg, me) : null;
      if (why && nowSec() - m.msg.createdAt < 120) {
        const msg = m.msg;
        toast(pingTitle(world.nameOf(msg.pubkey), why, groups.find((g) => g.id === msg.groupId)?.name ?? null), () => goToMessage(msg));
      }
      renderBell();
    }
      player.push({ k: 'msg', at: m.msg.createdAt, m: m.msg }, nowSec());
      chat.refresh(m.msg.groupId);
      drawTimeline();
      break;
    case 'reaction':
      player.push({ k: 'react', at: m.reaction.createdAt, r: m.reaction }, nowSec());
      chat.refresh(m.reaction.groupId);
      break;
    case 'msg-removed':
      player.events = player.events.filter((e) => !(e.k === 'msg' && e.m.id === m.id));
      chat.refresh(m.groupId);
      break;
    case 'reaction-removed':
      player.events = player.events.filter((e) => !(e.k === 'react' && e.r.id === m.id));
      chat.refresh();
      break;
    case 'zap':
      player.push({ k: 'zap', at: m.zap.createdAt, z: m.zap }, nowSec());
      chat.refresh(m.zap.groupId);
      break;
    case 'zap-removed':
      player.events = player.events.filter((e) => !(e.k === 'zap' && e.z.id === m.id));
      chat.refresh();
      break;
  }
}

let chatRefreshTimer: ReturnType<typeof setTimeout> | null = null;
/** Names arrive in bursts: repaint the open channel at most twice a second. */
function scheduleChatRefresh(): void {
  if (chatRefreshTimer) return;
  chatRefreshTimer = setTimeout(() => { chatRefreshTimer = null; chat.refresh(); }, 500);
}

function groupOfEv(e: Ev): string {
  return e.k === 'msg' ? e.m.groupId : e.k === 'react' ? e.r.groupId : e.z.groupId;
}

function activityOf(events: Ev[]): Map<string, number> {
  const a = new Map<string, number>();
  for (const e of events) if (e.k === 'msg') a.set(e.m.groupId, (a.get(e.m.groupId) ?? 0) + 1);
  return a;
}

// ── you ──────────────────────────────────────────────────────────────────
// Your own character: WASD / arrows (Shift runs), click the ground to walk,
// a thumb stick on touch screens. Standing in a building's yard puts you in
// that channel: its chat opens and what you type is posted there.

const input = new InputState();
mountJoystick($('app'), input);
let controller: PlayerController | null = null;
/** Where you got on a nostrich, while riding (a remote signer's riding goes out as an activity there). */
let rideSpot: string | null = null;
let place: string | null = null;
/** You're in the theater's hall (main.ts theater section). */
let inTheaterHall = false;
/** You were in LABITCONF's hall last time the sound was set (the "Sound off" toast, once a visit). */
let wasAtLabitconf = false;
let candidate: string | null = null;
let candidateFor = 0;

function enterAsPlayer(): void {
  const pk = myPk();
  if (!pk) return;
  world.setPlayer(pk);
  // The river and the pond are swum (not on a nostrich: it stays on the bank).
  controller = new PlayerController(() => world.navGrid(), world.playerSpawnPoint(), () => world.solids,
    (p) => world.playerWalkable(p) || (world.ridingOf(pk) === null && world.swimmable(p)),
    // Afloat, a bridge's deck is overhead: you swim under it on the riverbed's ground.
    (p) => world.groundAt(p, world.isSwimming(pk) && world.swimmable(p)));
  world.cam.followPlayer(world.personAnchor(pk));
}

function stepPlayer(dt: number): void {
  const pk = world.playerPk;
  const c = pk ? world.people.get(pk) : undefined;
  if (!controller || !c) return;
  // Your footsteps, in time with your feet (Character.onStep).
  c.onStep ??= (running) => sound.footstep(running);
  // In first person, step out to watch yourself train, sit or raise the knives (running laps stays in your eyes).
  // In a theater seat you keep your eyes on the screen.
  world.setSelfView((world.isTraining(pk!) && world.laneOf(pk!) === null) || (world.isSeated(pk!) && !world.inTheaterSeat(pk!)) || world.emoteOf(pk!) === 'sangre');
  // Sitting down or training gets you off the bird (World.sit / train): back to foot speeds.
  if (world.ridingOf(pk!) === null && rideSpot !== null) { rideSpot = null; controller.speeds = FOOT_SPEEDS; }
  // In deep water you swim: slower, and no jumping off the water.
  const swimming = world.swimmingAt(controller.pos, world.isSwimming(pk!)) && world.ridingOf(pk!) === null;
  if (rideSpot === null) controller.speeds = swimming ? SWIM_SPEEDS : FOOT_SPEEDS;
  const read = input.read();
  const mv = swimming && read.jump ? { ...read, jump: false } : read;
  // A jump ends an emote (walking does in Character.drive).
  if (mv.jump && world.emoteOf(pk!)) world.setEmote(pk!, null);
  // Walking off gets you up from your seat.
  if (world.isSeated(pk!) && (Math.hypot(mv.x, mv.y) > 0.05 || controller.path.length || mv.jump)) {
    const path = controller.path;
    standPlayer();
    controller.path = path;
  }
  // Steering by keys: the walk-to pin goes.
  if (Math.hypot(mv.x, mv.y) > 0.05) world.clearWalkTarget();
  // Running laps: round your lane at a run until you steer or jump off it.
  const lane = world.laneOf(pk!);
  let mvNow = mv;
  if (lane !== null) {
    if (Math.hypot(mv.x, mv.y) > 0.05 || mv.jump) { world.stopTraining(pk!); controller.path = []; }
    else {
      if (!controller.path.length) controller.path = world.lanePath(lane, controller.pos);
      mvNow = { ...mv, run: true };
    }
  }
  // Walking off ends a set (and steps you off the equipment).
  else if (world.isTraining(pk!)) {
    if (Math.hypot(mv.x, mv.y) > 0.05 || controller.path.length || mv.jump) { world.stopTraining(pk!); controller.pos = { ...c.pos }; }
    else { world.cam.played(); return; }
  }
  if (world.isSeated(pk!)) { world.cam.played(); return; }
  const before = { ...controller.pos };
  const vyBefore = controller.vy;
  controller.step(dt, mvNow, world.cameraYaw());
  // Never walk into NaN (a bad yaw, a bad ground read): it would carry the
  // camera and everything that follows you with it.
  if (!Number.isFinite(controller.pos.x) || !Number.isFinite(controller.pos.z)) {
    console.warn('[sky] position reset: it had gone non-finite');
    controller.pos = before;
    controller.path = [];
  }
  if (!Number.isFinite(controller.height) || !Number.isFinite(controller.vy)) { controller.height = 0; controller.vy = 0; }
  // Took off this frame: tell the others (nostr/motion.ts `j`).
  if (controller.vy > 0 && vyBefore <= 0) { pendingJump = performance.now(); sound.jump(); }
  // Came down: a thump as hard as the fall (a jump lands at about JUMP_SPEED).
  if (controller.landed) sound.land(-vyBefore / JUMP_SPEED);
  c.drive(controller.pos.x, controller.pos.z, controller.heading, controller.moving, controller.running, controller.height, controller.airborne);
  world.cam.setFeel({
    speed: dt > 0 ? Math.hypot(controller.pos.x - before.x, controller.pos.z - before.z) / dt : 0,
    running: controller.running && controller.moving,
    airborne: controller.airborne,
    landed: controller.landed,
    strafe: Math.max(-1, Math.min(1, mvNow.x)),
  });
  if (controller.moving && performance.now() - input.lastInput < 200) world.cam.played();
  if (controller.moving && pk) presence.activity(pk, Date.now());
  // Enter a channel when you stop in its yard or linger there; walking past
  // a yard doesn't count. What the chat does then is ui/chatAuto.ts.
  // In the theater the place is the channel it shows (picked there, or the screening's).
  const inHall = world.inTheater(controller.pos);
  if (inHall !== inTheaterHall) {
    inTheaterHall = inHall;
    syncTheater();
  }
  const here = inHall ? theaterChannel() : placeAt(controller.pos, world.yards());
  if (here !== candidate) { candidate = here; candidateFor = 0; }
  else candidateFor += dt;
  const settled = !controller.moving || candidateFor > SETTLE_WALKING;
  if (settled && candidate !== place) {
    place = candidate;
    // In the hall the chat opens only from the call bar's 💬, never by itself.
    const act = onPlaceChange(place, { open: chat.groupId, openedBy: chat.openedBy }, inHall ? 'off' : prefs.get().chatOpen);
    chatHint = act.kind === 'hint' ? act.id : null;
    if (act.kind === 'open') { const g = groups.find((x) => x.id === act.id); if (g) chat.open(g, 'auto'); }
    else if (act.kind === 'close') chat.close();
    renderCall();
  }
}

/** The channel whose chat the "open chat" button offers (you're in its yard). */
let chatHint: string | null = null;
let chatHintShown = '';
function renderChatHint(): void {
  const el = $('chat-hint') as HTMLButtonElement;
  const g = chatHint && chatHint === place && chat.groupId !== chatHint ? groups.find((x) => x.id === chatHint) : null;
  const text = g ? vw.chatHint(g.name, isTouch()) : '';
  if (text === chatHintShown) return;
  chatHintShown = text;
  el.hidden = !text;
  el.textContent = text;
}
function openHintedChat(): void {
  const g = chatHint ? groups.find((x) => x.id === chatHint) : null;
  if (g) chat.open(g, 'user');
  chatHint = null;
}
$('chat-hint').addEventListener('click', () => openHintedChat());

world.hooks.onBubbleClick = (msgId) => {
  const m = player.events.find((e): e is Extract<Ev, { k: 'msg' }> => e.k === 'msg' && e.m.id === msgId)?.m;
  if (!m || !myPk()) return;
  const g = groups.find((x) => x.id === m.groupId);
  if (g) chat.open(g);
  chat.setReply(m);
  const slot = world.slotFor(m.groupId);
  if (controller && slot && place !== m.groupId) { controller.walkTo(slot.yard); world.cam.played(); }
};

// A tap on the world puts an open card away first (on a phone that's all a
// tap on the ground does then: the card covers half the screen, walking off
// is a surprise). A tap on someone or something opens theirs right after.
world.hooks.onTap = () => {
  if ($('card').hidden) return false;
  $('card').hidden = true;
  return isTouch();
};

world.hooks.onGroundClick = (p) => {
  if (!controller) return;
  // Walking somewhere else ends your laps.
  if (world.playerPk && world.laneOf(world.playerPk) !== null) world.stopTraining(world.playerPk);
  // In and out of buildings too (through their doors).
  const route = world.routeFor(controller.pos, p);
  controller.path = route ?? [];
  seatGoal = null;
  // A pin where you're going (red if there's no way there).
  world.showWalkTarget(route ? route[route.length - 1] ?? p : p, !!route);
  world.cam.played();
};

/** The chair you clicked: walk there (in through the door if it's inside), then sit. */
let seatGoal: Seat | null = null;
world.hooks.onSeatClick = (seat) => {
  const pk = world.playerPk;
  if (!controller || !pk) return;
  if (world.isSeated(pk)) standPlayer();
  if (world.laneOf(pk) !== null || world.training(pk)) world.stopTraining(pk);
  if (dist(controller.pos, seat.pos) < 0.5) { sitOn(seat); return; }
  const route = world.routeFor(controller.pos, seat.pos);
  if (!route) { world.showWalkTarget(seat.pos, false); return; }
  controller.path = route;
  seatGoal = seat;
  world.showWalkTarget(seat.pos, true);
  world.cam.played();
};

/** Arrived at the chair you clicked (or gave up on it). */
function tickSeatGoal(): void {
  const pk = world.playerPk;
  const seat = seatGoal;
  if (!seat || !controller || !pk) return;
  if (controller.path.length) return;
  seatGoal = null;
  if (dist(controller.pos, seat.pos) > 0.6) return;
  if (seat.taken) { toast(vw.seatTaken); return; }
  sitOn(seat);
}

function toggleFirstPerson(): void {
  const on = !world.cam.firstPerson;
  world.setFirstPerson(on);
  world.camera.fov = on ? world.fpFov : (innerWidth < innerHeight ? 46 : 32);
  world.camera.updateProjectionMatrix();
  document.querySelector('.controls [data-act="firstperson"]')?.classList.toggle('on', world.cam.firstPerson);
  if (on) toast(isTouch() ? vw.firstPersonTouch : vw.firstPersonKeys);
}

const EX_LABEL: Record<StationKind, string> = vw.exercise as Record<StationKind, string>;

/** At the park: start (or stop) a set. `pick` chooses among the station's exercises. */
function toggleTraining(pick = 0): boolean {
  const pk = world.playerPk;
  if (!controller || !pk) return false;
  const now = world.training(pk);
  // Off a lane: just stop running.
  if (now?.kind === 'run') { world.stopTraining(pk); controller.path = []; return true; }
  const st = world.nearestStation(controller.pos, 1.9) ?? world.nearestLane(controller.pos);
  if (now && (!st || pick === 0 || st.kinds[pick] === now.kind)) { world.stopTraining(pk); controller.pos = { ...world.people.get(pk)!.pos }; return true; }
  if (!st || !st.kinds[pick]) return false;
  if (st.lane !== undefined) {
    // Into the lane: the laps start from where you are.
    if (world.train(pk, st, 'run')) controller.path = world.lanePath(st.lane, controller.pos);
    return true;
  }
  if (world.train(pk, st, st.kinds[pick])) { controller.pos = { ...st.pos }; controller.path = []; }
  return true;
}

/** Get up and step clear of the chair (and out of any terrace or quincho). */
function standPlayer(): void {
  const pk = world.playerPk;
  if (!controller || !pk || !world.isSeated(pk)) return;
  const face = world.people.get(pk)?.body.rotation.y ?? 0;
  world.stand(pk);
  const out = world.exitSpot(controller.pos, face);
  controller.pos = { ...out };
  controller.height = world.groundAt(out);
  controller.vy = 0;
  world.people.get(pk)?.place(out);
}

function sitOn(seat: Seat): void {
  if (!controller || !world.playerPk) return;
  world.sit(world.playerPk, seat);
  controller.pos = { ...seat.pos };
  controller.path = [];
  controller.height = world.groundAt(seat.pos);
  controller.vy = 0;
}

function toggleSeat(): void {
  if (!controller || !world.playerPk) return;
  if (toggleTraining()) return;
  if (world.isSeated(world.playerPk)) { standPlayer(); return; }
  const seat = world.nearestFreeSeat(controller.pos, 1.8);
  if (seat) sitOn(seat);
  else if (atTotem()) enterTotem();
  else toast(vw.noSeat);
}

/** On foot in front of the totem monitor (E watches it, after training and seats). */
function atTotem(): boolean {
  const pk = world.playerPk;
  const l = controller && pk && world.ridingOf(pk) === null ? world.totemLocal(controller.pos) : null;
  return !!l && inTotemZone(l);
}

/** "Press E to sit" (or a Sit / Stand up button on touch) near a free seat. */
function renderSeatHint(): void {
  // Written only when it changes (this runs every frame).
  const real = $('seat-hint') as HTMLButtonElement;
  const hint = { hidden: real.hidden, textContent: real.textContent ?? '' };
  seatHintCompute(hint);
  if (real.hidden !== hint.hidden) real.hidden = hint.hidden;
  if (!hint.hidden && real.textContent !== hint.textContent) real.textContent = hint.textContent;
}
function seatHintCompute(hint: { hidden: boolean; textContent: string }): void {
  const pk = world.playerPk;
  if (!controller || !pk) { hint.hidden = true; return; }
  const touch = isTouch();
  const t = world.training(pk);
  if (t) {
    hint.hidden = false;
    hint.textContent = t.kind === 'run'
      ? vw.laps(t.reps, touch)
      : vw.reps(EX_LABEL[t.kind], t.reps, touch);
    return;
  }
  const lane = world.nearestStation(controller.pos, 1.9) ? null : world.nearestLane(controller.pos);
  if (lane) {
    hint.hidden = false;
    const name = vw.lanes[lane.lane!] ?? String(lane.lane! + 1);
    hint.textContent = vw.lane(name, touch);
    return;
  }
  const st = world.nearestStation(controller.pos, 1.9);
  if (st) {
    hint.hidden = false;
    hint.textContent = touch
      ? vw.doExercise(EX_LABEL[st.kinds[0]])
      : st.kinds.map((k, i) => `${i === 0 ? 'E' : String(i + 1)}: ${EX_LABEL[k]}`).join(' · ');
    return;
  }
  const seated = world.isSeated(pk);
  const seat = seated ? null : world.nearestFreeSeat(controller.pos, 1.8);
  if (!seated && !seat && atTotem()) {
    hint.hidden = false;
    hint.textContent = vw.watchTotem(touch);
    return;
  }
  if (!seated && !seat) {
    // Someone online is using it.
    const who = world.claimedNear(controller.pos, 1.8);
    hint.hidden = !who;
    if (who) hint.textContent = vw.usingSpot(world.nameOf(who));
    return;
  }
  hint.hidden = false;
  if (seat?.prop && seat.prop !== 'mate') {
    const what = seat.prop === 'coffee' || seat.prop === 'asado' || seat.prop === 'marshmallow' || seat.prop === 'popcorn' ? vw.sitFor[seat.prop] : vw.sitFor.table;
    hint.textContent = vw.sit(what, touch);
    return;
  }
  hint.textContent = seated ? vw.standUp(touch) : vw.sitMate(touch);
}

$('seat-hint').addEventListener('click', () => { toggleSeat(); renderSeatHint(); });

// Riding a nostrich (world/nostrich.ts): F near a free one climbs on, F again gets off.
function toggleRide(): void {
  const pk = world.playerPk;
  if (!controller || !pk) return;
  if (world.ridingOf(pk) !== null) { getOff(); return; }
  if (world.isSeated(pk) || world.isTraining(pk)) { toast(vw.standFirst(isTouch())); return; }
  const bird = world.rideableNear(controller.pos);
  if (bird === null) { toast(vw.noNostrich); return; }
  controller.stopNow();
  world.clearWalkTarget();
  if (!world.mount(pk, bird)) return;
  controller.speeds = RIDE_SPEEDS;
  rideSpot = hereSpotId(controller.pos);
  world.cam.played();
}
function getOff(): void {
  const pk = world.playerPk;
  if (!controller || !pk) return;
  const out = world.dismount(pk);
  controller.speeds = FOOT_SPEEDS;
  rideSpot = null;
  if (!out) return;
  controller.stopNow();
  controller.pos = { ...out };
  controller.height = world.groundAt(out);
  controller.vy = 0;
}
/** "Press F to ride" near a free nostrich, "Press F to get off" on one. */
function renderRideHint(): void {
  const real = $('ride-hint') as HTMLButtonElement;
  const pk = world.playerPk;
  let text = '';
  if (controller && pk) {
    const touch = isTouch();
    if (world.ridingOf(pk) !== null) text = vw.getOff(touch);
    else if (!world.isSeated(pk) && !world.isTraining(pk) && world.rideableNear(controller.pos) !== null) text = vw.ride(touch);
  }
  if (real.hidden !== !text) real.hidden = !text;
  if (text && real.textContent !== text) real.textContent = text;
}
$('ride-hint').addEventListener('click', () => { toggleRide(); renderRideHint(); });

// Emotes (world/emotes.ts): G or the bottom bar opens the menu; picking the
// one you're doing stops it. Moving or jumping ends it too.
const emoteMenu = new EmoteMenu($('app'), {
  pick: (kind) => doEmote(kind),
  current: () => (world.playerPk ? world.emoteOf(world.playerPk) : null),
});
function doEmote(kind: EmoteKind): void {
  const pk = world.playerPk;
  if (!pk || !controller) { toast(tr('toast.loginToWalk')); return; }
  if (world.isSeated(pk) || world.isTraining(pk)) { toast(vw.standFirst(isTouch())); return; }
  if (world.ridingOf(pk) !== null) { toast(vw.getOffFirst(isTouch())); return; }
  // No coast: still moving next frame, the body would drop the emote at once.
  controller.stopNow();
  world.clearWalkTarget();
  world.setEmote(pk, world.emoteOf(pk) === kind ? null : kind);
}
document.addEventListener('pointerdown', (e) => {
  const t = e.target as Element;
  if (emoteMenu.open && !t.closest('.emote-menu') && !t.closest('[data-act="emote"]')) emoteMenu.toggle(false);
});

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  if (emoteMenu.key(e.key)) { e.preventDefault(); return; }
  if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey && world.playerPk) emoteMenu.toggle();
  if (e.key === 'Enter' && chat.groupId) { e.preventDefault(); chat.focusComposer(); }
  // E: sit down for a mate on the nearest bench or stool (or stand up).
  if (e.key.toLowerCase() === 'e' && controller && world.playerPk) toggleSeat();
  // F: climb on the nearest nostrich (or get off).
  if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && controller && world.playerPk) toggleRide();
  // 2, 3: the station's other exercises (at the pull-up bar, 2 is muscle-ups).
  if ((e.key === '2' || e.key === '3') && controller && world.playerPk) toggleTraining(Number(e.key) - 1);
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) openControlsGuide($('app'));
  if (e.key.toLowerCase() === 'v' && world.playerPk) toggleFirstPerson();
  if (e.key.toLowerCase() === 'c' && chatHint) openHintedChat();
  if (e.key.toLowerCase() === 'm' && nearPk) { e.preventDefault(); openDm(nearPk); }
  // N: the minimap on or off.
  if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) prefs.set({ minimap: !prefs.get().minimap });
  // Esc releases the mouse first (the browser does that); a second Esc leaves first person.
  if (e.key === 'Escape' && world.cam.firstPerson && !document.pointerLockElement) toggleFirstPerson();
});

// ── presence, channels and members (the left drawer) ─────────────────────

/** Online (live and active, or posting lately), AFK (live but idle), offline. */
const presence = new PresenceTracker();
/** When each pubkey last posted (ms): obelisk-dex counts 15 minutes as online. */
const lastPost = new Map<string, number>();
let liveClaimers = new Set<string>();
const POSTED_ONLINE_MS = 15 * 60_000;
function notePost(pk: string, at: number): void {
  if (at > (lastPost.get(pk) ?? 0)) lastPost.set(pk, at);
  presence.activity(pk, Math.min(Date.now(), at));
}
/** Connected to the village right now: you (logged in), or publishing where they are. */
function isLivePk(pk: string): boolean {
  if (pk === myPk()) return !isGuest();
  return !!motion.get(pk) || liveClaimers.has(pk);
}
/** The place (channel) a position is in: the theater's hall, else the nearest yard. */
function placeOfPos(p: Vec2): string | null {
  return world.inTheater(p) ? theaterChannel() : placeAt(p, world.yards());
}
/** Where `pk` stands, if the world draws them. */
function standingPlace(pk: string): string | null {
  const c = world.people.get(pk);
  return c ? placeOfPos(c.pos) : null;
}
function presenceOf(pk: string): Presence {
  const now = Date.now();
  const posted = now - (lastPost.get(pk) ?? 0) < POSTED_ONLINE_MS;
  const live = pk === myPk() || !!motion.get(pk) || liveClaimers.has(pk);
  if (!live) return posted ? 'online' : 'offline';
  const p = presence.of(pk, true, now);
  return p === 'afk' && posted ? 'online' : p;
}

const members = new MembersStore(hub, () => themes?.operator ?? null);
const side = new SidePanel($('app'), {
  channels: () => {
  // Only people connected right now, where they stand (ui/livePlaces.ts).
  const counts = hereCounts(world.people.values(), isLivePk, placeOfPos);
  const me = myPk();
  // A thread with a ping for you shows its own "@" under its forum.
  const pingedThreads = new Set(me ? openPings().map((p) => p.m.groupId) : []);
  return listRows().map((g) => ({
    id: g.id, name: g.name, kind: g.kind, here: counts.get(g.id) ?? 0,
    unread: unreadIn(g.id),
    mention: groupsIn(g.id).some((x) => pinged.has(x.id)),
    ...(g.kind === 'forum' ? {
      threads: forumThreads(g.id, groups, msgsOf).map((t) => ({
        id: t.group.id, name: t.group.name, kind: t.group.kind, here: 0,
        unread: me && readState ? countUnread(msgsOf(t.group.id), readState.cursorFor(t.group.id), me) : 0,
        mention: pingedThreads.has(t.group.id),
      })),
    } : {}),
  }));
  },
  layout: () => (isGuest() ? EMPTY_LAYOUT : themes?.layout ?? EMPTY_LAYOUT),
  defaultChannel: () => place ?? chat.groupId ?? groups[0]?.id ?? null,
  // On the guest island the houses aren't the relay's: no members to ask for.
  loadMembers: (id) => (isGuest() ? Promise.resolve({ members: [], admins: [] } as unknown as Awaited<ReturnType<typeof members.load>>) : members.load(id)),
  posters: (id) => [...new Set(msgsOf(id).map((m) => m.pubkey))],
  loadRanks: () => members.loadRoles(),
  presenceOf,
  profile: (pk) => { const p = world.profiles.get(pk); return { name: p?.name ?? world.nameOf(pk), avatar: p?.avatar ?? null, nip05: p?.nip05 ?? null }; },
  colorOf: (pk) => pubkeyColor(pk),
  me: () => myPk(),
  // Show its house and open its chat in the list's place: no need to walk over.
  onChannel: (id) => { side.close(); renderTabs(); openChannel(id); },
  onMember: (pk) => showPerson(pk),
});
const renderTabs = (): void => {
  $('tab-channels').classList.toggle('on', side.tab === 'channels');
  $('tab-members').classList.toggle('on', side.tab === 'members');
};
$('tab-channels').addEventListener('click', () => { side.toggle('channels'); renderTabs(); });
$('tab-members').addEventListener('click', () => { side.toggle('members'); renderTabs(); });
side.onToggle = renderTabs;

/** Open a channel from a list: the camera goes to its house and its chat
 *  opens on the right, fully usable, wherever your character is. */
function openChannel(id: string): void {
  const g = groups.find((x) => x.id === id);
  if (!g) return;
  if (dmPanel.isOpen) dmPanel.close();
  chat.el.hidden = false;
  chat.open(g, 'user');
  chat.setMinimised(false);
  chatHint = null;
  $('card').hidden = true;
  world.cam.focus(world.groupAnchor(id), 9);
}

// ── private messages and calls (obelisk-dex's NIP-17 DMs and 1:1 calls) ──

let dms: DmStore | null = null;
const pcall = new PrivateCall(() => dms, () => session.current?.pubkey ?? null, async () => { await call.leave(); });
const dmPanel = new DmPanel($('app'), {
  me: () => session.current?.pubkey ?? null,
  thread: (peer) => dms?.thread(peer) ?? [],
  send: async (peer, text) => (dms ? dms.send(peer, text) : vw.dmLogin),
  profile: (pk) => { const p = world.profiles.get(pk); return { name: p?.name ?? world.nameOf(pk), avatar: p?.avatar ?? null, nip05: p?.nip05 ?? null }; },
  colorOf: (pk) => pubkeyColor(pk),
  call: (peer) => void pcall.start(peer),
  presence: (pk) => vw.dmPresence[presenceOf(pk)],
});
dmPanel.onClose = () => { if (!chat.groupId) document.body.classList.remove('chat-open'); else chat.el.hidden = false; };

/** Open a private conversation with `pk` (it takes the chat panel's place). */
function openDm(pk: string): void {
  if (!session.current || isGuest() || pk === session.current.pubkey) return;
  if (chat.groupId) chat.el.hidden = true;
  dmPanel.open(pk);
}

function startDms(): void {
  dms?.stop();
  dms = null;
  const s = session.current;
  if (!s || isGuest()) return;
  const store = new DmStore(hub, s.pubkey, s.signer);
  dms = store;
  store.onMessage((peer, m, fresh) => {
    dmPanel.refresh(peer);
    if (fresh && m.from !== s.pubkey && dmPanel.peer !== peer) {
      toast(`💬 ${world.nameOf(peer)}: ${m.text.slice(0, 80)}`, () => openDm(peer));
    }
  });
  store.onCall((m) => pcall.handle(m));
  void store.start();
}

/** The private call bar: ringing, connecting, the call's timer, its end. */
function renderPCall(): void {
  const st = pcall.state;
  const bar = $('pcall');
  bar.hidden = st.status === 'idle';
  bar.dataset.status = st.status;
  if (bar.hidden) return;
  const name = st.peer ? world.nameOf(st.peer) : '';
  $('pcall-title').textContent = st.status === 'incoming' ? vw.calling(name) : `📞 ${name}`;
  const secs = st.connectedAt ? Math.floor((Date.now() - st.connectedAt) / 1000) : 0;
  const END: Record<string, string> = { ...vw.callEnd, error: st.error ?? vw.callEnd.error };
  $('pcall-sub').textContent = st.status === 'outgoing' ? vw.ringing
    : st.status === 'incoming' ? vw.privateCall
    : st.status === 'connecting' ? vw.connecting
    : st.status === 'reconnecting' ? vw.reconnecting
    : st.status === 'active' ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${st.micOn ? '' : vw.muted}`
    : END[st.endReason ?? 'error'] ?? vw.callEnded;
  $('pcall-accept').hidden = st.status !== 'incoming';
  $('pcall-mic').hidden = !(st.status === 'active' || st.status === 'reconnecting' || st.status === 'connecting');
  $('pcall-mic').textContent = st.micOn ? vw.mute : vw.unmute;
  $('pcall-end').hidden = st.status === 'ended';
  $('pcall-end').textContent = st.status === 'incoming' ? vw.decline : st.status === 'outgoing' ? vw.cancel : vw.hangUp;
}
pcall.onChange(renderPCall);
$('pcall-accept').addEventListener('click', () => void pcall.accept());
$('pcall-end').addEventListener('click', () => pcall.hangup());
$('pcall-mic').addEventListener('click', () => pcall.setMic(!pcall.state.micOn));
setInterval(() => { if (pcall.state.status === 'active') renderPCall(); }, 1000);

/** Someone connected right next to you: offer a private message or call. */
let nearPk: string | null = null;
function renderNearHint(): void {
  const el = $('near-hint');
  const me = world.playerPk;
  let best: string | null = null, bd = 2.2;
  if (me && controller && session.current && !isGuest()) {
    for (const c of world.people.values()) {
      if (c.pk === me) continue;
      const d = Math.hypot(c.pos.x - controller.pos.x, c.pos.z - controller.pos.z);
      if (d >= bd) continue;
      // Connected: live in the village (moving or sitting), online or AFK.
      if (!motion.get(c.pk) && !liveClaimers.has(c.pk)) continue;
      if (presenceOf(c.pk) === 'offline') continue;
      bd = d;
      best = c.pk;
    }
  }
  if (best === nearPk) return;
  nearPk = best;
  el.hidden = !best;
  if (best) $('near-name').textContent = `${presenceOf(best) === 'afk' ? '💤 ' : '🟢 '}${world.nameOf(best)}`;
}
$('near-dm').addEventListener('click', () => { if (nearPk) openDm(nearPk); });
$('near-call').addEventListener('click', () => { if (nearPk) void pcall.start(nearPk); });

// ── the chat panel and publishing ────────────────────────────────────────

/** Unread messages on a channel list row: the channel's, and a forum's children's too. */
function unreadIn(house: string): number {
  const me = myPk();
  if (!me || !readState) return 0;
  let n = 0;
  for (const g of groupsIn(house)) n += countUnread(msgsOf(g.id), readState.cursorFor(g.id), me);
  return n;
}
const msgsOf = (groupId: string) =>
  player.events.filter((e): e is Extract<Ev, { k: 'msg' }> => e.k === 'msg' && e.m.groupId === groupId).map((e) => e.m);
const reactionsOf = (msgId: string) =>
  player.events.filter((e): e is Extract<Ev, { k: 'react' }> => e.k === 'react' && e.r.targetId === msgId).map((e) => e.r);

const zapsOf = (msgId: string) =>
  zapTotal(player.events.filter((e): e is Extract<Ev, { k: 'zap' }> => e.k === 'zap' && e.z.targetId === msgId).map((e) => e.z));

async function publish(template: Parameters<typeof publishToGroup>[2]): Promise<string | null> {
  const out = await publishToGroup(hub, (t) => session.sign(t), template);
  if (!out.ok) return out.reason;
  // Show it now; the relay's echo is deduplicated by id.
  const st = feed?.state;
  if (st) {
    if (out.event.kind === 9) st.ingestMessage(out.event);
    else if (out.event.kind === 7) st.ingestReaction(out.event);
    else if (out.event.kind === 5) st.ingestDeletion(out.event);
  }
  return null;
}

/** The ranks the chat last drew with (MembersStore.rolesOf). */
let rolesShown: unknown = null;
const chat = new ChatPanel($('app'), {
  onProfile: (pk) => showPerson(pk),
  // Forums list their publications; a publication's ‹ goes back to its forum (nostr/forum.ts).
  threads: (id) => forumThreads(id, groups, msgsOf),
  forumOf: (id) => { const f = homeOfGroup(id); return f !== id ? groupMap().get(f) ?? null : null; },
  unread: (id) => (readState && myPk() ? countUnread(msgsOf(id), readState.cursorFor(id), myPk()!) : 0),
  // The ranks are read once per relay; the first ask redraws the chat when they come.
  roleOf: (pk) => {
    if (isGuest()) return null;
    void members.loadRoles().then((had) => { if (had !== rolesShown) { rolesShown = had; chat.refresh(); } });
    return members.rolesOf[pk]?.[0] ?? null;
  },
  me: () => myPk(),
  nameOf: (pk) => world.nameOf(pk),
  avatarOf: (pk) => world.profiles.get(pk)?.avatar ?? null,
  messages: msgsOf,
  reactions: reactionsOf,
  zaps: zapsOf,
  send: (g, text, reply, tags) => publish(messageTemplate(g, text, reply ? { id: reply.id, pubkey: reply.pubkey } : null, tags)),
  // The @-picker: like obelisk-dex, anyone on the relay (every channel's
  // members and posters), plus whoever is walking around the village.
  people: (g) => chatPeople(g),
  relay: activeRelay,
  operator: () => themes?.operator ?? null,
  react: (m, emoji) => { void publish(reactionTemplate(m.groupId, { id: m.id, pubkey: m.pubkey }, emoji)); },
  unreact: (r: WireReaction) => { void publish(deletionTemplate(r.groupId, r.id, 7)); },
  remove: (m) => { void publish(deletionTemplate(m.groupId, m.id, 9)); },
  join: (g) => publish(joinTemplate(g)),
  onGame: (id) => openGame(id),
  newGame: (g) => { if (myPk()) newGameDialog(g); },
  zap: (g, command, replyTo) => {
    if (isGuest()) return vw.guestOnly;
    const me = session.current?.pubkey ?? null;
    if (!me) return vw.loginToZap;
    const parsed = parseZapCommand(command, {
      messages: msgsOf(g), me, replyingTo: replyTo,
      people: chatPeople(g).map((p) => ({ pubkey: p.pubkey, names: [p.name] })),
    });
    if (!parsed.ok) return zapCommandMessage(parsed.error, parsed.token);
    openZap(g, parsed.target.recipient, parsed.target.messageId, parsed.target.sats);
    return null;
  },
  onReplyPick: (m) => {
    // Walk over to the person you're answering.
    const other = world.people.get(m.pubkey);
    if (controller && other && m.pubkey !== myPk()) controller.walkTo(other.pos);
  },
});
// The chat's ‹ goes back to the channel list, which stands in its place.
chat.onBack = () => { if (side.tab !== 'channels') side.toggle('channels'); renderTabs(); };
/** Everyone the @-picker (and /zap @name) may mean: anyone on the relay, plus whoever walks the village. */
function chatPeople(g: string): { pubkey: string; name: string; picture: string | null }[] {
  if (!isGuest()) void members.load(g);
  const pks = new Set<string>(world.people.keys());
  for (const ch of groups) {
    const m = members.cached(ch.id);
    for (const pk of m?.members ?? []) pks.add(pk);
    for (const msg of msgsOf(ch.id)) pks.add(msg.pubkey);
  }
  return [...pks].filter((pk) => /^[0-9a-f]{64}$/.test(pk)).map((pk) => ({ pubkey: pk, name: world.nameOf(pk), picture: world.profiles.get(pk)?.avatar ?? null }));
}

// ── zaps (wallet/, ui/zapSheet.ts) ───────────────────────────────────────

/** Open the zap sheet for `recipient` in channel `groupId` (their message `messageId`, if one). */
function openZap(groupId: string, recipient: string, messageId: string | null, sats: number | null): void {
  const s = session.current;
  if (isGuest()) { toast(vw.guestOnly); return; }
  if (!s) { toast(vw.loginToZap); return; }
  void loadWallet(s.pubkey);
  // The account and relay the zap starts with: a switch mid-payment posts no marker.
  const relay = activeRelay();
  const isCurrent = () => session.current?.pubkey === s.pubkey && activeRelay() === relay;
  openZapSheet($('app'), recipient, sats, {
    name: (pk) => world.nameOf(pk),
    lud16: (pk) => world.profiles.get(pk)?.lud16 ?? null,
    walletKind: () => walletKindFor(s.pubkey, s.method),
    walletView: () => walletView(s.pubkey),
    connect: async (uri) => { await connectWallet(s.pubkey, uri); },
    send: (amount, comment) => sendZap({
      account: s.pubkey, loginMethod: s.method, sign: (t) => session.sign(t),
      recipient, lud16: world.profiles.get(recipient)?.lud16 ?? null, groupId, messageId,
      sats: amount, comment, relay, isCurrent,
    }, async (t) => {
      const out = await publishToGroup(hub, (x) => session.sign(x), t);
      // Your own zap flies at once, without waiting for the relay to echo the ⚡;
      // the money moved, so it flies here even if the relay refused the marker.
      if (out.event) feed?.state.ingestReaction(out.event);
      return out;
    }),
    isUnconfirmed: (e) => e instanceof ZapPaymentUnconfirmed,
    toast,
  });
}

// Closed with ×: the button offers it again while you're still in its yard.
chat.onClose = () => { if (place) chatHint = place; };


// ── mentions and replies ─────────────────────────────────────────────────
// A ping is an explicit @you or a reply to you (obelisk-dex classifyGroupPing);
// ordinary traffic never pings. Read once its channel has been open, or with
// "Mark all read" (which sets the synced mentionsReadAt and, like
// obelisk-dex, reads every channel). The rules are nostr/pings.ts.

/** Read cursors for pings: a channel read past it, or "Mark all read". */
function pingCursors(): PingCursors | null {
  if (!readState) return null;
  const rs = readState;
  return { channel: (g) => rs.cursorFor(g), mentionsReadAt: rs.cursors.mentionsReadAt };
}

function openPings(): { m: WireMessage; reason: PingReason }[] {
  const me = session.current?.pubkey;
  const c = pingCursors();
  if (!me || !c) return [];
  return listPings(player.events.flatMap((e) => (e.k === 'msg' ? [e.m] : [])), me, c);
}

/** The newest unread ping in each channel (the map's "@" and its compass arrow open it). */
const pingIn = new Map<string, { m: WireMessage; reason: PingReason }>();

function goToMessage(m: WireMessage): void {
  const g = groups.find((x) => x.id === m.groupId);
  if (g) chat.open(g);
  const slot = world.slotFor(m.groupId);
  if (controller && slot) { controller.walkTo(slot.yard); world.cam.played(); }
  const sender = world.people.get(m.pubkey);
  if (sender && controller) sender.faceToward(controller.pos);
  sender?.cheer(1.2);
}

function renderBell(): void {
  const bell = $('bell');
  bell.hidden = !session.current || isGuest();
  const pings = openPings();
  const count = $('bell-count');
  count.hidden = !pings.length;
  count.textContent = pings.length > 9 ? '9+' : String(pings.length);
  const list = $('bell-list');
  list.replaceChildren();
  if (!pings.length) {
    const empty = document.createElement('div');
    empty.className = 'bell-empty';
    empty.textContent = vw.bellEmpty;
    list.append(empty);
  }
  for (const { m, reason } of pings.slice(0, 30)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'bell-item';
    const head = document.createElement('div');
    head.className = 'bell-item-head';
    const g = groups.find((x) => x.id === m.groupId);
    head.textContent = pingTitle(world.nameOf(m.pubkey), reason, g?.name ?? null);
    const text = document.createElement('div');
    text.className = 'bell-item-text';
    text.textContent = m.text;
    row.append(head, text);
    row.addEventListener('click', () => { $('bell-panel').hidden = true; goToMessage(m); });
    list.append(row);
  }
}

$('bell').addEventListener('click', () => { renderBell(); $('bell-panel').hidden = !$('bell-panel').hidden; });
$('bell-read').addEventListener('click', () => {
  // Like obelisk-dex's "Mark read": the mentions and every channel, so roofs,
  // signs and arrows clear too, not only the bell.
  const now = Date.now();
  readState?.markMentionsRead(now);
  for (const g of groups) readState?.markRead(g.id, now);
  $('bell-panel').hidden = true;
  renderBell();
  refreshSigns();
});

function toast(text: string, onClick?: () => void): void {
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'toast';
  t.textContent = text;
  if (onClick) t.addEventListener('click', () => { onClick(); t.remove(); });
  $('toasts').append(t);
  setTimeout(() => t.classList.add('out'), 6000);
  setTimeout(() => t.remove(), 6600);
}

// ── your look (kind 30078 obelisk:avatar3d:v1) ───────────────────────────

let avatars = new AvatarStore(hub);
const LOOK_ASKED = 'obelisk-sky/look-asked';

function myLook(): Avatar {
  const pk = myPk();
  if (!pk) return DEFAULT_AVATAR;
  // Nothing saved yet: the look your pubkey already gives your character.
  const saved = isGuest() ? loadGuestLook(pk) : avatars.get(pk);
  if (saved?.look) return saved;
  const look = world.people.get(pk)?.look ?? defaultLook(hashStr(pk));
  return { ...(saved ?? DEFAULT_AVATAR), v: 2, look: { ...look } };
}

function openLook(first = false): void {
  const pk = myPk();
  if (!pk) return;
  const before = myLook();
  openCreator($('app'), {
    current: myLook,
    preview: (a) => world.setAvatar(pk, a),
    cancel: () => world.setAvatar(pk, before),
    save: async (a) => {
      // The guest island: kept in this browser only.
      if (isGuest()) { saveGuestLook(pk, a); world.setAvatar(pk, a); return null; }
      const out = await publishToGroup(hub, (t) => session.sign(t), avatarTemplate(a, avatars.createdAt(pk)));
      if (!out.ok) return out.reason;
      avatars.ingest(out.event);
      return null;
    },
  }, first);
}

// ── the account pill: Edit profile / Your look ───────────────────────────

function closeAccountMenu(): void {
  $('account-menu').hidden = true;
  $('account-look').setAttribute('aria-expanded', 'false');
}

$('account-look').addEventListener('click', () => {
  const menu = $('account-menu');
  // The look panel open: close it (as Cancel), and the menu shows over the village, not behind it.
  if (closeCreator()) { menu.hidden = false; $('account-look').setAttribute('aria-expanded', 'true'); return; }
  menu.hidden = !menu.hidden;
  $('account-look').setAttribute('aria-expanded', String(!menu.hidden));
});
$('account-menu').addEventListener('click', (e) => {
  const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (!act) return;
  closeAccountMenu();
  if (act === 'your-look') openLook();
  else if (act === 'edit-profile') void openProfile();
});
document.addEventListener('pointerdown', (e) => {
  if (!$('account-menu').hidden && !(e.target as Element).closest('.account')) closeAccountMenu();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('account-menu').hidden) closeAccountMenu(); });

/** What sky already knows of your profile, for the editor's first paint. */
function knownProfile(pk: string): ProfileEditorInitial | null {
  if (ownKind0?.pubkey === pk) return initialOf(ownKind0);
  const p = world.profiles.get(pk);
  return p && p.loaded !== false ? { name: p.name, picture: p.avatar, nip05: p.nip05, lud16: p.lud16 ?? null } : null;
}

async function openProfile(): Promise<void> {
  const s = session.current;
  if (!s) return;
  profileMount ??= await import('./profile/ProfileMount');
  if (session.current !== s) return;
  profileMount.openProfileEditor({
    initial: knownProfile(s.pubkey),
    load: async () => {
      const { event } = await fetchOwnProfile({ hub, pubkey: s.pubkey });
      if (!event || session.current !== s) return null;
      if (!ownKind0 || ownKind0.created_at < event.created_at) ownKind0 = event;
      return initialOf(ownKind0);
    },
    onSaved: () => toast(lang === 'es' ? 'Perfil guardado.' : 'Profile saved.'),
  });
}

// Ask for the avatars of everyone in the village, a batch at a time.
setInterval(() => { if (session.current && !isGuest()) avatars.want([...world.people.keys()]); }, 3000);

// ── live activities (kind 30078 obelisk-sky:activity:v1) ─────────────────
// What you're doing (a bench, dips at the bars) goes to the relay, and what
// everyone else is doing comes back: they run over and hold the spot.

let activity = new ActivityStore(hub);
const beacon = new ActivityBeacon();
let activitySend: Promise<void> = Promise.resolve();
let claimsDirty = true;
let claimsAt = 0;

// Live movement (ephemeral kind 20390, nostr/motion.ts): where you walk.
let motion = new MotionStore(hub);
const motionBeacon = new MotionBeacon();
let motionBusy = false;

/** Send your movement when the beacon says so (one publish in flight at a time). */
/** When you last took off (performance.now()), until the jump is sent. */
let pendingJump = 0;

function tickMotion(): void {
  const s = session.current;
  const pk = world.playerPk;
  // A remote signer (bunker) can't sign this often; it still shares activities. The guest island shares nothing.
  if (!s || isGuest() || !pk || !controller || motionBusy || s.method === 'nip46' || !prefs.get().shareMotion) return;
  const path = controller.path;
  // A jump is sent while it's fresh (within ~0.6 s of take-off), else dropped.
  if (pendingJump && performance.now() - pendingJump > 600) pendingJump = 0;
  const send = motionBeacon.update({
    p: controller.pos,
    moving: controller.moving,
    run: controller.running,
    dest: path.length ? path[path.length - 1] : null,
    heading: controller.heading,
    jumped: pendingJump > 0,
    emote: world.emoteOf(pk),
    emoteSince: world.emoteSinceOf(pk),
    ride: world.ridingOf(pk) !== null,
    // Where you look: in first person the eyes (yaw and pitch), else the way your body faces.
    yaw: world.cam.firstPerson ? world.cam.fpYaw : controller.heading,
    pitch: world.cam.firstPerson ? world.cam.fpPitch : undefined,
  }, Date.now());
  if (!send) return;
  if (send.jump) pendingJump = 0;
  motionBusy = true;
  publishToGroup(hub, (t) => session.sign(t), motionTemplate(send))
    .then((out) => (out.ok ? motionBeacon.ok() : motionBeacon.fail()))
    .catch(() => motionBeacon.fail())
    .finally(() => { motionBusy = false; });
}

function startActivity(): void {
  activity.stop();
  activity = new ActivityStore(hub);
  activity.onChange(() => { claimsDirty = true; });
  activity.start();
  motion.stop();
  motion = new MotionStore(hub);
  motion.onChange((pk) => {
    const r = motion.get(pk);
    if (r) world.applyMotion(pk, r.m, r.ageMs / 1000);
    if (r?.m.moving) presence.activity(pk, Date.now());
  });
  motion.start();
  motionBeacon.reset();
  startTheater();
  // A start on the old relay expires by itself.
  beacon.reset();
  world.syncClaims([]);
  claimsDirty = true;
}

function publishActivity(a: Activity | null, since: number): void {
  if (isGuest()) return;
  activitySend = activitySend.then(async () => {
    const pk = session.current?.pubkey;
    if (!pk) return;
    const out = await publishToGroup(hub, (t) => session.sign(t), activityTemplate(a, since, activity.createdAt(pk)));
    if (out.ok) activity.ingest(out.event);
  }).catch(() => {});
}

/** Someone claimed your spot before you did: get up and let them have it. */
function yieldSpot(to: string): void {
  const pk = world.playerPk;
  if (!pk || !controller) return;
  if (world.isSeated(pk)) standPlayer();
  if (world.isTraining(pk)) { world.stopTraining(pk); controller.pos = { ...world.people.get(pk)!.pos }; }
  toast(vw.gotThere(world.nameOf(to)));
}

function tickActivity(): void {
  if (!myPk()) return;
  const pk = world.playerPk;
  let mine = pk ? world.activityOf(pk) ?? remoteSignerEmote(pk) : null;
  if (pk) {
    const send = beacon.update(mine, Date.now());
    if (send) publishActivity(send.activity, send.since);
  }
  tickMotion();
  const now = performance.now();
  if (!claimsDirty && now - claimsAt < 1000) return;
  claimsDirty = false;
  claimsAt = now;
  world.expireMotion();
  const local = pk ? { pk, activity: mine, since: beacon.since } : null;
  let claims = activity.live(nowSec(), local);
  liveClaimers = new Set(claims.map((c) => c.pk));
  const lost = pk && claims.find((c) => c.pk === pk && !c.held);
  if (lost && pk) {
    const winner = claims.find((c) => c.held && c.spot === lost.spot);
    yieldSpot(winner?.pk ?? '');
    mine = world.activityOf(pk);
    claims = activity.live(nowSec(), { pk, activity: mine, since: beacon.since });
  }
  world.syncClaims(claims);
  playEmoteClaims(claims);
}

/**
 * A remote signer's live movement is off, so their emote goes out as an
 * activity on the spot they stand (nostr/activity.ts `here:`).
 */
function remoteSignerEmote(pk: string): Activity | null {
  if (session.current?.method !== 'nip46' || !controller) return null;
  // Riding: the spot where you got on (it would change every step otherwise).
  if (rideSpot) return { spot: rideSpot, kind: 'ride' };
  const e = world.emoteOf(pk);
  return e ? { spot: hereSpotId(controller.pos), kind: emoteActivity(e) } : null;
}

/** Who is emoting by activity (remote signers), and what: played like a standing motion. */
const emoteClaims = new Map<string, { key: string; at: number }>();
function playEmoteClaims(claims: readonly Claim[]): void {
  const me = world.playerPk;
  const now = new Map<string, Claim>();
  for (const c of claims) if (c.pk !== me && (emoteOfActivity(c.kind) || c.kind === 'ride') && !motion.get(c.pk)) now.set(c.pk, c);
  for (const pk of emoteClaims.keys()) {
    if (now.has(pk)) continue;
    emoteClaims.delete(pk);
    if (world.people.has(pk)) { world.setEmote(pk, null); world.dismount(pk); }
  }
  const t = performance.now();
  for (const c of now.values()) {
    const key = `${c.spot}|${c.kind}`;
    const was = emoteClaims.get(c.pk);
    // Again now and then, or the world counts them gone like stale movement.
    if (was?.key === key && t - was.at < 30_000) continue;
    emoteClaims.set(c.pk, { key, at: t });
    const spot = parseSpot(c.spot);
    if (spot?.type !== 'here') continue;
    const still = { t: c.since * 1000, p: spot.pos, moving: false, run: false, dest: null, heading: null };
    if (c.kind === 'ride') world.applyMotion(c.pk, { ...still, ride: true }, 0);
    else world.applyMotion(c.pk, { ...still, emote: emoteOfActivity(c.kind)!, emoteSince: c.since * 1000 }, 0);
  }
}

// Best effort: tell the others you left (the expiration covers a lost one).
window.addEventListener('pagehide', () => { if (beacon.published) publishActivity(null, 0); });

/** First visit with no saved look: offer the creator once. */
function maybeWelcome(): void {
  const pk = session.current?.pubkey;
  if (!pk || isGuest()) return;
  let asked = false;
  try { asked = localStorage.getItem(`${LOOK_ASKED}/${pk}`) === '1'; } catch { /* private mode */ }
  if (asked) return;
  setTimeout(() => {
    if (avatars.get(pk) || session.current?.pubkey !== pk) return;
    if (document.querySelector('.guide')) { maybeWelcome(); return; }
    try { localStorage.setItem(`${LOOK_ASKED}/${pk}`, '1'); } catch { /* private mode */ }
    openLook(true);
  }, 6000);
}

// ── games (obelisk-dex tables, kind 2390) ────────────────────────────────

let book = new GameBook();
let tablesTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTables(): void {
  if (tablesTimer) return;
  tablesTimer = setTimeout(() => {
    tablesTimer = null;
    const list = groups.flatMap((g) => book.liveTables(g.id).map((s) => ({
      gameId: s.id,
      channelId: s.channelId,
      waiting: s.status === 'waiting',
      board: s.game === 'chain-reaction' && s.state ? readBoard(s) : null,
    })));
    world.setGameTables(list);
  }, 300);
}

async function gameOp(template: Parameters<typeof publishToGroup>[2]): Promise<void> {
  const out = await publishToGroup(hub, (t) => session.sign(t), template);
  if (!out.ok) { toast(vw.gameFailed(out.reason)); return; }
  book.ingest(out.event);
}

const gamePanel = new GamePanel($('app'), {
  me: () => session.current?.pubkey ?? null,
  nameOf: (pk) => world.nameOf(pk),
  session: (id) => book.session(id),
  join: (s) => void gameOp(joinTable(s)),
  start: (s) => void gameOp(startTable(s)),
  move: (s, cell, seat) => void gameOp(moveOnTable(s, { cell }, seat ?? undefined)),
  resign: (s, seat) => void gameOp(resignTable(s, seat)),
  cancel: (s) => void gameOp(cancelTable(s)),
  claimTimeout: (s) => void gameOp(timeoutOnTable(s)),
  appLink: (s) => `${OBELISK_APP}?relay=${encodeURIComponent(relayHost)}&c=${encodeURIComponent(s.channelId)}`,
});

// Every client watching a table helps enforce its clock (as the app does).
setInterval(() => {
  const id = gamePanel.openId;
  const s = id ? book.session(id) : null;
  if (s && session.current && claimableTimeout(s)) void gameOp(timeoutOnTable(s));
}, 2000);

/** Open a table; one older than the live window is fetched by id, as the app's
 *  services/games/resolve.ts does (the create, plus every op that roots on it). */
function openGame(id: string): void {
  gamePanel.open(id);
  if (book.session(id)) return;
  void hub.query({
    relays: [activeRelay()],
    filters: [{ ids: [id] }, { kinds: [2390], '#e': [id] }],
    maxWaitMs: 6000,
    label: 'sky-game-resolve',
  }).then((r) => { for (const ev of r.events) book.ingest(ev); gamePanel.refresh(id); }).catch(() => {});
}

world.hooks.onGameClick = (id) => openGame(id);

/** nostrwot.com's own link preview (its og:image). */
const NOSTR_WOT_BANNER = 'https://nostrwot.com/social-preview.png?title=Nostr+WoT+Extension+-+Identity%2C+Signer+%26+Lightning+Wallet&description=The+Nostr+browser+extension+with+a+NIP-07+signer%2C+encrypted+key+vault%2C+Lightning+wallet%2C+and+profile%2C+relay+and+mute-list+management.+Find+out+more.&locale=en&art=home';

/** A wide picture across the top of a card. */
function cardBanner(src: string, alt: string): HTMLImageElement {
  const img = el('img', 'card-banner') as HTMLImageElement;
  img.src = src;
  img.alt = alt;
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => img.remove());
  return img;
}

const LANDMARK_CARDS: Record<Exclude<LandmarkId, 'nostrwot' | 'liberture'>, { title: string; sub: string; about: string; link?: [string, string]; banner?: string }> = {
  lacrypta: {
    banner: 'https://r2a.primal.net/uploads2/5/9e/25/59e25f02b7cf6e54394b3f1a39d6182c345cb3eb3b63c44a80e41988c536a09c.png',
    ...vw.landmarks.lacrypta,
    link: [vw.landmarks.lacrypta.linkLabel!, 'https://lacrypta.ar'],
  },
  coffee: {
    ...vw.landmarks.coffee,
  },
  parrilla: {
    ...vw.landmarks.parrilla,
  },
  theater: {
    ...vw.landmarks.theater,
  },
  labitconf: {
    ...vw.landmarks.labitconf,
    link: [vw.landmarks.labitconf.linkLabel!, 'https://labitconf.com'],
  },
};

// ── brands with a place in the village: their own card, like nostr-wot's ──
// A banner (the site's social preview), the logo, an "Official site" badge,
// what they do, and their links.

interface BrandCard {
  name: string; sub: string; about: string; banner: string; logo: string; color: string;
  links: [label: string, href: string][];
  /** Buttons after the links (open a channel's chat…). */
  extra?: [label: string, run: () => void][];
}

const LIBERTURE_CARD: BrandCard = {
  name: 'Liberture', sub: vw.liberture.sub, color: '#e0b43a',
  banner: 'https://liberture.com/og-image.jpg', logo: '/brand/liberture.svg',
  about: vw.liberture.about,
  links: [['liberture.com', 'https://liberture.com']],
};

const OPENGYM_CARD: BrandCard = {
  name: 'openGym', sub: vw.opengym.sub, color: '#a3e635',
  banner: 'https://opengym.ch/img/social.jpg', logo: '/brand/opengym.svg',
  about: vw.opengym.about,
  links: [['opengym.ch', 'https://opengym.ch'], ['GitHub ↗', 'https://github.com/DuarteSantos8/openGym']],
};

function showBrand(b: BrandCard): void {
  openCard((body) => {
    body.append(cardBanner(b.banner, b.name));
    const logo = el('img', 'avatar brand-logo') as HTMLImageElement;
    logo.src = b.logo;
    logo.alt = '';
    logo.style.borderColor = b.color;
    body.append(logo, el('h2', '', b.name), el('div', 'official-badge', vw.officialSite), el('div', 'sub', b.sub), el('div', 'about', b.about));
    const actions = el('div', 'actions');
    b.links.forEach(([label, href], i) => {
      const a = el('a', i === 0 ? 'pill primary' : 'pill', label) as HTMLAnchorElement;
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      actions.append(a);
    });
    for (const [label, run] of b.extra ?? []) {
      const btn = el('button', 'pill', label);
      btn.addEventListener('click', run);
      actions.append(btn);
    }
    body.append(actions);
  });
}

/** The gym: openGym's card, with its channel's chat a click away. */
function showGym(id: string): void {
  const g = groups.find((x) => x.id === id);
  showBrand({ ...OPENGYM_CARD, extra: g ? [[vw.channelChat(g.name), () => { $('card').hidden = true; chat.open(g, 'user'); }]] : [] });
}

world.hooks.onLandmarkClick = (id) => {
  if (id === 'nostrwot') { showOfficial(); return; }
  if (id === 'liberture') {
    showBrand(LIBERTURE_CARD);
    const s = world.landmarkSlot(id);
    if (s && controller) { controller.walkTo(s.yard); world.cam.played(); }
    return;
  }
  const c = LANDMARK_CARDS[id];
  openCard((body) => {
    if (c.banner) body.append(cardBanner(c.banner, c.title));
    body.append(el('h2', '', c.title));
    body.append(el('div', 'sub', c.sub));
    body.append(el('div', 'about', c.about));
    if (c.link) {
      const actions = el('div', 'actions');
      const a = el('a', 'pill primary', c.link[0]) as HTMLAnchorElement;
      a.href = c.link[1];
      a.target = '_blank';
      a.rel = 'noopener';
      actions.append(a);
      body.append(actions);
    }
  });
  const s = world.landmarkSlot(id);
  if (s && controller) { controller.walkTo(s.yard); world.cam.played(); }
};

// ── nostr-wot: its HQ on the plaza and its official account ──────────────

/** The official account's kind 0 and latest notes, read from the public
 *  social relays (never the group relay; no AUTH is answered there). */
let officialCache: { about: string | null; notes: { id: string; content: string; at: number }[]; at: number } | null = null;

async function loadOfficial(): Promise<NonNullable<typeof officialCache>> {
  if (officialCache && Date.now() - officialCache.at < 5 * 60_000) return officialCache;
  const r = await hub.query({
    relays: [...DEFAULT_SOCIAL_RELAYS],
    filters: [{ kinds: [0], authors: [NOSTR_WOT_PUBKEY], limit: 1 }, { kinds: [1], authors: [NOSTR_WOT_PUBKEY], limit: 6 }],
    maxWaitMs: 5000,
    label: 'sky-nostrwot',
  }).catch(() => ({ events: [] as { kind: number; content: string; created_at: number; id: string; tags: string[][] }[] }));
  let about: string | null = null;
  const k0 = r.events.filter((e) => e.kind === 0).sort((a, b) => b.created_at - a.created_at)[0];
  if (k0) {
    // The village's own profile lookup only knows group relays' copies;
    // the official account lives on the public ones, so use this kind 0.
    feed?.state.ingestProfile(k0 as Parameters<SkyStateLike['ingestProfile']>[0]);
    try { const j = JSON.parse(k0.content); if (typeof j.about === 'string') about = j.about.slice(0, 400); } catch { /* not JSON */ }
  }
  const notes = r.events
    .filter((e) => e.kind === 1 && !e.tags.some((t) => t[0] === 'e'))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 4)
    .map((e) => ({ id: e.id, content: e.content.slice(0, 600), at: e.created_at }));
  officialCache = { about, notes, at: Date.now() };
  return officialCache;
}

function showOfficial(): void {
  const pk = NOSTR_WOT_PUBKEY;
  const prof = world.profiles.get(pk);
  openCard((body) => {
    body.append(cardBanner(NOSTR_WOT_BANNER, 'Nostr WoT'));
    if (prof?.avatar) {
      const img = el('img', 'avatar') as HTMLImageElement;
      img.src = prof.avatar;
      img.alt = '';
      img.style.borderColor = '#6366f1';
      body.append(img);
    } else {
      const a = el('img', 'avatar') as HTMLImageElement;
      a.src = '/brand/nostr-wot.svg';
      a.alt = '';
      body.append(a);
    }
    body.append(el('h2', '', prof?.name ?? 'nostr-wot'));
    const badge = el('div', 'official-badge', vw.officialAccount);
    body.append(badge);
    if (prof?.nip05) body.append(el('div', 'sub', prof.nip05));
    const about = el('div', 'about', vw.wotAbout);
    body.append(about);
    const notesBox = el('div', 'official-notes');
    notesBox.append(el('div', 'game-note', vw.loadingNotes));
    body.append(notesBox);
    const actions = el('div', 'actions');
    const site = el('a', 'pill primary', 'nostr-wot.com') as HTMLAnchorElement;
    site.href = NOSTR_WOT_SITE;
    site.target = '_blank';
    site.rel = 'noopener';
    const profile = el('a', 'pill', vw.interact) as HTMLAnchorElement;
    profile.href = obeliskProfileUrl(pk);
    profile.title = vw.interactTitle;
    profile.target = '_blank';
    profile.rel = 'noopener';
    const follow = el('button', 'pill', vw.followCamera);
    follow.addEventListener('click', () => world.cam.focus(world.personAnchor(pk), 6));
    actions.append(site, profile, follow);
    body.append(actions);
    void loadOfficial().then((o) => {
      if (o.about) about.textContent = o.about;
      notesBox.replaceChildren();
      if (!o.notes.length) { notesBox.append(el('div', 'game-note', vw.noNotes)); return; }
      notesBox.append(el('div', 'themes-section', vw.latestNotes));
      for (const n of o.notes) {
        const row = el('div', 'official-note');
        const text = el('div', 'chat-text');
        renderContent(text, n.content, { nameOf: (p) => world.nameOf(p), images: [], emojis: {} });
        const open = el('a', 'note-open', vw.openNote) as HTMLAnchorElement;
        open.href = obeliskNoteUrl(n.id, pk, DEFAULT_SOCIAL_RELAYS);
        open.target = '_blank';
        open.rel = 'noopener';
        open.title = vw.openNoteTitle;
        row.append(el('div', 'chat-when', new Date(n.at * 1000).toLocaleDateString(lang, { day: 'numeric', month: 'short' })), text, open);
        notesBox.append(row);
      }
    });
  });
  world.cam.focus(world.personAnchor(pk), 7);
  const s = world.landmarkSlot('nostrwot');
  if (s && controller) { controller.walkTo(s.yard); world.cam.played(); }
}

/** The account lives at its HQ: there whenever the village is. */
function placeOfficial(): void {
  // The account publishes notes but no kind 0 on the public relays: name it
  // and give it the nostr-wot mark until (unless) a profile turns up.
  if (!world.profiles.get(NOSTR_WOT_PUBKEY)?.loaded) {
    world.setProfile({ pubkey: NOSTR_WOT_PUBKEY, name: 'nostr-wot', avatar: '/brand/nostr-wot.svg', nip05: null, loaded: false });
  }
  world.addResident(NOSTR_WOT_PUBKEY, 'nostrwot', '#6366f1');
  feed?.state.watch(NOSTR_WOT_PUBKEY);
  void loadOfficial();
}

type SkyStateLike = NonNullable<typeof feed>['state'];

/** "Game" in a channel: open a table, then post its marker so the app shows it too. */
function newGameDialog(groupId: string): void {
  document.querySelector('.newgame')?.remove();
  const el = document.createElement('div');
  el.className = 'themes newgame';
  const title = document.createElement('div');
  title.className = 'themes-head';
  title.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'themes-title';
  t.textContent = vw.newGame;
  const sub = document.createElement('div');
  sub.className = 'themes-sub';
  sub.textContent = vw.newGameSub;
  title.append(t, sub);
  const body = document.createElement('div');
  body.className = 'themes-body';
  const choices: { label: string; game: string; opts: Record<string, unknown> }[] = [
    ...(['small', 'medium', 'large'] as CRSizeKey[]).map((size) => ({ label: `Chain Reaction · ${vw.crSize[size] ?? size}`, game: 'chain-reaction', opts: { size } })),
    { label: vw.inObelisk('Vesta'), game: 'vesta', opts: { seed: String(Math.floor(Date.now() / 1000) % 100000) } },
    { label: vw.inObelisk('Stacker'), game: 'stacker', opts: { seed: String(Math.floor(Date.now() / 1000) % 100000) } },
  ];
  for (const ch of choices) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bell-item';
    b.textContent = ch.label;
    b.addEventListener('click', async () => {
      el.remove();
      const out = await publishToGroup(hub, (tpl) => session.sign(tpl), createTable(groupId, ch.game, ch.opts, ch.game === 'chain-reaction' ? 45 : 0));
      if (!out.ok) { toast(vw.gameFailed(out.reason)); return; }
      book.ingest(out.event);
      await publish(messageTemplate(groupId, gameMarker(out.event.id), null));
      gamePanel.open(out.event.id);
    });
    body.append(b);
  }
  const foot = document.createElement('div');
  foot.className = 'themes-foot';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'account-btn';
  cancel.textContent = vw.cancel;
  cancel.addEventListener('click', () => el.remove());
  foot.append(document.createElement('span'), cancel);
  el.append(title, body, foot);
  $('app').append(el);
}

// ── voice (obelisk-dex mesh calls in the pavilions) ──────────────────────

installVoiceBridge({ hub, relay: activeRelay, pubkey: () => session.current?.pubkey ?? null, sign: (t) => session.sign(t), activeCalls: (cb) => liveCalls.onChange(cb) });
const call = new CallRoom(hub, activeRelay);

const VOICE_SIGNER = { nsec: 'nsec', nip07: 'nip07', nip46: 'bunker' } as const;

/** Walking out of the call's yard: how long you've been away, and whether you chose to stay. */
let awayFor = 0;
let stayInCall = false;
let awayShown: number | null = null;
function renderCall(): void {
  const s = call.state;
  // In the theater the bar is the hall's controls, always there and always in the same place.
  const hall = inTheaterHall;
  const hallId = hall ? theaterChannel() : null;
  const here = hall ? (hallId ? groups.find((g) => g.id === hallId) : null) : place ? groups.find((g) => g.id === place) : null;
  const voiceHere = here && isVoiceKind(here.kind) ? here : null;
  const inCall = !!s.channelId;
  const bar = $('callbar');
  // No calls on the guest island.
  bar.hidden = !session.current || isGuest() || (!inCall && !voiceHere && !hall);
  renderHallControls(hall && !bar.hidden, hallId);
  if (bar.hidden) return;
  const callGroup = inCall ? groups.find((g) => g.id === s.channelId) : voiceHere;
  ($('call-title') as HTMLElement).textContent = callGroup?.name ?? (hall ? vw.cine : vw.voice);
  const names = s.participants.map((pk) => world.nameOf(pk));
  const left = awayCountdown(inCall, place, s.channelId, awayFor, stayInCall);
  ($('call-who') as HTMLElement).textContent = inCall
    ? s.reconnecting ? vw.callReconnecting(s.reconnecting, RECONNECT_DELAYS.length)
      : s.joining ? vw.joining
      : left !== null ? vw.walkedAway(left)
      : s.micBlocked && s.error ? s.error
      : names.length ? names.join(', ') : vw.justYou
    : s.error ? vw.couldntJoin(s.error) : hall ? (voiceHere ? vw.joinToWatch : vw.pickAndStart) : vw.walkInTalk;
  // voice-sfu channels join through obelisk's SFU (voice/callRoom.ts); the app link stays for when it's down.
  const sfu = !inCall && voiceHere?.kind === 'voice-sfu' && !!s.error;
  // In the hall Join is for the channel it shows (a call elsewhere moves there, as in obelisk-dex).
  $('call-join').hidden = hall ? !voiceHere || s.channelId === voiceHere.id || s.joining : inCall;
  $('call-stay').hidden = left === null;
  // Mic and camera: icons that show on (green) or off (struck through); a blocked mic asks again.
  const toggle = (id: string, on: boolean, label: string, title: string) => {
    const b = $(id);
    b.hidden = !inCall || s.joining;
    b.classList.toggle('is-on', on);
    b.classList.toggle('is-off', !on);
    b.setAttribute('aria-pressed', String(on));
    b.title = title;
    (b.querySelector('.call-toggle-label') as HTMLElement).textContent = label;
  };
  toggle('call-mic', s.micOn, s.micBlocked ? vw.allowMic : s.micOn ? vw.micOn : vw.micOff, s.micBlocked ? vw.allowMicTitle : s.micOn ? vw.muteTitle : vw.unmuteTitle);
  toggle('call-cam', s.camOn, s.camOn ? vw.camOn : vw.camOff, s.camOn ? vw.camOffTitle : vw.camOnTitle);
  $('call-leave').hidden = !inCall;
  const app = $('call-app') as HTMLAnchorElement;
  app.hidden = !sfu;
  if (sfu && voiceHere) app.href = `${OBELISK_APP}?relay=${encodeURIComponent(relayHost)}&c=${encodeURIComponent(voiceHere.id)}`;
}

call.onChange(() => {
  syncTheater();
  world.setSpeaking(call.state.speaking);
  if (call.state.channelId) world.gatherForCall(call.state.channelId, call.state.participants);
});

/** Join a channel's call: through the SFU for voice-sfu. In the theater you come in with the mic off (the bar's mic turns it on). */
function joinCall(g: WireGroup, quiet = false): void {
  const s = session.current;
  if (!s || isGuest()) return;
  void call.join(g.id, { open: g.open !== false, signer: VOICE_SIGNER[s.method], sfu: g.kind === 'voice-sfu', mic: !quiet });
}

$('call-join').addEventListener('click', () => {
  const id = inTheaterHall ? theaterChannel() : place;
  const g = id ? groups.find((x) => x.id === id) : null;
  if (g) joinCall(g, inTheaterHall);
});
$('call-mic').addEventListener('click', () => void call.setMic(call.state.micBlocked || !call.state.micOn));
$('call-cam').addEventListener('click', () => void call.setCamera(!call.state.camOn));
$('call-leave').addEventListener('click', () => void call.leave());
$('call-stay').addEventListener('click', () => { stayInCall = true; renderCall(); });

function tickCallAway(dt: number): void {
  const s = call.state;
  if (!s.channelId || s.joining) { awayFor = 0; stayInCall = false; awayShown = null; return; }
  if (place === s.channelId) { awayFor = 0; awayShown = null; return; }
  awayFor += dt;
  const left = awayCountdown(true, place, s.channelId, awayFor, stayInCall);
  if (left !== awayShown) { awayShown = left; renderCall(); }
  if (left === 0) { void call.leave(); toast(vw.leftCall); }
}
window.addEventListener('beforeunload', () => { void call.leave(); });

// ── the theater (world/landmarks/theater.ts) ─────────────────────────────
// A voice channel's call on the big screen, nothing more: pick the channel in
// the call bar, Join, and whoever shares their screen is on it. Everyone in
// the call is equal, as in obelisk-dex's voice channels. Inside the hall the
// call bar is the only control and stays where it is.

/** Calls on right now in any channel (SFU rooms and mesh beacons): a transmission already going. */
const liveCalls = new LiveCalls(hub);
/** The channel picked in the hall's call bar. */
let theaterPick: string | null = null;
let theaterTick = 0;
let filmVolume = 1;

/** The channel the hall shows: the one picked, else the voice call you're in, else a call already live. */
const theaterChannel = (): string | null => {
  if (theaterPick && groups.some((g) => g.id === theaterPick)) return theaterPick;
  const inCall = call.state.channelId ? groups.find((g) => g.id === call.state.channelId) : null;
  if (inCall && isVoiceKind(inCall.kind)) return inCall.id;
  // A transmission already on somewhere (a screen shared first): the hall shows it.
  return liveForTheater(liveCalls.all(), (id) => isVoiceKind(groups.find((g) => g.id === id)?.kind ?? ''));
};

function startTheater(): void {
  liveCalls.start(activeRelay());
  syncTheater();
}

function stopTheater(): void {
  liveCalls.stop();
  theaterPick = null;
  syncTheater();
}

/** The screen, the marquee and the call bar: after any change to the hall or the call. */
function syncTheater(): void {
  const channel = theaterChannel();
  const inThisCall = !!channel && call.state.channelId === channel;
  const g = channel ? groups.find((x) => x.id === channel) : null;
  const stream = inThisCall ? call.state.screen?.stream ?? null : null;
  const live = channel ? liveCalls.get(channel) : null;
  const card: [string, string] = !g ? [vw.cine, vw.pickAndStart]
    : inThisCall ? [g.name, vw.nobodySharing]
      : [g.name, live ? vw.liveCard(live.screens.length ? world.nameOf(live.screens[0]) : null) : vw.joinToWatch];
  // Your call's people take the hall's seats while you watch it there.
  world.setTheater({ channel: inTheaterHall && inThisCall ? channel : null, marquee: g?.name ?? vw.nowShowing, stream, card });
  watchView?.show(stream, card);
  renderCall();
}

/** The hall's part of the call bar: the channel picker, Share, Watch, Chat and the film's volume. */
function renderHallControls(on: boolean, channel: string | null): void {
  const pick = $('call-pick') as HTMLSelectElement;
  const share = $('call-share'), watch = $('call-watch'), chatBtn = $('call-chat');
  const vol = $('call-vol') as HTMLInputElement;
  const s = call.state;
  const inThisCall = on && !!channel && s.channelId === channel && !s.joining;
  pick.hidden = !on;
  watch.hidden = !on;
  chatBtn.hidden = !on || !channel;
  share.hidden = !inThisCall;
  vol.hidden = !inThisCall || !s.screen;
  if (!on) return;
  const voice = groups.filter((g) => isVoiceKind(g.kind));
  const key = voice.map((g) => `${g.id}:${g.name}`).join('|') + `>${channel ?? ''}`;
  if (pick.dataset.key !== key) {
    pick.dataset.key = key;
    pick.replaceChildren();
    if (!channel) {
      const o = new Option(voice.length ? vw.pickChannel : vw.noVoice, '', true, true);
      o.disabled = true;
      pick.append(o);
    }
    for (const g of voice) pick.append(new Option(g.name, g.id, false, g.id === channel));
  }
  share.classList.toggle('is-on', s.sharing);
  share.setAttribute('aria-pressed', String(s.sharing));
  share.title = s.sharing ? vw.stopShareTitle : vw.shareTitle;
  (share.querySelector('.call-toggle-label') as HTMLElement).textContent = s.sharing ? vw.stopSharing : vw.shareScreen;
  watch.title = watchView ? vw.backToVillage : vw.watchModeTitle;
  (watch.querySelector('.call-toggle-label') as HTMLElement).textContent = watchView ? vw.backShort : vw.watchMode;
  watch.classList.toggle('is-on', !!watchView);
  const chatOpen = !!channel && chat.groupId === channel && !chat.minimised;
  chatBtn.classList.toggle('is-on', chatOpen);
  chatBtn.setAttribute('aria-pressed', String(chatOpen));
  chatBtn.title = vw.chatToggleTitle;
  (chatBtn.querySelector('.call-toggle-label') as HTMLElement).textContent = vw.chatToggle;
  vol.title = vw.filmVolume;
  if (document.activeElement !== vol) vol.value = String(filmVolume);
}

$('call-pick').addEventListener('change', () => {
  const id = ($('call-pick') as HTMLSelectElement).value;
  if (!id) return;
  theaterPick = id;
  // In a call already: move to the picked channel's, as clicking another voice channel does in obelisk-dex.
  const g = groups.find((x) => x.id === id);
  if (g && call.state.channelId && call.state.channelId !== id) joinCall(g, true);
  syncTheater();
});
$('call-share').addEventListener('click', () => void call.setScreenShare(!call.state.sharing));
$('call-watch').addEventListener('click', () => (watchView ? exitWatch() : enterWatch()));
$('call-chat').addEventListener('click', () => {
  const id = theaterChannel();
  const g = id ? groups.find((x) => x.id === id) : null;
  if (!g) return;
  if (chat.groupId === g.id && !chat.minimised) chat.close();
  else { chat.open(g, 'user'); chat.setMinimised(false); }
  renderCall();
});
$('call-vol').addEventListener('input', () => {
  filmVolume = Number(($('call-vol') as HTMLInputElement).value);
  call.setScreenVolume(filmVolume);
});

/** Watch mode (ui/theaterPanel.ts WatchView): the film, the call and the chat; the village isn't drawn. */
let watchView: WatchView | null = null;
function enterWatch(): void {
  if (watchView || !inTheaterHall) return;
  watchView = new WatchView(() => exitWatch(), $('app'));
  syncTheater();
}
function exitWatch(): void {
  if (!watchView) return;
  watchView.close();
  watchView = null;
  lastFrame = performance.now();
  renderCall();
}
world.hooks.onTheaterScreenClick = () => enterWatch();

/** The totem monitor's focus (world/totemMonitor.ts): totemcillo fills the page in Watch mode's
 *  view, for you alone, and the village isn't drawn until Esc or "Back to the village". E in front
 *  of the screen (the seat prompt offers it, tap on touch screens) opens it; a click on the screen
 *  from near it, as on the theater's, too. */
let totemView: WatchView | null = null;
function enterTotem(): void {
  if (totemView || watchView) return;
  world.setTotemFocused(true);
  totemView = new WatchView(() => exitTotem(), $('app'), TOTEM_URL);
}
function exitTotem(): void {
  if (!totemView) return;
  totemView.close();
  totemView = null;
  world.setTotemFocused(false);
  lastFrame = performance.now();
}
world.hooks.onTotemScreenClick = () => {
  const l = controller ? world.totemLocal(controller.pos) : null;
  if (l && inTotemZone(l, TOTEM.ZONE.pad)) enterTotem();
};
// Registered last: onChange calls back at once, and syncTheater reads the theater's state declared above.
liveCalls.onChange(() => { if (inTheaterHall) syncTheater(); });

/** Once a second: the bar's live parts (the channel list changes without telling it). */
function tickTheater(dt: number): void {
  theaterTick -= dt;
  if (theaterTick > 0) return;
  theaterTick = 1;
  if (inTheaterHall) renderCall();
}


// ── frame loop ───────────────────────────────────────────────────────────

let contextTimer: ReturnType<typeof setTimeout> | undefined;

let signTimer = 0;
let minimapTimer = 0;
/** Each channel's unread count, as its sign shows it (refreshSigns, once a second). */
const unreadShown = new Map<string, number>();

function updateMinimap(): void {
  if (minimap.el.hidden) return;
  const me = world.playerPk;
  minimap.update({
    houses: groups.flatMap((g) => {
      const s = world.slotFor(g.id);
      return s ? [{ id: g.id, name: g.name, pos: s.pos, unread: unreadShown.get(g.id) ?? 0, ping: pinged.has(g.id) }] : [];
    }),
    landmarks: [...world.landmarkSlots].map(([id, s]) => ({ id, pos: s.pos })),
    people: [...world.people.values()].filter((c) => c.pk !== me && c.opacity > 0.5 && isLivePk(c.pk)).map((c) => c.pos),
    me: controller ? { pos: controller.pos, heading: controller.heading } : null,
    cameraYaw: world.cameraYaw(),
  });
}
const pinged = new Set<string>();
const roofLit = new Set<string>();
let placeDwell = 0;
let qualityHeld = true;
let lastFrame = performance.now();
const frameTimes: number[] = [];
/** One frame's error must never stop the village: the next frame is asked
 *  for first, and a throw is logged (once per kind) instead of ending the loop. */
const frameErrors = new Set<string>();
function loop(): void {
  requestAnimationFrame(loop);
  try {
    frame();
  } catch (err) {
    const key = String((err as Error)?.stack ?? err).slice(0, 300);
    if (!frameErrors.has(key)) { frameErrors.add(key); console.error('[sky] frame error', err); }
  }
}

function frame(): void {
  // Your character moves first, then the world draws it: no frame of lag.
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  frameTimes.push(dt);
  if (frameTimes.length > 120) frameTimes.shift();
  // Watch mode: nothing of the village is drawn or moved; the call, the chat and the heartbeats go on.
  if (watchView) {
    tickTheater(dt);
    tickActivity();
    if (!inTheaterHall) exitWatch();
    return;
  }
  // The totem's focus, the same way: only the heartbeats go on.
  if (totemView) {
    tickActivity();
    return;
  }
  stepPlayer(dt);
  tickCallAway(dt);
  tickTheater(dt);
  tickSeatGoal();
  world.frame(dt);
  // "auto" quality waits until the intro has landed: a step down mid-swing recompiles and stutters.
  if (qualityHeld && !world.cam.inIntro) { qualityHeld = false; world.post.holdLevel(false); }
  tickActivity();
  renderSeatHint();
  renderRideHint();
  renderChatHint();
  renderNearHint();
  if (call.state.channelId && controller) {
    call.updatePositions({ x: controller.pos.x, z: controller.pos.z, yaw: world.cameraYaw() }, (pk) => world.people.get(pk)?.pos ?? null);
  }
  player.update(dt, nowSec());
  const cmds = director.take();
  if (cmds.length) world.apply(cmds);
  for (const p of director.people.values()) world.homeOf.set(p.pk, p.groupId);
  sound.night = world.sky.night;
  musicTimer -= dt;
  if (musicTimer <= 0) {
    musicTimer = 0.25;
    const t = world.cam.controls.target;
    const at = controller ? controller.pos : { x: t.x, z: t.z };
    // In the theater and at LABITCONF (its video sounds) the outside doesn't
    // reach you: no music from the village, no crickets.
    const atLabitconf = !!controller && world.inLabitconf(controller.pos);
    const indoors = inTheaterHall || atLabitconf;
    // Walking into LABITCONF with Sound off: its video plays silent, offer to turn sound on (once a visit).
    if (atLabitconf && !wasAtLabitconf && !prefs.get().sound) toast(vw.stageSoundOff, () => prefs.set({ sound: true }));
    wasAtLabitconf = atLabitconf;
    sound.hush = indoors;
    world.stageSound = soundUnlocked && prefs.get().sound;
    emoteMusic.update(indoors ? [] : world.dancers(), { ...at, yaw: world.cameraYaw() }, world.playerPk);
    // Steps back under emote music nearby, and while you're doing an emote yourself.
    placeMusic.update(indoors ? [] : world.musicPlaces(), at, world.quietPlaces(), emoteMusic.playing || (!!world.playerPk && world.emoteOf(world.playerPk) !== null));
  }
  signTimer -= dt;
  if (signTimer <= 0) { signTimer = 1; refreshSigns(); }
  minimapTimer -= dt;
  if (minimapTimer <= 0) { minimapTimer = 0.25; updateMinimap(); }
  // Only roofs that glow (or just stopped) are touched.
  for (const [id, b] of world.buildings) {
    const on = pinged.has(id);
    if (on || roofLit.has(id)) setRoofPing(b, on, performance.now() / 1000);
    if (on) roofLit.add(id); else roofLit.delete(id);
  }
  // A channel's chat open (and not folded) for a second reads it, wherever
  // you stand: opened from the channel list counts as much as walking in.
  const reading = chat.groupId && !chat.el.hidden && !chat.minimised ? chat.groupId : null;
  if (reading && readState) {
    placeDwell += dt;
    if (placeDwell > 1) {
      const latest = msgsOf(reading).at(-1);
      if (latest) readState.markRead(reading, latest.createdAt * 1000);
    }
  } else placeDwell = 0;
}

/** Pips: green when a channel spoke in the last 15 min (of the time being
 *  shown), count = messages in the 24 h before it. */
function refreshSigns(): void {
  const at = player.at || nowSec();
  const last = new Map<string, number>();
  const day = new Map<string, number>();
  for (const e of player.events) {
    if (e.k !== 'msg' || e.at > at) continue;
    last.set(e.m.groupId, e.at);
    if (at - e.at < 86400) day.set(e.m.groupId, (day.get(e.m.groupId) ?? 0) + 1);
  }
  const me = isGuest() ? null : session.current?.pubkey ?? null;
  pinged.clear();
  // The newest unread ping in each channel.
  const pings = pingIn;
  pings.clear();
  if (me) for (const p of openPings()) if (!pings.has(p.m.groupId)) pings.set(p.m.groupId, p);
  for (const g of groups) {
    world.overlay.setSignActivity(g.id, at - (last.get(g.id) ?? 0) < 900, day.get(g.id) ?? 0);
    if (!readState || !me) continue;
    const ping = pings.get(g.id) ?? null;
    if (ping) pinged.add(g.id);
    const unread = countUnread(msgsOf(g.id), readState.cursorFor(g.id), me);
    unreadShown.set(g.id, unread);
    world.overlay.setSignUnread(g.id, unread, !!ping, ping ? pingTitle(world.nameOf(ping.m.pubkey), ping.reason, g.name) : null);
  }
  $('tab-channels-n').textContent = String(groups.length);
  // Online now: live in the village or active in the last minutes (AFK not counted).
  const online = new Set<string>([...motion.livePks(), ...liveClaimers, ...[...lastPost.keys()].filter((pk) => presenceOf(pk) === 'online')]);
  const mine = myPk();
  if (mine) online.add(mine);
  let n = 0;
  for (const pk of online) if (presenceOf(pk) === 'online') n++;
  $('tab-members-n').textContent = String(n);
  for (const c of world.people.values()) world.setPresence(c.pk, presenceOf(c.pk));
  side.refresh();
  if (historyOn) {
    const span = spanSeconds(historySpan);
    $('timeline-cursor').style.left = `calc(8px + (100% - 16px) * ${Math.max(0, 1 - (nowSec() - at) / span)})`;
  }
}

// ── status / feed / timeline ─────────────────────────────────────────────

function setStatus(mode: string, text: string): void {
  const s = $('status');
  s.dataset.mode = mode;
  s.title = vw.statusTitle(text);
  // "HISTORY · pick a moment": the word, then the detail (dropped on a phone).
  const [word, ...more] = text.split(' · ');
  const t = s.querySelector('.status-text') as HTMLElement;
  t.replaceChildren(word);
  if (more.length) {
    const m = document.createElement('span');
    m.className = 'status-more';
    m.textContent = ` · ${more.join(' · ')}`;
    t.append(m);
  }
}

function renderStatus(s: PlayerStatus): void {
  const missed = s.missed ? vw.newCount(s.missed) : '';
  // On the guest island the pill says so ("LIVE · Guest island").
  const guest = isGuest() ? ` · ${tr('status.guest')}` : '';
  if (s.mode === 'live') { setStatus(s.history ? 'replay' : 'live', s.history ? `${vw.historyPick}${missed}` : `${vw.live}${guest}`); return; }
  const d = new Date(s.at * 1000);
  const when = d.toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const g = s.episode ? groups.find((x) => x.id === s.episode!.groupId) : null;
  setStatus('replay', `${vw.replay} · ${when}${g ? ` · ${g.name}` : ''}${missed}`);
}

/** Live: the village now. History: the panel below opens to pick a stretch of the past. */
function setHistory(on: boolean): void {
  historyOn = on;
  player.history = on;
  $('timeline-panel').hidden = !on;
  document.querySelector('.controls [data-act="story"]')?.classList.toggle('on', on);
  $('status').setAttribute('aria-pressed', String(on));
  if (on) { drawTimeline(); player.status(); }
  else { player.seek(nowSec(), true); player.goLive(nowSec()); }
}
// The status pill is the switch: Live ⇄ History.
$('status').addEventListener('click', () => setHistory(!historyOn));

function addFeed(pk: string, groupId: string, text: string, to: string | null): void {
  const feed = $('feed');
  const line = document.createElement('div');
  line.className = 'feed-line';
  const who = document.createElement('span');
  who.className = 'who';
  who.style.color = pubkeyColor(pk);
  who.textContent = world.nameOf(pk);
  const ch = document.createElement('span');
  ch.className = 'ch';
  const g = groups.find((x) => x.id === groupId);
  ch.textContent = ` ${to ? `→ ${world.nameOf(to)} ` : ''}· ${g?.name ?? ''}`;
  const body = document.createElement('div');
  body.textContent = text;
  line.append(who, ch, body);
  feed.appendChild(line);
  while (feed.children.length > 5) feed.firstElementChild!.remove();
  setTimeout(() => line.classList.add('old'), 14_000);
  setTimeout(() => line.remove(), 15_500);
}

/** The history panel: messages over the span, the busiest stretches marked and listed. */
function drawTimeline(): void {
  if (!historyOn) return;
  const c = $('timeline-canvas') as HTMLCanvasElement;
  const w = (c.width = c.clientWidth * devicePixelRatio);
  const h = (c.height = c.clientHeight * devicePixelRatio);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  const now = nowSec();
  const span = spanSeconds(historySpan);
  const from = now - span;
  const times = player.events.filter((e) => e.k === 'msg').map((e) => e.at);
  const counts = binCounts(times, from, now, Math.max(24, Math.floor(w / (3 * devicePixelRatio))));
  const peaks = topPeaks(findEpisodes(player.events), from, now, 5);
  // The busiest stretches, shaded behind the bars.
  g.fillStyle = 'rgba(255, 200, 61, 0.16)';
  for (const p of peaks) {
    const x0 = timeToX(p.start, from, now) * w, x1 = timeToX(p.end, from, now) * w;
    g.fillRect(x0 - 2 * devicePixelRatio, 0, Math.max(4 * devicePixelRatio, x1 - x0 + 4 * devicePixelRatio), h);
  }
  const max = Math.max(1, ...counts);
  const bw = w / counts.length;
  for (let i = 0; i < counts.length; i++) {
    if (!counts[i]) continue;
    const bh = Math.max(2 * devicePixelRatio, (Math.sqrt(counts[i]) / Math.sqrt(max)) * h);
    g.fillStyle = 'rgba(180, 249, 83, 0.75)';
    g.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
  }
  // Day ticks (hours, over a day).
  g.fillStyle = 'rgba(255,255,255,0.12)';
  const tick = span <= 86400 ? 3600 * 3 : 86400;
  for (let t = Math.ceil(from / tick) * tick; t < now; t += tick) g.fillRect(timeToX(t, from, now) * w, 0, devicePixelRatio, h);
  $('tl-start').textContent = vw.ago(SPANS.find((s) => s.id === historySpan)!.label);
  renderHistoryChips(peaks);
}
window.addEventListener('resize', drawTimeline);

function renderHistoryChips(peaks: ReturnType<typeof topPeaks>): void {
  const spans = $('tl-spans');
  spans.replaceChildren(...SPANS.map((s) => {
    const b = el('button', `tl-chip${s.id === historySpan ? ' on' : ''}`, s.label);
    b.addEventListener('click', () => { historySpan = s.id; drawTimeline(); });
    return b;
  }));
  const list = $('tl-peaks');
  list.replaceChildren(...peaks.map((p) => {
    const g = groups.find((x) => x.id === p.groupId);
    const b = el('button', 'tl-chip peak');
    b.append(el('b', undefined, `${p.count}`), ` · ${peakLabel(p.start, lang)}${g ? ` · ${g.name}` : ''}`);
    b.title = vw.replayN(p.count);
    b.addEventListener('click', () => player.playFrom(p.start - 1, p.end, nowSec(), p));
    return b;
  }));
  if (!peaks.length) list.append(el('span', 'tl-chip', vw.nothingBusy));
}

// Drag across the panel to replay that stretch; a click plays the hour after it.
{
  const tl = $('timeline');
  const sel = $('timeline-sel');
  let x0: number | null = null;
  const xOf = (e: PointerEvent) => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left - 8) / (r.width - 16))); };
  const show = (a: number, b: number) => {
    sel.hidden = false;
    sel.style.left = `calc(8px + (100% - 16px) * ${Math.min(a, b)})`;
    sel.style.width = `calc((100% - 16px) * ${Math.abs(b - a)})`;
  };
  tl.addEventListener('pointerdown', (e) => { x0 = xOf(e); tl.setPointerCapture(e.pointerId); show(x0, x0); });
  tl.addEventListener('pointermove', (e) => { if (x0 !== null) show(x0, xOf(e)); });
  tl.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const now = nowSec();
    const { start, end } = dragRange(x0, xOf(e), now - spanSeconds(historySpan), now);
    x0 = null;
    setTimeout(() => { sel.hidden = true; }, 1200);
    // Start a little before the first message so the scene has context.
    const first = player.events.find((ev) => ev.k === 'msg' && ev.at >= start && ev.at <= end);
    if (!first) { toast(vw.nobodyWrote); return; }
    player.playFrom(first.at - 2, end, now);
  });
}

// ── cards ────────────────────────────────────────────────────────────────

function openCard(build: (body: HTMLElement) => void): void {
  const card = $('card');
  const body = card.querySelector('.card-body') as HTMLElement;
  body.replaceChildren();
  build(body);
  card.hidden = false;
  // On a phone the chat is a bottom sheet the card would sit under: fold it.
  if (window.matchMedia('(max-width: 720px)').matches) chat.setMinimised(true);
}
// The × closes it; on a phone the card is a bottom sheet whose grip drags it away.
wireCard($('card'), () => { $('card').hidden = true; });
// Phones held upright: a card asks to turn sideways (and can lock it).
initOrientation($('rotate'));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function messageList(msgs: WireMessage[], showWho: boolean): HTMLElement {
  const list = el('div', 'msgs');
  for (const m of msgs.slice(-5).reverse()) {
    const row = el('div', 'm');
    const g = groups.find((x) => x.id === m.groupId);
    const when = new Date(m.createdAt * 1000).toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    row.append(el('div', 'meta', `${showWho ? `${world.nameOf(m.pubkey)} · ` : ''}${g?.name ?? ''} · ${when}`), el('div', '', m.text));
    list.append(row);
  }
  if (!msgs.length) list.append(el('div', 'meta', vw.nothing30));
  return list;
}

function showPerson(pk: string): void {
  if (pk === NOSTR_WOT_PUBKEY) { showOfficial(); return; }
  const prof = world.profiles.get(pk);
  const msgs = player.events.filter((e): e is Extract<Ev, { k: 'msg' }> => e.k === 'msg' && e.m.pubkey === pk).map((e) => e.m);
  openCard((body) => {
    const color = pubkeyColor(pk);
    if (prof?.avatar) {
      const img = el('img', 'avatar') as HTMLImageElement;
      img.src = prof.avatar;
      img.alt = '';
      img.style.borderColor = color;
      body.append(img);
    } else {
      const a = el('div', 'avatar', ([...(prof?.name ?? '?')][0] ?? '?').toUpperCase());
      a.style.borderColor = color;
      a.style.background = color;
      body.append(a);
    }
    body.append(el('h2', '', prof?.name ?? vw.someone));
    // Their NIP-05 (e.g. name@domain), whether they're here, and how much they wrote.
    if (prof?.nip05) body.append(el('div', 'sub nip', `✓ ${prof.nip05.replace(/^_@/, '')}`));
    const pres = presenceOf(pk);
    body.append(el('div', 'sub', `${vw.personPresence[pres]} · ${vw.messages30(msgs.length)}`));
    body.append(messageList(msgs, false));
    const actions = el('div', 'actions');
    // No DMs, calls or zaps on the guest island.
    if (session.current && !isGuest() && pk !== session.current.pubkey) {
      const msg = el('button', 'pill primary', vw.message);
      msg.addEventListener('click', () => { $('card').hidden = true; openDm(pk); });
      const ring = el('button', 'pill', vw.call);
      ring.addEventListener('click', () => { $('card').hidden = true; void pcall.start(pk); });
      // Zap them for their latest message here (its channel carries the ⚡).
      const zapBtn = el('button', 'pill', vw.zap);
      zapBtn.addEventListener('click', () => {
        const last = msgs.at(-1);
        const g = last?.groupId ?? place ?? groups[0]?.id;
        if (!g) { toast(vw.noZapChannel); return; }
        $('card').hidden = true;
        openZap(g, pk, last?.id ?? null, null);
      });
      actions.append(msg, ring, zapBtn);
    }
    const follow = el('button', 'pill', vw.followCamera);
    follow.addEventListener('click', () => world.cam.focus(world.personAnchor(pk), 6));
    const profile = el('a', 'pill', vw.profileOnObelisk) as HTMLAnchorElement;
    profile.href = obeliskProfileUrl(pk);
    profile.target = '_blank';
    profile.rel = 'noopener';
    profile.title = vw.profileTitle;
    actions.append(follow, profile);
    body.append(actions);
  });
  world.cam.focus(world.personAnchor(pk), 7);
}

function showGroup(id: string): void {
  const g = groups.find((x) => x.id === id);
  if (!g) return;
  const msgs = player.events.filter((e): e is Extract<Ev, { k: 'msg' }> => e.k === 'msg' && e.m.groupId === id).map((e) => e.m);
  openCard((body) => {
    body.append(el('h2', '', g.name));
    const kind = kindLabel(g.kind);
    body.append(el('div', 'sub', `${kind} · ${vw.messages30(msgs.length)}`));
    if (g.about) body.append(el('div', 'about', g.about));
    body.append(messageList(msgs, true));
    // The guest island's houses exist only here.
    if (!isGuest()) {
      const actions = el('div', 'actions');
      const open = el('a', 'pill primary', vw.openInObelisk) as HTMLAnchorElement;
      open.href = `${OBELISK_APP}?relay=${encodeURIComponent(relayHost)}&c=${encodeURIComponent(id)}`;
      open.target = '_blank';
      open.rel = 'noopener';
      actions.append(open);
      body.append(actions);
    }
  });
  world.cam.focus(world.groupAnchor(id), 9);
}

// ── controls ─────────────────────────────────────────────────────────────


// On a phone the bottom bar folds into the header's menu button: a sheet of
// the same buttons, labelled. Toggles leave it open; anything else closes it.
function setMenu(open: boolean): void {
  document.body.classList.toggle('menu-open', open);
  $('menu-btn').setAttribute('aria-expanded', String(open));
}
$('menu-btn').addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
document.addEventListener('pointerdown', (e) => {
  if (!document.body.classList.contains('menu-open')) return;
  const t = e.target as Element;
  if (!t.closest('.controls') && !t.closest('#menu-btn')) setMenu(false);
});
const MENU_TOGGLES = new Set(['director', 'time', 'signs', 'tilt', 'sound']);

document.querySelectorAll<HTMLButtonElement>('.controls button').forEach((b) => {
  b.addEventListener('click', () => {
    if (!MENU_TOGGLES.has(b.dataset.act ?? '')) setMenu(false);
    switch (b.dataset.act) {
      case 'about':
        window.open('/', '_blank', 'noopener');
        break;
      case 'logout':
        void session.logout();
        break;
      case 'director':
        prefs.set({ autoDirector: !prefs.get().autoDirector });
        break;
      case 'story':
        // A toggle: on, the latest conversation plays in history mode (so it
        // isn't cut short); off, back to live and the panel closes.
        if (historyOn) setHistory(false);
        else { setHistory(true); player.playStory(nowSec()); }
        break;
      case 'time': {
        const order = ['auto', 'day', 'sunset', 'night'] as const;
        prefs.set({ timeOfDay: order[(order.indexOf(prefs.get().timeOfDay) + 1) % order.length] });
        break;
      }
      case 'signs':
        prefs.set({ signs: !prefs.get().signs });
        break;
      case 'tilt': {
        const on = !prefs.get().tiltShift;
        prefs.set({ tiltShift: on });
        toast(on ? vw.tiltOn : vw.tiltOff);
        break;
      }
      case 'sound':
        prefs.set({ sound: !prefs.get().sound });
        break;
      case 'settings': {
        // Pressed again: close it.
        const open = $('app').querySelector('.settings');
        if (open) open.remove();
        else openSettings($('app'), prefs, () => world.post.level);
        break;
      }
      case 'districts':
        if (!themes) break;
        openThemeEditor($('app'), {
          config: () => themes!.config,
          categoryNames: () => themes!.categoryNames,
          categoryOf: () => themes!.categoryOf,
          groups: () => groups,
          resolved: (g) => resolveTheme(g, { channels: {}, categories: themes!.config.categories, updatedAt: 0 }, themes!.categoryOf),
          save: saveThemes,
        });
        break;
      case 'home':
        $('card').hidden = true;
        world.cam.home();
        break;
      case 'emote':
        if (world.playerPk) emoteMenu.toggle();
        else toast(tr('toast.loginToWalk'));
        break;
      case 'firstperson':
        if (world.playerPk) toggleFirstPerson();
        else toast(tr('toast.loginToWalk'));
        break;
      case 'help': {
        const open = $('app').querySelector('.guide');
        if (open) open.remove();
        else openControlsGuide($('app'));
        break;
      }
      case 'fullscreen':
        if (document.fullscreenElement) void document.exitFullscreen();
        // A phone goes full screen sideways (ui/orientation.ts).
        else if (isTouch()) void lockLandscape();
        else void document.documentElement.requestFullscreen?.();
        break;
    }
  });
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('card').hidden = true; setMenu(false); }
});
