# X2F design kit: build handoff (8 Nov 2026)

This doc is for the build team. It covers every shared kit component, so a builder can implement each one without opening the canvas. All values come from the kit generators (`gen/badges.py`, `gen/badge_parts.py`, `gen/craftkit.py`, `gen/craft-onb/kit.py`, `craftgen/craftlib.py`, `gen/teamkit.py`, `craftfold/foldkit.py`, `gen/craft-home/kit.py`, `gen/craft-staff/kit.py`). Where a generator and a board disagree, the board wins and the gap is noted inline as **Kit note**. The rules behind the kit are in `design-visual-system-v2.md` (v2) and `design-craft-brief-2026-11-07.md` (craft brief). The build-side gaps are in `design-build-gaps/`.

Build checked: `app-main` at `origin/main` 48d2460d. It is six files past cbf8e50e, the commit the gap reports used, and none of those files touch the kit. Line numbers below are from 48d2460d.

Conventions used in this doc:

- Token names are written as the boards write them (`--surface-raised`). In the build every token has an `--x2f-` prefix, and `--mod` is `--x2f-moderator`.
- `mix(T N%)` is short for `color-mix(in srgb, var(--T) N%, transparent)`. `mix(T N%, X)` is short for `color-mix(in srgb, var(--T) N%, var(--X))`.
- **Mono** means `'Atkinson Hyperlegible Mono'`. **Familjen** means `'Familjen Grotesk'`. Everything else is `'Atkinson Hyperlegible Next'`.
- Icons are stroke SVGs on a 24 viewBox: `fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`. The stroke width is 1.75 unless stated.
- Board names refer to `canvas/project/<Board>.dc.html`. The renders are in `shots/sweep/<Board>.png`.

---

## 1. Tokens

### 1.1 Colour (THEMES, identical on all 138 boards)

| Token | Night | Day | Use |
|---|---|---|---|
| `--ground` | `#0e1116` | `#f5f6f8` | Page background. Phone footer and bottom nav. |
| `--surface` | `#171b22` | `#ffffff` | Primary cards, sheets, the hero base, the dot ring on avatars, inner-block dividers. |
| `--surface-raised` | `#20262f` | `#eceef2` | Inner blocks, stat tiles, avatars, inputs, tooltips, neutral icon tiles, chips, list dividers on a surface card. |
| `--line` | `#6b7584` | `#7a8494` | Control borders (inputs, secondary buttons, "+N" button, own chat bubble), tooltip border, grab handle, pending moderator tile. Holds 3:1. |
| `--ink` | `#eef1f5` | `#12161c` | Primary text, amounts, focus ring, every selected state (2 px ink border), the current step. |
| `--ink-muted` | `#9aa4b2` | `#566070` | Secondary text, labels, meta, chevrons, units next to a hero number, the neutral tone (cancelled or refunded). |
| `--monero` | `#ff6600` | `#ff6600` | Fill of the one primary button per screen. Never a selection, never a chip, never the key mark. |
| `--monero-ink` | `#ff6600` | `#b84a00` | Orange text: links, the "XMR" unit label, "/ XMR". |
| `--on-monero` | `#1a0e05` | `#1a0e05` | Text on a monero fill. |
| `--escrow` | `#4cc3d9` | `#0b7285` | Secured, released, completed, Trusted ring, online dot, done steps, reputation badges. |
| `--caution` | `#f2c14e` | `#8a5a00` | Waiting, securing, timer running, held changes, the Fast badge, stars. |
| `--danger` | `#ff6b8a` | `#c2255c` | Disputes, scam warnings, destructive actions, the blocked marker. |
| `--scrim` | `rgba(0,0,0,0.6)` | `rgba(18,22,28,0.45)` | Behind sheets and modal dialogs. |
| `--mod` | `#b69cff` | `#6741d9` | Moderators, inside disputes and the staff app only. |
| `--team` | `#7aa2ff` | `#2f5bd3` | Team members: the Team member tag, team avatars, team cards. |

Tints are always `color-mix` of a token with `transparent` or with a surface token. Never use a hex value or rgba outside THEMES. Don't use box shadows. The only shadow allowed is the nav-current inset line, `box-shadow: inset 2px 0 0 var(--ink)` on the rail, or `inset 0 2px 0 var(--ink)` on the phone bottom-nav item.

### 1.2 Spacing

| Token | Value | Typical use |
|---|---|---|
| space-1 | 4 | Icon-to-label gap in tags. Footer gap. |
| space-2 | 8 | Label to field. Gap between chips (6 in a chip row). Between section label and card. |
| space-3 | 12 | Inside lists. Identity row gap (avatar to text). Callout padding (12 14). |
| 14 | 14 | List-row gap (tile to text). Inner-block row padding (0 14) and divider inset. |
| space-4 | 16 | Phone gutter. Gap between cards on phone. Hero gap. |
| space-5 | 20 | Card padding. Result-hero gap. |
| space-6 | 24 | Gap between cards on wide. Gap between settings sections. Key-mark dot pitch. |
| space-8 | 32 | Wide content padding (32 48 48). |

14 is not a build token yet. Use `calc(var(--x2f-space-3) + 2px)` or add a `space-3h` token. Don't round it to 12 or 16.

### 1.3 Radii

| Value | Use |
|---|---|
| 6 | Inputs, small buttons, role tags (Vendor and the other role tags), nav items, the 20 px escrow block in the empty-state mark. |
| 10 | Stat tiles, 32 px moderator and system tiles. **Not in the build** (`tokens.css:53-56` has 6/12/16/999). Add it as `--x2f-radius-tile: 10px`. |
| 12 | Inner blocks, buttons, callouts, 40 px icon tiles, 40 px seals, tooltips, the hover card, chat bubbles (with one 4 px corner), evidence tiles, star tiles. |
| 16 | Primary cards, the hero, sheet tops (16 16 0 0), upload rows, 56 px state tiles. |
| 999 | Status chips, badge chips, the 22 px seal, stepper bars, avatars, dots, the "This device" tag. |

Component-internal radii (not tokens): 9 on the 28 px seal, 8 on the evidence preview, 4 on one bar inside the evidence preview.

### 1.4 Type scale

| Role | Family | Size/line | Weight | Tracking | Use |
|---|---|---|---|---|---|
| Display | Familjen | 40/44 | 700 | -0.02em | Wide result headline (counts as the one display). Board titles. |
| Result headline | Familjen | 32/36 | 700 | -0.02em | Hero of a result screen on phone (Refunded). |
| Screen title | Familjen | 28/32 | 700 | -0.01em | Key screens, under the context line (BuyerPay "Buying from satoshi_ghost", setup, Settings, Devices). |
| Sheet title | Familjen | 24/30 | 700 | -0.01em | Bottom sheets, dialogs, empty and done-state titles, the badge sheet. |
| Heading | Atkinson | 18/24 | 600 | 0 | Card and section headings. |
| Row title | Atkinson | 16/22 | 600 | 0 | List-row and settings-row titles, 40 px identity names. |
| Body | Atkinson | 16/24 | 400 | 0 | Running text, empty-state sentence. |
| Value | Mono (digits) / Atkinson | 15/20 | 500 | 0 | Inner-block values, settings-row values. Bubbles are 15/22. |
| Label (row) | Atkinson | 14/20 | 400 | 0 | Inner-block labels (muted), callout text (ink). |
| Label (caps) / meta | Atkinson | 13/16 | 600 caps / 400 meta | 0.04em caps | Uppercase labels ("TIME TO PAY", list labels), status chips, the context line. Row meta is 13/18. |
| Caption | Atkinson | 12/16 | 400 | 0 | Stepper labels, stat-tile labels, badge "Earned" lines, evidence meta, the encryption note. |
| Tag | Atkinson | 11/14 | 600 caps | 0.06em | Role tags only. |
| Hero number | Mono | 40/44 | 500 | -0.02em | The one big amount or timer per screen. Its unit is in Atkinson 18/24 600 muted (USD unit: 16/24 600 muted). |
| Amount (secondary) | Mono | 28/32 | 500 | -0.01em | Amounts inside the hero or an inner block. The unit is 15 600 `--monero-ink`. Wide: 32/36. |

Mono is for digits only: amounts, IDs, times, dates, counts ("3 of 10"), percentages. Units and words stay in Atkinson. The board fonts load weights Familjen 600 and 700, Atkinson Next 400 and 600, Mono 400 and 500.

### 1.5 Token fixes (checklist against the build)

- [ ] **Monero orange.** In `design/design-system/tokens.json:13`, change `monero` from night `#ff7a1a` / day `#f26822` to `#ff6600` / `#ff6600`. In `tokens.json:14`, change `monero-ink` night from `#ff7a1a` to `#ff6600` (day `#b84a00` already matches). Then run `npm run tokens`, so that `apps/web/src/theme/tokens.css:13-14` and `:33` follow. Don't edit tokens.css by hand: its header says it is generated.
- [ ] **monero-ink-hover and monero-hold** (`tokens.json:19-20`, `tokens.css:19-20,39-40`) don't exist on any board. Board links hover to `--ink` (`a:hover{color:var(--ink)}`). Re-derive both from the new `#ff6600`, or drop them and use the board rule. Either way, list it for the owner.
- [ ] **Scrim.** The build has no scrim token. Add `scrim` with night `rgba(0,0,0,0.6)` and day `rgba(18,22,28,0.45)`. This is the only non-hex colour, and it's allowed because it lives in the token file.
- [ ] **Radius 10.** Add it (stat tile, 32 px tiles).
- [ ] **XMR always 6 decimals.** `screens/trade/refundUi.tsx:7-10` `xmrText()` formats to 12 decimals and strips trailing zeros ("1.25"). Replace the body with `formatXmr(BigInt(atomic))`: in `packages/trade/src/money.ts:82` the default is 6 decimals, which gives "1.250000". Note that `formatXmr` truncates instead of rounding, which never overstates. `ui/Amount.tsx` already asserts 6 decimals. Every prose amount must pass the same check.
- [ ] **Timers as mono digits plus body units.** `ui/Countdown.tsx:10-24` `'clock'` gives "28:42", and `screens/auth/ApproveOnDevice.tsx:34` pads it to "04:59". The board form is `<mono>28</mono> min <mono>42</mono> s` (TradeFund) and `<mono>4</mono> min <mono>59</mono> s` (LoginApprove). There is no zero-padding and no colon. Hours read `<mono>1</mono> h <mono>52</mono> min`. In a hero, the digits are hero-number mono 40/44 and each unit is Atkinson 18/24 600 muted with a 6 px gap. The element is `role="timer"` with an aria-label in words ("28 minutes 42 seconds left to fund"). Return parts (`[{n:'28',u:'min'},{n:'42',u:'s'}]`), not a string, so the units can be styled.
- [ ] **Screen title.** The token `--x2f-screen-title-*` exists (`tokens.css:74-78`) but nothing uses it. `.x2f-screen__title` (`screens/screens.css:16-22`) uses the heading tokens, and `.x2f-trade-header__title` (`ui/ui.css:260`) and `trade.css:76-83` use `--x2f-title-*` (24/30 600). Point all of these at screen-title 28/32 700 -0.01em. The `title` style in `tokens.json:35` (24/30 **600**) has no board counterpart: retire it, or make it equal to sheet-title (700).
- [ ] **Result headline.** Add `result-headline` (Familjen 32/36 700 -0.02em, wide 40/44) and `hero-number` (Mono 40/44 500 -0.02em) to `tokens.json`.
- [ ] **No shadows.** `ui/ui.css:390-403` gives `.x2f-hold` a 2 px orange ring, plus a 4 px ring and a 32 px orange glow on hover or hold. Remove all three, and remove the `translateY(-1px)` lift. Hold progress stays the `__fill` element. Keep `ui.css:495` (`inset 0 2px 0`, bottom nav current) and `:1615` (`inset 2px 0 0`, rail current). `ui.css:1598` (`inset 0 0 0 1px var(--x2f-ink)`) is a selection ring drawn with a shadow: make it a 2 px ink border, as the selection rule says.
- [ ] **Moderator token name.** The boards say `--mod` and the build says `--x2f-moderator`. Keep the build name, but every kit component that says `--mod` below means `--x2f-moderator`.

