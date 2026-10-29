// obelisk-dex's channel composer (hooks/chat/composer/useChannelComposer.ts
// at the vendored commit), re-hosted: the same draft state, emoji / GIF /
// sticker picks, @-mentions, slash commands from the bots alive on the relay,
// uploads and keys, built from the app's own pieces (draft-text, mentions,
// bot-commands, picker-keys, useComposerUploads, useBotCommands). What the
// app reads from its bridge (members, the publish, /zap's wallet) is sky's:
// people come from `people()`, a send goes to `onSend` (ChatPanel's
// `deps.send`, publish.ts's kind 9), and a failed send keeps the draft.

import {
  useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type ClipboardEvent, type KeyboardEvent, type RefObject,
} from 'react';
import {
  applyMentionToDraft, detectMentionQuery, filterMembers, resolveDraftMentions,
  type DraftMention, type MemberInfo,
} from '@/utils/message-text/mentions';
import { mergeCustomEmojiMaps, type CustomEmojiMap } from '@/utils/media/tags/custom-emoji-tags';
import type { MessageSticker } from '@/utils/media/tags/sticker-tags';
import type { MessageVoiceNote } from '@/utils/media/tags/voice-note-tags';
import { extractUrls, isImageUrl } from '@/utils/message-text/markdown';
import { useChatStore } from '@/store/chat';
import { buildSlashSections, mergeSlashCommands, slashCommandId, type SlashFilter } from '@/services/relay/bot-commands';
import { loadRecentSlashCommands, pushRecentSlashCommand } from '@/services/chat/slash/recent-slash-commands';
import type { BotProfiles, SlashCommand } from '@/utils/chat/slash/slash-commands';
import type { MediaPickerTab } from '@/utils/chat/picker/media-catalog';
import type { PickedCustomEmoji } from '@/types/chat/picker';
import { outgoingTags, pastedMediaFiles, removeUrlLine, slashQueryOf, withPickedMedia } from '@/utils/chat/composer/draft-text';
import { navigatePicker } from '@/utils/chat/composer/picker-keys';
import { MAX_COMPOSER_ATTACHMENTS } from '@/constants/chat/composer';
import { useComposerUploads } from '@/hooks/chat/composer/useComposerUploads';
import { useBotCommands } from '@/hooks/relay/operator/useBotCommands';
import { getProfile, subscribeProfile } from '../../nostr/profileStore';
import { SKY_SLASH_COMMANDS, skyBuiltinOf, unsupportedCommandOf } from './commands';
import { vw } from '../../i18n/village';

/** A message being answered: what the reply bar shows and the `e`/`p` tags need. */
export interface ReplyTarget { id: string; pubkey: string; content: string }

/** Someone the @-picker can offer. */
export interface MentionPerson { pubkey: string; name: string; picture?: string | null }

export interface SkyComposerOptions {
  groupId: string;
  relay: string;
  replyingTo: ReplyTarget | null;
  setReplyingTo: (m: ReplyTarget | null) => void;
  /** Publish a kind 9; resolves to an error reason, or null once it's out. */
  onSend: (text: string, tags: string[][], replyTo: ReplyTarget | null) => Promise<string | null>;
  /** `/play`: open the game table. */
  onNewGame?: () => void;
  /** `/zap …` (mentions already as `nostr:npub1…`): open the zap sheet, or say why not. */
  onZap?: (command: string, replyTo: ReplyTarget | null) => string | null;
  /** Everyone mentionable on this relay (asked only while the @-picker is open). */
  people: () => MentionPerson[];
  /** Escape with nothing left to close in the bar (no picker, emoji sheet or reply): the panel may close (sky's general chat). */
  onEscape?: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  maxMentionResults?: number;
}

/** Names and pictures for the bots in the slash picker, from sky's profile store (fetched on first read). */
function useBotProfiles(pubkeys: readonly string[]): BotProfiles {
  const key = [...pubkeys].sort().join(',');
  const version = useSyncExternalStore(
    (cb) => {
      const offs = key ? key.split(',').map((pk) => subscribeProfile(pk, cb)) : [];
      return () => offs.forEach((off) => off());
    },
    () => (key ? key.split(',').map((pk) => { const p = getProfile(pk); return `${p?.name ?? ''}\t${p?.picture ?? ''}`; }).join('\n') : ''),
    () => '',
  );
  return useMemo<BotProfiles>(() => {
    const out: Record<string, { name?: string | null; picture?: string | null }> = {};
    const lines = version ? version.split('\n') : [];
    (key ? key.split(',') : []).forEach((pk, i) => {
      const [name, picture] = (lines[i] ?? '').split('\t');
      out[pk] = { name: name || null, picture: picture || null };
    });
    return out;
  }, [key, version]);
}

