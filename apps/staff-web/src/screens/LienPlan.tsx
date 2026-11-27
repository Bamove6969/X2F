import { LIEN_FULL_RATE_BPS, LIEN_GRACE_DAYS, LIEN_GRACE_METHOD_MAX, LIEN_RATE_REASON_PREFILL, can, parseCollectRate, parseLienPlan, type KeyTapIntent, type LienPlan, type StaffRole } from '@x2f/staff';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { collectLien, decideLienRate, escalateLien, lienView, paidOffPlatformLien, type CaseLien, type DisputeCase, type LienPlanView } from '../api.js';
import { faultText } from '../refusals.js';
import { Button, ChoiceGroup, Notice } from '../ui/kit.js';
import { hhmm, xmrShort } from './modModel.js';

/**
 * Owner decision, 26 Nov 2026 5:43 PM (docs/lien-recovery.md "Grace: 7 days to pay the agreed way"),
 * with the owner's 5:51 PM addition (the share collected from each later trade, chosen with "Collect
 * now") and 5:53 PM change (a share under 100% goes to a senior moderator or the owner, who reads the
 * dispute's chat and approves it without a key tap).
 *
 * - `LienPlanFields`: on the ruling form, for a ruling that places a lien: "Start collecting now"
 *   (with the share, 100% by default) or "Give them 7 days to pay the agreed way" (with "How they
 *   agreed to pay"). Sent with the ruling, under the proposer's ruling tap.
 * - `LienPanel`: the case's liens: the grace, its deadline and lapse, the switch to collecting (a
 *   `lien-collect` key tap bound to the lien and share), sending a lapsed one to a senior, and a
 *   pending lower share for a senior to decide.
 *
 * COPY-UNSIGNED, DESIGNER-REVIEW (no board).
 */

export const PLAN_COPY = {
  heading: 'If this ruling places a lien',
  collect: 'Start collecting now',
  collectNote: 'Everything they receive in later trades goes to the person owed, at the share you set, until it is paid.',
  grace: `Give them ${LIEN_GRACE_DAYS} days to pay the agreed way`,
  graceNote: `Nothing is taken from their trades for ${LIEN_GRACE_DAYS} days. The person owed confirms when they have been paid. If they do not, you are told and decide what happens next.`,
  method: 'How they agreed to pay',
  methodHint: 'For example: a new PayPal payment of $120 to the same account. Both traders see this.',
  share: 'Share of each later trade collected (%)',
  shareHint: 'From what the person at fault said they can afford. 100% unless you lower it.',
  shareBelow: 'Under 100% goes to a senior moderator or the owner to approve. Until they do, 100% is collected.',
  shareReason: 'Why this share',
} as const;

/** The form's state for the plan. */
export interface PlanDraft {
  mode: 'collect' | 'grace';
  sharePct: string;
  shareReason: string;
  method: string;
}
export const EMPTY_PLAN: PlanDraft = { mode: 'collect', sharePct: '100', shareReason: LIEN_RATE_REASON_PREFILL, method: '' };

/** The percentage as basis points (whole percent, 1..100), or null. */
export function shareBps(pct: string): number | null {
  if (!/^\d{1,3}$/.test(pct.trim())) return null;
  const n = Number(pct.trim());
  return n >= 1 && n <= 100 ? n * 100 : null;
}

/** The plan the form sends, or null while it is incomplete. */
export function planOf(d: PlanDraft): LienPlan | null {
  if (d.mode === 'grace') return parseLienPlan({ mode: 'grace', method: d.method });
  const bps = shareBps(d.sharePct);
  if (bps === null) return null;
  return parseLienPlan(bps === LIEN_FULL_RATE_BPS ? { mode: 'collect' } : { mode: 'collect', rateBps: bps, rateReason: d.shareReason });
}

/** The plan in words (the approver's card). */
export function planWords(p: LienPlanView | undefined): string {
  if (p === undefined) return `${PLAN_COPY.collect} (100% of each later trade)`;
  if (p.mode === 'grace') return `${PLAN_COPY.grace}: ${p.method}`;
  if (p.rateBps === LIEN_FULL_RATE_BPS) return `${PLAN_COPY.collect} (100% of each later trade)`;
  return `${PLAN_COPY.collect} at ${p.rateBps / 100}% of each later trade (a senior approves the lower share): ${p.rateReason ?? ''}`;
}

function ShareFields({ pct, reason, onPct, onReason }: { pct: string; reason: string; onPct: (v: string) => void; onReason: (v: string) => void }) {
  const pctId = useId();
  const reasonId = useId();
  const bps = shareBps(pct);
  return (
    <>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor={pctId}>
          {PLAN_COPY.share}
        </label>
        <input id={pctId} className="x2f-input" inputMode="numeric" value={pct} onChange={(e) => onPct(e.target.value)} data-part="lien-share" />
        <p className="x2f-staff-hint">{bps === null ? 'A whole number from 1 to 100.' : PLAN_COPY.shareHint}</p>
      </div>
      {bps !== null && bps < LIEN_FULL_RATE_BPS ? (
        <div className="x2f-field">
          <label className="x2f-label" htmlFor={reasonId}>
            {PLAN_COPY.shareReason}
          </label>
          <textarea id={reasonId} className="x2f-textarea" rows={2} maxLength={500} value={reason} onChange={(e) => onReason(e.target.value)} data-part="lien-share-reason" />
          <p className="x2f-staff-hint">{PLAN_COPY.shareBelow}</p>
        </div>
      ) : null}
    </>
  );
}

