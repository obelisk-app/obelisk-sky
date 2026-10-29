// obelisk-dex's message bar (app/[locale]/app/panes/channel/ChatComposer.tsx
// at the vendored commit) in sky's chat panel: its reply bar, attachment
// menu, emoji / GIF / sticker picker, @-mention and slash-command pickers,
// the command scaffold, attachments, voice note and send button, over
// useSkyComposer. The input is a textarea (Shift+Enter is a new line, as
// sky's composer always allowed), and the picker opens as a sheet over the
// panel, which is too narrow for the app's 600px popover.

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Button from '@/components/ui/buttons/Button';
import MessageMediaPicker from '@/components/chat/picker/MessageMediaPicker';
import { AttachmentMenu } from '@/components/chat/composer/AttachmentMenu';
import { VoiceNoteButton } from '@/components/chat/composer/VoiceNoteButton';
import { VoiceNoteDraft } from '@/components/chat/composer/VoiceNoteDraft';
import MentionAutocomplete from '@/components/chat/mentions/MentionAutocomplete';
import SlashCommandAutocomplete from '@/components/chat/slash/SlashCommandAutocomplete';
import SlashCommandScaffold from '@/components/chat/slash/SlashCommandScaffold';
import { ComposerAttachments } from '@/app/[locale]/app/panes/channel/ComposerAttachments';
import { ComposerReplyBar } from '@/app/[locale]/app/panes/channel/ComposerReplyBar';
import type { JsMessage } from '@/services/nostr-bridge';
import { MESSAGE_INPUT_PROPS } from '@/constants/chat/composer';
import { SendIcon, StickerIcon } from '@/assets/icons';
import { useDismiss } from '@/hooks/common/useDismiss';
import { useRelayEmojiSet } from '@/hooks/relay/operator/useRelayEmojiSet';
import { relayOperatorAuthors } from '@/services/relay/channel-layout';
import { relayEmojiMap, relayMediaKindMap } from '@/services/relay/relay-emojis';
import { useChatStore } from '@/store/chat';
import type { MediaPickerTab } from '@/utils/chat/picker/media-catalog';
import type { PickedCustomEmoji } from '@/types/chat/picker';
import { useSkyComposer, type MentionPerson, type ReplyTarget } from './useSkyComposer';

export type { MentionPerson, ReplyTarget };

export interface SkyComposerProps {
  groupId: string;
  groupName: string;
  relay: string;
  /** The relay's NIP-11 operator: its emoji set is the picker's server emoji. */
  operator: string | null;
  replyingTo: ReplyTarget | null;
  setReplyingTo: (m: ReplyTarget | null) => void;
  onSend: (text: string, tags: string[][], replyTo: ReplyTarget | null) => Promise<string | null>;
  onNewGame?: () => void;
  onZap?: (command: string, replyTo: ReplyTarget | null) => string | null;
  people: () => MentionPerson[];
  /** Escape with nothing left to close in the bar: the panel may close (sky's general chat). */
  onEscape?: () => void;
  /** Filled with the textarea, so the panel can focus it. */
  inputRef?: { current: HTMLTextAreaElement | null };
}

// The textarea's own props: MESSAGE_INPUT_PROPS minus the input-only `type`.
const { type: _type, ...textareaProps } = MESSAGE_INPUT_PROPS as Record<string, unknown>;

/** The relay operator's emoji set into the chat store, where the picker and the app's send read it (useRelayOperatorData). */
function useRelayEmojis(relay: string, operator: string | null): void {
  const set = useRelayEmojiSet(relay || null, relayOperatorAuthors(operator));
  const setServerEmojis = useChatStore((s) => s.setServerEmojis);
  useEffect(() => { setServerEmojis(relayEmojiMap(set), relayMediaKindMap(set)); }, [set, setServerEmojis]);
}

