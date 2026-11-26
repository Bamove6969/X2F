// TRIPWIRES for Plan 2 Task 18's web side (team members). They read the local tree only: each fails
// when what it waits for lands; then build that part and delete the check.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('Task 18 web still waits for its design and the member keys', () => {
  it('NEEDS_DESIGN_TEAM: no Team or Join-team board yet, so the screens carry no styling of their own', () => {
    // The owner's rule (2026-10-29): Claude Design owns all looks. Team.tsx (/settings/team, linked
    // from Security) and auth/MemberInvite.tsx (/team/join) use kit parts and existing classes only;
    // their words are COPY-UNSIGNED in settings/teamCopy.ts. A member's trade room (TradeRoom.tsx
    // MemberRoom, BuyerPay.tsx SellerWaitingMember; review round 2, n3) reuses the trade room's own
    // parts and classes, so it needs no board of its own. When a board lands in design/x2f-app/:
    // style both to it (the board's copy wins), place the Team entry where the board puts it (the
    // Profile tab or Settings), add expectParity at PHONE_VIEWPORTS in an e2e spec, and delete this.
    const boards = readdirSync(`${ROOT}design/x2f-app`).filter((f) => /team|member/i.test(f));
    expect(boards, 'a team board landed: build to it').toEqual([]);
    for (const f of ['apps/web/src/screens/settings/Team.tsx', 'apps/web/src/screens/settings/MyAccess.tsx', 'apps/web/src/screens/settings/MemberSessions.tsx', 'apps/web/src/screens/auth/MemberInvite.tsx']) {
      expect(readFileSync(`${ROOT}${f}`, 'utf8'), f).not.toMatch(/style=\{/);
    }
    expect(existsSync(`${ROOT}apps/web/src/screens/settings/team.css`)).toBe(false);
  });

  it('Task 42 member keys: a member acts in a trade only with the matching box, and only with the keys loaded by their own key', () => {
    // The escrow-key sync (apps/web/src/escrow/keySync.ts, API escrowSync/routes.ts, migration 860)
    // keeps an end-to-end encrypted copy of each trade's keys for the holder and the members it
    // assigned ("Hold trade keys"). Owner Jess, 26 Nov 2026 (the 'trades-release' answer): a member
    // acts in the account's trades with separate boxes, `trades-fund`, `trades-release`,
    // `trades-upload-proof` and `trades-mark-paid`, each also needing `trades-escrow-keys`; their
    // device loads the keys (escrow/memberKey.ts, unlocked with the member's own passkey, security
    // key or PGP key) and runs the escrow only for such a step. A box missing: the action is not
    // shown. Fund and release take a `fund-trade` / `release-trade` confirm. If a box is added,
    // removed or renamed, change memberActs.ts and this check together.
    expect(existsSync(`${ROOT}apps/web/src/escrow/keySync.ts`)).toBe(true);
    expect(readFileSync(`${ROOT}apps/web/src/escrow/worker.ts`, 'utf8')).toMatch(/withKeySync\(await openEscrowStore\(\), httpKeySyncApi\(\)\)/);
    const room = readFileSync(`${ROOT}apps/web/src/screens/trade/TradeRoom.tsx`, 'utf8');
    expect(room).toMatch(/if \(memberOf\(session\) !== null\) return <MemberRoom/);
    // The member's step comes from their boxes only, never from the session's roles.
    expect(room).toMatch(/const step = boxes === null \? null : memberStep\(view, acts\)/);
    expect(existsSync(`${ROOT}apps/web/src/escrow/memberKey.ts`)).toBe(true);
    const acts = readFileSync(`${ROOT}apps/web/src/screens/trade/memberActs.ts`, 'utf8');
    for (const box of ['trades-fund', 'trades-release', 'trades-upload-proof', 'trades-mark-paid']) expect(acts, box).toContain(`'${box}'`);
    // Every act needs Hold trade keys: without it, none.
    expect(acts).toMatch(/if \(!keys\) return NO_ACTS;/);
    // The release goes through the member's confirm, never the owner's bare post.
    expect(readFileSync(`${ROOT}apps/web/src/screens/trade/SellerConfirm.tsx`, 'utf8')).toMatch(/confirmedEvent\(escrowCode, 'release-trade', 'release-started', member\.prove\)/);
    // Never an authenticator code or a recovery code: the confirm sheet offers neither.
    const sheet = readFileSync(`${ROOT}apps/web/src/screens/auth/ConfirmSheet.tsx`, 'utf8');
    expect(sheet).not.toMatch(/methods\.includes\('totp'\)|methods\.includes\('recovery-codes'\)/);
  });
});
