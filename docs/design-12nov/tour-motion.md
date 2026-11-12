# Landing intro and tour: isometric motion language (12 Nov)

Worker T1 "tour-art". Covers the owner's 12 Nov notes: he wants the tour "like it was made in Flash or HTML5", and he wants the Trust Wallet *quality* (real 3D depth, smooth building and morphing, polish) but **not** their look. Everything here uses X2F's own motifs, THEMES colours and type. None of their layouts, gradients or slide structure is reused.

- **Prototype (READY):** `S/w13/tour-art/x2f-intro-prototype.html`. It is one file, about 46 KB raw and 13 KB gzipped, with no libraries and no network requests. It runs in a 443 x 794 phone frame and has light and dark themes plus reduced motion.
- **Frames:** `S/w13/tour-art/frames/`. Start with the contact sheets: `contact-intro-night.png`, `contact-tour-night.png` and `contact-day-and-reduced-motion.png`. The single frames are named `<theme>[-rm]-<scene or stop>-<ms or rest>.png`.
- **Re-render:** `node S/w13/tour-art/cap.js '<json>'` (Playwright). URL params: `?theme=night|day`, `?rm=1`, `?view=tour&stop=N`, `?still=1`, `?bare=1`.

Status for each item: **READY** means drawn, built and checked in frames. **OPEN** means it needs a decision.

---

## 1. The language (READY)

**Shapes.** Every object is an axis-aligned box: a top face and two visible sides. Boxes never rotate. They only change position, size and tone, which is what makes "build, morph, rearrange" read as one material. There are two exceptions:
- the **shield**, a plane extruded by stacking 15 layers;
- **decals**, which are stroke icons printed on a top face or front face.

**Camera.** True-ish isometric: `rotateX(56–60deg) rotateZ(40–50deg)` under `perspective: 1500px`. The camera orbits a few degrees per scene, so the depth reads as real and not as flat 2.5D.

**Light** comes from the top-left and is fixed. Each face is shaded from THEMES tokens only:

| Face | Night | Day |
|---|---|---|
| Top | `color-mix(tone, --ink 24%)`, a 1px lighter rim, and a 135deg sheen | `color-mix(tone, --surface 30%)` |
| Left (front) side | `tone`, falling to `color-mix(tone, --ground 22%)` at the base | the same, with `--ink` as the dark mixer |
| Right side | `color-mix(tone, --ground 46%)`, darker toward the base | `color-mix(tone, --ink 30%)` |
| Contact shadow | `--scrim`, blurred 3px when resting. Lifted objects get a wider, fainter shadow that is offset away from the light. | the same |

The page CSS sets `--iso-hi` and `--iso-lo` for each theme: night uses `--ink` / `--ground`, day uses `--surface` / `--ink`. That is why both themes come from the same scene data.

**Tones mean things.** They are never decoration:

| Tone | Means |
|---|---|
| `--team` | you, a trader |
| `--mod` | the other trader |
| `--monero` | XMR coin tiles. This is the illustration's only orange, and it never sits next to the orange button. |
| `--escrow` | the vault, the keys that agree, and the shield |
| `--line` | X2F's resting key |
| `--surface-raised` | the stage slab |
| `--ink-muted` | cash or a bank note |

**Layers, back to front:**
1. A dotted floor grid (parallax: it drifts on a slower, longer curve than the objects).
2. The stage slab.
3. The objects.
4. Fixed DOM text and buttons, which never move with the art.

**Design-system exceptions inside the illustration only (OPEN, head designer to confirm).** v2 §3 and Don't ban drop shadows and gradients outside the hero wash. The iso art needs face gradients and soft contact shadows to get the depth the owner asked for. I propose allowing them **inside `.illus` and the tour card's mini tile only**. UI chrome stays shadow-free.

## 2. Landing intro scenes (READY)

