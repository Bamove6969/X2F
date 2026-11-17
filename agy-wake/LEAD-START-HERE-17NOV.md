# lead: start here (17 Nov, from claude3)

Read this first. Three parts: (A) what changed while you were out, (B) your own
Jetpost account, (C) your Jetpost wake through Tailscale (owner's order).

## A. What changed

- **Chat is in the Jetpost X2F Team Room**, the permanent record stays on comms.
  Start messages with "lead:". agy (account bamove+agy) and claude2 (bnkxfers)
  are in the room too.
- **agy:** claude3 is its only manager (WHO-DOES-WHAT.md, owner's order). Its
  orders are AGY-ORDERS*.md and to-agy.log. Reviews are in
  review-agy-*-2026-11-1{6,7}.md.
  - **Approve:** setup-flow.
  - **Approve with minors:** landing and recovery-copy.
  - **Changes needed:** layout, unsigned-copy, demo-docs and terms-questions.
  - **Pattern:** solid builder, but it follows a note's literal words over
    recorded rulings. agy is out of tokens now.
- **Demo round 3, wip/third-demo-r3 @94337781, is green and with the owner.**
  - Results: 7,304 vitest and 574 Playwright passed.
  - Known leftovers: serve-boards (design's support.js) and semgrep (semgrep.dev
    blocked here).
  - It contains claude2's fonts, sign-up v2, security-key and notes-continuity
    work.
  - Two tests were aligned with those changes:
    - webauthn "review M1": one trader per key;
    - post.spec unit weight: DM Mono's maximum is 500.
- **Owner decisions since 13 Nov:**
  - Fee split at release. Each receiver pays its own payout network fee; never
    say "half".
  - Books: a "Monero network fees paid to date" column and a net total.
  - Liens:
    - evidence before enforcement;
    - partial recovery, with the remainder carried forward;
    - no double compensation;
    - the debtor keeps trading, with 50% of proceeds recovered by default;
    - a moderator's change of the % needs a reason and a senior moderator's
      approval.
  - TOTP as the only 2FA needs username + display name + password. There is no
    passkey-only.
  - PGPony is the Android recommendation and need not be first.

  All of these are recorded in to-lead.log.
- **Waiting on the owner:**
  - agy-landing's three reversals;
  - security-key art (4 generic outlines vs illustrations of real keys);
  - help links on /session-length;
  - the six Terms questions (being corrected by agy first).
- **Please ack in the Team Room:** "lead: read LEAD-START-HERE".

## B. Your own Jetpost account (do this before C)

Jetpost wakes one address per account's agent. If your Jetpost login is the
owner's (your messages show as "Jesse Fleming's agent"), setting a wake would
take claude3's away. So:

1. Ask the owner to create a Jetpost account for you with the address
   `bamove+lead@gmail.com`, using **email sign-up, not "Sign in with Google"**
   (Google merges + addresses into his own account). Then add it to the
   jesse-fleming workspace and share the Team Room with it.
2. Reconnect your Jetpost connector with that account, then check `whoami`.

If your login already shows a name of its own, skip B.

## C. Jetpost wake through Tailscale

Follow part B of `agy-wake/CLAUDE2-START-HERE-17NOV.md` exactly, with:
- hostname `x2f-lead`;
- address `https://x2f-lead.tail8d8abc.ts.net/jetpost`.

Your cloud environment needs the same allowed hosts listed there. Post
"lead: wake ready" when done.
