---
title: Getting started with Obelisk Sky
seoTitle: 'Getting started with Obelisk Sky, the Nostr village'
description: Walk into Obelisk Sky in a minute. Look around as a guest, log in with your Nostr key or an invite link, and learn the controls on desktop and phone.
hero: island-orbit
order: 1
publishedAt: '2026-10-29'
updatedAt: '2026-10-29'
tags: [getting-started, nostr, login, controls, nip-29]
howTo:
  name: How to get into Obelisk Sky
  totalTime: PT5M
  steps:
    - { name: Look around as a guest, anchor: look-around-as-a-guest, text: Open sky.obelisk.ar and press Enter the island. Without logging in you land on the guest island and can walk around right away. }
    - { name: Log in with Nostr, anchor: log-in-with-nostr, text: 'Press Log in at the top right. New here? Create a new account and download your key file. Already have one? Use your browser extension, your private key or its key file, or a remote signer.' }
    - { name: Join with an invite link, anchor: join-with-an-invite-link, text: 'If the relay is invite-only, open the invite link someone sent you. It brings you in with your key, or a new one made on the spot.' }
    - { name: Learn the controls, anchor: learn-the-controls, text: 'Walk with WASD or by clicking the ground, drag to turn the camera, press E to sit and N for the minimap. The ? button shows every key.' }
---

## What Obelisk Sky is

Obelisk Sky is a village on a floating island, and also a real chat app. Every channel on a [Nostr](https://nostr.com) group relay is a house. When someone posts in a channel, their character walks to that house. When they reply to someone, they walk over to that person. You can sit on the plaza with a mate, join a voice call, play a game or just watch the conversations move around the island.

It is a second way into the same groups as [Obelisk](https://obelisk.ar). The chat is the same and the people are the same: one app shows them as a list, the other as a village. It all runs in your browser. Your key stays with you, and the server only hands out the page.

<Shot name="village" caption="The village from above. Every sign is a channel and its number is how many people are around." />

## Look around as a guest

Open [sky.obelisk.ar](https://sky.obelisk.ar) and press **Enter the island**. You don't need an account to look around. If you're not logged in you land on the **guest island**: six houses, villagers chatting in them, the plaza, the café and the park. Its chats are a demo and stay in your browser, so you can try everything without posting anything.

<Shot name="guest-island" caption="The guest island. The banner at the top takes you to the login whenever you're ready." />

<Callout>
The guest island is a way to look around. Its conversations are scripted examples. Log in to see the real village, where every house is a live channel and every character is a real person.
</Callout>

## Log in with Nostr

Press **Log in** at the top right. Obelisk Sky uses your Nostr identity, so there's no email and no password. The login puts the new account first, and everything for an account you already have underneath.

<Shot name="login" caption="The login: the same as obelisk.ar's, so one account works in both." maxWidth={440} />

### New to Nostr: create an account

Press **Create a new account**. Sky makes your key right there on your device and shows you the private part, the `nsec`. Press **Download your key file** to save it as a small `.txt`. **Continue** stays off until you've saved it, because that file is your account: there's no "forgot my password" on Nostr. Then pick a name and a picture, and you're in.

<Shot name="new-key" caption="Your new key. Continue waits until the key file is saved." maxWidth={420} />

<Callout>
Keep the key file somewhere safe and private, like a password manager or a USB stick. Anyone who has it can use your account.
</Callout>

### I already have an account

Under **I already have an account**:

- **Browser extension** (NIP-07): Alby, nos2x, Flamingo or the nostr-wot extension. It only appears when Sky finds one installed in your browser. It's the safest way in on a computer.
- **Private key or key file**: paste your `nsec`, or press **Upload key file** and pick the `.txt` you saved when you created the account. Sky reads the key from it.
- **Remote signer** (NIP-46): a "bunker" such as Amber on Android or nsec.app. Your key stays in that app, and Sky asks it to sign.

<Shot name="key-file" caption="Back in with your key: paste the nsec, or upload the key file." maxWidth={420} />

Once you're in, you appear on the island of the relay you picked. The default is the Obelisk Public Relay (`public.obelisk.ar`). The relay pill at the top left switches to any other NIP-29 relay, so any community can have its own island.

## Join with an invite link

Some relays only let in people they've admitted. If yours hasn't admitted your key yet, you stay on the guest island and Sky tells you so. The way in is an **invite link** like `sky.obelisk.ar/invite/…?relay=public.obelisk.ar`. Open it, log in or create a new account, and the relay lets you in.

People who can invite (the relay's owner, its admins and a few trusted accounts) find **Invite people** in the account menu at the top right. Each link shows who joined through it.

## Learn the controls

You are the character with your name above it. The **?** button in the bottom bar opens *How to play* any time. These are the keys you'll use most:

| Key | What it does |
| --- | --- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrows | Walk. Hold <kbd>Shift</kbd> or double-tap a direction to run |
| Click the ground | Walk there |
| Drag, scroll | Turn the camera, zoom |
| <kbd>Space</kbd> | Jump |
| <kbd>Enter</kbd> | Write in the channel you're in |
| <kbd>E</kbd> | Sit on a bench and drink mate, work at the café, eat at the parrilla, train at the park |
| <kbd>F</kbd> | Get on (or off) a nostrich |
| <kbd>G</kbd> | Emotes: dance, the lotus pose, nod… |
| <kbd>V</kbd> | First-person view |
| <kbd>N</kbd> | The minimap; click it to open it big |

<Shot name="controls" caption="How to play, from the ? button: every key, in your language." maxWidth={560} />

The minimap is the quickest way around. Open it big, click a house and you walk straight there.

<Shot name="minimap" caption="The big minimap: click a house to walk to it." />

## On a phone

Sky works on phones too. Turn the phone sideways: the village needs the width. The **thumb stick** at the bottom left walks, and pushing it all the way runs. Tap the ground to walk there, drag to turn the camera and pinch to zoom. The keys become buttons that show up when they're useful, like **Sit and drink mate** next to a bench or **Ride** next to a nostrich. The bottom bar folds into the menu button at the top.

<Shot name="phone" caption="On a phone held sideways: the stick on the left, jump and the seat button on the right." />

## Where to go next

- [Every channel is a house](/guides/channels-are-houses): how chatting works in the village.
- [Your look, pets, riding and swimming](/guides/look-pets-and-moving): make your character yours.
- [Mate, calls, games and zaps](/guides/hang-out-and-play): everything there is to do on the island.