Layout, 443 x 794:
- header 56: logo top-left and the screen name "Welcome";
- illustration y 56 to 434;
- headline at y 440: Familjen 30/36 700;
- line: 17/24 `--ink-muted`, at most 2 lines;
- dots at y 560;
- primary "Take the tour" 56h at y 600;
- secondary "Skip and get started" 48h;
- tab bar 64 at the bottom, shown "as if they had dived in".

All words below are **COPY-UNSIGNED**.

| # | Headline | Line | Shapes (pool slot: what it does) |
|---|---|---|---|
| 1 | Welcome to X2F | Swap Monero for cash, bank transfers or gift cards, person to person. | The slab builds. A blue trader block (person decal) stands at the left and a violet one at the right. Two coin tiles are stacked in the middle and a third hangs in mid-air between them, being handed over. A grey cash note lies in front. |
| 2 | Escrow holds the coins | The seller's coins are locked before you pay, so nobody can run off with them. | The coins sink into the centre while 8 teal cubes build a 2x2x2 vault around them, one by one, with a lock decal on the front. The traders shrink and step out to the left and right corners. The camera turns to the right. |
| 3 | Two of three keys | You, the other trader and X2F each hold a key. It takes any two to move the coins. | The traders morph into key pillars: a blue key pillar and a violet key pillar, both with filled key decals and 70 tall. The third pillar is short and grey with an outline key: X2F's key, resting. The vault shrinks and slides back. |
| 4 | Private from the start | No email and no IP addresses logged. Alerts reach you on Jabber. | The key pillars sink away. The vault re-forms as a 3x2 wall at the back. A teal shield (eye-off glyph) rises and scales up in front of it, with a soft shadow on the slab. The traders come back small, behind the shield. |

Scene 3 echoes the 2-of-3 meaning without using the key mark itself, which v2 §1 says is never animated.

## 3. Intro motion: every duration, easing and order (READY)

Curves:
- `--ease-out` = `cubic-bezier(0.22, 1, 0.36, 1)` (out-quint: morph, settle)
- `--ease-in` = `cubic-bezier(0.4, 0, 1, 1)` (leave)
- `--ease-io` = `cubic-bezier(0.65, 0, 0.35, 1)` (camera, floor)

| What | Duration | Easing | Order and delay |
|---|---|---|---|
| First build (on arrival) | 1000ms | ease-out | Boxes grow from height 0 and drop 40px, staggered **70ms** in pool order: slab, then trader A, trader B, coins, then cash. Done at about 1.4s. |
| Box morph (position, size) | 760ms | ease-out | Staggered **45ms** across the boxes that stay or arrive, in pool order (slab first, then traders, coins, vault cubes, keys) |
| Box leaving | 760ms height to 0 | ease-in | No stagger: everything leaving goes at t=0 |
| Box opacity | 320ms | ease-out | Same delay as its morph |
| Box tone change | 600ms | ease-out | Same delay as its morph |
| Decal swap | out 160ms (opacity, scale to 0.6); in 240ms opacity + 360ms scale to 1 | ease-out | The new decal goes in at t=160 |
| Camera orbit | 1100ms | ease-io | t=0 |
| Floor parallax drift | 1400ms | ease-io | t=0. It is slower than the objects, which gives the depth. |
| Shield rise | 900ms (scale 0 to 1, rise 40px) | ease-out | t=0 |
| Text out | 160ms opacity + translateY(-6px) | ease-in | t=0 |
| Text in | 280ms opacity + translateY(+10px to 0) | ease-out | Swap at t=160, in from t=280 |
| Dots | 240ms (width 8 to 24, colour `--line` to `--ink`) | ease-out | t=0 |

**Paging:**
- The intro auto-advances every **4200ms**, once through, and **rests on scene 4**. Nothing loops.
- Any tap on a dot, a swipe (40px or more), or a button stops auto-advance for good.
- Auto-advance is off under reduced motion (WCAG 2.2.2).

## 4. Tour overlay (READY shell; the stops are a demo)