export function LienPlanFields({ value, onChange }: { value: PlanDraft; onChange: (d: PlanDraft) => void }) {
  const headId = useId();
  const methodId = useId();
  return (
    <div data-part="lien-plan">
      <h3 className="x2f-staff-eyebrow" id={headId}>
        {PLAN_COPY.heading}
      </h3>
      <ChoiceGroup
        look="card"
        labelledBy={headId}
        options={[
          { value: 'collect', label: PLAN_COPY.collect, note: PLAN_COPY.collectNote },
          { value: 'grace', label: PLAN_COPY.grace, note: PLAN_COPY.graceNote },
        ]}
        value={value.mode}
        onChange={(mode: 'collect' | 'grace') => onChange({ ...value, mode })}
        part="lien-mode"
      />
      {value.mode === 'collect' ? (
        <ShareFields pct={value.sharePct} reason={value.shareReason} onPct={(sharePct) => onChange({ ...value, sharePct })} onReason={(shareReason) => onChange({ ...value, shareReason })} />
      ) : (
        <div className="x2f-field">
          <label className="x2f-label" htmlFor={methodId}>
            {PLAN_COPY.method}
          </label>
          <textarea id={methodId} className="x2f-textarea" rows={2} maxLength={LIEN_GRACE_METHOD_MAX} value={value.method} onChange={(e) => onChange({ ...value, method: e.target.value })} data-part="lien-method" />
          <p className="x2f-staff-hint">{PLAN_COPY.methodHint}</p>
        </div>
      )}
    </div>
  );
}

/** A pending key tap, as ModCase opens it. */
export interface LienTap {
  intent: KeyTapIntent;
  title: string;
  body: string;
  labels: Readonly<Record<string, string>>;
  onDone: (tapId: string) => Promise<void>;
}

/** The lien's grace in words. */
export function graceLine(l: CaseLien, now = Date.now()): string | null {
  const g = l.grace;
  if (g !== null && g.repaidOffPlatformAt !== null) return `Marked as paid outside X2F (${hhmm(g.repaidOffPlatformAt)}). Nothing more is collected.`;
  if (g === null || g.graceUntil === null) return null;
  if (g.collectStartedAt !== null) return `Was given ${LIEN_GRACE_DAYS} days to pay; collecting from later trades since ${hhmm(g.collectStartedAt)}.`;
  if (g.escalatedAt !== null) return `The ${LIEN_GRACE_DAYS} days passed without payment confirmed. Sent to a senior moderator at ${hhmm(g.escalatedAt)}.`;
  if (g.lapsedAt !== null || Date.parse(g.graceUntil) <= now) return `The ${LIEN_GRACE_DAYS} days passed on ${hhmm(g.graceUntil)} without the person owed confirming payment. Nothing is collected until you decide.`;
  return `${LIEN_GRACE_DAYS} days to pay the agreed way, until ${hhmm(g.graceUntil)}. Nothing is collected meanwhile.`;
}

