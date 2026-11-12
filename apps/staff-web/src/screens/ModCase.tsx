import type { KeyTapIntent, RulingOutcome, StaffRole } from '@x2f/staff';
import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  approveRuling,
  codeOf,
  disputeCase,
  messageTraders,
  proposeRuling,
  requestProof,
  sendBackRuling,
  serverNow,
  setFreeze,
  takeCase,
  type CaseTrader,
  type DisputeCase,
  type Side,
} from '../api.js';
import { faultText } from '../refusals.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { Button, ChoiceGroup, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import {
  EVIDENCE_LINE_MAX,
  EVIDENCE_MAX,
  OUTCOME_LABELS,
  REASON_MIN,
  codeText,
  evidenceLines,
  fiatText,
  hhmm,
  limitText,
  outcomeChoices,
  reasonHint,
  reasonText,
  rulingIntent,
  span,
  usdText,
  xmrShort,
  xmrSix,
} from './modModel.js';
import { takeable } from './ModQueue.js';
import '../ui/staff.css';

const isApprover = (role: StaffRole) => role === 'senior' || role === 'owner';
const nameOf = (t: CaseTrader | null, side: Side) => t?.displayName ?? (side === 'buyer' ? 'the buyer' : 'the seller');

/** A pending key tap: the dialog's intent and words, and what to do with the tap. */
interface Tap {
  intent: KeyTapIntent;
  title: string;
  body: string;
  onDone: (tapId: string) => Promise<void>;
}

/**
 * The moderator's case (Plan 4 Task 18, board ModCase): the header line and chips, the full chat
 * (closed), "Message both traders", the traders, the payment proof, the escrow, the freeze, and
 * the ruling: "Your ruling" for the assignee, the waiting state for its proposer, and "Approve
 * ruling" (tapped) or "Send back" for a senior moderator or the owner who did not propose it.
 *
 * What each person sees follows the API's own rules, so the page never offers what the API would
 * refuse: messages, proof requests and the freeze need `mayWork` (the assignee, or a senior or the
 * owner, never someone involved in round 1 of an appeal); only the assignee proposes; only a senior
 * or the owner who is not the proposer approves (rulings.approve; the API still checks R37).
 *
 * NEEDS_P4_CHAT_MEMBERSHIP: the full chat and the unblurred proof are not readable here yet (the
 * staff chat keys, design-chat-membership-keys-2026-11-08 build task 9). "Open the full chat" stays
 * disabled and nothing on this page fetches chat text.
 *
 * The board's account actions are not offered: a freeze is its own act (D-015, the Freeze card) and
 * the bans are Task 27's (the API refuses any account action on the ruling). The board's extra
 * trader lines (disputes, cancel rate, last ratings) are not in the case answer. DESIGNER-REVIEW.
 * Sentences the board does not word are COPY-UNSIGNED.
 */
