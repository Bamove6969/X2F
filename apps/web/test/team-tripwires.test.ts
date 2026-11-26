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

  it('Task 42 escrow-key sync: the keys are copied end to end; the API lets a Release coins member release, and the member device is not wired to sign yet (owner question trades-release)', () => {
    // Owner question trades-release (26 Nov 2026, pending his final yes): the API side landed. A
    // member the lead gives Release coins together with Hold trade keys (team/abilities.ts
    // ABILITY_REQUIRES) may send release-started with a `release-trade` confirm token from a
    // passkey, security key or PGP key, logged under the member's name. The member's DEVICE is not
    // wired yet: MemberRoom still runs no escrow and imports no synced copy. Next step: a member
    // device restores its copy (keySync.ts restoreTrades with the member's reader key) into an
    // escrow store, and the member's room gets the seller's release (press-and-hold, then
    // withConfirm(release-trade), then release-started with the token, then escrow.release()).
    // When that lands (escrow/memberKey.ts or MemberRoom running the escrow), change this check.
    const confirm = readFileSync(`${ROOT}packages/accounts/src/confirmAction.ts`, 'utf8');
    expect(confirm).toMatch(/STRONG_ONLY_ACTIONS[^=]*= \[[^\]]*'release-trade'/);
    expect(readFileSync(`${ROOT}apps/api/src/team/perms.ts`, 'utf8')).toMatch(/MEMBER_SIGNING_EVENTS_LIST: readonly string\[\] = \['fund-started'\]/);
    // NEEDS_PLAN3_TASK42_MEMBER_KEY is retired by the escrow-key sync (apps/web/src/escrow/keySync.ts,
    // API escrowSync/routes.ts, migration 860): the holder's escrow worker keeps an end-to-end
    // encrypted server copy of each trade's keys for itself and the members it assigned ("Hold trade
    // keys"), and a new device of the holder restores them after a passkey/security-key PRF or PGP
    // unlock. Until the member device is wired (above): an assigned member's device holds a copy to
    // read, never imports it into an escrow store, and never runs the escrow (MemberRoom). The API's
    // member-cannot-sign stays for funding, taking, accepting and the trade identity.
    expect(existsSync(`${ROOT}apps/web/src/escrow/keySync.ts`)).toBe(true);
    expect(readFileSync(`${ROOT}apps/web/src/escrow/worker.ts`, 'utf8')).toMatch(/withKeySync\(await openEscrowStore\(\), httpKeySyncApi\(\)\)/);
    expect(readFileSync(`${ROOT}apps/web/src/screens/trade/TradeRoom.tsx`, 'utf8')).toMatch(/if \(memberOf\(session\) !== null\) return <MemberRoom/);
    expect(existsSync(`${ROOT}apps/web/src/escrow/memberKey.ts`), 'member signing landed: wire it in and change this check').toBe(false);
  });
});
