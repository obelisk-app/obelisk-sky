// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { nip19, type Event as NostrEvent } from 'nostr-tools';
import type { RelayHub } from '@nostr-wot/relay/hub';
import SkyComposer, { type SkyComposerProps } from './SkyComposer';
import { mountComposer } from './mount';
import { registerHost } from '../../shims/host';
import { installVoiceBridge } from '../../shims/bridge';
import { clearProfiles } from '../../nostr/profileStore';
import { useChatStore } from '@/store/chat';

const RELAY = 'wss://relay.test';
const ALICE = 'a'.repeat(64);
const BOT = 'b'.repeat(64);

// A hub that never touches the network: the bridge's subscriptions are kept
// so a test can hand them events (a bot's command catalog).
const subs: { filters: Record<string, unknown>[]; onEvent: (ev: NostrEvent) => void }[] = [];
const fakeHub = {
  subscribe: (req: { filters: Record<string, unknown>[]; onEvent: (ev: NostrEvent) => void }) => {
    subs.push(req);
    return { release: () => { subs.splice(subs.indexOf(req), 1); } };
  },
  acquireAuthLease: () => ({ release: () => {} }),
  status: () => ({ auth: 'authenticated' }),
  onStatus: () => () => {},
  publish: async () => { throw new Error('tests never publish'); },
} as unknown as RelayHub;

beforeAll(() => {
  // jsdom has no layout: the pickers scroll their selected row into view.
  Element.prototype.scrollIntoView = () => {};
  registerHost({ login: async () => {}, sign: async () => { throw new Error('no signer'); }, pubkey: () => null });
  installVoiceBridge({ hub: fakeHub, relay: () => RELAY, pubkey: () => null, sign: async () => { throw new Error('no signer'); } });
});

afterEach(() => {
  cleanup();
  clearProfiles();
  useChatStore.getState().setServerEmojis({});
  localStorage.clear();
});

function setup(over: Partial<SkyComposerProps> = {}) {
  const onSend = vi.fn<SkyComposerProps['onSend']>(async () => null);
  const setReplyingTo = vi.fn();
  const props: SkyComposerProps = {
    groupId: 'g1', groupName: 'plaza', relay: RELAY, operator: null,
    replyingTo: null, setReplyingTo, onSend,
    people: () => [{ pubkey: ALICE, name: 'Alice' }],
    ...over,
  };
  render(<SkyComposer {...props} />);
  const input = screen.getByRole('textbox', { name: 'Message #plaza' }) as HTMLTextAreaElement;
  const type = (value: string) => fireEvent.change(input, { target: { value, selectionStart: value.length } });
  return { input, type, onSend, setReplyingTo, props };
}