export default function SkyComposer(props: SkyComposerProps) {
  const t = useTranslations();
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = props.inputRef ?? ownRef;
  const emojiBtnRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  useRelayEmojis(props.relay, props.operator);
  const composer = useSkyComposer({ ...props, inputRef });
  const { emojiOpen, setEmojiOpen } = composer;
  useDismiss({ refs: [emojiBtnRef, pickerRef], onDismiss: () => setEmojiOpen(false), enabled: emojiOpen, escape: 'close' });

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [composer.draft, inputRef]);

  const showSlash = composer.slashQuery !== null
    && (composer.slashResults.length > 0 || (composer.slashFilter !== 'all' && composer.slashRail.length > 0));
  const showMentions = composer.mentionQuery !== null && composer.filteredMembers.length > 0;
  const showAttachments = composer.pendingImageUrls.length > 0 || composer.uploading;
  const canSend = composer.draft.trim().length > 0;
  const placeholder = t('shell.desktop.composer.placeholder', { name: props.groupName });
  const pickMedia = (emoji: string, custom?: PickedCustomEmoji, kind?: MediaPickerTab) => {
    composer.onPickMedia(emoji, custom, kind);
    inputRef.current?.focus();
  };
  const reply = props.replyingTo ? ({ ...props.replyingTo } as unknown as JsMessage) : null;

  return (
    <form
      className="sky-composer"
      onSubmit={(e) => { e.preventDefault(); void composer.send(); }}
      data-testid="sky-composer"
    >
      {reply && <ComposerReplyBar replyingTo={reply} onCancel={() => props.setReplyingTo(null)} />}
      {composer.sendError && (
        <p className="sky-composer-error" data-testid="composer-error">{composer.sendError}</p>
      )}
      {composer.activeSlashCommand && (
        <SlashCommandScaffold command={composer.activeSlashCommand} content={composer.draft} caret={composer.caret} />
      )}
      {showAttachments && (
        <ComposerAttachments urls={composer.pendingImageUrls} uploading={composer.uploading} onRemove={composer.removeAttachmentUrl} />
      )}
      {emojiOpen && (
        <div ref={pickerRef} className="sky-picker">
          <MessageMediaPicker
            variant="sheet"
            initialTab={composer.pickerTab}
            customEmojis={composer.pickerEmojis}
            onPick={pickMedia}
            onClose={() => setEmojiOpen(false)}
          />
        </div>
      )}
      <div className="relative">
        {showSlash && (
          <SlashCommandAutocomplete
            sections={composer.slashSections}
            rail={composer.slashRail}
            filter={composer.slashFilter}
            onFilter={composer.setSlashFilter}
            botProfiles={composer.botProfiles}
            selectedIndex={composer.slashIndex}
            onSelect={composer.insertSlashCommand}
            onClose={composer.closeSlash}
          />
        )}
        {showMentions && (
          <MentionAutocomplete
            members={composer.filteredMembers}
            selectedIndex={composer.mentionIndex}
            onSelect={composer.applyMention}
            onHover={composer.setMentionIndex}
            onClose={composer.closeMentions}
          />
        )}
        <div className="sky-composer-bar flex items-end gap-0.5 rounded-[22px] border border-lc-border bg-lc-card/80 px-1.5 py-1 focus-within:border-lc-green">
          {!composer.draftVoiceNote && (<>
            <AttachmentMenu
              disabled={composer.uploading}
              onFiles={(files) => void composer.onPickFiles(files)}
              onContact={composer.onContact}
              onNewSticker={() => composer.openPicker('sticker')}
            />
            <div ref={emojiBtnRef}>
              <Button
                variant="bare"
                type="button"
                onClick={() => (emojiOpen ? setEmojiOpen(false) : composer.openPicker('emoji'))}
                className="flex h-9 w-9 items-center justify-center rounded-full text-lc-muted hover:bg-white/5 hover:text-lc-white"
                aria-label={t('mobile.composer.openPicker')}
                aria-haspopup="dialog"
                aria-expanded={emojiOpen}
              >
                <StickerIcon size={null} className="h-5 w-5" />
              </Button>
            </div>
          </>)}
          <div className="min-w-0 flex-1 self-center">
            {composer.draftVoiceNote && (
              <VoiceNoteDraft note={composer.draftVoiceNote} onDiscard={composer.discardVoiceNote} />
            )}
            <textarea
              {...textareaProps}
              ref={inputRef}
              rows={1}
              value={composer.draft}
              onChange={(e) => composer.onInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onKeyDown={composer.onKeyDown}
              onSelect={(e) => { const el = e.currentTarget; composer.onSelect(el.value, el.selectionStart ?? el.value.length); }}
              onPaste={composer.onPaste}
              placeholder={placeholder}
              aria-label={placeholder}
              className={(composer.draftVoiceNote ? 'hidden ' : '') + 'sky-composer-input block w-full resize-none bg-transparent py-2 text-sm text-lc-white outline-none placeholder:text-lc-muted'}
            />
          </div>
          {canSend ? (
            <Button
              variant="bare"
              type="submit"
              disabled={composer.uploading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lc-green text-lc-black disabled:opacity-30"
              aria-label={t('common.send')}
            >
              <SendIcon size={null} strokeWidth={2} className="h-5 w-5" />
            </Button>
          ) : (
            <VoiceNoteButton disabled={composer.uploading} onRecorded={(file, duration) => void composer.onVoiceRecorded(file, duration)} />
          )}
        </div>
      </div>
    </form>
  );
}
