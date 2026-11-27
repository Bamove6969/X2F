# Private moderator chat in disputes (owner 27 Nov)

Owner ask: in a dispute the moderator picks "Talking to both / Talking to <seller> / Talking to <buyer>".
A private message is seen only by the moderator and that one trader. Everything is still recorded for
audit: other moderators and the owner (any staff reader the moderation process grants) see all of it.
Private messages show in their own colour with a private marker, for the participants and in the audit view.

Defaults built while the owner decides (decision cards in the project thread):
- D1: the other trader sees nothing (no message, no gap, no notice).
- D2: a trader may reply privately once the moderator has sent them at least one private message;
  their composer then offers "Only moderator / Everyone" and defaults to "Only moderator" while the
  moderator's latest message to them was private.

## Crypto (packages/protocol/src/chatV2.ts, "private lanes")

TK is held by both traders, so it cannot carry a private message. Each trader gets a **lane key** PK
(32 random bytes), made and kept only by the moderation process (sealed in its keystore beside the
chat's moderator identity). The API never holds TK or PK.

- `privateKeyHash(PK)` = `pkh`.
- **Lane record** `{v:1, chat, to, pkh, wrap, sig}` (`makePrivateLaneRecord` / `verifyPrivateLaneRecord`
  / `openPrivateLaneRecord`): PK sealed to trader `to`'s attested box key, signed by the chat's
  moderator identity. Traders verify it against the attested `mod` participant.
- **Staff wrap**: `wrapPrivateKey(deviceBoxPublic, PK)` / `unwrapPrivateKey(device, wrap, pkh)`, given on
  every moderation-granted read (that is the audit path; the `chat.read` log entry already records it).
- **Envelope v3** `{v:3, trade, from, to, seq, nonce, ct, sig}` (`encryptPrivate`, `signPrivateEnvelope`,
  `sealPrivate`, `openPrivate`): `to` is the lane, `from` is `'mod'` or `to`. Seq is per (from, to) lane;
  each lane needs its own `ReplayGuard`.
- **Lane countersign** (`makeModPrivateCountersign` / `verifyModPrivateCountersign`): the v1 countersign
  plus `to`, so the API cannot move a sealed message into another lane.

## Contracts

### Moderation internal (apps/moderation, `/internal/chat/*`)
- Migration `apps/moderation/migrations/897_private_lanes.sql`: `mod_private_lanes (chat, lane in
  buyer|seller, sealed bytea /* PK, AES-256-GCM under MOD_KEYSTORE_KEY, AD = chat || '\0' || lane */,
  pkh, record jsonb, created_at, primary key (chat, lane))`, and lane seq bookkeeping like the shared
  moderator seq.
- `POST /internal/chat/grant` answer gains `lanes: [{ to, pkh, wrap, nextSeq, record }]`, both lanes,
  created on first grant (PK random, record signed with the chat's moderator identity against the
  attested traders). `wrap` is PK sealed to the device's certified box key; `nextSeq` the moderator's
  next seq in that lane.
- `POST /internal/chat/send` takes optional `to: 'buyer'|'seller'`. With `to`: the body is v3
  (`{v:3, trade: channel, from:'mod', to, seq, nonce, ct}`), the countersign is the lane countersign
  (same freshness/replay rules), `seq` must be that lane's next moderator seq (409 `stale-seq` with
  `nextSeq`), the lane must exist (409 `no-lane`), answer `{ envelope }` signed by `signPrivateEnvelope`.

### API (apps/api)
- Migration `apps/api/migrations/897_chat_private_lanes.sql`:
  - `chat_envelopes.to_role text null check (to_role in ('buyer','seller'))`, check
    `to_role is null or sender_role in ('mod', to_role)`; unique index replaced by
    `(chat, sender_role, coalesce(to_role, ''), seq)`.
  - `chat_private_lanes (chat references chats on delete cascade, to_role, pkh, record jsonb,
    created_at, primary key (chat, to_role))`; purge grants as `chat_keys`.