**Parts:**
- **Scrim:** full-screen `--scrim`.
- **Cut-out:** an SVG mask. The hole is a rounded rect with radius 14, padded 6px around the target.
- **Ring:** a 2px `--ink` stroke on the hole.
- **Arrow:** a quadratic curve, 2.5px `--ink`, round caps, plus a chevron head.
- **Card:** `--surface`, 1px `--line` border, radius 16, padding 16. It contains:
  - a 72px mini iso tile (`--surface-raised`, radius 12);
  - a meta line, 13/16 muted, with mono digits: "Trade · 1 of 4";
  - a title, Familjen 19/24 600;
  - the body, 16/23;
  - "Skip tour" (tertiary) on the left and the primary button (48h, min 132) on the right. The primary reads **"Next"**, then **"Next screen"** on a page's last stop, then **"Done"** on the final stop.

**Placement:**
- The card goes below the target when the target sits in the top 45% of the screen and the card fits there. Otherwise it goes above.
- The gap is 64px for the arrow.
- The arrow starts from the card edge, 70px off the target's centre on the side away from the edge, and bends outward.

**Keys and focus:**
- Esc means Skip tour.
- Focus moves to the primary after each stop.
- The overlay is `role="dialog" aria-modal`.

**Motion order per "Next"** (t in ms; this is what the owner described: "arrows fade in and out, highlighted areas fade quickly in and quickly out"):

| t | Event | Duration | Easing |
|---|---|---|---|
| 0 | Arrow fades out | 120 | ease-in |
| 0 | Highlight (hole + ring) fades out. The scrim stays. | **90** | ease-in |
| 0 | Card text fades out, -4px | 120 | ease-in |
| 0 | Mini iso object morphs to the next stop's shape | 760, stagger 40 | ease-out |
| 130 | Text swaps. The card slides to its new place if it has to switch sides. | top 320 | ease-out |
| 190 | Card text fades in | 200 | ease-out |
| 190 | Highlight fades in at the new target | **120** | ease-out |
| 270 | Arrow fades in, and draws from card to target with stroke-dashoffset L to 0 | fade 120, draw **280** | ease-out |
| 510 | Arrowhead fades in | 100 | ease-out |

A stop settles at about **610ms**.

- **"Next screen"** adds a crossfade to the next screen (260ms) after the out-phase, then the same in-sequence.
- **Start:** the tour view crossfades in over 260ms, the scrim fades in over 200ms, the card fades in, then the highlight and the arrow follow as above.
- **Skip / Done / Esc:** arrow and highlight out as above, card fades out over 200ms, scrim fades out over 200ms.

**Mini iso object for each stop.** This is the demo; the same mapping applies to every tour:
- logo / home: a stepped block stack and a coin;
- Buy or sell: two trader blocks;
- offer: a trader pair and a coin stack;
- post: an orange plus slab;
- wallet: a teal tray with coins;
- profile: a single person block.

Staff and team tours reuse the shell. They swap the tones to `--mod` (staff) and `--team` (members), and use a gavel or ID-card block motif in place of the coin.

**Demo stops in the prototype.** These are **COPY-UNSIGNED**, and they are a demo of the shell, not the final stop list. The stop lists per page and role belong to the tour spec.

| Stop | Title | Body | Button |
|---|---|---|---|
| Trade 1/4, logo | Your home base | Tap the logo on any screen to come back to Trade. | Next |
| Trade 2/4, Buy/Sell switch | Buy or sell | Switch between buying and selling Monero. The list below changes to match. | Next |
| Trade 3/4, first offer row | Pick an offer | Check the price, the limits and the trader's feedback. Starting a trade is always free. | Next |
| Trade 4/4, Post offer tab | Post your own offer | Set your price and how you get paid. You only pay a fee when you post an offer. | Next screen |
| Wallets 1/2, wallet card | Your wallets | Add the Monero wallet you send from and receive to. Coins from a trade land here. | Next |
| Wallets 2/2, Profile tab | Your profile | Your feedback, badges and settings live here. | Done |