function LienRow({ l, role, setTap, reload }: { l: CaseLien; role: StaffRole; setTap: (t: LienTap) => void; reload: () => Promise<void> }) {
  const [pct, setPct] = useState('100');
  const [reason, setReason] = useState(LIEN_RATE_REASON_PREFILL);
  const [fault, setFault] = useState<string | null>(null);
  const [chat, setChat] = useState<{ code: string; disputeOpen: boolean } | null>(null);
  const g = l.grace;
  const binding = l.status === 'active' || l.status === 'suspended';
  const senior = can(role, 'rulings.approve');
  const mayDecide = l.ruledByYou || senior;
  const waiting = binding && g !== null && g.graceUntil !== null && g.collectStartedAt === null && g.repaidOffPlatformAt === null;
  const bps = shareBps(pct);
  const rate = bps === null ? null : parseCollectRate(bps === LIEN_FULL_RATE_BPS ? {} : { rateBps: bps, rateReason: reason });

  const collect = () => {
    if (rate === null) return;
    setFault(null);
    setTap({
      intent: { kind: 'lien-collect', lienId: l.id, rateBps: rate.rateBps },
      title: PLAN_COPY.collect,
      body: `Tap your security key to start collecting this lien from their later trades at ${rate.rateBps / 100}%.`,
      labels: { lienId: 'this lien', rateBps: `${rate.rateBps / 100}% of each later trade` },
      onDone: async (tapId) => {
        try {
          await collectLien(l.id, { tapId, rateBps: rate.rateBps, ...(rate.rateReason !== null ? { rateReason: rate.rateReason } : {}) });
          await reload();
        } catch (e) {
          setFault(faultText(e, 'Collecting did not start. Try again.'));
        }
      },
    });
  };
  const escalate = async () => {
    setFault(null);
    try {
      await escalateLien(l.id);
      await reload();
    } catch (e) {
      setFault(faultText(e, 'It was not sent. Try again.'));
    }
  };
  // Review item 3: the traders settled it themselves; a key tap bound to the lien ends it.
  const paidOff = () => {
    setFault(null);
    setTap({
      intent: { kind: 'lien-paid-off-platform', lienId: l.id },
      title: 'Mark as paid outside X2F',
      body: 'Tap your security key to end this lien: the person owed was paid outside X2F, so nothing more is collected.',
      labels: { lienId: 'this lien' },
      onDone: async (tapId) => {
        try {
          await paidOffPlatformLien(l.id, tapId);
          await reload();
        } catch (e) {
          setFault(faultText(e, 'It was not marked as paid. Try again.'));
        }
      },
    });
  };
  const review = async () => {
    try {
      setChat((await lienView(l.id)).chat);
    } catch (e) {
      setFault(faultText(e, 'The request could not be opened. Try again.'));
    }
  };
  const decide = async (approve: boolean) => {
    if (l.pendingRate === null) return;
    setFault(null);
    try {
      await decideLienRate(l.id, l.pendingRate.id, approve);
      await reload();
    } catch (e) {
      setFault(faultText(e, 'The decision did not go through. Try again.'));
    }
  };

  const line = graceLine(l);
  return (
    <li data-part="lien-row" data-lien={l.id}>
      <p>{`${l.debtor === 'buyer' ? 'The buyer' : 'The seller'} owes ${xmrShort(l.amountAtomic)} XMR; ${xmrShort(l.remainingAtomic)} XMR still to come (${l.status}).`}</p>
      {g !== null && g.method !== null ? <p data-part="lien-method-shown">{`Agreed way to pay: ${g.method}`}</p> : null}
      {line !== null ? <p className="x2f-staff-hint" data-part="lien-grace">{line}</p> : null}
      {g === null || g.mode === 'collect' ? <p className="x2f-staff-hint">{`Collecting ${l.rateBps / 100}% of each later trade.`}</p> : null}
      {waiting && mayDecide ? (
        <div data-part="lien-switch">
          <ShareFields pct={pct} reason={reason} onPct={setPct} onReason={setReason} />
          <Button variant="primary" disabled={rate === null} onClick={collect}>
            {PLAN_COPY.collect}
          </Button>
          {g!.lapsedAt !== null && g!.escalatedAt === null ? (
            <Button variant="secondary" onClick={() => void escalate()}>
              Send to a senior moderator
            </Button>
          ) : null}
        </div>
      ) : null}
      {l.status === 'active' && mayDecide && (g === null || g.repaidOffPlatformAt === null) ? (
        <Button variant="secondary" data-part="lien-paid-off" onClick={paidOff}>
          Mark as paid outside X2F
        </Button>
      ) : null}
      {l.pendingRate !== null ? (
        <div data-part="lien-rate-request">
          <p>{`Requested: ${l.pendingRate.rateBps / 100}% of each later trade. ${l.pendingRate.reason}`}</p>
          {senior && !l.pendingRate.proposedByYou ? (
            chat === null ? (
              <Button variant="secondary" onClick={() => void review()}>
                Review the request
              </Button>
            ) : (
              <>
                <p className="x2f-staff-hint">
                  {chat.disputeOpen ? 'Read the conversation in the chat on this case before you decide.' : 'The dispute is closed, so its chat stays shut; decide from the case.'}{' '}
                  <Link className="x2f-link" to={`/disputes/${encodeURIComponent(chat.code)}`}>
                    The case
                  </Link>
                </p>
                <Button variant="primary" onClick={() => void decide(true)}>
                  Approve the lower share
                </Button>
                <Button variant="secondary" onClick={() => void decide(false)}>
                  Turn down the request
                </Button>
              </>
            )
          ) : (
            <p className="x2f-staff-hint">Waiting for a senior moderator or the owner. Until then, 100% is collected.</p>
          )}
        </div>
      ) : null}
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
    </li>
  );
}

export function LienPanel({ c, role, setTap, reload }: { c: DisputeCase; role: StaffRole; setTap: (t: LienTap) => void; reload: () => Promise<void> }) {
  const liens = c.liens ?? [];
  if (liens.length === 0) return null;
  return (
    <section className="x2f-card" data-part="liens">
      <h2 className="x2f-h2">Lien</h2>
      <ul className="x2f-staff-list">
        {liens.map((l) => (
          <LienRow key={l.id} l={l} role={role} setTap={setTap} reload={reload} />
        ))}
      </ul>
    </section>
  );
}