export function ModCase({ role }: { role: StaffRole }) {
  const { code = '' } = useParams();
  const [c, setC] = useState<DisputeCase | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [tap, setTap] = useState<Tap | null>(null);

  const load = async () => {
    try {
      setC(await disputeCase(code));
    } catch (e) {
      setFault(codeOf(e) === 'not-found' ? 'There is no dispute with that code.' : faultText(e, 'The case could not be loaded just now. Reload to try again.'));
    }
  };
  useEffect(() => {
    void load();
  }, [code]);

  if (c === null) {
    return (
      <section data-screen="mod-case">
        <Link className="x2f-link" to="/disputes">
          All disputes
        </Link>
        {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      </section>
    );
  }

  const buyer = nameOf(c.traders.buyer, 'buyer');
  const seller = nameOf(c.traders.seller, 'seller');
  const live = c.status !== 'closed';
  const work = c.mayWork && live;
  const proposing = c.assignedToYou && ((c.round === 1 && c.status === 'open') || (c.round === 2 && c.status === 'appealed'));
  const approving = c.status === 'awaiting-approval' && isApprover(role) && !c.proposedByYou && c.ruling.proposal !== null;

  return (
    <section data-screen="mod-case">
      <Link className="x2f-link" to="/disputes">
        All disputes
      </Link>
      <PageTitle title={codeText(c.code)}>
        <p className="x2f-staff-page__lead" data-part="case-line">
          {caseLine(c)}
        </p>
        {c.note.trim() !== '' ? (
          <p className="x2f-staff-hint" data-part="case-note">
            {`Their note: ${c.note}`}
          </p>
        ) : null}
        <CaseChips c={c} role={role} onTaken={load} />
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}

      <div className="x2f-staff-case">
        <div className="x2f-stack">
          <ChatCard />
          {work ? <MessageCard code={c.code} /> : null}
        </div>
        <div className="x2f-stack">
          <TradersCard c={c} />
          <ProofCard c={c} buyer={buyer} seller={seller} work={work} />
          <EscrowCard c={c} buyer={buyer} seller={seller} />
          {c.mayWork ? <FreezeCard c={c} buyer={buyer} seller={seller} onChange={(freezes) => setC({ ...c, freezes })} /> : null}
          <RulingCard c={c} proposing={proposing} approving={approving} buyer={buyer} seller={seller} setTap={setTap} reload={load} />
        </div>
      </div>

      {tap !== null ? (
        <KeyTapDialog
          intent={tap.intent}
          title={tap.title}
          body={tap.body}
          onCancel={() => setTap(null)}
          onDone={(tapId) => {
            const t = tap;
            setTap(null);
            void t.onDone(tapId);
          }}
        />
      ) : null}
    </section>
  );
}

/** Board ModCase: "Zelle · 4.00 XMR for $1,320.00 at $330.00 / XMR · opened by the buyer 2 h 40 min ago: paid, but …". */
function caseLine(c: DisputeCase): string {
  const e = c.escrow;
  const by = c.openedBy === 'system' ? 'X2F' : `the ${c.openedBy}`;
  const ago = span(serverNow().getTime() - Date.parse(c.openedAt));
  return `${e.methodId} · ${xmrShort(e.amountAtomic)} XMR for ${fiatText(e.fiatCents, e.currency)} at ${fiatText(e.centsPerXmr, e.currency)} / XMR · opened by ${by} ${ago} ago: ${reasonText(c.openedBy, c.reason)}`;
}

const STATUS_TEXT: Readonly<Record<DisputeCase['status'], string>> = {
  open: 'Open',
  'awaiting-approval': 'Ruling waiting for approval',
  published: 'Ruling published',
  appealed: 'Appealed',
  final: 'Final',
  complying: 'Waiting for the seller to comply',
  closed: 'Closed',
};

function CaseChips({ c, role, onTaken }: { c: DisputeCase; role: StaffRole; onTaken: () => Promise<void> }) {
  const [fault, setFault] = useState<string | null>(null);
  const now = serverNow().getTime();
  const chips: string[] = [];
  if (c.status === 'open' || c.status === 'appealed') {
    const reply = c.firstReplyAt === null;
    const left = Date.parse(reply ? c.replyDueAt : c.rulingDueAt) - now;
    const what = reply ? 'First reply' : 'Ruling';
    chips.push(left > 0 ? `${what} due in ${span(left)}` : `${what} overdue by ${span(-left)}`);
  } else {
    chips.push(STATUS_TEXT[c.status]);
  }
  if (c.overLimit) chips.push(`Above the ${limitText(c.limitUsd)} limit`);
  chips.push(c.assignedToYou ? 'Assigned to you' : c.assignee !== null ? `Assigned to ${c.assignee}` : 'Unassigned');

  const take = async () => {
    setFault(null);
    try {
      await takeCase(c.code);
      await onTaken();
    } catch (e) {
      // not-a-refusal: a case taken by someone else meanwhile is a changed state, shown as a fault.
      setFault(faultText(e, 'This case could not be taken. Someone may have taken it first.'));
    }
  };

  return (
    <div className="x2f-row" data-part="case-chips">
      {chips.map((t) => (
        <span key={t} className="x2f-staff-tag">
          {t}
        </span>
      ))}
      {takeable(c, role) ? (
        <Button variant="secondary" onClick={() => void take()}>
          Take this case
        </Button>
      ) : null}
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
    </div>
  );
}

