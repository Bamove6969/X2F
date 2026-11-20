import type { KeyTapIntent, StaffRole } from '@x2f/staff';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { codeOf, decideLimits, limitRecommendations, type LimitRecommendation } from '../api.js';
import { faultText } from '../refusals.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { Button, EmptyState, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { codeText } from './modModel.js';
import '../ui/staff.css';

/**
 * Recommended limits (Plan 4 Task 26), at /disputes/limits: the account limits moderators
 * recommended, oldest first, each with its reason (staff only), for a senior moderator or the owner
 * to approve or decline with a security-key tap. Their own recommendations show without a decision
 * (the API refuses the recommender too). No board draws it: built from the kit. DESIGNER-REVIEW,
 * every sentence COPY-UNSIGNED.
 */
export const isLimitDecider = (role: StaffRole) => role === 'senior' || role === 'owner';

/** "$300 per trade" or "Hold to Starter limits". */
export function limitWhatText(r: Pick<LimitRecommendation, 'capUsd' | 'stage'>): string {
  if (r.capUsd !== null) return `Limit to $${r.capUsd.toLocaleString('en-US')} per trade`;
  return `Hold to ${r.stage === 'starter' ? 'Starter' : 'Building'} limits`;
}

const STAGE_WORDS = { starter: 'Starter', building: 'Building', graduated: 'Graduated' } as const;

export function LimitRecommendations({ role }: { role: StaffRole }) {
  const [list, setList] = useState<LimitRecommendation[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [tap, setTap] = useState<{ r: LimitRecommendation; approve: boolean } | null>(null);

  const load = async () => {
    try {
      setList((await limitRecommendations()).recommendations);
    } catch (e) {
      setFault(faultText(e, 'The recommended limits could not be loaded just now. Reload to try again.'));
    }
  };
  useEffect(() => {
    if (isLimitDecider(role)) void load();
  }, [role]);

  if (!isLimitDecider(role)) {
    return (
      <section data-screen="limit-recommendations">
        <Notice tone="caution">Only a senior moderator or the owner decides recommended limits.</Notice>
      </section>
    );
  }

  const decide = async (r: LimitRecommendation, approve: boolean, tapId: string) => {
    setFault(null);
    try {
      await decideLimits(r.accountId, r.id, { approve, tapId });
    } catch (e) {
      const code = codeOf(e);
      // not-a-refusal: someone decided it meanwhile.
      if (code === 'wrong-state') setFault('Someone already decided this recommendation.');
      else if (code === 'same-person') setFault('You recommended this, so another senior moderator or the owner decides it.');
      else setFault(faultText(e, 'The decision could not be saved just now. Try again.'));
    }
    await load();
  };

  // not-a-refusal: 'account-limit' here is the tap intent's kind, not an error code.
  const intentOf = (r: LimitRecommendation, approve: boolean): KeyTapIntent => ({ kind: 'account-limit', recId: r.id, accountId: r.accountId, approve, capUsd: r.capUsd, stage: r.stage });

  return (
    <section data-screen="limit-recommendations">
      <Link className="x2f-link" to="/disputes">
        All disputes
      </Link>
      <PageTitle title="Recommended limits">
        <p className="x2f-staff-page__lead">
          Limits moderators recommend for habitual offenders and hit-and-run cases. The trader sees only their own limit, never the reason.
        </p>
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {list !== null && list.length === 0 ? (
        <EmptyState icon="shield" title="No recommended limits are waiting." data-part="limits-empty">
          When a moderator recommends limits for an account, they wait here for a decision.
        </EmptyState>
      ) : null}
      {list?.map((r) => (
        <article key={r.id} className="x2f-card" data-part="limit-rec">
          <h2 className="x2f-h2">{`${r.displayName}: ${limitWhatText(r)}`}</h2>
          <p className="x2f-staff-hint">
            {`Now on ${STAGE_WORDS[r.currentStage]}${r.currentCapUsdCents === null ? ', no cap per trade' : `, up to $${(Number(r.currentCapUsdCents) / 100).toLocaleString('en-US')} per trade`}. Recommended by ${r.recommendedBy}${r.code === null ? '' : ` from case ${codeText(r.code)}`}.`}
          </p>
          <p>{r.reason}</p>
          {r.mine ? (
            <p className="x2f-staff-hint">You recommended this; another senior moderator or the owner decides it.</p>
          ) : (
            <div className="x2f-staff-actions">
              <Button variant="secondary" onClick={() => setTap({ r, approve: true })}>
                Approve
              </Button>
              <Button variant="secondary" onClick={() => setTap({ r, approve: false })}>
                Decline
              </Button>
            </div>
          )}
        </article>
      ))}
      {tap !== null ? (
        <KeyTapDialog
          intent={intentOf(tap.r, tap.approve)}
          title={tap.approve ? 'Approve these limits' : 'Decline these limits'}
          body={`Tap your security key to ${tap.approve ? 'approve' : 'decline'}: ${tap.r.displayName}, ${limitWhatText(tap.r).toLowerCase()}.`}
          labels={{ accountId: tap.r.displayName, recId: 'this recommendation' }}
          onCancel={() => setTap(null)}
          onDone={(tapId) => {
            const t = tap;
            setTap(null);
            void decide(t.r, t.approve, tapId);
          }}
        />
      ) : null}
    </section>
  );
}