---

## 2. Trader identity

Source: `gen/badges.py` `avatar()`, `trader()`, `stat()`. Also `gen/badge_parts.py` `avatar()`, `compact_trader()`, `VENDOR_TAG`, `gen/craftkit.py` `avatar()`, `avatar_on_raised()`, `tag()`, `modtile()`, `ident()`, `gen/teamkit.py`, `gen/craft-onb/kit.py` `signed_in()`, and `craftgen/craftlib.py` `trader_card()`. Cast facts are fixed (craft brief): satoshi_ghost is Vendor, Trusted + Fast, online, 1,284 trades · 99.4% positive · 275.4 XMR traded. mira.k: 212 · 99% · 41.7.

### 2.1 Avatar

Anatomy: a circle with initials, and an optional status marker bottom-right.

| Size | Where | Initials (Familjen 700, -0.01em) | Online dot | Dot ring | Dot offset |
|---|---|---|---|---|---|
| 48 | Header, hero, trader card, recipient row, signed-in row | 17 px | 12 | 2.5 px `--surface` | right -1, bottom -1 |
| 40 | Lists, settings, chat-pane header, parties strip, team rows | 15 px | 12 | 2.5 px `--surface` | -1 / -1 |
| 40 on `--surface-raised` (parties strip) | DisputeOpen, DisputeRoom | 15 px | 11 | 2.5 px `--surface-raised` | -1 / -1 |
| 32 | Chat messages | 13 px | none in chat (craftkit gives 10 / 2 px if ever needed) | — | -1 / -1 |

```css
.avatar { position: relative; display: flex; flex-shrink: 0; width: 48px; height: 48px; box-sizing: border-box;
  align-items: center; justify-content: center; border-radius: 999px; background: var(--surface-raised);
  border: 2px solid var(--surface-raised);                 /* no ring */
  font: 700 17px 'Familjen Grotesk', sans-serif; letter-spacing: -0.01em; color: var(--ink); }
.avatar[data-trusted] { border-color: color-mix(in srgb, var(--escrow) 70%, transparent); }
.avatar__dot { position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border-radius: 999px;
  background: var(--escrow); border: 2.5px solid var(--surface); }
```

States and variants:

- **Trusted ring.** The 2 px border is `mix(escrow 70%)` only when the person holds the Trusted badge. Otherwise the border is the same colour as the fill.
- **Online.** A teal dot. The dot ring is the colour of whatever the avatar sits on: `--surface` on a card, `--surface-raised` inside an inner block. It's always teal, and it's never shown for yourself in setup.
- **Offline.** No dot. The meta line reads `Last seen <mono ink>1</mono> h ago` (SellerRefund). The Trusted ring stays. Use this for anyone who missed a deadline or is away.
- **Inactive or unblocked person** (Block list, teamkit `kind='off'`): the initials go `--ink-muted`. teamkit also switches the fill and border to `--surface`. Use the muted initials only. See the Kit note at the end of this section.
- **On surface-raised** (`avatar_on_raised`): the fill and no-ring border become `--surface`, and the dot ring becomes `--surface-raised`, so the avatar keeps an edge inside an inner block.
- **Blocked marker** (Block board, account kit): an 18×18 circle at right -3, bottom -3, `background: var(--danger)`, `color: var(--surface)`, `border: 2px solid var(--surface)`, `box-sizing: border-box`, centring a 10 px ban icon (`<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>`, stroke 3.5). It replaces the dot, and the avatar has no ring.
- **Team member avatar** (teamkit): `background: var(--team); border: 2px solid var(--team); color: var(--ground)`. Use it for members only. The owner uses the standard avatar.
- **X2F team avatar** (Support): 32 px, initials "X2F" at 11 px, standard surface-raised fill, no ring.
- **Moderator.** Not an avatar but a tile: see 2.3.

Accessibility: the avatar is decorative (`aria-hidden="true"`), because the name sits next to it. "Online" must be in text. On the trader card the meta line says "Online". In compact list blocks a visually hidden `Online · ` prefixes the meta (`SR_ONLINE`: `position:absolute;width:1px;height:1px;overflow:hidden`). Don't rely on `aria-label` on a span inside an aria-hidden parent: some boards do, and it is never announced.

### 2.2 Role tags

Base (identical in craftkit, teamkit and badge_parts):

```css
.tag { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 6px;
  font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  white-space: nowrap; flex-shrink: 0; }
/* icon: 12 px, stroke-width 2 */
```

| Tag | Background | Text | Icon |
|---|---|---|---|
| Vendor | `mix(ink 8%)` | `--ink-muted` | store (`M4 9l1.5-5h13L20 9` / `M4 9h16v2a3 3 0 01-5.3 1.9A3 3 0 0112 14a3 3 0 01-2.7-1.1A3 3 0 014 11z` / `M5.5 14v6h13v-6`) |
| Team member | `mix(team 14%)` | `--team` | users (teamkit `USERS`) |
| X2F Moderator | `mix(mod 14%)` | `--mod` | shield outline (`M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z`), no check |
| X2F team (Support staff) | `mix(ink 8%)` | `--ink-muted` | none |
| Neutral context ("You · buyer", "Not joined") | `mix(ink 8%)` | `--ink-muted` | none |

The moderator tag appears inside disputes and the staff app only. Tags are text, so they need no ARIA.

Not a role tag: the "This device" tag on Devices is a different element (22 h, padding 0 8, pill, `mix(escrow 14%)`, escrow text, 12/16 600 uppercase .04em). Don't merge the two.

### 2.3 Moderator tile and pending tile

Use this instead of an avatar for moderators (`craftkit.modtile`).

| Size | Radius | Icon |
|---|---|---|
| 48 | 12 | 22 |
| 40 | 12 | 20 |
| 32 | 10 | 16 |

- Joined: `background: mix(mod 16%); color: var(--mod)`, with the shield-outline glyph.
- Pending ("Not joined"): `border: 1px solid var(--line); color: var(--ink-muted)`, no fill, with the same glyph.
- Staff system tile (`SYSTILE32`): 32, radius 10, surface-raised, muted cpu icon 16.

### 2.4 Name line and identity row

`ident()`, the first row of `trader()`. Layout: `display:flex; align-items:center; gap:12px; min-width:0`. Then the avatar, then a column (`gap:3px; min-width:0`).

- Name row: `display:flex; align-items:center; gap:8px` (it wraps with `gap: 2px 8px` in compact rows). The name is 17/22 600 at 48 and 16/22 600 at 40, followed by the role tag.
- Meta: 13/18 `--ink-muted`. Online: `<span style="color:var(--escrow);font-weight:600">Online</span> · replies in about <mono ink>4</mono> min`. In the chat header: `Online · <mono>1,284</mono> trades · <mono>99.4%</mono> positive`.
- Moderator name (DisputeRuling, DisputeRoom): the name colour is `--mod`.
- Never a bare name in body text where a person matters.

### 2.5 Stat tiles

```css
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.stat  { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-radius: 10px;
         background: var(--surface-raised); min-width: 0; }
.stat__v { font: 500 16px/20px 'Atkinson Hyperlegible Mono', monospace; }
.stat__l { font-size: 12px; line-height: 16px; color: var(--ink-muted); }
```

There are always three tiles: trades, % positive, XMR traded (to date). BecomeVendor reuses the tiles for fee / members / … . Use `<dl>` semantics, or leave them as plain text: value then label reads correctly.

### 2.6 Trader card

`craftlib.trader_card()` is `trader()` inside a primary card: `<section aria-label="Seller|Buyer">` with `padding:20px; border-radius:16px; background:var(--surface)`. Inside, a column with `gap:12px`:

1. Identity row at 48 (2.4).
2. Stats grid (2.5).
3. Chip row: `display:flex; flex-wrap:wrap; gap:6px; align-items:center`. Up to two featured badge chips, then "+N" (section 3).

Placement: on phone trade screens, right after the hero. On wide, at the top of the right column. The offline variant follows 2.1 (no dot, "Last seen …").

### 2.7 Compact list block

`badge_parts.compact_trader()` is used on offer lists (BuyOffers, SellOffers, Fold-Offers). It's a column with `gap:12px; min-width:0`:

- Top row: `flex; align-items:center; gap:12px`. A 40 avatar, then a text column (`gap:2px; flex-grow:1`), then an optional trailing slot (`side`, for example the price or a Trade button).
- Name 16/22 600, ink (or `--ink-muted` when the row is muted), followed by the Vendor tag. The name row wraps with `gap: 2px 8px`.
- One meta line, 13/18 muted, every number wrapped in mono (`mono_digits`).
- Then the chip row (as 2.6.3), omitted when there are no badges.

### 2.8 Recipient row

Used in release and payment-confirm sheets (Warn-Release, Warn-Release-Wide). Anatomy:

```html
<div style="display:flex;flex-direction:column;gap:8px;padding:14px 0;
            border-top:1px solid var(--surface-raised);border-bottom:1px solid var(--surface-raised)">
  <!-- identity row at 48 (2.4), with no stats and no chips -->
  <span style="display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;padding-left:60px">
    <span style="display:inline-flex;align-items:baseline;gap:4px;white-space:nowrap">
      <span style="font:500 16px/20px 'Atkinson Hyperlegible Mono'">1.250000</span>
      <span style="font-size:14px;font-weight:600;color:var(--monero-ink)">XMR</span></span>
    <span style="font-size:13px;line-height:18px;color:var(--ink-muted)">about <span style="font-family:'Atkinson Hyperlegible Mono';color:var(--ink)">$412.50</span></span>
  </span>
</div>
```

The 60 px indent is the avatar (48) plus the gap (12), so the amount lines up under the name.

### 2.9 Signed-in identity row

Onboarding: `craft-onb.signed_in()`, used on SetupWelcome. It has `role="status"`, `flex; gap:12px`, and a 48 avatar with no ring and an online dot. The name is 17/22 600, plus the Vendor tag when the account is a vendor. Under it is a check line: `flex; gap:6px`, 13/18 600 `--escrow`, with a 16 px check icon (stroke 2, `M5 12l4 4 10-10`) and one sentence.

### 2.10 Two-person block (team)

Team boards (MemberApproval, MemberPermissions) use the owner row over the member row inside an inner block. Each row is `flex; gap:12px; padding:14px`: a 40 avatar (the owner standard with the Vendor tag, the member team-blue with the Team member tag), then the name 16/22 600, then the tag. Detail rows follow with `border-top:1px solid var(--surface)` inside `margin:0 14px`.

**Kit notes.**

- **Dot size at 40 differs between kits.** `badge_parts` uses 12 (all list boards), `craftkit` 11, and `craft-onb` 10, which no board uses. Build 12, and 11 only on surface-raised.
- **The 40 px initial is 14 px** in `craftlib.person()` but 15 everywhere else. Build 15.
- **The `badges.py` `avatar()` is 48-only.** `craftlib.avatar_sized()` sets 15 px initials for every non-48 size, which is wrong at 32 (13 px).
- **teamkit `off` avatar vs SellerRefund offline avatar.** The teamkit `off` avatar uses a surface fill and muted initials, but the SellerRefund offline trader keeps the raised fill and ring. Use "offline = no dot", and "unblocked or removed = muted initials". teamkit's surface fill would lose its edge on a surface card.