/** NEEDS_P4_CHAT_MEMBERSHIP: closed, and no way to open it yet (no board copy for the closed state; A8). COPY-UNSIGNED */
function ChatCard() {
  return (
    <section className="x2f-card" data-part="chat">
      <h2 className="x2f-h2">Full chat</h2>
      {/* not-a-refusal: an explanation: the chat read is not built yet (a gap, not a rule that stops the moderator) */}
      <p className="x2f-staff-hint">The full chat can't be opened here yet. It needs the staff chat keys, which are still being built. Opening it will be written to the activity log.</p>
      <Button variant="secondary" disabled>
        Open the full chat
      </Button>
    </section>
  );
}

function MessageCard({ code }: { code: string }) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const send = async () => {
    setBusy(true);
    setNote(null);
    try {
      await messageTraders(code, text);
      setText('');
      setNote({ tone: 'ok', text: 'Sent and logged.' });
    } catch (e) {
      setNote({ tone: 'danger', text: faultText(e, 'The message could not be sent just now. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="x2f-card" data-part="message">
      <div className="x2f-field">
        <label className="x2f-label" htmlFor={id}>
          Message both traders
        </label>
        <textarea id={id} className="x2f-textarea" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <Button variant="secondary" disabled={busy || text.trim() === ''} onClick={() => void send()}>
        Send
      </Button>
      <p className="x2f-staff-hint">Your messages show the X2F Moderator badge to both traders.</p>
      {note !== null ? (note.tone === 'ok' ? <p className="x2f-staff-ok">{note.text}</p> : <Notice tone="danger">{note.text}</Notice>) : null}
    </section>
  );
}

const traderLine = (t: CaseTrader) => `${t.completedTrades} trades · ${t.positivePct === null ? 'no ratings yet' : `${t.positivePct}% positive`}`;

function TradersCard({ c }: { c: DisputeCase }) {
  return (
    <section className="x2f-card" data-part="traders">
      <h2 className="x2f-h2">Traders</h2>
      {(['buyer', 'seller'] as const).map((side) => {
        const t = c.traders[side];
        return (
          <div key={side} className="x2f-staff-key-row">
            <span className="x2f-staff-eyebrow">{side === 'buyer' ? 'Buyer' : 'Seller'}</span>
            <span className="x2f-staff-key-row__name">{nameOf(t, side)}</span>
            {t !== null ? <span className="x2f-staff-key-row__note">{traderLine(t)}</span> : null}
          </div>
        );
      })}
    </section>
  );
}

function ProofCard({ c, buyer, seller, work }: { c: DisputeCase; buyer: string; seller: string; work: boolean }) {
  const [asked, setAsked] = useState<{ name: string; at: string } | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const ask = async (side: Side) => {
    setFault(null);
    try {
      await requestProof(c.code, side);
      setAsked({ name: side === 'buyer' ? buyer : seller, at: serverNow().toISOString() });
    } catch (e) {
      setFault(faultText(e, 'The request could not be sent just now. Try again.'));
    }
  };
  return (
    <section className="x2f-card" data-part="proof">
      <h2 className="x2f-h2">Payment proof</h2>
      {/* NEEDS_P4_CHAT_MEMBERSHIP: the proof itself is not readable here yet. COPY-UNSIGNED */}
      {/* not-a-refusal: an explanation: viewing the proof is not built yet */}
      <p className="x2f-staff-hint">The proof can't be viewed here yet. You can still ask a trader for the unblurred copy.</p>
      {work && asked === null ? (
        <div className="x2f-stack" data-part="proof-actions">
          <Button variant="secondary" onClick={() => void ask('buyer')}>
            {`Request unblurred proof from ${buyer}`}
          </Button>
          <Button variant="secondary" onClick={() => void ask('seller')}>
            {`Request unblurred proof from ${seller}`}
          </Button>
          <p className="x2f-staff-hint">The request is written to the activity log. Only you will see the copy.</p>
        </div>
      ) : null}
      {asked !== null ? <p className="x2f-staff-ok">{`Requested at ${hhmm(asked.at)} and logged. Waiting for ${asked.name} to send it.`}</p> : null}
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
    </section>
  );
}

function EscrowCard({ c, buyer, seller }: { c: DisputeCase; buyer: string; seller: string }) {
  return (
    <section className="x2f-card" data-part="escrow">
      <h2 className="x2f-h2">Escrow</h2>
      <p>{`${c.escrow.confirmations} confirmations`}</p>
      <p className="x2f-staff-code">{`${xmrSix(c.escrow.amountAtomic)} XMR locked`}</p>
      <p className="x2f-staff-hint">
        {`3 keys, any 2 release it: ${buyer}, ${seller} and the moderator key. Your ruling signs with the winning side's key.${c.ruling.publishedAt === null ? ' Nothing has moved yet.' : ''}`}
      </p>
    </section>
  );
}

/**
 * The freeze (owner 2026-11-02; no board): one per side, a separate act from the ruling (D-015).
 * A seller who let a ruling's payment time pass can be frozen for that too. COPY-UNSIGNED, DESIGNER-REVIEW
 */
function FreezeCard({ c, buyer, seller, onChange }: { c: DisputeCase; buyer: string; seller: string; onChange: (f: DisputeCase['freezes']) => void }) {
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (b: Parameters<typeof setFreeze>[1]) => {
    setBusy(true);
    setFault(null);
    try {
      onChange((await setFreeze(c.code, b)).freezes);
    } catch (e) {
      const code = codeOf(e);
      // not-a-refusal: the freeze's own conditions (48 hours of silence, or a lapsed ruling) not met yet, shown as a fault.
      if (code === 'freeze-not-allowed') setFault("X2F does not allow this freeze yet: the trader must have said nothing for 48 hours, or let the ruling's payment time pass.");
      // not-a-refusal: the case changed meanwhile (closed, or a freeze already set or lifted).
      else if (code === 'wrong-state') setFault('The case changed meanwhile. Reload it.');
      else setFault(faultText(e, 'The freeze could not be changed just now. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const live = c.status !== 'closed';
  return (
    <section className="x2f-card" data-part="freeze">
      <h2 className="x2f-h2">Freeze</h2>
      {/* not-a-refusal: an explanation of when the freeze applies, before any attempt */}
      <p className="x2f-staff-hint">Only for a trader who said nothing for 48 hours, or a seller who let the ruling's payment time pass. A frozen account can't post or take offers; its open trades still finish. There is no end time: a moderator lifts it.</p>
      {(['buyer', 'seller'] as const).map((side) => {
        const name = side === 'buyer' ? buyer : seller;
        if (c.freezes[side]) {
          return (
            <div key={side} className="x2f-stack">
              <p>{`${name} is frozen.`}</p>
              <Button variant="secondary" disabled={busy} onClick={() => void act({ side, on: false })}>
                {`Lift the freeze on ${name}`}
              </Button>
            </div>
          );
        }
        if (!live) return null;
        return (
          <div key={side} className="x2f-stack">
            <Button variant="danger-outline" disabled={busy} onClick={() => void act({ side, on: true, reason: 'no-reply' })}>
              {`Freeze ${name}`}
            </Button>
            {side === 'seller' && c.status === 'complying' ? (
              <Button variant="danger-outline" disabled={busy} onClick={() => void act({ side, on: true, reason: 'ignored-ruling' })}>
                {`Freeze ${name} for ignoring the ruling`}
              </Button>
            ) : null}
          </div>
        );
      })}
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
    </section>
  );
}

function RulingCard({
  c,
  proposing,
  approving,
  buyer,
  seller,
  setTap,
  reload,
}: {
  c: DisputeCase;
  proposing: boolean;
  approving: boolean;
  buyer: string;
  seller: string;
  setTap: (t: Tap) => void;
  reload: () => Promise<void>;
}) {
  const r = c.ruling;
  return (
    <>
      {c.assignedToYou && r.sentBack !== null && proposing ? (
        <Notice tone="caution" data-part="sent-back">
          {`Sent back at ${hhmm(r.sentBack.at)}: ${r.sentBack.note ?? ''}`}
        </Notice>
      ) : null}
      {proposing ? <ProposeForm c={c} buyer={buyer} seller={seller} setTap={setTap} reload={reload} /> : null}
      {approving ? <ApprovePanel c={c} setTap={setTap} reload={reload} /> : null}
      {c.status === 'awaiting-approval' && !approving ? (
        <p className="x2f-staff-hint" data-part="ruling-waiting">
          {c.proposedByYou && r.proposal !== null
            ? `Waiting for approval from a senior moderator or the owner. Proposed at ${hhmm(r.proposal.proposedAt)} and logged.`
            : 'This ruling is waiting for approval by a senior moderator or the owner.'}
        </p>
      ) : null}
      {r.publishedAt !== null && c.status !== 'awaiting-approval' ? (
        <p className="x2f-staff-hint" data-part="ruling-published">
          {`Ruling published at ${hhmm(r.publishedAt)}${r.draft !== null ? `: ${OUTCOME_LABELS[r.draft.outcome]}` : ''}.`}
        </p>
      ) : null}
    </>
  );
}

const rulingFault = (e: unknown, fallback: string) => {
  const code = codeOf(e);
  // not-a-refusal: the tap was made for other content (the reason or outcome changed), shown as a fault.
  if (code === 'tap-invalid') return 'The tap did not match this ruling. Try again.';
  // not-a-refusal: the case moved on meanwhile (taken, decided or sent back).
  if (code === 'wrong-state') return 'The case changed meanwhile. Reload it.';
  // not-a-refusal: a wait, not a rule against this person (lead call Q1): maintenance holds the dispute's timers.
  if (code === 'dispute-paused') return 'Rulings wait while maintenance pauses this dispute. Try again when it ends.';
  // not-a-refusal: a wait, not a rule against this person (lead call Q1): the emergency stop.
  if (code === 'trading-paused') return 'Rulings wait while trading is stopped. Try again when it resumes.';
  // not-a-refusal: R37, someone involved in round 1 never decides the appeal.
  if (code === 'forbidden-case') return 'You took part in this case before, so you cannot decide it.';
  return faultText(e, fallback);
};

function ProposeForm({ c, buyer, seller, setTap, reload }: { c: DisputeCase; buyer: string; seller: string; setTap: (t: Tap) => void; reload: () => Promise<void> }) {
  const reasonId = useId();
  const evidenceId = useId();
  const headId = useId();
  const [outcome, setOutcome] = useState<RulingOutcome | null>(null);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [fault, setFault] = useState<string | null>(null);

  const lines = evidenceLines(evidence);
  const evidenceOk = lines.length <= EVIDENCE_MAX && lines.every((l) => l.length <= EVIDENCE_LINE_MAX);
  const ready = outcome !== null && reason.trim().length >= REASON_MIN && evidenceOk;
  const label = c.overLimit ? 'Send ruling for approval' : 'Send ruling';
  const xmr = xmrShort(c.escrow.amountAtomic);

  const submit = () => {
    if (!ready || outcome === null) return;
    setFault(null);
    const rulingId = crypto.randomUUID();
    const text = reason;
    const ev = lines;
    setTap({
      intent: rulingIntent('propose', { rulingId, code: c.code, round: c.round, outcome, amountAtomic: c.escrow.amountAtomic, reason: text }),
      title: label,
      body: `Tap your security key to sign this ruling: ${OUTCOME_LABELS[outcome]}.`,
      onDone: async (tapId) => {
        try {
          await proposeRuling(c.code, { rulingId, outcome, reason: text, evidence: ev, tapId });
          await reload();
        } catch (e) {
          setFault(rulingFault(e, 'The ruling could not be sent just now. Try again.'));
        }
      },
    });
  };

  return (
    <section className="x2f-card" data-part="ruling">
      <h2 className="x2f-h2" id={headId}>
        Your ruling
      </h2>
      <ChoiceGroup look="card" labelledBy={headId} options={outcomeChoices(c.afterRefund, { xmr, buyer, seller })} value={outcome} onChange={setOutcome} part="ruling-outcome" />
      <h3 className="x2f-staff-eyebrow">Account action</h3>
      <p className="x2f-staff-hint">None. A freeze is its own action (Freeze, above); bans come later.</p>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor={reasonId}>
          Reason (required, both traders see it)
        </label>
        <textarea id={reasonId} className="x2f-textarea" rows={4} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="x2f-staff-hint" data-part="reason-hint">
          {reasonHint(reason)}
        </p>
      </div>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor={evidenceId}>
          Evidence (optional, one line each, both traders see it)
        </label>
        <textarea id={evidenceId} className="x2f-textarea" rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        {/* not-a-refusal: an input check on the evidence lines */}
        {!evidenceOk ? <p className="x2f-staff-hint">{`At most ${EVIDENCE_MAX} lines, each up to ${EVIDENCE_LINE_MAX} characters.`}</p> : null}
      </div>
      {c.overLimit ? (
        <Notice tone="caution" title="Above your limit: sent to a senior moderator or the owner for approval.">
          {`${usdText(c.usd)} is over the ${limitText(c.limitUsd)} large-trade limit. Nothing is signed until they approve.`}
        </Notice>
      ) : null}
      <Button variant="primary" disabled={!ready} onClick={submit}>
        {label}
      </Button>
      <p className="x2f-staff-hint">
        {ready
          ? c.overLimit
            ? 'The traders see the ruling once it is approved.'
            : 'The traders see the ruling as soon as you tap.'
          : outcome !== null
            ? 'Write the reason to continue.'
            : 'Pick an outcome and write the reason.'}
      </p>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
    </section>
  );
}

function ApprovePanel({ c, setTap, reload }: { c: DisputeCase; setTap: (t: Tap) => void; reload: () => Promise<void> }) {
  const noteId = useId();
  const p = c.ruling.proposal!;
  const outcome = c.ruling.draft?.outcome ?? null;
  const [back, setBack] = useState(false);
  const [note, setNote] = useState('');
  const [fault, setFault] = useState<string | null>(null);

  const approve = () => {
    if (outcome === null) return;
    setFault(null);
    setTap({
      intent: rulingIntent('approve', { rulingId: p.rulingId, code: c.code, round: c.round, outcome, amountAtomic: c.escrow.amountAtomic, reason: p.reason }),
      title: 'Approve ruling',
      body: `Tap your security key to approve and publish this ruling: ${OUTCOME_LABELS[outcome]}.`,
      onDone: async (tapId) => {
        try {
          await approveRuling(c.code, p.rulingId, tapId);
          await reload();
        } catch (e) {
          setFault(rulingFault(e, 'The approval did not go through. Try again.'));
        }
      },
    });
  };
  const sendBack = async () => {
    setFault(null);
    try {
      await sendBackRuling(c.code, p.rulingId, note);
      await reload();
    } catch (e) {
      setFault(rulingFault(e, 'The ruling could not be sent back just now. Try again.'));
    }
  };

  return (
    <section className="x2f-card" data-part="approve">
      <h2 className="x2f-h2">Ruling waiting for your approval</h2>
      <p>{outcome !== null ? OUTCOME_LABELS[outcome] : ''}</p>
      <p className="x2f-staff-hint">{`Proposed at ${hhmm(p.proposedAt)}.`}</p>
      <p>{p.reason}</p>
      {p.evidence.length > 0 ? (
        <ul>
          {p.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      <Button variant="primary" disabled={outcome === null} onClick={approve}>
        Approve ruling
      </Button>
      <Button variant="secondary" onClick={() => setBack(true)}>
        Send back
      </Button>
      {back ? (
        <div className="x2f-field">
          <label className="x2f-label" htmlFor={noteId}>
            Note for the moderator
          </label>
          <textarea id={noteId} className="x2f-textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="secondary" disabled={note.trim() === ''} onClick={() => void sendBack()}>
            Send back to the moderator
          </Button>
        </div>
      ) : null}
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
    </section>
  );
}