- Staff `POST /staff/v1/disputes/:code/chat`: files each lane's `record` (upsert), answer gains
  `lanes: [{ to, pkh, wrap, nextSeq }]`; every envelope item gains `to: 'buyer'|'seller'|null`. All
  envelopes are returned (audit).
- Staff `POST /staff/v1/disputes/:code/messages`: optional `to`; passed to moderation; stored with
  `to_role`, seq per lane; the live `chat` event goes only to that trader; log detail gains `to`.
  It counts as the dispute's reply like a shared message.
- Trader `GET /v1/chats/:chat/lane` → `{ record }` for the caller's own role, or 404 `no-lane`.
- Trader `GET /v1/chats/:chat/envelopes`: only `to_role is null or to_role = <caller role>`; items gain `to`.
- Trader `POST /v1/chats/:chat/envelopes`: also takes v3 when the chat is keyed, `from` = `to` = caller's
  role, the lane exists, the trade's dispute is not closed, and a moderator message exists in that lane
  (D2), else 400/409; seq per lane. Live event to that trader only (the moderator side reads on refresh).

### Staff web (apps/staff-web)
- Worker `open()` unwraps every lane (pkh-pinned) and opens v3 envelopes per lane with its own guard;
  `CaseChatLine` gains `to?: 'buyer'|'seller'`; `ChatView` gains `nextSeqByLane`.
- `seal(handle, text, now, seq, to?)`: v3 + lane countersign when `to`; `SealedModMessage` gains `to?`.
- ModCase: a "Talking to" dropdown above the composer: "Talking to both", "Talking to <seller
  username>", "Talking to <buyer username>". Private lines in the private colour with "Private · only
  <username> sees this"; an audit reader sees the same.

### Trader web (apps/web)
- Engine: in a disputed chat, `GET …/lane`; verify against the attested moderator; open with the
  chat identity's box key; open v3 envelopes of the own lane (own guard); post v3 with per-lane seq.
- ChatPanel: private lines in the private colour with "Private · only you and the moderator see
  this"; composer toggle per D2.

Colour: a violet private token (`--private` / `--private-bg`), day and night, distinct from teal
(secured), amber (securing) and red (danger).

## Owner 27 Nov (follow-up): the moderator switches private mode on and off; @mentions

Replaces D2. Decided: D1 = the other trader sees nothing.

- **Only the moderator starts private mode.** Choosing "Talking to <trader>" turns private mode ON with
  that trader; choosing "Talking to both" (or the other trader) turns it OFF. The trader has no toggle:
  while it is on, everything the trader sends goes into their lane (v3) automatically; when it is off,
  back to the shared chat.
- **The mode travels inside the lane, signed by the moderator**, so the API cannot fake or flip it: the
  staff device seals a lane message `{type: 'chat.mode', payload: {on: true|false}}` (v3, from 'mod',
  lane countersign as any lane message) whenever the dropdown changes (on to the newly chosen lane, off
  to the lane left). A trader's mode = the latest `chat.mode` from the moderator in its own lane
  (default off). If the API withholds one, the worst case is a stale mode, never a message the trader
  sent privately reaching the other trader.
- Rendering: a mode message is a system line, not a bubble. Trader: "The moderator started a private
  conversation with you. Only you and the moderator see these messages." / "The moderator ended the
  private conversation. Messages are seen by both traders again." Staff (audit): "Private mode on with
  <username>" / "Private mode off with <username>". While on, the trader's composer is tinted with the
  private marker and its placeholder says "Private message to the moderator".
- **@mentions, everyone, every chat in a dispute:** typing `@` opens a picker with the moderator's
  name and both trader usernames (filtered as you type; keyboard and tap). Choosing inserts
  `@username `. In rendered lines, `@<known name>` is highlighted. Plain text only; nothing else changes.