Accessibility: none of the identity pieces are interactive except the chips. If the whole trader card links to a profile, make the name the link. Don't wrap the chip buttons in a link.

Used on: BuyerPay, TradeFund, BuyerPaidWaiting, SellerConfirm, SellerRefund, Refunded, CancelRequest, Warn-Release, DisputeOpen, DisputeRoom, DisputeRuling, BuyOffers, SellOffers, BuyQuote, OfferAd, Profile, Settings, Block, Team, MemberApproval, MemberPermissions, HoldChange, Support, SetupWelcome, Fold-*.

Replaces in apps/web: `ui/ui.css:1474` `.x2f-avatar` (team-blue only), `ui/ui.css:1451-1462` `.x2f-tag` (team tone only), `ui/ModeratorBadge.tsx` and `ui/ui.css:142-151` `.x2f-moderator-badge` (an outlined pill), and `screens/trade/TradeTimeline.tsx:52` `CounterpartyCard` (text-only, wide only). The 8 px dot and name in `screens/browse/OfferCard.tsx` and `OfferList.tsx` goes too. The stat tile is new (`.x2f-number-card` and `.x2f-big-number` at `ui.css:1163-1222` are hero numbers, not tiles). Build these as `Avatar`, `RoleTag`, `ModTile`, `IdentityRow`, `StatTiles`, `TraderCard`, `CompactTrader` and `RecipientRow`.

---

## 3. Badge seal, chip and "+N"

Source: `gen/badges.py` `seal()`, `glyph()`, `chip()`, `more()`, `row()`, the sheet and the `pop` hover card. `gen/badge_parts.py` holds the same pieces as reusable strings plus `JS_BADGES`.

### 3.1 The badge set (draft copy, COPY-UNSIGNED)

| Key | Name | Family tone | Glyph | Meaning |
|---|---|---|---|---|
| trusted | Trusted | escrow | shield with check | 200+ trades and 98%+ positive. |
| clean | Clean record | escrow | circle with check | No lost disputes in 100 trades. |
| veteran | Veteran | escrow | medal | Trading on X2F for over a year. |
| fast | Fast | caution | bolt | Usually pays or releases within 10 min. |
| pgp | PGP verified | ink | key | Logs in with a verified PGP key. |
| hw | Security key | ink | hardware key | Protects the account with a hardware key. |
| m10 / m100 / m500 | 10 / 100 / 500 trades | ink | the number, in mono | Completed N trades. |
| new | New | ink-muted | sprout | Joined in the last 30 days. |

Families: reputation is escrow teal, speed is caution amber, security and milestones are ink, newcomer is ink-muted. Badges are never orange. Single-path glyph data is in `badge_parts.D`. The multi-element originals are in `badges.IC`.

### 3.2 Seal

```css
.seal { display: flex; flex-shrink: 0; box-sizing: border-box; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--T) 16%, var(--surface-raised));
  border: 1.5px solid color-mix(in srgb, var(--T) 55%, transparent); color: var(--T); }
```

| Size | Where | Radius | Ring | Icon glyph | Number glyph (mono 500, line 1, -0.02em) |
|---|---|---|---|---|---|
| 22 | In a chip, in a login button | 999 | 1 px | 13 | 8 px |
| 28 | Profile, strong-login trio | 9 | 1.5 px | 16 | 9.5 px |
| 40 | Lists, the sheet, the hover card, BadgeSettings | 12 | 1.5 px | 20 | 12 px |

The seal is always `aria-hidden`. The chip or row text names the badge.

### 3.3 Chip

Wrapped in the 44 px transparent button (`BTNWRAP`):

```html
<button type="button" aria-haspopup="dialog" aria-label="Trusted badge: 200+ trades and 98%+ positive."
  style="display:inline-flex;align-items:center;height:44px;margin:-7px 0;padding:0;border:0;
         background:transparent;color:inherit;font:inherit;cursor:pointer">
  <span style="display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px 0 4px;box-sizing:border-box;
    border-radius:999px;background:var(--surface-raised);border:1px solid color-mix(in srgb,var(--escrow) 32%,transparent);
    font-size:13px;line-height:16px;font-weight:600;color:var(--ink);white-space:nowrap">
    [seal 22] Trusted</span></button>
```

- The visible chip is 30 h. The button is 44 h, with `margin:-7px 0` so rows keep the 30 px rhythm while the hit area is 44.
- Border: family tone at 32%. On hover or focus-visible it goes to **60%**, and the focus outline is 2 px ink, offset 2.
- The name is sentence case: no uppercase and no wash fill. Badges are not status chips.
- Show at most two featured chips on a card. The rest collapse into "+N".

### 3.4 "+N" button

Same `BTNWRAP`. The inner span is 30 h, `padding:0 10px 0 11px`, `gap:4px`, pill, `background:var(--surface-raised)`, `border:1px solid var(--line)`, 13/16 600 ink. The content is `<mono>+3</mono>` plus a 14 px chevron-down (stroke 2, `M6 9l6 6 6-6`). Open state: `border:2px solid var(--ink)` and `aria-expanded="true"`. Label: `aria-label="3 more badges"`, `aria-haspopup="dialog"`.

### 3.5 Badge row (sheet, hover card, lists)

`row()` is an `<li>` with `flex; align-items:center; gap:12px`: a 40 seal, then a column (`gap:2px`) holding the name 15/20 600, the meaning 13/18 muted, and the earned line 12/16 muted ("Earned <mono>12 Mar 2026</mono>", "Since …", or "Not yet: <mono>212</mono> of <mono>500</mono>").

### 3.6 Phone: badge sheet

Tapping "+N" or any chip opens the sheet:

- Overlay: `position:absolute; inset:0; background:var(--scrim); display:flex; align-items:flex-end`.
- Sheet: `<section role="dialog" aria-modal="true" aria-label="satoshi_ghost's badges">` with `width:100%; box-sizing:border-box; padding:10px 16px 20px; border-radius:16px 16px 0 0; border-top:1px solid var(--surface-raised); background:var(--surface); flex column; gap:16px`.
- Grab handle: 36×4, pill, `--line`, centred, `aria-hidden`.
- Head row: space-between. The title "satoshi_ghost's badges" is Familjen 24/30 700 -0.01em. The close button is 44×44 with `margin-right:-10px`, a 22 px X icon, and `aria-label="Close"`.
- List: `<ul>` with `gap:16px` of badge rows (3.5). Show all of the trader's visible badges.
- Close on swipe down, tap on the scrim, the X, or Esc. Focus moves into the sheet on open and returns to the triggering button on close. Enter over 200 ms (translate 8 px plus opacity). There is no motion under `prefers-reduced-motion`.

### 3.7 Desktop: hover card

Pointing at "+N" (or a chip) opens a card under it:

```css
.badge-card { position: absolute; width: 340px; box-sizing: border-box; padding: 16px; border-radius: 12px;
  background: var(--surface-raised); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 14px; }
.badge-card::before { /* arrow */ content: ''; position: absolute; top: -7px; left: 36px; width: 12px; height: 12px;
  background: var(--surface-raised); border-left: 1px solid var(--line); border-top: 1px solid var(--line); transform: rotate(45deg); }
```

- Contents: a label "3 more badges", then a `<ul>` with `gap:14px` of badge rows. The arrow sits over the trigger.
- Behaviour: the card opens on hover and on keyboard focus plus Enter. It stays open while the pointer is over the trigger or the card. It closes on Esc or when the pointer leaves both.
- Use `role="dialog"` (as `aria-haspopup="dialog"` promises), not `role="tooltip"`. The board's `role="tooltip"` holds a list, which tooltips must not contain.
- **Kit note.** The label is set in `badges.py` `LBL`: mono 12/16 uppercase .04em muted. Mono on a word breaks v2 §4. Until the head designer rules, use the uppercase label style (Atkinson 13/16 600 .04em) with only the "3" in mono.

### 3.8 Keyboard summary

Chips and "+N" are buttons, so Tab reaches them. Enter or Space opens the sheet (phone) or the card (desktop). Esc closes, and focus returns to the trigger. In BadgeSettings, the visibility controls are real radios or switches.

Used on: Badges, BadgeSettings, Profile, OfferAd, BuyOffers, SellOffers, BuyQuote, all trade screens (trader card), Reviews, Fold-Trade and Fold-Offers (chat header and lists), SetupWelcome (the New badge).

Replaces in apps/web: `ui/BadgePill.tsx` (12 px icon pill, escrow and caution only), `ui/ui.css:111-140` `.x2f-badge*`, and `screens/browse/OfferCard.tsx:97-145` `Badges` (+N tooltip). Build these as `BadgeSeal`, `BadgeChip`, `BadgeMore`, `BadgeRow`, `BadgeSheet` and `BadgeCard`. The data is `JS_BADGES` in `badge_parts.py`.

**Kit notes.**

- `craftgen/craftlib.py` still says Trusted is "100+ trades". Every board and `badge_parts` say 200+. Build 200+.
- `badge_parts.JS_BADGES` `sealStyle` only knows 40 and 22: a 28 gets radius 999 and a 1 px ring. Use the Python `seal()` values in 3.2.
- The craft brief says the hover card is in `badge_parts.py`. It is only in `badges.py` (`pop`), and the sheet is also only in `badges.py`.

---

## 4. v2 hero (status block)

Source: v2 §6 and §7, and the boards BuyerPay, TradeFund, SellerConfirm (trade), Refunded (result), DisputeRoom (danger), HoldChange and SetupWelcome (hold and setup). Use one per screen.

### 4.1 Container

```css
.hero { display: flex; flex-direction: column; gap: 16px; padding: 20px; border-radius: 16px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--T) 14%, var(--surface)) 0%, var(--surface) 140px);
  border: 1px solid color-mix(in srgb, var(--T) 35%, transparent); }
.hero[data-kind=result] { gap: 20px; padding: 24px 20px 20px; }   /* Refunded: wash stop 160px */
@media (wide) { .hero { padding: 28px; } }
```

The wash is 14% of the tone over surface, fading to plain surface at 140 px (trade, hold and setup heroes) or 160 px (result heroes). The border is the tone at 35%. Inner dividers are `height:1px; background: mix(T 25%)`. This is the only gradient in the app.

### 4.2 Row 1: chip and key mark

`flex; align-items:center; justify-content:space-between; gap:8px`. The status chip is on the left and the key mark (section 5) on the right. The key mark is on trade and trade-result screens only. Non-trade heroes (HoldChange, SetupWelcome, BecomeVendor) have the chip alone, or an uppercase label on the left with the chip on the right.

Status chip:

```css
.status-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px;
  background: color-mix(in srgb, var(--T) 14%, transparent); color: var(--T);
  font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
/* icon 16 px, stroke 1.75 */
```

| Tone | Background | Text | Example words |
|---|---|---|---|
| escrow | 14% | `--escrow` | Escrow secured, Released, Completed |
| caution | 14% | `--caution` | Securing escrow, Pay now, Waiting |
| danger | 14% | `--danger` | Dispute open |
| neutral (ink-muted) | **16%** | **`--ink`** | Refunded, Cancelled |
| mod | **16%** | `--mod` | Moderator decided |
| team | 14% | `--team` | New team member |

There is never an orange chip. The chip word carries the state: the tone, the wash and the key mark repeat it.

### 4.3 Row 2: the meaning (one big thing)