export function useSkyComposer({
  groupId, relay, replyingTo, setReplyingTo, onSend, onNewGame, onZap, people, onEscape, inputRef, maxMentionResults = 8,
}: SkyComposerOptions) {
  const serverEmojis = useChatStore((s) => s.serverEmojis);

  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<MediaPickerTab>('emoji');
  const [draftCustomEmojis, setDraftCustomEmojis] = useState<CustomEmojiMap>({});
  const [draftSticker, setDraftSticker] = useState<MessageSticker | null>(null);
  const [draftVoiceNote, setDraftVoiceNote] = useState<MessageVoiceNote | null>(null);
  const [draftMentions, setDraftMentions] = useState<DraftMention[]>([]);
  const pendingCaretRef = useRef<number | null>(null);
  const { uploading, onPickFiles, onVoiceRecorded } = useComposerUploads({
    setDraft, setDraftSticker, setDraftVoiceNote, setSendError,
  });

  // ── @-mentions ──
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const filteredMembers = useMemo<MemberInfo[]>(() => {
    if (mentionQuery === null) return [];
    const seen = new Set<string>();
    const all: MemberInfo[] = [];
    for (const p of people()) {
      if (seen.has(p.pubkey)) continue;
      seen.add(p.pubkey);
      all.push({ pubkey: p.pubkey, displayName: p.name, picture: p.picture ?? undefined });
    }
    return filterMembers(all, mentionQuery).slice(0, maxMentionResults);
  }, [mentionQuery, people, maxMentionResults]);

  // ── slash commands: sky's built-ins, then every live bot's (useSlashCatalog) ──
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashFilter, setSlashFilterState] = useState<SlashFilter>('all');
  const [recentSlash, setRecentSlash] = useState<string[]>(() => loadRecentSlashCommands());
  const botCommandSets = useBotCommands(relay || null);
  const allSlashCommands = useMemo(() => mergeSlashCommands(SKY_SLASH_COMMANDS, botCommandSets), [botCommandSets]);
  const slashSections = useMemo(
    () => (slashQuery === null ? [] : buildSlashSections(allSlashCommands, slashQuery, recentSlash, slashFilter)),
    [slashQuery, allSlashCommands, recentSlash, slashFilter],
  );
  const slashOpen = slashQuery !== null;
  const slashRail = useMemo(
    () => (slashOpen ? buildSlashSections(allSlashCommands, '', recentSlash) : []),
    [slashOpen, allSlashCommands, recentSlash],
  );
  const slashResults = useMemo<SlashCommand[]>(() => slashSections.flatMap((sec) => sec.commands), [slashSections]);
  const botProfiles = useBotProfiles(useMemo(() => botCommandSets.map((b) => b.pubkey), [botCommandSets]));
  const activeSlashCommand = useMemo(() => skyBuiltinOf(draft), [draft]);

  // A new channel starts clean (the previous-value pattern, as the app's).
  const [composerGroupId, setComposerGroupId] = useState(groupId);
  if (composerGroupId !== groupId) {
    setComposerGroupId(groupId);
    setMentionQuery(null);
    setSlashQuery(null);
    setDraftMentions([]);
    setSendError(null);
  }

  useLayoutEffect(() => {
    const next = pendingCaretRef.current;
    if (next === null) return;
    pendingCaretRef.current = null;
    inputRef.current?.setSelectionRange(next, next);
    setCaret(next);
  }, [draft, inputRef]);

  function detect(value: string, cursor: number) {
    setCaret(cursor);
    const sq = slashQueryOf(value);
    if (sq !== null) {
      if (slashQuery === null) setSlashFilterState('all');
      setSlashQuery(sq);
      setSlashIndex(0);
      setMentionQuery(null);
      return;
    }
    setSlashQuery(null);
    const query = detectMentionQuery(value, cursor);
    if (query !== mentionQuery) {
      setMentionQuery(query);
      if (query !== null) setMentionIndex(0);
    }
  }

  function onInput(value: string, cursor: number) {
    setDraft(value);
    setDraftSticker(null);
    setDraftVoiceNote(null);
    detect(value, cursor);
  }

  function focusAndPlaceCaret(position: number) {
    inputRef.current?.focus({ preventScroll: true });
    pendingCaretRef.current = position;
  }

  function insertSlashCommand(cmd: SlashCommand) {
    // Bot commands insert what the bot parses (`!milugar`), not `/milugar`.
    const next = `${cmd.insert ?? `/${cmd.name}`} `;
    setRecentSlash(pushRecentSlashCommand(slashCommandId(cmd)));
    setDraft(next);
    setSlashQuery(null);
    focusAndPlaceCaret(next.length);
  }

  function applyMention(member: MemberInfo) {
    const cursor = inputRef.current?.selectionStart ?? draft.length;
    const { next, cursor: nextCursor, mention } = applyMentionToDraft(draft, cursor, member.pubkey, { displayName: member.displayName });
    setDraft(next);
    if (mention) setDraftMentions((prev) => [...prev, mention]);
    setMentionQuery(null);
    focusAndPlaceCaret(nextCursor);
  }

  async function send() {
    const content = draft.trim();
    if (!content || uploading) return;
    if (unsupportedCommandOf(content)) {
      setSendError('That command only works in obelisk.ar.');
      return;
    }
    // /zap is frontend-only, like the app's: the sheet pays, then posts the ⚡.
    if (/^\/zap(\s|$)/i.test(content)) {
      const err = onZap ? onZap(resolveDraftMentions(content, draftMentions), replyingTo) : vw.loginToZap;
      if (err) { setSendError(err); return; }
      setSendError(null);
      setDraft('');
      setDraftMentions([]);
      setReplyingTo(null);
      return;
    }
    if (/^\/play(\s|$)/.test(content)) {
      onNewGame?.();
      setDraft('');
      setReplyingTo(null);
      return;
    }
    setSendError(null);
    const reply = replyingTo;
    const kept = { draft, draftMentions, draftCustomEmojis, draftSticker, draftVoiceNote };
    // The draft holds mentions as `@Name`; the wire wants `nostr:npub1…`.
    const wire = resolveDraftMentions(content, draftMentions);
    const tags = outgoingTags(wire, { serverEmojis, draftCustomEmojis, draftSticker, draftVoiceNote });
    setDraft('');
    setDraftMentions([]);
    setDraftCustomEmojis({});
    setDraftSticker(null);
    setDraftVoiceNote(null);
    setReplyingTo(null);
    const err = await onSend(wire, tags, reply);
    if (err) {
      // Not sent: put it all back (unless they've started typing again).
      setDraft((d) => (d ? d : kept.draft));
      setDraftMentions((m) => (m.length ? m : kept.draftMentions));
      setDraftCustomEmojis((c) => (Object.keys(c).length ? c : kept.draftCustomEmojis));
      setDraftSticker((s) => s ?? kept.draftSticker);
      setDraftVoiceNote((v) => v ?? kept.draftVoiceNote);
      setReplyingTo(reply);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (navigatePicker(e, {
      open: slashQuery !== null,
      count: slashResults.length,
      setIndex: setSlashIndex,
      choose: () => insertSlashCommand(slashResults[slashIndex]),
      close: () => setSlashQuery(null),
    })) return;
    if (navigatePicker(e, {
      open: mentionQuery !== null,
      count: filteredMembers.length,
      setIndex: setMentionIndex,
      choose: () => applyMention(filteredMembers[mentionIndex]),
      close: () => setMentionQuery(null),
    })) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === 'Escape') {
      if (emojiOpen) setEmojiOpen(false);
      else if (replyingTo) { setReplyingTo(null); inputRef.current?.blur(); }
      else { inputRef.current?.blur(); onEscape?.(); }
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = pastedMediaFiles(Array.from(e.clipboardData?.items ?? []));
    if (files.length > 0) {
      e.preventDefault();
      void onPickFiles(files);
    }
  }

  function onPickMedia(emoji: string, custom?: PickedCustomEmoji, kind?: MediaPickerTab) {
    setDraft((current) => withPickedMedia(current, emoji, kind));
    setDraftSticker(kind === 'sticker' && custom ? custom : null);
    setDraftVoiceNote(null);
    if (custom) setDraftCustomEmojis((current) => ({ ...current, [custom.name]: custom.url }));
    setEmojiOpen(false);
  }

  const pendingImageUrls = useMemo(
    () => extractUrls(draft).filter(isImageUrl).slice(0, MAX_COMPOSER_ATTACHMENTS),
    [draft],
  );
  const pickerEmojis = useMemo(() => mergeCustomEmojiMaps(serverEmojis, draftCustomEmojis), [serverEmojis, draftCustomEmojis]);

  return {
    draft, setDraft, caret, onInput, onSelect: detect, onKeyDown, onPaste, send, sendError, setSendError,
    uploading, onPickFiles, onVoiceRecorded, draftVoiceNote,
    discardVoiceNote: () => { setDraft(''); setDraftVoiceNote(null); },
    onContact: (value: string) => {
      setDraftSticker(null);
      setDraftVoiceNote(null);
      setDraft((current) => current + (current ? ' ' : '') + 'nostr:' + value);
    },
    pendingImageUrls,
    removeAttachmentUrl: (url: string) => setDraft((d) => removeUrlLine(d, url)),
    emojiOpen, setEmojiOpen, pickerTab,
    openPicker: (tab: MediaPickerTab) => { setPickerTab(tab); setEmojiOpen(true); },
    pickerEmojis, onPickMedia,
    mentionQuery, mentionIndex, setMentionIndex, filteredMembers, applyMention,
    closeMentions: () => setMentionQuery(null),
    slashQuery, slashIndex, slashSections, slashRail, slashResults, slashFilter,
    setSlashFilter: (f: SlashFilter) => { setSlashFilterState(f); setSlashIndex(0); },
    botProfiles, activeSlashCommand, insertSlashCommand,
    closeSlash: () => setSlashQuery(null),
  };
}

export type SkyComposerState = ReturnType<typeof useSkyComposer>;
