X2F is a private, peer-to-peer way to trade Monero for cash. The interface stays calm and exact, because people are moving real money with strangers. Every screen answers three questions at a glance: where is my money, what happens next, and how long do I have.

## Content fundamentals

- Write plainly and in second person: "Send the payment, then tap I've paid."
- Name what people recognise, never the machinery. Say "escrow", "Fund" and "Release". Never say "multisig", "key image" or "partial signature" in the UI.
- Buttons state exactly what happens: **Fund 1.25 XMR**, **I've paid**, **Release 1.25 XMR to mira.k**. After an action, confirm it in past tense ("Escrow funded").
- Show every amount twice: the XMR amount in `amount` (6 decimals) and the fiat total beside it in `ink-muted`.
- Times are countdowns, never clock times: "62 min left to pay".
- No emoji, no exclamation marks, no hype. Warnings say what to do: "Check your bank app before you release. Screenshots can be faked."
- Privacy copy is matter-of-fact: "We don't ask for ID. We never see your coins."

## Visual foundations

**Colour.** Night is the primary theme; Day mirrors it. Build screens on `ground`, with content on `surface` and inputs and chat bubbles on `surface-raised`.
- `monero` orange is reserved for the brand and for the single primary action on each screen, with `on-monero` text. Two orange buttons on one screen means one of them is wrong.
- Orange text uses `monero-ink`.
- **State colours always come with a word and an icon**, so nothing depends on colour alone:
  - `caution`: waiting (Securing escrow, Awaiting payment, Awaiting confirmation)
  - `escrow`: protected and done (Escrow secured, Releasable, Released)
  - `danger`: disputes and scam warnings

**Type.**
- `display` and `title` use Familjen Grotesk.
- Running text uses Atkinson Hyperlegible Next.
- Every number, address and fingerprint uses Atkinson Hyperlegible Mono with tabular figures. That face keeps 0/O and 1/l/I distinct, which matters when people compare addresses.
- Body text is never smaller than 16px on phones.

**Spacing and shape.**
- Use the 4/8/16/24 scale: `space-1`, `space-2`, `space-4`, `space-6`.
- The phone side gutter is `space-4`.
- Cards and primary buttons use `radius-md`, inputs use `radius-sm`, and status chips and timers use `radius-pill`.
- Use no shadows. Separate surfaces by tone, and use `line` where an edge must read.

**Focus and states.**
- Focus is a solid 2px `ink` ring with a 2px offset, so it holds 3:1 on every surface.
- Disabled controls drop to `ink-muted` text and keep their outline.
- Motion is limited to the escrow timeline advancing and countdowns ticking, and is off under reduced motion.

**The 2-of-3 motif.** Three dots with two filled stand for the escrow: any two of buyer, seller and moderator can move the coins. Use it for escrow status and loading states, never as decoration.

## Iconography

- Use Lucide icons at a 1.5px stroke, 20px in lists and 24px in the trade room, coloured with the state token of their context.
- No emoji.
- There is no logo yet. Set the name "X2F" in `display` until one exists.