- **Hero number** (trade): an uppercase label 13/16 600 .04em in the tone ("TIME TO PAY", "TIME TO FUND"), with an optional 14 px info icon (stroke 2) that opens a tooltip. Then `inline-flex; align-items:baseline; gap:6px` holding the mono 40/44 500 -0.02em digits and the unit in Atkinson 18/24 600 muted. Then a meaning line 14/20 muted, with digits mono ink.
- **Result headline** (result): Familjen 32/36 700 -0.02em, `text-wrap:balance`, then a lead 16/24 muted (gap 10). Digits in the lead are mono ink: split them with the `monoParts` regex, `/((?<![A-Za-z])\d[\d.,:]*\d|(?<![A-Za-z])\d)/`.
- **Amount** inside the hero: mono 28/32 500 -0.01em, then "XMR" 15 600 `--monero-ink`, then the fiat in mono 16/24 muted. It wraps with `column-gap:10px`.

### 4.4 Row 3: supporting detail

- **Timer ring** (v2 §14), placed right of the hero number (`justify-content:space-between`):

```html
<svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="89 of 90 minutes left to pay">
  <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="5" style="color:var(--caution)"/>
  <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"
          stroke-dasharray="167.7 169.6" transform="rotate(-90 32 32)" style="color:var(--caution)"/></svg>
```

  The circumference is 169.6, and the first dash value is `169.6 × remaining/total`. **Not started**: the second circle uses `stroke-dasharray="2 6.48"` and no rotate, plus a clock-hands path `M32 22v10l6 4` (stroke 2) in the tone. The label is in words ("90 of 90 minutes left, not started").
- **Segmented progress** (confirmations): `role="progressbar" aria-valuemin=0 aria-valuemax=10 aria-valuenow=N`, `display:grid; grid-template-columns:repeat(10,1fr); gap:3px; height:8px`. Each pill has radius 999. Done pills are in the tone, and the rest are `mix(T 18%, surface-raised)`. When secured, all pills are escrow. The row above it is 14/20 muted ("Confirmations" plus a 14 px info icon) with the value right-aligned (`<mono 500 ink>3 of 10</mono> · about <mono>14</mono> min`).
- **Inner block** (section 8.1) for amounts and fees. Inside a result hero, rows use `padding:14px 16px` for a stacked amount row and `min-height:48px; padding:0 16px` for a key/value row (Refunded). See the Kit note in 8.1.

### 4.5 Tone per state

| State | Tone | Boards |
|---|---|---|
| Funding, securing escrow, pay now, waiting for the seller, timer running | caution | TradeFund, BuyerPay, BuyerPaidWaiting, SellerConfirm, SellerRefund |
| Secured, released, completed; setup done | escrow | Released, SetupWelcome, BecomeVendor (vendor) |
| Dispute open or in progress | danger | DisputeOpen, DisputeRoom |
| Moderator decided | mod | DisputeRuling, Refunded (variant `moderator`) |
| Refunded, cancelled (finished, nothing to do) | ink-muted | Refunded, CancelRequest |
| Held change (weak login) / confirmed change | caution / escrow | HoldChange |

Accessibility: the hero is a `<section>` with `aria-label` or `aria-labelledby`. The key mark and any decorative glyph are `aria-hidden`. Tooltips open on hover and on click (toggle), are linked with `aria-describedby`, and close on Esc. Info triggers are buttons with `min-height:44px`.

Used on: BuyerPay, TradeFund, BuyerPaidWaiting, SellerConfirm, SellerRefund, Released, Refunded, CancelRequest, DisputeOpen, DisputeRoom, DisputeRuling, HoldChange, SetupWelcome, Login-Backup (held), BecomeVendor, Fold-Trade, Fold-Cover.

Replaces in apps/web: `ui/StatusChip.tsx` and `ui/ui.css:97-125,1185-1200`. Those chips have a flat surface-raised background with padding 6 12, and their `Tone` type is caution, escrow or danger only. Add neutral, mod and team. Also replaces `.x2f-number-card` and `.x2f-big-number` (`ui.css:1163-1222`), and `ui/Countdown.tsx` presentation (keep its server-clock logic). The hero container is new: `Hero`, `StatusChip`, `HeroNumber`, `TimerRing`, `SegmentProgress`.

---

## 5. Key mark (2-of-3)

Source: v2 §1, `craft-home.keytile()`. Three dots: two filled, one ring. It means 2-of-3 escrow and is used for nothing else.

```html
<!-- hero: 14 px dots, 24 px pitch -->
<svg width="62" height="14" viewBox="0 0 62 14" aria-hidden="true" style="flex-shrink:0;color:var(--caution)">
  <circle cx="7" cy="7" r="7" fill="currentColor"/><circle cx="31" cy="7" r="7" fill="currentColor"/>
  <circle cx="55" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>
<!-- small, inside a toned 40 tile on active-trade rows -->
<span aria-hidden="true" style="display:flex;flex-shrink:0;width:40px;height:40px;align-items:center;justify-content:center;
  border-radius:12px;background:color-mix(in srgb,var(--caution) 14%,transparent)">
  <svg width="32" height="8" viewBox="0 0 32 8" style="color:var(--caution)"><circle cx="4" cy="4" r="4" fill="currentColor"/>
  <circle cx="16" cy="4" r="4" fill="currentColor"/><circle cx="28" cy="4" r="3.25" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span>
```

- Its colour is the screen's state tone (4.5). It is never orange, never animated, never a button, and always `aria-hidden`.
- Places: the hero's top-right (trade and trade-result screens), the leading tile of an active-trade row (Main, BuyMain, MyOffers, Fold-Cover, DeleteAccount "Still open"), and the "no trades yet" empty state at hero size in `--ink-muted`.

Replaces in apps/web: `ui/EscrowDots.tsx` and `ui/ui.css:113-172` `.x2f-dots`. Those dots are 10 px, the empty dot is outlined in `--line`, and they sit loose in list rows. Rebuild as `KeyMark size="hero"|"small" tone=…` plus `KeyTile`.

---

## 6. Phone trade stepper

Source: BuyerPay `steps`, v2 §13. It goes on every live-trade phone screen, directly under the screen title. Ended trades (Refunded) use a timeline, not the stepper.

```html
<ol aria-label="Trade progress" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:0;padding:0 16px 16px;list-style:none">
  <li aria-current="step|false" style="display:flex;flex-direction:column;gap:6px">
    <span style="display:block;height:4px;border-radius:999px;background:var(--surface-raised);overflow:hidden">
      <span style="display:block;height:100%;border-radius:999px;width:30%;background:var(--caution)"></span></span>
    <span style="font-size:12px;line-height:16px;font-weight:600;color:var(--ink)">Escrow</span></li>
  …
</ol>
```

| State | Track fill | Label |
|---|---|---|
| Done | `width:100%; background:var(--escrow)` | 12/16 muted |
| Current | `width:<progress>%` in the state tone (caution while waiting, danger in a dispute) | 12/16 **600 ink**, `aria-current="step"` |
| Upcoming | `width:0` (empty raised track) | 12/16 muted |

- The current step's progress is the step's real progress. BuyerPay: escrow 3 of 10 shows 30% on step 1; just after secured, step 2 shows 2%.
- Buyer labels: Escrow · You pay · Seller checks · Released. Seller labels: Escrow · Buyer pays · You check · Released. These are COPY-UNSIGNED.
- Only the current step carries `aria-current`. For screen readers, add a visually hidden status per step ("done" or "upcoming"), because colour is the only cue otherwise.

Used on: TradeFund, BuyerPay, BuyerPaidWaiting, SellerConfirm, SellerRefund, CancelRequest, DisputeOpen, DisputeRoom (current step in danger).

Replaces in apps/web: `screens/trade/TradeTimeline.tsx:38-50` and `pay.css:584-610`, which render only in the wide room, with done labels in escrow 600, current labels in caution 600 at 13 px, and no partial fill. Make one `TradeStepper` used on phone and wide. `ui/TradeHeader.tsx:30-45` must render it under the title.

---

## 7. Icon tiles

Source: `craftlib.icon_tile()`, `teamkit.tile()`, `craft-home.tile()`, `craft-staff.tile()`, and v2 §9.

| Variant | Size | Radius | Glyph | Background | Glyph colour |
|---|---|---|---|---|---|
| Neutral | 40 | 12 | 20, stroke 1.75 | `--surface-raised` | `--ink` |
| Toned | 40 | 12 | 20 | `mix(T 14%)` | `--T` |
| Danger row (Settings `.tile.danger`) | 40 | 12 | 20 | `mix(danger 14%)` | `--danger` |
| Pending change (HoldChange) | 40 | 12 | 20 | `mix(caution 14%)` | `--caution` |
| Small (staff tables) | 32 | 10 | 16 | as above | as above |
| State tile (done and empty states) | 56 | 16 | 28, stroke 1.75 | neutral: `--surface-raised`; toned: `mix(T 14%)` | `--ink` / `--T` |
| Key tile | 40 | 12 | key mark small | `mix(T 14%)` | `--T` |

- The tile is always `display:flex; flex-shrink:0; align-items:center; justify-content:center` and `aria-hidden="true"`. The row title carries the meaning.
- Every list row that means something has one. No tile is decoration.
- The craft brief allows 14–16% for toned tiles. Every kit file uses 14% except the moderator tile and seals (16%). Build 14% for tiles.
- On a surface-raised parent (a selected brand row, for example) the neutral tile switches to `--surface`.

**Builder step head** (`craft-home.stephead()`, PostOffer): `flex; align-items:center; gap:12px`. A neutral 40 tile, then a column (`gap:2px; flex-grow:1`) holding the uppercase label "Step <mono>1</mono> of <mono>4</mono>" (13/16 600 .04em muted) over an `<h2>` 18/24 600, then an optional right slot.

**Staff KPI cell** (`craft-staff.kpi()`, ModQueue and StaffOverview, separate staff build): `flex; align-items:center; gap:14px; padding:18px 20px`, with `border-left:1px solid var(--surface-raised)` except on the first cell. A 40 tile (toned by meaning: overdue danger, unassigned caution, second approval mod), then `<dt>` 13/16 600 caps .04em muted over `<dd>` mono 28/32 500 (optionally in the tone).

Used on: Settings, Devices, HoldChange, BuyerPay (locked payment details, upload row), Warn-Release, Warn-IvePaid, Main (active trades), MyOffers, PostOffer, GiftCardBrand (no results), DeleteAccount, Alerts, ModQueue, StaffOverview, BecomeVendor, Team.

Replaces in apps/web: `ui/ui.css:664-673` `.x2f-icon-tile` (keep it and make it the one tile) and `ui/ui.css:1405-1415` `.x2f-item__icon` (a 40 px **pill**: make it radius 12). The 32 px bare icon in `ui/EmptyState.tsx` goes too (see sections 12 and 13).

---

## 8. Inner block and settings rows

### 8.1 Inner block (detail rows inside a card)

Source: BuyerPay "Send exactly", the craft brief, and v2 §8.

```css
.inner { display: flex; flex-direction: column; margin: 0; border-radius: 12px; background: var(--surface-raised); } /* <dl> */
.inner__row { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 48px;
  padding: 0 14px; font-size: 14px; line-height: 20px; }
.inner__row dt { color: var(--ink-muted); }
.inner__row dd { margin: 0; font: 500 15px 'Atkinson Hyperlegible Mono', monospace; }  /* digits; words in Atkinson 15 600 */
.inner__div { height: 1px; margin: 0 14px; background: var(--surface); }               /* inset 14 */
```

