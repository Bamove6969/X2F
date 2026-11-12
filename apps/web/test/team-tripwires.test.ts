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
    for (const f of ['apps/web/src/screens/settings/Team.tsx', 'apps/web/src/screens/auth/MemberInvite.tsx']) {
      expect(readFileSync(`${ROOT}${f}`, 'utf8'), f).not.toMatch(/style=\{/);
    }
    expect(existsSync(`${ROOT}apps/web/src/screens/settings/team.css`)).toBe(false);
  });

  it('NEEDS_PLAN3_TASK42_MEMBER_KEY: a member device never starts an escrow step until the member key scheme lands', () => {
    // The API refuses a member's release and trade identity (403 member-cannot-sign, R44); the web
    // shows it through CantDoThat (teamCantDoText). Plan 3 Task 42 owns the trade side for members
    // (chat label "<lead display name> Assistant N", owner p11-25 / S-105, from GET /v1/team and /v1/account/me `chatLabel`; proof; release with a per-member
    // key). When its key scheme lands (apps/web/src/escrow/memberKey.ts), wire the member's device
    // into the escrow there, drop the 'member-cannot-sign' words if no longer reachable, and delete this.
    expect(existsSync(`${ROOT}apps/web/src/escrow/memberKey.ts`), 'Task 42 member keys landed: wire them in').toBe(false);
  });
});
