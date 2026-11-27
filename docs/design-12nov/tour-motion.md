# First screen and first-trade tour: motion (12 Nov, v2)

**The owner rejected the isometric-blocks style on 12 Nov** ("it sucks", "why are we ripping their animation off"). All the iso work is gone: the block scenes, the camera orbit, the floor grid, the shield, and the mini iso tiles in the tour cards. Its old contact sheets are in `tour-art/rejected-iso/` for the record only. What replaces it is X2F's own: the logo's letters, and the real app being used.

- **Prototype (READY):** `tour-art/x2f-intro-prototype.html` (the same file is at `S/w13/tour-art/`). It is one file with no libraries. Its only network request is the Google Fonts stylesheet the boards already use. It fills the viewport, so the same file is the phone, the folded iPhone Duo and the unfolded iPhone Duo.
- **Contact sheets** (in `tour-art/` and `S/w13/tour-art/frames/`):
  - `contact-intro.png`: the letter sequence, then the hold frame at each size, plus reduced motion;
  - `contact-intro-landscape.png`;
  - `contact-tour-night-443x794.png`, `contact-tour-day-443x794.png` and `contact-tour-night-390x844.png`;
  - `contact-tour-night-466x678-folded.png`, `contact-tour-day-626x890-unfolded.png` and `contact-tour-night-890x626-landscape.png`;
  - `contact-tour-in-motion.png`: actions mid-flight.
- **URL params:** `?theme=night|day`, `?rm=1`, `?view=tour&stop=1..17`, `?still=1` (hold the full logo), `?bare=1` (hide the prototype controls).
- **JS hooks:** `X2F.intro()`, `X2F.tour(n)`, `X2F.go(n)`, `X2F.end()`.

Status for each item: **READY** means built and checked in rendered frames. **OPEN** means it needs a decision.

---

## 1. Motion tokens (READY)

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | settles, card moves, text in |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | anything leaving |
| `--ease-io` | `cubic-bezier(0.65, 0, 0.35, 1)` | scrolls, the scan line, the ring's breathing |
| Letter spring | a damped spring (ζ 0.62, ω 13.5 rad/s, 600 ms), sampled into CSS `linear()` | each letter's grow: about 6% overshoot, then it settles |
| Dot spring | ζ 0.48, ω 15 rad/s, 700 ms | the orange dot's landing: a touch more bounce |

The springs are generated in JS (`spring(zeta, omega, dur)`) as `linear()` easing strings and handed to the Web Animations API. Where `linear()` is missing (Safari before 17.2), use `--ease-out` instead.

## 2. First screen: the letter intro (READY)

**Layout.** This is the FirstScreen board's order with the intro slot filled in. The column is at most 480 wide and centred, with 16 px sides:

1. **Hero:** radius 20, a 1 px `--surface-raised` border, and the board's radial wash (`--escrow` 10% into `--surface`, falling to `--ground`). It flexes: at most 340 tall, at least 132.
2. **"Welcome to X2F":** Familjen 30/36 700.
3. **One line:** 17/24 `--ink-muted`. "Swap Monero for cash, bank transfers or gift cards, person to person." This is the line from the old intro scene 1, so it is still **COPY-UNSIGNED**.
4. **Take the tour:** primary, 56 high.
5. **Skip and get started:** secondary, 52 high.
6. **FAQ / Getting started / Support / Settings:** ~~these only show when the screen is at least 760 tall.~~ Owner note #47, confirmed 26 Nov: they show on every screen height; under 760 tall the spacing compacts to fit them.
7. **Tab bar:** 60 high, with no tab current.