- **Tall rows** (fee row, decided-by row, stacked values): `align-items:flex-start; padding:12px 14px; min-height:48px; box-sizing:border-box`.
- A value that is words with digits (MemberApproval "Trade handler (9 of 34 allowed)") is Atkinson 15 600, right-aligned, with the digits in mono.
- **Inside a hero:** dividers are `mix(T 25%)` when they divide hero sections. Dividers inside the inner block stay `--surface`.
- **Placeholder rows** (BuyerPay, while locked): the same rows, holding 10 px `--surface` pills (64 and 132, or 44 and 176 wide) and `aria-hidden`.
- **Kit note:** Refunded's hero block uses `padding: 0 16px` and a divider inset of 16. The kit and v2 say 14. Build 14 everywhere.

### 8.2 List card rows (settings, devices, blocked, login methods)

Source: the Settings `<style>` and v2 §9.

```css
.lbl  { margin: 0; padding: 0 4px; font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: 0.04em;
        text-transform: uppercase; color: var(--ink-muted); }          /* section label, 8 px above the card */
.card { margin: 0; padding: 0; list-style: none; border-radius: 16px; background: var(--surface); }
.card > li + li { border-top: 1px solid var(--surface-raised); }
.row  { display: flex; align-items: center; gap: 14px; min-height: 64px; box-sizing: border-box; padding: 12px 16px;
        color: var(--ink); text-decoration: none; }
a.row:hover, button.row:hover { background: color-mix(in srgb, var(--surface-raised) 60%, var(--surface)); }
.card > li:first-child > .row { border-radius: 16px 16px 0 0; } .card > li:last-child > .row { border-radius: 0 0 16px 16px; }
.txt  { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ttl  { font-size: 16px; line-height: 22px; font-weight: 600; text-wrap: balance; }
.meta { font-size: 13px; line-height: 18px; color: var(--ink-muted); }
.val  { flex-shrink: 0; white-space: nowrap; font-size: 15px; line-height: 20px; font-weight: 500; color: var(--ink); } /* digits mono */
.val + .chev { margin-left: -6px; }
.chev { flex-shrink: 0; color: var(--ink-muted); }  /* 20 px, path M9 6l6 6-6 6 */
.off, .off .tile { color: var(--ink-muted); }
```

- Anatomy: tile (40) or avatar (40), then the title over the meta, then an optional value, then a trailing control. The trailing control is a chevron (navigable rows), a 44 h outlined button (min-width 80, padding 0 14, radius 12, 1px line, 15 600), a text button (44 h, 15 600, `--danger` for "Log out"), or a switch.
- Switch: a button 60×44 (`margin-right:-8px`) around a 52×32 track. The track has padding 3, a pill shape and a 1px border. On: ink border and ink fill, knob `--ground`, right. Off: line border, surface-raised fill, knob `--ink-muted`, left. Knob 24. Use `role="switch" aria-checked`.
- Sections sit 24 apart. The label is 8 above its card.
- The settings value goes right-aligned before the chevron (Devices `<mono>2</mono> of <mono>3</mono>`, Session `<mono>4</mono> h`).
- The whole row is the link or button, so the hit area is ≥ 64 h.

**Kit notes.**

- **Divider inset differs.** Settings list dividers are full-width (`li + li` border-top). HoldChange and Block card dividers are inset 16 (`margin: 0 16px`). The craft brief asks for inset dividers. Build inset 16 for list cards and inset 14 for inner blocks.
- **Chevron stroke differs.** The Settings chevron is stroke 1.5, and `craft-home.CHEV` is 1.75. Build 1.75 (the global icon rule).

### 8.3 Change-card header (account kit)

HoldChange: an `<li>` card with `padding:12px; border-radius:16px; background:var(--surface); flex column; gap:4px`. The head row is `flex; align-items:center; gap:12px; padding:4px 4px 8px`: a 40 tile or 40 avatar, then a title 16/22 600 that grows, then the per-change tick (section 16).

Used on: Settings, Settings-Wide, Devices, Block, HoldChange, Alerts, SessionLength, MemberPermissions, BuyerPay, Refunded, DisputeRuling, MemberApproval, ProfileVisibility.

Replaces in apps/web: `ui/ui.css:1339` `.x2f-facts` and `ui/ui.css:1382-1432` `.x2f-items`, `.x2f-item*`. Also `.x2f-row-link` (`ui.css:1506-1522`) and `ui/Switch.tsx` (check it against the anatomy above). Build these as `InnerBlock`, `ListCard`, `ListRow`, `RowValue`.

---

## 9. Callouts

Source: v2 §12 and BuyerPay, HoldChange, Lien-Notice, Devices.

```css
.callout { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px;
  background: color-mix(in srgb, var(--T) 10%, var(--surface)); border: 1px solid color-mix(in srgb, var(--T) 30%, transparent); }
.callout svg { flex-shrink: 0; margin-top: 1px; width: 18px; height: 18px; color: var(--T); }   /* stroke 1.75 */
.callout p   { margin: 0; font-size: 14px; line-height: 20px; color: var(--ink); }
.callout[data-tone=info] { background: var(--surface-raised); border-color: color-mix(in srgb, var(--ink-muted) 30%, transparent); }
```

| Tone | Icon | Use |
|---|---|---|
| caution | triangle `M12 4l9 16H3z` `M12 10v4` `M12 17h.01` | Warnings, the 24 h hold, "pay from your own account" |
| danger | triangle (the boards use the triangle; v2 lists an octagon) | Liens, bans, scams |
| escrow | check-circle or shield | Done changes, status notes (Devices, BecomeVendor) |
| info (`--ink-muted`) | info circle `circle r9` `M12 11v5` `M12 8h.01` | Explanations, "who made this change" (HoldChange), CancelRequest |

- When the callout has more than one sentence, add a title (15/20 600) above the text in a column with `gap:4px`.
- Roles: `role="alert"` for something that appears after an action and blocks it, `role="status"` for a result, `role="note"` for static guidance, and nothing for page copy.
- **Kit note.** Some escrow status callouts (Devices, BecomeVendor) draw the icon at stroke 2. Build 1.75.

Used on: BuyerPay, SellerConfirm, CancelRequest, Fold-Trade sheet, HoldChange, SignupSecurity, Login-Backup, Lien-Notice, Ban-Notice, Devices, BecomeVendor, Settings.

Replaces in apps/web: `ui/Notice.tsx` (`.x2f-outcome*`, a bordered box with a plain tone and an optional icon). Map `plain` to escrow, `info` to info, `caution` to caution and `danger` to danger. Set the icon to 18 px, and add the 10% tint and the 30% border.

---

## 10. Setup stepper (onboarding)

Source: `gen/craft-onb/kit.py` `STEPPER_MARKUP`, `stepper_js()`. It replaces the bare ink bars, and it supersedes the earlier setup-stepper rule.

```html
<ol aria-label="Setup progress" style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:8px 0 0;padding:0;list-style:none">
  <li aria-current="step|false" style="display:flex;flex-direction:column;gap:6px;min-width:0">
    <span aria-hidden="true" style="display:block;height:4px;border-radius:999px;background:var(--escrow)"></span>
    <span style="font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-muted)">Username</span></li>
  …
</ol>
```

| State | Bar (full width, no partial fill) | Label |
|---|---|---|
| Done (n < first) | `--escrow` | 12/16 muted |
| Current (first ≤ n ≤ last) | `--ink` | 12/16 600 `--ink`, `aria-current="step"` |
| Upcoming | `--surface-raised` | 12/16 muted |
| All done (SetupWelcome) | all `--escrow` | all muted |

- Labels: Username · Log in · **[3]** · Backup · Wallet. Step 3 depends on the login method: "PGP key" (7 boards), "Password" (3 boards), or "Your key" (other methods). These are COPY-UNSIGNED.
- A range can be current at once. SignupSecurity marks steps 1–3, and its counter reads "Steps <mono>1</mono>–<mono>3</mono> of <mono>5</mono>".
- Header above it: a 44 back button, then on the right a counter "Step <mono 500 ink>2</mono> of <mono 500>5</mono>" (13/16 600 muted, padding 0 10). The stepper has `margin-top:8px`, or `0` when there is no back row (SetupWelcome). Under it, the context line "Set up your account · Takes about 2 minutes." (13/16 muted, margin-top 20), then the screen title 28/32 (margin-top 4).
- The PGP challenge sub-step label is "Step 3 of 5 · part 2" (account.md).
- For screen readers, add visually hidden "done" text to done steps. The `ol` replaces the old `role="progressbar"`.

Used on: SetupUsername, SetupLogin, SetupPassword, SetupPgpKey, SetupPgpChallenge, SetupBackup, SetupWallet, SetupWelcome, SetupTerms, SignupSecurity, RecoveryCode.

Replaces in apps/web: `screens/setup/kit.tsx:86-109` (`.x2f-start__progress`, five `.x2f-start__seg` with no labels, `role="progressbar"`) and `screens/setup/setup.css:69-89`.

---

## 11. Login-method seals and the strong-login trio

Source: `gen/craft-onb/kit.py` `G`, `seal()`, `SEAL40`, `SEAL22`, and the boards Login-Backup, LoginApprove, RecoveryHold, Compromised (trio), SetupLogin, Login, SignupSecurity (seals). This is the one set of login glyphs. They are all the **ink** family.

| Method | Glyph paths (24 viewBox, stroke 1.75) |
|---|---|
| PGP key | `<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 6l3 3"/>` |
| Security key | `<rect x="8" y="2.5" width="8" height="8" rx="1.5"/><path d="M6.5 10.5h11V15a5.5 5.5 0 01-11 0z"/><path d="M12 14v2.5"/>` |
| Passkey | `<path d="M5 11a7 7 0 0114 0v2"/><path d="M8.5 20a10 10 0 001.5-5v-4a2 2 0 014 0v3"/><path d="M14 18a14 14 0 01-.6 3"/><path d="M17 16.5V11a5 5 0 00-9.5-2.2"/>` |
| Password | `<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7.5 12h.01M12 12h.01M16.5 12h.01"/>` |
| Authenticator | `<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 7h4M9 12h6M9 16h4"/>` |
| Recovery codes | `<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>` |

Sizes are the badge seal (3.2) in `--ink`:

- **40**, method rows (SetupLogin, SignupSecurity, HoldChange): radius 12, ring 1.5, glyph 20.
- **22**, inside buttons and chips: circle, ring 1px, glyph 13. The Login board "Logging in with PGP key" chip is the badge chip (3.3) with an ink 32% border and `role="img"` with an aria-label naming the method.
- **28**, the trio: radius 9, ring 1.5, glyph 16.

**Strong-login trio:** `<span aria-hidden="true" style="display:flex;flex-shrink:0;gap:6px">` holding three 28 seals in the order **PGP key, passkey, security key** (Login-Backup). The trio always sits next to a sentence that names the three methods ("Have a security key, passkey or PGP key? …"). On Login-Backup it sits in an outline card (`padding:20px; border-radius:16px; border:1px solid var(--line); gap:12px`).

**Kit note.** The craft brief lists the trio as "passkey, security key and PGP". The boards draw PGP first. Build the board order.

Pre-login wordmark: plain ink "X2F" in Familjen 700, centred, 24 px on phone and 32 px on wide. It isn't a logo mark.

Replaces in apps/web: new. There are no seals in `setup/Login.tsx`, `auth/*` or `settings/Security.tsx`. Build `LoginSeal method size` and `StrongLoginTrio`.

---

## 12. Empty-state mark

Source: Main, BuyMain, ModQueue (the boards agree byte for byte), and v2 §16. This is the one empty-state mark for every board.

