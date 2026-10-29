# UI kit

Shared components for the X2F web app, built to match the X2F App boards (`design/x2f-app/`).
Colours come only from the design tokens (`design/design-system/tokens.json`, generated into
`src/theme/tokens.css` by `npm run tokens`).

## Lead decisions

These are lead choices. The owner may adjust any of them.

- **Sheet backdrop.** The backdrop behind a `Sheet` is the `ground` colour at 80% opacity.
- **Countdown format.** `Countdown` keeps the kit's `minutes` format ("1 h 52 min",
  "14 min"). The phone boards win; the Desktop board's "62 min left" is out of date.
- **Day values of the new tokens.** The day values of `moderator`, `monero-ink-hover` and
  `monero-hold` are the lead's choice:

  | Token              | Day value | Contrast (day)                                                             |
  | ------------------ | --------- | -------------------------------------------------------------------------- |
  | `moderator`        | `#6741d9` | 5.82:1 on ground, 6.30:1 on surface                                        |
  | `monero-ink-hover` | `#9c3f00` | 6.22:1 on ground, 6.72:1 on surface; darker than `monero-ink` so hover shows |
  | `monero-hold`      | `#f7a47a` | `on-monero` text on it reads 9.51:1                                         |

## Board references (parity)

`expectParity` (`apps/web/e2e/parity.ts`) compares each screen with `design/x2f-app/refs/<Board>.png`; `refs/manifest.json` records the board file each one was shot from, and a unit test fails when a board changes after its reference was shot. To recapture: fetch the canvas runtime `support.js` from the X2F App canvas into `design/x2f-app/` (a controller step; it is gitignored), then run `X2F_CHROMIUM_PATH=/usr/bin/chromium npx tsx tools/parity/capture-refs.ts <Board> …` (no names: every board) and commit the PNGs with `manifest.json`.
