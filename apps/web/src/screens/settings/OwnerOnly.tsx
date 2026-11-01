/**
 * Plan 2 Task 18 (review e2e area 5): what a team member sees on a screen that is the account
 * owner's alone (payout wallets, Settings → Security): CantDoThat with `owner-only`, never a blank
 * or broken screen. The API refuses every call on these screens anyway (403 `owner-only`).
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { memberOf } from '../../session/member.js';
import { useSession } from '../../session/useSession.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE, teamCantDoText } from '../../ui/cantDoCodes.js';

/** Renders `children` for everyone but a team member, who gets the owner-only refusal. */
export function OwnerOnly({ screen, children }: { screen: string; children: ReactNode }) {
  const session = useSession();
  const navigate = useNavigate();
  if (memberOf(session) === null) return <>{children}</>;
  return (
    <main className="x2f-screen" data-screen={screen} data-owner-only="">
      <CantDoThat title={CANT_DO_TITLE.team} body={teamCantDoText('owner-only')} from="owner-only" onClose={() => void navigate('/sell')} />
    </main>
  );
}