```html
<section aria-labelledby="empty-title" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 24px;text-align:center">
  <span style="display:flex;align-items:flex-end;gap:8px">
    <span aria-hidden="true" style="width:20px;height:20px;margin-bottom:4px;border-radius:6px;
          background:color-mix(in srgb,var(--escrow) 35%,var(--surface-raised))"></span>
    <span style="display:flex;width:56px;height:56px;align-items:center;justify-content:center;border-radius:16px;
          background:var(--surface-raised);color:var(--ink)">[28 px icon, stroke 1.75, aria-hidden]</span>
    <span aria-hidden="true" style="width:12px;height:12px;margin-bottom:30px;border-radius:999px;
          background:color-mix(in srgb,var(--caution) 45%,var(--surface-raised))"></span>
  </span>
  <h2 id="empty-title" style="margin:0;font:700 24px/30px 'Familjen Grotesk';letter-spacing:-0.01em;overflow-wrap:anywhere">No method called "…" yet</h2>
  <p style="margin:0;max-width:420px;font-size:16px;line-height:24px;color:var(--ink-muted)">One sentence.</p>
  <a style="display:inline-flex;align-items:center;justify-content:center;height:48px;margin-top:4px;padding:0 20px;
     border-radius:12px;border:1px solid var(--line);color:var(--ink);font-size:16px;font-weight:600">Post an offer</a>
</section>
```

- Variants: the icon in the 56 tile changes per board (search, inbox …). Trade empties ("no trades yet") replace the whole mark with the **hero key mark in `--ink-muted`**.
- The action is one secondary button, or the primary if it's the screen's only action. It's optional (ModQueue has none).
- If the empty state replaces a list after a search, wrap it in `role="status"` so the change is announced.
- **Kit note.** `gen/craft-staff/kit.py` `empty()` draws a different, three-block mark (a 16 px escrow square at 28%, a 20×8 caution pill at 32%, and a 12 px muted ring), which no board uses. The craft brief says the mark lives in `gen/craft-home/kit.py`, but that file has no empty-state function. Build the board markup above, and retire `craft-staff.empty()`.

Drawn on: Main, BuyMain, ModQueue, StaffLog, Fold-TriFold. Every other empty list (MyOffers, BuyOffers and SellOffers no-results, Alerts, News, Reviews none-yet) should use the same mark when built.

Replaces in apps/web: `ui/EmptyState.tsx` (a 32 px bare icon, an h2 and a p) and `ui/ui.css:1737-1762`.

---

## 13. done_state (designed result state)

Source: `craftgen/craftlib.py` `done_state()`, and the boards Review, Feedback, Settings (password changed). Use it for every thank-you, saved, skipped or done state. Never use a bare check and grey text.

```html
<section role="status" aria-labelledby="done-title" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 24px;text-align:center">
  <span style="display:flex;width:56px;height:56px;align-items:center;justify-content:center;border-radius:16px;
        background:color-mix(in srgb,var(--escrow) 14%,transparent);color:var(--escrow)">[28 px icon]</span>
  <h2 id="done-title" style="margin:0;font:700 24px/30px 'Familjen Grotesk';letter-spacing:-0.01em">Thank you!</h2>
  <p style="margin:0;font-size:16px;line-height:24px;color:var(--ink-muted)">One line.</p>
  <!-- optional extra -->
</section>
```

| Variant | Tile | Board |
|---|---|---|
| Saved, sent, thanks (escrow) | `mix(escrow 14%)` + `--escrow`, check icon | Review (saved), Feedback |
| Skipped or neutral (ink) | `--surface-raised` + `--ink` | Review (skipped) |
| Any tone T | `mix(T 14%)` + `--T` | `done_state(tone=…)` |
| In a card (Settings "New password from …") | neutral tile; the section gets `padding:32px 24px; border-radius:16px; background:var(--surface)` | Settings |

- Optional extra, for example Feedback's "sent as" chip: a 28 h pill, `padding:0 10px`, `mix(ink-muted 16%)`, ink text 13/16 600, no uppercase.
- A date inside the title is mono at 20/30 500 (Settings).
- Use `role="status"` (Review) or `aria-live="polite"` (Feedback), so the swap from form to result is announced. Then move focus to the title (`tabindex="-1"`).
- There is no key mark and no flanking blocks: those belong to the empty state only.
- **Kit note:** the brief points to GiftCardBrand for done_state, but GiftCardBrand has no done state. Its piece is the brand tile (section 18).

Drawn on (56 px state tile): Review, Reviews, Feedback, Feedback-Wide, Settings, Settings-Wide, LoginApprove, SessionExtend, RecoveryCode, RecoveryHold, HoldMember, MemberApproval, JabberSetup (and the -Wide variants).

Replaces in apps/web: new (today these are `Notice tone="plain"` lines). Build `DoneState tone icon title`.

---

## 14. Chat kit

Source: `craftfold/foldkit.py` `chat_markup()`, `chat_js()`, `ident()`, `LOCK`, `gen/craftkit.py` `chatmsg()`, and the boards Fold-Trade, DisputeRoom, TeamChat, Support.

### 14.1 Message

```js
const chatView = (m, who, init, trusted) => ({
  them: !m.me, who: m.me ? 'You' : who, init, text: m.text, time: m.time,
  wrapStyle:  'display:flex; gap:8px; align-items:flex-end; max-width:' + (m.me ? '85%; align-self:flex-end;' : '90%; align-self:flex-start;'),
  colStyle:   'display:flex; flex-direction:column; gap:4px; min-width:0; align-items:' + (m.me ? 'flex-end;' : 'flex-start;'),
  bubbleStyle:'margin:0; padding:10px 14px; font-size:15px; line-height:22px; ' + (m.me
     ? 'border-radius:12px 12px 4px 12px; border:1px solid var(--line);'                 // own: outline, no fill
     : 'border-radius:12px 12px 12px 4px; background:<one step above the log background>;')
});
```

- Other person: a 32 avatar (2.1, with the Trusted ring when it applies, no dot, `aria-hidden`) at the bottom-left, aligned to the bubble's bottom. Own messages have no avatar.
- Name line, above the bubble: 13/16 muted. `<span style="color:var(--ink);font-weight:600">satoshi_ghost</span> · <mono>10:20</mono>`. Own messages say "You · <mono>time</mono>", right-aligned.
- Bubble corners: 12/12/12/4 for the other person (the tail is bottom-left) and 12/12/4/12 for you (bottom-right).
- Other-bubble fill: `--surface` when the log sits on `--ground` (DisputeRoom, Support), and `--surface-raised` when the log sits in a surface pane (Fold-Trade, TeamChat). It's always one step up.
- **Moderator message** (DisputeRoom): a 32 mod tile instead of the avatar. The name line has the X2F Moderator tag first, then the name in `--mod` 600 · time. The bubble is `mix(mod 8%, surface)` with a `mix(mod 40%)` border.
- **Team member message:** the 32 team avatar, with the Team member tag in the name line. Never say which member in customer-facing chat (owner rule; see `teamCopy.ts:447`).
- **X2F team (Support):** the 32 "X2F" avatar plus the X2F team tag in the name line. **Kit note:** the Support board sets the name at 14/18 inside the 13/16 line and uses `gap: 4px 8px` with flex-wrap. Build the kit's 13/16 line.
- **System line:** centred, `max-width:92%; padding:8px 12px; border-radius:12px; background:var(--surface-raised)`, 13/18 muted. It starts with `<mono>10:14</mono> · `. The moderator-joined variant uses a `mix(mod 10%, surface)` background with the moderator name in `--mod` 600.
- Log container: `role="log" aria-label="Messages"` (or "Trade chat"), `flex column`, gap 12 (DisputeRoom) or 16 (Fold-Trade pane, padding 16).

### 14.2 Chat-header identity row

Fold-Trade: `<header style="display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid var(--surface-raised)">`. It holds the identity row at **40** (avatar with dot and ring, name 16/22 600 plus the Vendor tag, wrapping with `gap:2px 8px`), with a meta line of `Online · <mono>1,284</mono> trades · <mono>99.4%</mono> positive`. On the right, `flex-shrink:0`, is one badge chip (the top featured badge, usually Trusted) in its 44 px button.

### 14.3 Encryption note

The first item in the log, centred:

```html
<span style="align-self:center;display:flex;align-items:flex-start;gap:6px;max-width:320px;font-size:12px;line-height:16px;color:var(--ink-muted);text-align:center">
  <svg width="14" height="14" … style="flex-shrink:0;margin-top:1px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>
  <span>Encrypted. If a dispute is opened, a moderator can read this conversation.</span></span>
```