Other COPY-UNSIGNED strings: "Welcome" (the screen name), "Skip tour", "Next screen", "Done".

## 5. Reduced motion (READY)

This applies under `prefers-reduced-motion: reduce`, or `?rm=1` in the prototype. There is no movement, only crossfades:
- **Illustration:** the whole picture fades out (200ms), the new layout is applied instantly, then it fades in (200ms). There is no build, no camera orbit and no parallax. The shield appears in place.
- **Text:** opacity only, keeping the same 160 / 280ms timings.
- **Decals:** opacity only.
- **Tour highlight:** keeps its 90ms out and 120ms in fades, which are opacity only.
- **Arrow:** appears fully drawn with a 120ms fade. There is no draw.
- **Card:** opacity only. It jumps to its new place; it does not slide.
- **Mini iso:** crossfades.
- **Paging:** auto-advance is off.

See `frames/night-rm-s2-0100.png`, `-0300.png` and `-rest.png`.

## 6. Production tech recommendation (READY): CSS 3D

**Recommendation: build it as a small React component (`<IsoStage scenes={…}>`) with CSS 3D transforms and registered custom properties, exactly as the prototype does.**

| | CSS 3D (the prototype) | Rive | Lottie |
|---|---|---|---|
| Runtime size, self-hosted | **0 KB library**. The engine is about 4 KB and the scene data about 1 KB per scene. | About 150 KB WASM + JS runtime, plus a .riv per scene (small) | lottie-web about 250 KB min (about 60–70 KB gz, light build), plus 20–100 KB JSON per scene |
| Real 3D depth | Yes: a true perspective camera, live orbit and parallax | Drawn 2.5D; depth is faked in the tool | Pre-rendered 2.5D vectors from After Effects |
| Light/dark from THEMES | Free: faces are `color-mix()` of tokens | Needs data-bound colours or two files | Needs colour slots or two files |
| Reduced motion | Trivial: the same data, crossfaded | A separate state or a still | Show a still frame |
| Text and buttons | Real DOM, accessible, translatable | Real DOM beside the canvas | Real DOM beside the canvas |
| Authoring | Scene = a data array (boxes, tones, decals). Engineers and designers can edit it in review. | Rive editor, skilled animator | After Effects + Bodymovin, skilled animator |
| Best at | Geometric block worlds (our motif) | Characters, mesh deformation, state machines | Illustrative, frame-by-frame vector art |

**Why CSS 3D:**
- The prototype shows the owner's quality bar is reachable with zero dependencies: real depth, staggered build and morph, camera orbit, contact shadows, and both themes.
- It shares the tour shell's DOM and tokens.
- No CDN, no WASM, nothing to self-host beyond our own code.

Rive is the fallback if the owner later wants characters or organic motion. Rive is preferred over Lottie, since its state machine maps to tour steps.

**Production notes:**
- `@property` needs Chrome 85+, Safari 16.4+ or Firefox 128+. Where it is missing, snap to the new layout with the reduced-motion crossfade, which is still acceptable.
- Animating custom properties runs on the main thread. Keep 20 boxes or fewer per stage, and profile on a mid-range Android.
  - If it janks, switch each box to a unit cube with `transform: translate3d() scale3d()`, which is compositor-only. That costs non-uniformly scaled decals, so move the decals to separate planes.
- Replace the `filter: blur()` contact shadows with a pre-blurred `radial-gradient`. That is cheaper on mobile GPUs.
- Keep boxes non-intersecting. Safari's 3D depth sorting misorders planes that intersect. Test on iOS Safari.
- Pause the intro when the tab is hidden (`visibilitychange`).

## 7. Open questions

1. **Design-system exceptions:** confirm face gradients and contact shadows are allowed inside the iso art only (§1).
2. **Copy:** scene 4 says "No email and no IP addresses logged." Is that the owner's wording to keep, or is the Landing line's wording the one to use? It needs his sign-off with the rest of the COPY-UNSIGNED strings.
