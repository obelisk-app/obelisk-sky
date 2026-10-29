# Relay invite links in Obelisk Sky

Code: `client/src/nostr/invite.ts`, `client/src/ui/invitePanel.ts`, the wiring in `client/src/main.ts`.
Protocol: obelisk-relay `docs/relay-invites.md` (§3 claim, §4 HTTP API, §6 client flow).

## Who can invite

The relay decides; sky asks it with `GET https://<relay host>/api/invites/me` (NIP-98).

| `basis` | Who | Allowance |
|---|---|---|
| `owner`, `admin`, `reference` | The relay's owner, its admins, its reference accounts | 10 people in total, ever, over as many links as they like. Each new link is clamped to what is left. |
| `grant` | Anyone an admin gave an explicit grant | The grant's own limits (it overrides the automatic allowance). |
| `null` | Everyone else | Can't invite. The card says who can. |

`can_mint` is false once the allowance is spent. Invite people still shows in the account menu while the account has a basis or links of its own, so it can see who joined and turn links off. Settings always has an Invite people row for an admitted account.

## The card

- **Relay picker.** The relay the links are for, from your known relays, with the current one picked. Changing it loads that relay's `/me` (signed for that relay's URL) without switching the village.
- **Why you may invite**, with a "7 of 10 left" meter, and "Invited by <name>" when the relay says who invited you.
- **New link:** an optional label, how many people (1 up to what is left, all of it by default) and days until it expires (7 by default, capped by the grant's `max_ttl_secs`). `POST /api/invites`. The relay clamps every field.
- The new link is shown with **Copy** and **Share** (the system share sheet when the browser has one). "Copied" shows only when the clipboard really took it.
- **Your links:** live ones first, past ones (turned off, expired, used up) folded. Each shows its label, link, uses, expiry and who joined (names from loaded profiles, else a short npub, with the date; people an admin removed are struck through). Live links have **Turn off**, which asks in place first (`DELETE /api/invites/{code}`; people who already joined stay).
- If loading fails the card says so and offers **Retry**. Failures aren't cached.

## Following a link

1. `/invite/<code>?relay=<host>` goes to `/app?invite=<code>&relay=<host>`. The code is stored under `obelisk-sky/invite` and taken out of the address bar.
2. **Trust rule.** Sky switches to the link's relay by itself only when it already knows that relay: the suggested relays, your own, or the one you were on. For an unknown relay you stay where you were (the relay is taken out of the address too) and a card asks: *Go to <host>* (adds it to your relays, switches, and makes an account if you have none) or *Stay here*. A link can't quietly point you at someone else's relay.
3. With no account, a key is made and logged in. You can back it up later.
4. Every key in use on that relay sends a NIP-43 kind 28934 claim. OK lets you in. A dead code (`unknown`, `revoked`, `expired`, `exhausted`, `inactive`) is dropped with a message.
5. **Retry.** A `stale` refusal (clock skew) or no answer is sent once more after a short pause with a fresh `created_at`. If that fails too, a toast says so and the next login or relay change tries again.