**Kit note:** DisputeRoom uses `max-width:280px`, a `<p>`, and the copy "Chats are encrypted. If a dispute is opened, a moderator can read this conversation." Fold-Trade says "Encrypted. …". Pick one wording (it's a P4 for the owner). The geometry is otherwise the same.

### 14.4 Composer

DisputeRoom footer: `flex; gap:8px`, with a visually hidden label "Message". The input is 48 h, radius 6, 1px line border, surface-raised fill, padding 0 14, 16 px text, placeholder "Message satoshi_ghost". The send button is 48×48, radius 12, 1px line border, transparent, a 20 px icon, and `aria-label="Send message"`.

Used on: Fold-Trade, Fold-Tabletop, DisputeRoom, TeamChat, TeamChat-Wide, Support, Support-Wide, BuyerPaidWaiting-Wide.

Replaces in apps/web: `chat/ChatPanel.tsx:186-265` and `chat/chat.css:5-153`. Those bubbles are surface-raised blocks with a 13 px "who" line and no avatar, and there's no header identity row or lock note. Keep the engine. Replace `.x2f-chat__line`, `__who`, `__text` and `__notice` with `ChatMessage`, `ChatHeader`, `ChatSystemLine`, `EncryptionNote`.

**Kit note.** `browse.md:79` asks for a **48 px** avatar in the chat-pane header. The Fold-Trade board and `foldkit.ident()` (default `size=40`) draw 40. Build 40.

---

## 15. Dispute kit

Source: `gen/craftkit.py` `party()`, `parties()`, `evtile()`, `evgrid()`, `modtile()`, `MODTAG`, and the boards DisputeOpen, DisputeRoom, DisputeRuling.

### 15.1 Parties strip ("Who holds the keys")

```html
<ul aria-label="Who holds the keys" style="margin:0;padding:14px 8px;list-style:none;display:grid;grid-template-columns:repeat(3,1fr);
    gap:4px;border-radius:12px;background:var(--surface-raised)">
  <li style="display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;text-align:center">
    [40 avatar on raised: surface fill, dot 11 with a surface-raised ring]
    <span style="font-size:13px;line-height:18px;font-weight:600;max-width:100%;overflow-wrap:anywhere">mira.k</span>
    [neutral tag "You · buyer"]</li>
  … the other trader ("Seller"), then the moderator: 40 mod tile + "Moderator" + tag "Not joined" (pending) or the mod tile + name + X2F Moderator tag
</ul>
```

The order is you, the other trader, the moderator. It sits inside the hero, under the amount.

### 15.2 Evidence tile and grid

- Grid: `<ul aria-label="Evidence">` with `display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px`.
- Tile: `<li role="img" aria-label="Your Zelle screenshot, blurred, included">` with `flex column; gap:8px; padding:8px 8px 10px; border-radius:12px; min-width:0`. The background is `--surface-raised`, or `mix(mod 10%, surface-raised)` for moderator-only files.
- Preview: 72 h, radius 8, `--surface`, `aria-hidden`. Screenshot kind: a column with gap 6 and padding 0 14 holding four bars: 5 h 40% `--line`; 9 h 62% radius 4 `--ink` (or `--mod` for moderator files); 5 h 88% `--line` with `filter:blur(2px)`; 5 h 70% blurred. Chat kind: padding 0 12 and three 12 h radius-6 bubbles: 58% raised at the start, 46% `mix(ink 22%, surface)` at the end, and 38% raised at the start.
- Text: a column with gap 2 and padding 0 4. The title is 14/18 600. The meta is 12/16 muted and may include a status line, for example an escrow 600 12/16 line with a 14 px check (stroke 2) reading "Included".
- If tiles open a preview, make the `li` content a button. `role="img"` is only right while the tile is static.

### 15.3 Decided-by row

DisputeRuling: the first row of the ruling's inner block, with `flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px`. It holds a 40 mod tile, then a column (`gap:3px`). The column's top row (`gap:8px`, wrapping) has the name 16/22 600 in `--mod` and the X2F Moderator tag. Under it, the meta 13/18 muted is the date in mono, "29 Oct 2026, 14:05 UTC". An inset-14 `--surface` divider follows.

### 15.4 Pending moderator tile

`modtile(size, pending=True)`: a 1px solid `--line` border, no fill, and the `--ink-muted` shield. Use it in the parties strip ("Moderator" plus "Not joined") and in staff tables for unassigned cases (32 px).

### 15.5 Fee row

DisputeRuling, under the decided-by row in the same inner block: `flex; gap:10px; align-items:flex-start; min-height:48px; box-sizing:border-box; padding:12px 14px; font-size:14px; line-height:20px`. It holds an 18 px muted percent icon (`<path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>`, `margin-top:1px`), then `<span style="font-weight:600">Fee: </span><mono>1%</mono> paid by satoshi_ghost, as the offer poster.` States:

- Release: "1% paid by the offer poster".
- Refund: "none. Everything went back, so X2F charges nothing."
- Appeal sent: "waits until the appeal is decided."

These are COPY-UNSIGNED, owner rule g63.

Also from the kit:

- Ruling reason card: a tinted card, `mix(mod 8%, surface)`, with a `mix(mod 40%)` border, radius 16, padding 20, gap 16.
- Moderator request card (DisputeRoom): the same tint, padding 16, gap 12.
- "A moderator steps in within 24 h" (DisputeOpen) is an info-style row. **Kit note:** that row uses a 20 px danger icon on surface-raised with no border. Build it as an info callout (section 9).

Used on: DisputeOpen, DisputeRoom, DisputeRuling, Appeal-Notice, ModCase, ModQueue (pending tile).

Replaces in apps/web: new. The dispute screens are `screens/dispute/*`. `ModeratorBadge` goes (2.2).

---

## 16. Account kit

Source: HoldChange, Block, Settings, and the craft brief's account kit.

### 16.1 Effect line with countdown

The last line inside each change's "After" block:

```js
effStyle: 'display:flex; align-items:flex-start; gap:6px; margin-top:4px; font-size:13px; line-height:18px; font-weight:600; color:' + (ticked ? TONE : 'var(--ink-muted)')
```

- It opens with a 16 px icon (`margin-top:1px`): a clock for a held change, a check for an instant one, and an "off" glyph for an unticked change. Then the text parts, with digits in mono: `Applies in <mono>23</mono> h <mono>12</mono> min`, "Removed in …", "Usable in …", "Applies now", "Applies when you confirm", "Won't apply".
- TONE is `--caution` when the change is held (logged in with just a username and password) and `--escrow` otherwise.
- The countdown follows the timer rule (1.5): mono digits, body units, no colons. It is computed from the server clock.

### 16.2 Before / After blocks

- Before: `flex column; gap:2px; padding:10px 12px; border-radius:12px; background:var(--surface-raised)`.
- After: the same, with `background: mix(TONE 8%, surface-raised); border:1px solid mix(TONE 35%)`.
- Each block opens with the `.lbl` "BEFORE" or "AFTER". The title is 15/22 600, or 400 muted when empty ("No passkey"). The meta is 13/18 muted with the dates mono. A 20 px muted down-arrow sits centred between the two blocks.

### 16.3 Per-change tick

In the change-card header (8.3), right-aligned: `<label style="display:flex;flex-shrink:0;align-items:center;justify-content:center;width:44px;height:44px;margin:-8px -8px -8px auto;cursor:pointer">` around `<input type="checkbox" style="width:22px;height:22px;margin:0;accent-color:var(--ink)">`.

- Use `aria-label="<change> · ticked changes apply"`.
- It only shows when approving (`canTick`).
- Unticking dims both blocks and the arrow to `opacity:0.55`, and the effect line turns muted "Won't apply".
- The header's tick count ("<mono>N</mono> changes") updates.

### 16.4 Pending row (HoldChange lists, Settings)

A list row (8.2) whose tile is the pending caution tile (section 7) and whose meta is 13/18 `--caution` ("· waiting to submit" or "· waiting to confirm").

### 16.5 Settings row value, blocked marker, offline avatar

See 8.2 (value) and 2.1 (blocked marker, offline). Block list rows are 64 h, padding 12 16, gap 14, inset dividers (`border-top:1px solid var(--surface-raised)`). The name is 16/22 600, or ink-muted once unblocked. The trailing control is a 44 h outlined "Unblock", or a `--monero-ink` text "Undo".

Wide rule: cards in a column sit 24 apart, always.

Used on: HoldChange, HoldChange-Wide, HoldMember, MemberPermissions, Settings, Block, Block-Wide, BlockQueued, Devices, SessionLength, RecoveryHold.

Replaces in apps/web: new (HoldChange is not built). Block rows replace the text-only rows in `screens/settings/Blocked.tsx:132-152`.

---

## 17. Rating chip and star picker

Source: `craftgen/craftlib.py` `rating_chip()`, and the boards Review (picker), Reviews and Reviews-Wide (chip).

### 17.1 Rating chip

The badge chip with a caution star seal:

```html
<span role="img" aria-label="5 of 5 stars" style="display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px 0 4px;box-sizing:border-box;
  border-radius:999px;background:var(--surface-raised);border:1px solid color-mix(in srgb,var(--caution) 32%,transparent);
  font-size:13px;line-height:16px;font-weight:600;color:var(--ink);white-space:nowrap">
  [22 seal, caution, star glyph 13: M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z]
  <span style="font-family:'Atkinson Hyperlegible Mono';font-weight:500">5</span>
  <span style="font-weight:400;color:var(--ink-muted)">of 5</span></span>
```

It isn't interactive (no 44 wrapper). It sits right-aligned in a review row, after the reviewer name (15/20 600) over the meta (13/16 muted).

### 17.2 Star picker

```html
<div role="radiogroup" aria-labelledby="rv-q" style="display:flex;gap:6px">
  <button type="button" role="radio" aria-checked="true|false" aria-label="4 of 5" style="display:flex;align-items:center;justify-content:center;
     width:56px;height:56px;box-sizing:border-box;border-radius:12px;padding:0;cursor:pointer;
     background:color-mix(in srgb,var(--caution) 16%,var(--surface-raised));border:1.5px solid color-mix(in srgb,var(--caution) 55%,transparent)">
    <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" style="color:var(--caution)">
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>
  …
</div>
```

- Picked (n ≤ rating): the seal wash and ring as above, with the star filled in `--caution`.
- Not picked: `background:var(--surface-raised); border:1.5px solid transparent`, with the star `fill="none"` and `color:var(--line)`.
- Only the star equal to the rating has `aria-checked="true"`. The group follows radio keyboard rules: arrow keys move, and the roving tabindex lands on the checked star.
- Above the picker, a summary: mono 28/32 500 -0.01em rating, then "of 5" in 16/24 600 muted.
- The question heading is 18/24 600 ("How was trading with satoshi_ghost?"), with a 13/18 muted line under it.
- The phrase chips below the picker are not badges: 44 min-height, pill, padding 0 14, 15 px. The picked chip gets a 2 px ink border on surface-raised, and its text keeps its tone (escrow for good, danger for bad). Use `aria-pressed`.

Used on: Review, Reviews, Reviews-Wide, Profile (rating summary).

Replaces in apps/web: new. `Released.tsx:134 reviewSlot` is empty.

---

## 18. Brand tile (gift cards)

Source: GiftCardBrand, and `design-gift-card-rules-2026-11-07.md` for the behaviour.

- Search: a 48 h input, radius 6, 1px line border, surface-raised fill, padding `0 14px 0 44px`, with a 20 px muted search icon at left 14, a visually hidden label "Search brands", and `type="search"`.
- Group card: `<section>` with `flex column; gap:4px; padding:12px 20px; border-radius:16px; background:var(--surface)`. Its `<h2>` uses the uppercase label style with `padding:4px 0 8px` ("MOST USED", "ALL BRANDS"). Under it, a `<ul role="listbox" aria-labelledby>`.
- Each `<li>` after the first has `border-top:1px solid var(--surface-raised)`.
- Row: `<button role="option" aria-selected>` with `display:flex; align-items:center; gap:12px; width:calc(100% + 16px); min-height:48px; margin:0 -8px; box-sizing:border-box; border-radius:12px; text-align:left`.
  - Unselected: `padding:4px 8px; border:0; background:transparent`.
  - Selected: `padding:2px 6px; border:2px solid var(--ink); background:var(--surface-raised)`, plus a 22 px check (stroke 2) on the right. The padding drops by 2 so the content doesn't move.
- **Brand tile:** 40×40, radius 12, initials in Familjen 15/20 700 -0.01em, ink. The background is `--surface-raised`, or `--surface` when the row is selected. It is `aria-hidden`, and it isn't a logo: there are no brand colours or marks.
- The name is 16/24, grows, and is left-aligned.
- No results: an outline card (`flex; gap:14px; padding:16px 20px; border-radius:16px; border:1px solid var(--line)`, `aria-live="polite"`) holding a neutral 40 search tile and 14/20 muted text, with the query in ink.

Used on: GiftCardBrand, PostOffer (gift-card branch), FlexOffer-Post.

Replaces in apps/web: new (GiftCardBrand is not built). Reuse `ListCard` (8.2) and the 40 tile (section 7).

---

## 19. Build order and acceptance

### 19.1 Order

1. **Tokens (section 1).** Fix monero, add scrim, radius 10, hero-number and result-headline. Make the screen title 28/32 700. Make `xmrText` 6 decimals. Split the timer into parts. Remove the hold-button glow. This is one PR, and every later component depends on it.
2. **Trader identity and badges (sections 2 and 3).** `Avatar`, `RoleTag`, `ModTile`, `IdentityRow`, `StatTiles`, `TraderCard`, `CompactTrader`, `RecipientRow`, `BadgeSeal`, `BadgeChip`, `BadgeMore`, `BadgeSheet`, `BadgeCard`. These unblock browse, trade, dispute, profile and fold.
3. **Hero and stepper (sections 4, 5 and 6).** `Hero`, `StatusChip` (six tones), `HeroNumber`, `TimerRing`, `SegmentProgress`, `KeyMark`/`KeyTile`, `TradeStepper`. Then rebuild `TradeHeader` (key-screen and compact variants, v2 §5) to host the stepper.
4. **Rows and blocks (sections 7, 8 and 9).** `IconTile`, `InnerBlock`, `ListCard`/`ListRow`/`RowValue`/`Switch`, `Callout`.
5. **Onboarding (sections 10 and 11).** `SetupStepper`, `LoginSeal`, `StrongLoginTrio`, `SignedInRow`.
6. **States (sections 12 and 13).** `EmptyState` (with the mark), `DoneState`.
7. **Chat (section 14), then dispute (section 15), account (section 16), reviews (section 17) and brand tile (section 18)**, in the order their screens are built (gap README job order 4–6).

Each component ships with a story or test page showing night and day, every state in its table, and a 390 px phone width.

### 19.2 Acceptance (one check per component)

| Component | Reviewer check |
|---|---|
| Tokens | `grep -r '#ff7a1a\|#f26822' apps/web design` is empty. A rendered night primary button is `#ff6600`. `box-shadow` appears only on the two nav-current lines. |
| XMR amounts | Every XMR string in the app matches `/^\d+\.\d{6}$/`, prose included (SellerRefund lead reads "1.250000 XMR"). |
| Timers | No `mm:ss` anywhere. TradeFund shows mono "28" + "min" + mono "42" + "s", and LoginApprove "4 min 59 s". |
| Avatar | 48 / 40 / 32 measure exactly, with initials at 17 / 15 / 13. Teal ring only for Trusted. Dot 12 with a ring matching the background. Offline has no dot plus "Last seen". The blocked marker is 18 px danger bottom-right. |
| Role tags | Vendor, Team member, X2F Moderator and X2F team are 20 h, radius 6, 11/14 caps .06em, in the right tone. Moderator appears only inside disputes and staff. |
| Stat tiles | Three in a row, gap 6, radius 10, mono 16 value over a 12 muted label. |
| Trader card | Surface, radius 16, padding 20. Identity, stats and chips 12 apart. Placed right after the hero on phone. |
| Recipient row | The amount line starts exactly under the name (60 px indent). Raised rules above and below. |
| Badge seal | Seals at 22 / 28 / 40 have radius 999 / 9 / 12 and a 16% tone fill with a 55% ring. Milestones show the mono number. |
| Badge chip / +N | Chip 30 h inside a 44 h button. Border 32%, 60% on hover or focus. At most two chips then "+N". Tap opens the sheet (phone), hover or Enter opens the card (desktop). Esc closes and focus returns. |
| Hero | One per screen. 14% wash to 140 (160 on results), 35% border. Chip left and key mark right (trade only). One hero number or one result headline. |
| Status chip | 28 h, caps 13/16, 14% tint (16% neutral or mod). Neutral text is ink. Never orange. |
| Key mark | Hero 62×14 or small 32×8. State tone, aria-hidden. Appears only in heroes, active-trade tiles and the trade empty state. |
| Trade stepper | Present on every live-trade phone screen under the title. Done is escrow, current has a partial fill in the tone with an ink 600 label and `aria-current`, upcoming is empty. |
| Icon tile | 40 / 12 / 20 (or 56 / 16 / 28). Neutral raised or toned 14%. Every meaningful row has one, and none are pills. |
| Inner block | Raised, radius 12. Rows ≥ 48 with padding 0 14. Muted 14/20 label left, mono 15/500 value right. Surface dividers inset 14. |
| Settings row | ≥ 64 h, padding 12 16, gap 14. Title 16/22 600 over 13/18 meta. Value 15/20 500 before the chevron. Chevron 20 muted. Section label caps 8 above the card. |
| Callout | Padding 12 14, radius 12, 10% tint and 30% border (info: raised plus a 30% muted border). The icon is 18 px in the tone. |
| Setup stepper | Five labelled bars. Done escrow, current ink with a 600 label and `aria-current`, upcoming raised. The step-3 label follows the chosen login method. |
| Login seals / trio | Ink family only. 40 / 22 / 28 sizes. The trio is PGP, passkey, security key, gap 6, aria-hidden, next to a sentence naming them. |
| Empty state | A 56 tile flanked by the 20 px escrow block (bottom) and the 12 px caution dot (raised 30). Title 24/30, one 16/24 sentence, at most one button. Trade empties use the muted key mark. |
| done_state | A centred 56 toned tile, a 24/30 title and one line. Announced (status or live region), and focus moves to the title. |
| Chat | Others: 32 avatar, name 600 ink · mono time, 12/12/12/4 bubble one step above the background. Own: outline, 12/12/4/12, no avatar. A lock note opens the log, and the header carries the 40 identity row plus one chip. |
| Parties strip | Three columns on raised: you, the other trader, the moderator. 40 avatars with dot 11, or a mod tile (pending: line border, muted). |
| Evidence tile | 2-column grid, 72 px preview, title 14/18 600, meta 12/16. Moderator-only files have the mod-tinted background. |
| Decided-by / fee row | Mod tile 40, the name in mod purple, the X2F Moderator tag, a mono UTC date. The fee row has an 18 px percent icon and "Fee:" in 600 with the mono value. |
| Effect line / tick | Every change ends with a 13/18 600 effect line in the tone, with the countdown in mono digits. The tick is a 22 px box in a 44 hit area. Unticked dims to 0.55 and reads "Won't apply". |
| Rating chip / star picker | The chip is the badge chip with a caution star seal, mono value and muted "of 5". The picker is a radiogroup of five 56 px tiles. Picked tiles have the caution seal wash and a filled star, unpicked a raised tile with a line-colour outline star. |
| Brand tile | 40 / 12 tile with Familjen 15 700 initials. The selected row has a 2 px ink border on raised plus a check, and the tile turns surface. listbox/option roles. |

---

## Appendix: open contradictions in the kit sources

These are listed so the head designer can rule. The build follows the choice stated in each section until then.

1. **Trusted meaning.** `craftgen/craftlib.py` says "100+ trades and 98%+ positive". `gen/badges.py`, `gen/badge_parts.py` and every board say 200+.
2. **The 40 px avatar online dot.** It is 12 in `badge_parts` (most boards), 11 in `craftkit` (parties strip), and 10 in `craft-onb` (unused). The 40 px initial is 14 in `craftlib.person()` and 15 elsewhere. `craftlib.avatar_sized()` gives a 32 px avatar 15 px initials, where `craftkit` gives 13.
3. **The empty-state mark.** `gen/craft-staff/kit.py` `empty()` has three blocks (16 escrow 28%, a 20×8 caution pill 32%, a 12 muted ring). The boards Main, BuyMain and ModQueue have two (a 20 escrow 35% over raised, a 12 caution 45% over raised), and the craft brief says "flanked by two small blocks". The brief also says the mark is in `gen/craft-home/kit.py`, which has no empty-state code. The craft brief's wide "Steps" jump card is not in `gen/craft-home/kit.py` either.
4. **The hover card.** The brief says it's in `gen/badge_parts.py`. It (and the sheet) exist only in `gen/badges.py`. Its "3 more badges" label is set in mono (`LBL`), against v2's digits-only rule, and it uses `role="tooltip"` around a list.
5. **The `badge_parts.JS_BADGES` `sealStyle`** has no 28 px case (it yields a 999 radius and a 1 px ring).
6. **mira.k.** The brief says "Trusted + PGP verified +3, teal ring". `craftlib.trader_card_mira()` draws no ring, PGP only and no "+N". Warn-Release and SellerRefund draw mira.k with the teal ring, and `badges.py` C2 has Trusted + PGP + 3.
7. **The chat-pane header avatar.** `design-build-gaps/browse.md:79` asks for 48. Fold-Trade and `foldkit.ident()` draw 40.
8. **The encryption note.** The copy and max-width differ: DisputeRoom says "Chats are encrypted. …" at 280, Fold-Trade "Encrypted. …" at 320. The Support chat name is 14/18 against the kit's 13/16 line.
9. **Dividers and chevrons.** Settings list dividers are full-width, HoldChange and Block are inset 16, and inner blocks are inset 14. Refunded's hero inner block uses 16 where the kit says 14. The Settings chevron is stroke 1.5 where `craft-home.CHEV` is 1.75. Some callout icons are stroke 2.
10. **The offline avatar.** The teamkit `off` kind (surface fill, muted initials) and SellerRefund's offline trader (raised fill, ring kept, no dot) disagree.
11. **The strong-login trio order.** The brief says passkey, security key, PGP. The boards draw PGP, passkey, security key.
12. **The danger callout icon.** v2 §12 says an octagon. The boards use the triangle.
13. **Team allowance.** MemberApproval reads "9 of 34 allowed". The brief says Team's "of 19" should become "of 31" to match Q16, so there are three different totals.
14. **The task brief named GiftCardBrand as a done_state board.** It has none. Its kit piece is the brand tile.
15. **The tag families.** The "This device" tag (Devices) is a pill, 22 h, 12/16 caps. Role tags are radius 6, 20 h, 11/14 caps. Two small-label styles exist, and they're not unified.
16. **Build tokens that have no board counterpart:** `title` 24/30 600, `monero-ink-hover` and `monero-hold`. Board tokens that are missing in the build: `scrim`, radius 10, hero-number and result-headline.

## Head designer's rulings on the appendix (8 Nov 2026)

Build these values; they override anything above that disagrees. The generators will be brought in line on design's side.

1. **Trusted** is "200+ trades and 98%+ positive" (owner p5-3). craftlib's 100+ is stale.
2. **Avatars:** online dot 10 at 32 px, 12 at 40 px, 14 at 48 px, always with a 2 px surface ring, bottom-right. Initials: 13 at 32, 15 at 40, 18 at 48 (Familjen 700).
3. **Empty-state mark:** the boards' two-block version (56 px tile flanked by a 20 escrow block at 35% and a 12 caution block at 45%, both over surface-raised). The three-block staff version is dropped.
4. **Hover card:** build from badges.py's markup, with two fixes: the "3 more badges" label is body text with only the digit in mono, and the card is `role="dialog"` (aria-label "<name>'s other badges") containing a list, opened by the "+N" button, closed by Esc or pointer leave. The phone sheet is the same list in a bottom sheet.
5. **Seal 28 px:** radius 9, 1.5 px tone ring at 55%, 16 px glyph (as badges.py). badge_parts' missing case is a design-side bug.
6. **mira.k** holds Trusted: teal ring, chips "Trusted · PGP verified" + "+3". trader_card_mira() is stale.
7. **Chat-pane header avatar:** 40 px (Fold-Trade, foldkit). 48 is for screen headers and heroes only.
8. **Encryption note:** "Encrypted. If a dispute is opened, a moderator can read this conversation." 13/18 ink-muted, 14 px lock icon, centred, max-width 320. Chat name line 13/16 600 everywhere (Support's 14/18 is drift).
9. **Dividers:** 1 px surface-raised (or surface inside raised blocks), inset 14 inside inner blocks and list cards, full width only between cards' own sections. Chevrons 16 px, stroke 1.75, ink-muted.
10. **Offline avatar:** keep the normal fill and any Trusted ring, remove the dot, add "Last seen …" under the name (SellerRefund's version). teamkit's muted `off` style is dropped.
11. **Strong-login trio order:** passkey, security key, PGP, everywhere (the brief's order); boards drawing PGP first will be fixed on design's side.
12. **Danger callout icon:** the triangle (as the boards). v2 §12 is updated to match.
13. **Team totals:** 34 permissions (five types). "9 of 34 allowed" on MemberApproval is one member's count, not a total, so it stands.
14. **GiftCardBrand:** no done state; its kit piece is the brand tile.
15. **Tags:** one small-label family: radius 6, height 20, 11/14 600 uppercase .04em, padding 0 6, optional 12 px icon. "This device" moves to it.
16. **Tokens:** drop `title` 24/30 (use sheet-title 24/30 700 for sheets, screen-title 28/32 for screens), drop `monero-hold` and the hover glow (no shadows, v2 §2; hover is a 6% ink overlay). `monero-ink-hover` may stay as a link hover. Add `scrim`, radius 10 (stat tiles), `hero-number` 40/44 mono 500 and `result-headline` 32/36 Familjen 700. Rename `--x2f-moderator` to `--x2f-mod`.