**The letters.** These are the real logo paths (`viewBox 0 -2.15 292 122.15`), split into four layers: X, 2, F and the orange dot.
- All four layers share one box with whole-pixel width and height, so the end state is exactly the static logo. There is no sub-pixel drift.
- The box width is min(280, 66% of the hero's width, 46% of its height × 292/122). Short screens shrink the letter stage first.
- Only `transform` and `opacity` animate (`will-change` is on), so there is no layout and no blur. Each letter scales from its own baseline centre.

**One loop** (t in ms):

| t | What | Duration | Easing |
|---|---|---|---|
| 0 | **X** grows from `scale(0.36) translateY(10px)` to rest; opacity 0 to 1 over the first 160 | 600 | letter spring |
| 200 | **2**, the same | 600 | letter spring |
| 400 | **F**, the same | 600 | letter spring |
| 660 | **The dot** drops 34 px and scales 0.55 to 1. It lands last. | 700 | dot spring |
| 850 | A thin `--monero` ring leaves the dot: scale 1 to 2.3, opacity 0.55 to 0 | 620 | `--ease-out` |
| 1360 to 2560 | **Hold**: the full logo, still | 1200 | |
| 2560 | **Settle back**: each layer goes to `scale(0.86)` and opacity 0, 50 ms apart (X first) | 420 | `cubic-bezier(0.5, 0, 0.75, 0)` |
| 3130 to 3610 | Rest on the empty hero, then the loop starts again | 480 | |

- The text and buttons rise in once and do not loop: the welcome block at 1250 ms, the buttons at 1400 and the links at 1520. Each takes 520 ms (opacity, plus translateY 8 to 0).
- The loop stops once the person leaves the screen (Take the tour, Skip and get started).
- **Production:** pause the loop on `visibilitychange`. Stop it after about 30 s on the screen, resting on the full logo (WCAG 2.2.2: moving content that lasts more than 5 s needs a pause; this auto-stop is the simplest one). **OPEN:** the owner asked for "repeats". Design suggests stopping after 30 s; the owner should confirm.

**Reduced motion:** the full logo, faded in over 600 ms, with no loop. Text and buttons fade in with no rise.

## 3. First-trade tour: the shell (READY)

These parts are the TourShell board's, kept as they were, except where noted.

- **Scrim:** `--scrim` over everything, with an SVG mask hole: radius 14, padded 6 px round the target.
- **Ring:** 2 px `--ink` on the hole. On **stop 1 only**, a second ring breathes outward: scale 1 to 1.06 / 1.22, opacity 0.55 to 0, every 1.8 s, with `--ease-io`.
- **Arrow:** a quadratic curve, 2.5 px `--ink`, round caps and joins, with an open chevron head (9 × 14). Its end tangent is aimed straight at the target, so the head always points in. It is drawn with `stroke-dashoffset` over 320 ms `--ease-out`, and the head fades in once the line arrives.
- **Card:** `--surface`, 1 px `--line` border, radius 16, padding 20, gap 12. Inside, top to bottom:
  - page bars, one per screen: Find a trade, Offers, Quote, Fund, Check and release, Done;
  - the step count, mono 14 `--ink-muted`, reading "**n of 17**";
  - the body, 17/26.

  On the centred stops (5 and 17) the card also gets a 56 px `--escrow` icon tile, and the body is centred.

  There is **no title.** The 17 card texts are short narration and are kept exactly as signed off. A title would add words that are not in the copy.
- **Buttons:** Skip tour (text), Back (secondary; off on stop 1), Next (primary, at least 112 wide; it reads **Done** on stop 17). Done and Skip tour both close the tour.
- **Keys:** → means Next, ← means Back, Esc means Skip tour. Focus moves into the card at each stop. When the person is using the keyboard, it goes to Next.
- **Short screens** (720 tall or less): card padding 16, body 16/24, and the QR at 160 px.

**Placement rules**, so a card never covers the highlight and never clips:
1. **Phone, folded, and unfolded portrait:** the card is the column's width less 32, at most 448. It goes **below** the highlight if it fits with a 60 px arrow gap and 12 px to spare at the bottom. If not, it goes **above**.
2. If neither fits, the screen **scrolls** first (480 ms, ease-in-out cubic): to put the highlight near the top with the card below it, or near the footer with the card above it. Sticky footers (the Request and Release buttons) never scroll; their card goes above.
3. **Unfolded landscape (or any screen 860+ wide with room):** the column slides left and the card sits **to the right** of the highlight. The card is 300 to 360 wide, 40 px past the column's content, and vertically centred on the highlight within the screen. The arrow then runs sideways.
4. When the highlight moves during an action (the currency menu opens, the focus moves from the amount to what you receive, from the status card to the tick box), the card moves with it, using the same rules.

## 4. First-trade tour: motion (READY)

**Each Next** (t in ms):

| t | Event | Duration | Easing |
|---|---|---|---|
| 0 | Arrow fades out | 110 | `--ease-in` |
| 0 | Highlight (hole and ring) fades out. The scrim stays. | 90 | `--ease-in` |
| 0 | Card text fades out, −4 px | 110 | `--ease-in` |
| 120 | Any half-played action snaps to its end state. If the stop is on a new screen, that screen **pushes in**: the new one 28 px from the right plus opacity, the old one 16 px to the left (Back reverses it). | 300 | `--ease-out` |
| +0 | The screen scrolls, if placement needs it | 480 | ease-in-out |
| +0 | The card moves to its place (transform) | 340 | `--ease-out` |
| +40 | The new text comes in, from +6 px | 200 / 240 | `--ease-out` |
| +60 | Highlight fades in at the target | 120 | `--ease-out` |
| +140 | Arrow draws | 320 | `--ease-out` |
| +440 | Arrowhead fades in | 120 | ease-out |
| +700 to +1100 | **The action plays** (§5), after the text, so the card says it first and then the app does it | | |

**Action pieces:**
- **Tap ripple:** an `--ink` disc at the tap point. Scale 0.25 to 1.35, opacity 0.26 to 0.14 to 0, over 440 ms `--ease-out`. The tapped element dips to `scale(0.98)` for 120 ms.
- **Selection fill:** a selected pill, chip or row fills to `--surface-raised` and gains its 2 px `--ink` border, over a **150 ms** colour transition. A row's chevron swaps to a tick (opacity, plus scale 0.6 to 1, 200 ms).
- **Highlight moves within a stop:** the hole tweens its rect over 240 to 260 ms (ease-out cubic).
- **Highlight alternation (stop 1):** the hole fades out over 90 ms, moves, then fades in over 120 ms, between Buy and Sell, every 1.3 s until Next.
- **Typing:** one character every 90 ms (180 ms for the first). The field shows a focus ring and a caret, and what you receive updates live with each character.
- **Press and hold:** a pressed disc stays under the finger (scale 0.3 to 1.15, 300 ms). The fill grows left to right over 1500 ms (linear, `scaleX`), and the label reads "Keep holding…". Then the button turns `--escrow`: "Released 0.594354 XMR to satoshi_ghost".
- **State swaps on cards** (escrow funded, payment sent): the old content fades out and up 6 px while the new content comes in from +6 px (260 / 300 ms). The card's tint crossfades over 400 ms, and the stepper bar grows over 600 ms.
- **QR scan:** a 2 px `--monero` line with a soft glow sweeps the code once, over 1500 ms `--ease-io`.

## 5. What each stop does (READY)

See `tour-stops.md` §2 for the targets and copy. Actions in order:

| Stop | Screen | Action after the text |
|---|---|---|
| 1 | Find a trade (Buy) | The highlight fades back and forth between Buy and Sell, with the breathing ring. |
| 2 | Find a trade | Tap Sell. Sell fills, and the heading swaps to "How do you want to be paid?". |
| 3 | Find a trade | Tap the currency button. The menu opens and the highlight grows to cover it. Tap USD: it fills. The menu closes, the price swaps €306.10 → $329.90 and the method list swaps to the USD methods. The highlight shrinks back. |
| 4 | Find a trade | Tap Cash App. The row fills and the chevron becomes a tick. |
| 5 | Find a trade | No highlight. A centred card with an eye-off tile. |
| 6 | Offers (push) | The highlight is on the header, "Sell XMR via Cash App". |
| 7–9 | Offers | The highlight steps to the badges, then the % figure, then the limits. |
| 10 | Offers | Tap the first offer card. It presses and stays tinted. |
| 11 | Quote (push) | Tap the field and type 0.594354. You receive counts to $200.00. Then the highlight moves to the "You receive" card. |
| 12 | Quote | Tap Request to sell XMR. It reads "Request sent" with three pulsing dots. After 1.3 s it turns `--escrow`: "Trade started", "satoshi_ghost accepted. The trade has started." |
| 13 | Fund (push) | Scroll to the QR and its address and amount. The scan line sweeps. |
| 14 | Fund | Scroll back up. The status card turns from caution "Waiting for you to fund" (with its timer) to escrow "Locked in escrow · 0.594354 XMR", and the first stepper bar fills. |
| 15 | Check and release (push) | The status card swaps from "Waiting for satoshi_ghost to pay" to "Payment sent". The highlight moves to the tick box, which gets ticked, and the release button unlocks. |
| 16 | Check and release | Press and hold release (1.5 s). It becomes "Released". |
| 17 | Released, rate the trade (push) | A centred card with a tick tile and Done. |

The amounts all agree: market price $329.90; satoshi_ghost pays 2% above it, $336.50; $50 to $1,000 is ≈ 0.148588 to 2.971768 XMR; $200.00 is 0.594354 XMR. Every screen carries the **Example** marker, as ruled.

## 6. Responsive and foldable (READY)

Checked at deviceScaleFactor 2 for 443 × 794 and 390 × 844, and at 3 for the iPhone Duo's third-party estimates:
- **Folded, 466 × 678:** the hero shrinks, so the letters, the welcome text and both buttons fit with no scrolling. ~~The four links hide (under 760 tall).~~ Owner note #47, confirmed 26 Nov: the spacing compacts and the four links stay. Tour cards use the short-screen sizes, and every stop places without covering its highlight.
- **Unfolded portrait, 626 × 890:** a centred 480 column. The cards are 448 wide, not edge to edge.
- **Unfolded landscape, 890 × 626:** the intro is the centred column. In the tour, the column slides left and the cards sit beside each highlight (§3, rule 3).

## 7. Reduced motion (READY)

This applies under `prefers-reduced-motion: reduce`, or `?rm=1`. There is no movement, only fades:
- **Intro:** the full logo fades in over 600 ms. There is no loop and no rise.
- **Screen pushes:** crossfades only.
- **Arrow:** shown fully drawn, faded in. The ring does not breathe.
- **Ripples:** a short opacity flash with no scale. Typing and scrolls are instant, and waits are capped at 400 ms.
- **Card:** fades in place.
- **Hold to release:** the fill still shows progress, since it tells the person something.

## 8. Production notes

- Build the letters as one `<X2FMark animated>` component: four absolutely placed inline SVG layers, driven by WAAPI. The tour is the TourShell component plus a small script per stop (target, optional highlight moves, action).
- Keep using transform and opacity only. The hole rect and the arrow are SVG attributes, updated per frame only while they move.
- `linear()` easing: Chrome 113+, Safari 17.2+, Firefox 112+. The fallback is `--ease-out`.
- Pause everything on `visibilitychange`.

## 9. Decisions and open items

- **Decided (owner, 12 Nov):** no isometric style. The intro is X2F's own letters. The trader tour is only "how to do your first trade".
- **Open:** loop forever, or stop after about 30 s (§2)? Design suggests stopping after about 30 s, for WCAG 2.2.2.
- **Open:** owner sign-off of the COPY-UNSIGNED strings. These are the intro line, plus the mock-screen strings the tour adds:
  - "Locked in escrow";
  - "satoshi_ghost has been told to pay you.";
  - "Waiting for satoshi_ghost to pay";
  - "You'll get an alert when they tap I've paid.";
  - "I checked my Cash App myself and the $200.00 is there.";
  - "Only your Cash App shows whether the money arrived.";
  - "Request sent";
  - "Trade started";
  - "satoshi_ghost accepted. The trade has started.".
