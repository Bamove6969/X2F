# Terms open items, 26 Nov 2026 (owner walkthrough)

Not legal advice. Applied in Terms version `2026-11-26` (`apps/web/src/screens/setup/termsText.ts`):

- Review proposal 8: section 6 lists what X2F keeps (password as "a scrambled fingerprint", never the password).
- Review proposal 9: IP lines say "X2F's servers" (sections 5, 6, 7 and the key point).
- Section 9 and the sign-up intro promise "a short summary of what changed"; the Updated Terms screen shows `TERMS_CHANGES` under "What changed". Write a new summary with every version move.
- Section 1: "not a ... money services business" replaced with "never takes custody of your funds, and cannot move them on its own" until a lawyer confirms X2F's status.
- Section 6 and the key point: retention words match the code (chat and proofs purged at 30 days, disputed chats 90 days after the dispute closes, addresses deleted at 90 days, a stripped trade record stays). No scrub tool is claimed.
- Wallet screens: "X2F never takes custody of your coins."
- Demo note #161: the first wallet skips confirm-it's-you for the whole sign-up session (no 30-minute clock), still only while the account has no wallet.

## For the lawyer: is X2F an MSB (FINTRAC) or a VASP elsewhere?

- FINTRAC: an MSB offers at least one MSB service and has a place of business in Canada (https://fintrac-canafe.canada.ca/msb-esm/msb-eng); PCMLTFA s. 5(h.1) also covers foreign businesses whose services are directed at people in Canada. "Dealing in virtual currency" covers exchange and transfer services.
- Owner's position: X2F only connects traders, "akin to a dating app". Traders exchange with each other; fiat never passes through X2F; the XMR moves on the blockchain.
- Facts that bear on it: X2F holds one of three escrow keys and co-signs some moves alone (the automatic refund to the seller's recorded address when the buyer does not pay); the 1% fee is taken out of the escrowed XMR at release; moderators rule where the XMR goes in a dispute.
- Design lever if needed: charge the fee outside the escrow (as dating apps charge separately).
