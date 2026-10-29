---
title: 'Every channel is a house: chatting in Sky'
description: How Obelisk Sky turns Nostr group chats into a village. Each NIP-29 channel is a house, posting walks you there, and replying walks you to the person.
hero: plaza-meetup
order: 2
publishedAt: '2026-10-29'
updatedAt: '2026-10-29'
tags: [chat, channels, nip-29, nostr, groups]
---

## Houses are channels

In Obelisk Sky the island **is** the relay. Every channel (a NIP-29 group) gets a house on it, with a sign showing its name and how many people are around. The busier the channel, the bigger its house. Voice channels are different: each one is an ombú tree with a campfire and log seats around it, where the call happens.

<Shot name="village" caption="Every sign is a channel: Bitcoin, Nostr dev, Mate & chat, Fitness, Art & memes…" />

Some houses are landmarks with their own building: La Crypta, the nostr-wot HQ, the café, the parrilla, the theater. They're covered in [the hang-out guide](/guides/hang-out-and-play).

## Open a channel

There are three ways to open a channel:

1. **Walk up to its house.** Stand in front of the door and its chat opens.
2. **Click its sign or its building.** You walk there by yourself.
3. **Pick it from the list.** The **#** pill at the top right lists every channel on the relay, in the relay's own categories, with how many people are in each.

<Shot name="channels" caption="The channel list, from the # pill: every channel, and who's around." maxWidth={360} />

## Post, and walk there

Press <kbd>Enter</kbd> (or tap the message bar) and write. When you post in a channel, **your character walks to its house**, and everyone in the village sees you go. Their posts work the same way, which is why the village is never still: people cross the plaza to the conversations they're having.

<Shot name="guest-chat" caption="A channel's chat on the right. On the island, the people in it gather at its house." />

## Reply, and walk to the person

Click someone's speech bubble (or a message in the chat) to reply. **You walk over to them** and your reply lands under their message. A conversation between two people looks like two people talking, standing together.

The message bar is the same one obelisk.ar uses, so you have everything you're used to:

- Replies, reactions and @-mentions
- Emoji, GIFs and stickers, including the relay's own emoji set
- Voice notes and pictures
- Commands, like `/zap` to tip someone and `/play` to start a game

<Shot name="voice-note" caption="Replies, reactions and a voice note, in the village's chat." maxWidth={380} />

## The same chat as obelisk.ar

Sky doesn't keep a chat of its own. It reads and writes the same Nostr events as [obelisk.ar](https://obelisk.ar). A message you post on the island shows up in the Obelisk app, and the other way round. You can use whichever you prefer and switch any time.

## Live, together

You see other people move in real time. Every step is a short-lived Nostr event that no relay keeps, so after a few seconds it's gone. What you're doing (sitting, training, dancing) lasts only while you're doing it and disappears when you close the tab. The **History** button in the bottom bar replays the latest conversation around the island, and pressing it again takes you back to live.

## How it maps to Nostr

| In the village | On Nostr |
| --- | --- |
| A house | A NIP-29 group (kind 39000 metadata) |
| Walking to a house | Posting a kind 9 message in that group |
| The picture over your head | Your kind 0 profile |
| Your 3D look and pet | A replaceable kind 30078 event (`obelisk:avatar3d:v1`) |
| People moving around | Ephemeral events, never stored |
| Coins flying between people | Zaps (NIP-57), sent with NWC or WebLN |

Because it's all plain Nostr, Sky works with **any NIP-29 relay**, not only Obelisk's. Pick one from the relay pill at the top left and you get that community's island.

## Next

- [Getting started](/guides/getting-started): log in, invites and the controls.
- [Your look, pets, riding and swimming](/guides/look-pets-and-moving).
- [Mate, calls, games and zaps](/guides/hang-out-and-play).