describe("SkyComposer (obelisk-dex's message bar)", { timeout: 20_000 }, () => {
  it('Enter sends the text, Shift+Enter does not', async () => {
    const { input, type, onSend } = setup();
    type('hola');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('hola', [], null));
    expect(input.value).toBe('');
  });

  it('sends a reply to the message in the reply bar, then clears it', async () => {
    const reply = { id: 'e'.repeat(64), pubkey: ALICE, content: 'what time is the asado?' };
    const { input, type, onSend, setReplyingTo } = setup({ replyingTo: reply });
    expect(screen.getByText('Replying to')).toBeTruthy();
    type('at nine');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('at nine', [], reply));
    expect(setReplyingTo).toHaveBeenCalledWith(null);
  });

  it('keeps the draft when the send fails', async () => {
    const { input, type } = setup({ onSend: async () => 'restricted: not a member' });
    type('let me in');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('let me in'));
  });

  it('inserts an emoji from the picker', async () => {
    const { input } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open emoji, GIF, and sticker picker' }));
    const smile = await screen.findByRole('button', { name: '😀' });
    fireEvent.click(smile);
    await waitFor(() => expect(input.value).toBe('😀'));
    expect(screen.queryByTestId('media-picker-shell')).toBeNull();
  });

  it("offers the relay operator's emoji set and tags a pick on send (NIP-30)", async () => {
    const url = 'https://cdn.test/mate.png';
    const OPERATOR = 'd'.repeat(64);
    const { input, onSend } = setup({ operator: OPERATOR });
    // The operator's kind 30030 `obelisk:emojis:<relay>`, handed to the bridge's subscription.
    await waitFor(() => expect(subs.some((s) => JSON.stringify(s.filters).includes('obelisk:emojis:'))).toBe(true));
    const ev = {
      id: 'f'.repeat(64), pubkey: OPERATOR, kind: 30030, created_at: Math.floor(Date.now() / 1000), sig: '',
      tags: [['d', `obelisk:emojis:${RELAY}`], ['emoji', 'mate', url], ['media', 'mate', 'emoji']], content: '',
    } as NostrEvent;
    act(() => { for (const s of [...subs]) if (JSON.stringify(s.filters).includes('obelisk:emojis:')) s.onEvent(ev); });
    await waitFor(() => expect(useChatStore.getState().serverEmojis).toEqual({ mate: url }));
    fireEvent.click(screen.getByRole('button', { name: 'Open emoji, GIF, and sticker picker' }));
    fireEvent.click(await screen.findByTitle(':mate:'));
    await waitFor(() => expect(input.value).toBe(':mate:'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(':mate:', [['emoji', 'mate', url]], null));
  });

  it('completes an @mention and sends it as nostr:npub', async () => {
    const { input, type, onSend } = setup();
    type('hi @al');
    const option = await screen.findByTestId('mention-option');
    expect(option.textContent).toContain('Alice');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('hi @Alice '));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith(`hi nostr:${nip19.npubEncode(ALICE)}`, [], null));
  });

  it("lists the bots' commands on / and inserts what the bot parses", async () => {
    const { input, type } = setup();
    // The catalog a bot publishes (obelisk-agents lib/commands.mjs), handed to the bridge's subscription.
    await waitFor(() => expect(subs.some((s) => JSON.stringify(s.filters).includes('obelisk:bot-commands:wss://relay.test'))).toBe(true));
    const ev = {
      id: 'c'.repeat(64), pubkey: BOT, kind: 30078, created_at: Math.floor(Date.now() / 1000), sig: '',
      tags: [['d', `obelisk:bot-commands:${RELAY}`], ['t', 'obelisk-bot-commands']],
      content: JSON.stringify({ v: 1, name: 'Milu', commands: [{ command: '!milugar', description: 'Where Milu is now' }] }),
    } as NostrEvent;
    act(() => { for (const s of [...subs]) if (JSON.stringify(s.filters).includes('bot-commands')) s.onEvent(ev); });
    type('/mil');
    const rows = await screen.findAllByTestId('slash-option');
    expect(rows.map((r) => r.textContent).join(' ')).toContain('/milugar');
    expect(rows[0].textContent).toContain('Where Milu is now');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('!milugar '));
  });

  it('/play opens the game table instead of posting', async () => {
    const onNewGame = vi.fn();
    const { input, type, onSend } = setup({ onNewGame });
    type('/');
    expect((await screen.findAllByTestId('slash-option')).some((r) => r.textContent?.includes('/play'))).toBe(true);
    type('/pl');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe('/play '));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onNewGame).toHaveBeenCalled());
    expect(onSend).not.toHaveBeenCalled();
  });

  it('/zap opens the zap sheet instead of posting, and shows why when it can\'t', async () => {
    const onZap = vi.fn((cmd: string) => (cmd.includes('@nobody') ? 'Nobody here is called “@nobody”.' : null));
    const { input, type, onSend } = setup({ onZap });
    type('/');
    expect((await screen.findAllByTestId('slash-option')).some((r) => r.textContent?.includes('/zap'))).toBe(true);
    type('/zap 21');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onZap).toHaveBeenCalledWith('/zap 21', null));
    await waitFor(() => expect(input.value).toBe(''));
    type('/zap @nobody');
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Nobody here is called “@nobody”.');
    expect(input.value).toBe('/zap @nobody');
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('Escape in the message bar', { timeout: 20_000 }, () => {
  it('with nothing left to close, leaves the bar and lets the panel close', () => {
    const onEscape = vi.fn();
    const { input } = setup({ onEscape });
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });

  it('drops a reply first, and the panel stays', () => {
    const onEscape = vi.fn();
    const { input, setReplyingTo } = setup({ onEscape, replyingTo: { id: 'm1', pubkey: ALICE, content: 'hi' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(setReplyingTo).toHaveBeenCalledWith(null);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('closes the @-picker first, and the panel stays', async () => {
    const onEscape = vi.fn();
    const { input, type } = setup({ onEscape });
    type('@Ali');
    await screen.findByText('Alice');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

describe('the mounted message bar', { timeout: 20_000 }, () => {
  it('takes a focus asked for before React drew it, on the first mount and on a new channel', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const m = mountComposer(host);
    const base = { relay: RELAY, operator: null, replyingTo: null, setReplyingTo: () => {}, onSend: async () => null, people: () => [] };
    act(() => { m.render({ ...base, groupId: 'g1', groupName: 'one' }); m.focus(); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message #one' })));
    act(() => { m.render({ ...base, groupId: 'g2', groupName: 'two' }); m.focus(); });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message #two' })));
    act(() => m.unmount());
    host.remove();
  });
});
