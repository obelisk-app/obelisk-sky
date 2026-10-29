import { describe, it, expect } from 'vitest';
import { pickGeneralChat } from './generalChat';
import type { WireGroup } from './wire';
import type { ChannelLayout } from '@/services/relay/channel-layout';

const g = (id: string, name: string, kind: WireGroup['kind'] = 'text', parent: string | null = null): WireGroup => ({ id, name, about: '', kind, parent });

describe('the general chat', () => {
  it('is the text channel called general', () => {
    expect(pickGeneralChat([g('a', 'bitcoin'), g('b', 'General'), g('c', 'chat')])).toBe('b');
    expect(pickGeneralChat([g('a', 'bitcoin'), g('b', '#general-chat')])).toBe('b');
  });

  it('else one called like a chat room (the guest island’s Mate & chat)', () => {
    expect(pickGeneralChat([g('a', 'Bitcoin'), g('b', 'Nostr dev'), g('c', 'Mate & chat'), g('d', 'Fitness')])).toBe('c');
    expect(pickGeneralChat([g('a', 'Bitcoin'), g('c', 'Mate y charla')])).toBe('c');
    expect(pickGeneralChat([g('a', 'Bitcoin'), g('c', 'off-topic')])).toBe('c');
  });

  it('never a voice channel, a forum or a forum’s thread', () => {
    expect(pickGeneralChat([g('v', 'General', 'voice'), g('f', 'general', 'forum'), g('t', 'general', 'text', 'f'), g('a', 'bitcoin')])).toBe('a');
    expect(pickGeneralChat([g('v', 'General', 'voice-sfu')])).toBeNull();
    expect(pickGeneralChat([])).toBeNull();
  });

  it('else the first text channel in the operator’s layout, else the first one', () => {
    const layout: ChannelLayout = {
      categories: [{ id: 'k2', name: 'Two', position: 1 }, { id: 'k1', name: 'One', position: 0 }],
      channels: [{ id: 'a', categoryId: 'k2', position: 0 }, { id: 'b', categoryId: 'k1', position: 1 }, { id: 'c', categoryId: 'k1', position: 0 }],
      updatedAt: 1,
    };
    expect(pickGeneralChat([g('a', 'bitcoin'), g('b', 'nostr'), g('c', 'memes')], layout)).toBe('c');
    expect(pickGeneralChat([g('x', 'unlisted'), g('b', 'nostr')], layout)).toBe('b');
    expect(pickGeneralChat([g('a', 'bitcoin'), g('b', 'nostr')])).toBe('a');
  });
});
