# UI kit

Shared components for the X2F web app, built to match the X2F App boards (`design/x2f-app/`).
Colours come only from the design tokens (`design/design-system/tokens.json`, generated into
`src/theme/tokens.css` by `npm run tokens`).

## Lead decisions

These are lead choices. The owner may adjust any of them.

- **Sheet backdrop.** The backdrop behind a `Sheet` is the `scrim` token (design kit handoff 1.1).
- **Countdown format.** Timers are mono digits with body units and no colon (design kit handoff
  1.5): `clock` reads "28 min 42 s" ("59 s" under a minute, "1 h 52 min" from an hour), `minutes`
  reads "1 h 52 min" or "14 min", rounded up.
- **Day values of the new tokens.** The day values of `mod` (was `moderator`) and `monero-ink-hover` are
  the lead's choice (`monero-hold` was dropped by the head designer's ruling 16; the hold fill is an
  `on-monero` 16% overlay on the orange, lead choice, `on-monero` text on it reads about 4.8:1):

  | Token              | Day value | Contrast (day)                                                             |
  | ------------------ | --------- | -------------------------------------------------------------------------- |
  | `mod`              | `#623ece` | 6.27:1 on ground, 6.78:1 on surface                                        |
  | `monero-ink-hover` | `#9c3f00` | 6.22:1 on ground, 6.72:1 on surface; darker than `monero-ink` so hover shows |

- **Day tone tokens for chips and tags (lead default, kit review 2, 8 Nov).** A status chip or role
  tag is tone text on a 14% (16% for mod) wash of the same tone; at the kit's day values it fell
  below 4.5:1 on ground and surface-raised. The day text tokens are darkened just enough to hold
  4.5:1 on ground, surface and surface-raised, with the wash kept: `escrow` #0b7285 → #0a6677,
  `caution` #8a5a00 → #815400, `danger` #c2255c → #ae2152, `team` #2f5bd3 → #2c55c5, `mod`
  #6741d9 → #623ece. Night is unchanged. `test/kit-contrast.test.ts` computes every tone × surface.
  Design may adjust these.
- **monero-ink day** is #b34800 (was #b84a00, 4.49986:1 on surface-raised; kit review 9).

## Board references (parity)

`expectParity` (`apps/web/e2e/parity.ts`) compares each screen with `design/x2f-app/refs/<Board>.png`; `refs/manifest.json` records the board file each one was shot from, and a unit test fails when a board changes after its reference was shot. To recapture: fetch the canvas runtime `support.js` from the X2F App canvas into `design/x2f-app/` (a controller step; it is gitignored), then run `X2F_CHROMIUM_PATH=/usr/bin/chromium npx tsx tools/parity/capture-refs.ts <Board> …` (no names: every board) and commit the PNGs with `manifest.json`.
