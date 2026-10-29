# Roadmap: obelisk-dex features Obelisk Sky doesn't have yet

What obelisk-dex (vendored at `vendor/obelisk/src`) does that sky is still missing, or only does in part. Last surveyed 2026-10-15. Dex paths are relative to `vendor/obelisk/src`, and `app/…` means `app/[locale]/app/…`. Sky paths are relative to `client/src`.

These dex features don't exist, so they aren't listed here: message editing, pinned messages, bookmarks and polls. The Poll entry in dex's attachment menu is disabled.

## Next up

1. **The message menu.** Forward, copy text or link, mute the author, and delete for everyone as an admin. Dex already has the components and the wire formats match, so it's cheap to add to `ui/chatPanel.ts`, whose actions are only reply, react and delete-own today.
2. **Channel creation and channel settings.** Without them, operators can't manage their houses from sky.
3. **A DM inbox.** A list of conversations and a new-DM search. Today a DM opens only by walking up to someone or from their card.
4. **New forum threads.** Sky lists a forum's publications and opens them (`nostr/forum.ts`), but starting one still sends you to obelisk.ar.
5. **Social notes and follows.** See "Social / Nostr" below.

## Chat

| Feature | In dex | Sky today |
|---|---|---|
| Forward a message | `components/chat/message/ForwardMessageModal.tsx`, `services/chat/message/forward-message.ts` | missing |
| Copy text or link, jump to a message | `app/…/panes/message/MessageMenu.tsx`, `services/chat/timeline/message-flash.ts` | missing (the bell's pings do jump to a message) |
| Mute a user from a message | `MessageMenu.tsx`, `components/settings/privacy/MutedAndBlocked.tsx` | missing |
| Who reacted or zapped, on hover | `panes/message/ReactorHoverCard.tsx`, `ZapperHoverCard.tsx` | partial: a chip's title lists names |
| Search (messages, people, channels) | `app/…/search/*`, `services/chat/search/group-search.ts` | missing |
| Forum extras: tags, sort, gallery view, search | `components/chat/forum/*`, `hooks/chat/forum/*` | partial: thread cards (latest first) and threads nested in the channel list |
| A channel's media gallery | `components/chat/gallery/*` | missing |
| Mention navigator and inbox popover | `components/chat/mentions/MentionNavigator.tsx`, `panes/topbar/InboxPopover.tsx` | partial: the bell, "Mark all read" |
| DM attachments, encrypted files, voice notes | `services/chat/dm/dm-attachments.ts`, `dm-file-decrypt.ts` | missing: DMs are text only (`ui/dmPanel.ts`) |
| DM opt-in gate, switching DM protocol | `app/…/dm/DmOptInGate.tsx`, `DmProtocolSwitch.tsx` | missing: NIP-17 only |
| Post-quantum (PQ) messages | `components/chat/pq/*`, `services/chat/pq/*` | missing |
| Personal media library, sticker pack editor | `components/media/library/*` | missing on purpose (shimmed out, favourites hidden) |
| Voice note in the world's speech bubble | n/a | the bubble shows the raw URL; it should say "🎤 voice note" |

## Channels and moderation

| Feature | In dex | Sky today |
|---|---|---|
| Create a channel | `panes/sidebar/CreateGroupSection.tsx`, `services/chat/channel/create-channel-form.ts` | missing |
| Channel settings (name, about, type, public, private or read-only, forum tags, SFU URL, members, admins) | `modals/channel-settings/ChannelSettingsModal.tsx` | missing |
| Delete for everyone (admin) | `MessageMenu.tsx` | partial: only your own messages |
| Relay admin (members and roles in bulk) | `components/admin/relay-admin/*`, `services/admin/relay-admin-bulk.ts` | missing |
| Edit relay roles | `components/admin/relay-roles/*` | partial: reads them and shows badges |
| Edit the relay's custom emoji | `components/admin/relay-emoji/RelayEmojiAdminModal.tsx` | partial: uses the set |
| Edit the channel layout (categories, order) | `modals/layout/ManageLayoutModal.tsx` | partial: reads it; `ui/themeEditor.ts` edits only sky's districts |
| Relay branding and settings | `modals/relay/RelayBrandingModal.tsx`, `RelaySettingsModal.tsx` | partial: reads branding (`nostr/branding.ts`) |
| Relay access and joining | `modals/relay/RelayAccessModal.tsx`, `services/relay/relay-invite.ts` | partial: a join request (kind 9021) from the chat; relay invite links (`nostr/invite.ts`, `docs/relay-invites.md`) let a new key in, an unknown relay only after you confirm |
| Channel menu (mute, notification level, follow, mark read, copy link) | `components/chat/channel/ChannelContextMenu.tsx` | missing |
| Invite links, relay share links | `panes/channel/CopyInviteLinkButton.tsx`, `app/[locale]/r/[code]`, `app/[locale]/invite/[code]` | partial: relay invite links (`/invite/<code>`; Invite people in the account menu and settings: relay picker, allowance, who joined, turn off); channel and relay share links missing |

## Social / Nostr

| Feature | In dex | Sky today |
|---|---|---|
| Notes feed, threads, reposts, likes, composer, articles, trending, starter packs | `components/social/*`, `services/social/*` | missing: the cards link out to obelisk.ar (`ui/obeliskLinks.ts`) |
| Follow people and hashtags | `components/social/viewer/FollowButton.tsx`, `social/tags/FollowTagButton.tsx` | missing (`nostr/follows.ts` is a stub) |
| Full profile pane and popover with feed tabs | `components/chat/profile/*`, `panes/reader/ProfilePane.tsx` | partial: sky's person card |
| Web of trust badges, settings, stats | `components/wot/WotBadge.tsx`, `settings/privacy/Wot*` | missing (the engine is shimmed) |

**The plan for notes:** re-host dex's `NoteActionRow` and `NoteComposer`, and publish through the outbox. That means the user's 10002 write relays plus the author's read relays (`@nostr-wot/data` `relaysForAuthor` / `fetchRelayList`), never the group relay. It needs these from the shims:
- `nostrActions` (`ensureUserMetadata`) and `useCurrentRelayUrl` in `shims/bridge.ts`;
- `copyWithToast` in `shims/clipboard.ts`;
- a host for dex's toast store;
- `@nostr-wot/wallet` (or a shim) for zaps.

## Games inside the village

- **Chain Reaction in the 3D world.** Build a playable in-world experience at
  the game table: select cells on the table, see orb placements and chain
  reactions animate, and make turn, player and win states clear. Reuse the
  existing Chain Reaction engine and kind 2390 game protocol so the same match
  remains compatible with obelisk.ar. Sky already has game tables and a playable
  Chain Reaction panel (`games/book.ts`, `ui/gamePanel.ts`); this item is the
  direct interaction and presentation inside the world.
- **A playable arcade game.** Let a villager approach an arcade cabinet and
  launch a short game inside Sky, with keyboard/touch controls, score, restart
  and a clear way back to the village. Choose the first game during design;
  the existing decorative cabinets are the starting point, not a finished game.

Requested 2026-10-26; planned, not implemented by this roadmap update.

## Calls

| Feature | In dex | Sky today |
|---|---|---|
| Call quality popover, mute someone for yourself, debug overlay, the full voice-room stage | `components/voice/*` | partial: camera, screen share, volume, the theater |
| Ringtone picker, call-relay editor | `components/settings/notifications/RingtonePicker.tsx`, `CallRelayEditor.tsx` | missing: one fixed ringtone |

## Wallet

| Feature | In dex | Sky today |
|---|---|---|
| Zap a message, invoice card | `components/chat/zaps/MessageZapModal.tsx`, `InvoiceCard.tsx` | partial: `/zap` and the card's ⚡ Zap; an invoice shows as a plain chip |
| Wallet settings page | `components/settings/wallet/*` | partial: NWC connect inside `ui/zapSheet.ts` |

## Settings and the rest

| Feature | In dex | Sky today |
|---|---|---|
| Notification settings, desktop notifications | `components/settings/notifications/NotificationSettings.tsx`, `services/notifications/*` | missing |
| Muted and blocked list, local data, analytics consent | `components/settings/privacy/*` | missing |
| Social (outbox) relay settings | `components/settings/social-relays/*` | missing |
| Account backup export | `components/settings/account/AccountBackupExport.tsx` | missing |
| Appearance (colours, bubble animation) | `components/settings/appearance/*` | missing: sky's own world prefs only |
| Unread count in the favicon | `hooks/notifications/useFaviconBadge.ts` | missing |
| Hints and guides | `components/hints`, `components/guides` | partial: "How to play" |
