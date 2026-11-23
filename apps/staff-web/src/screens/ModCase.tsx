import type { KeyTapIntent, RulingOutcome, StaffRole } from '@x2f/staff';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  approveRuling,
  reProposeRuling,
  secondApproveRuling,
  codeOf,
  disputeCase,
  messageTraders,
  proposeRuling,
  readCaseChat,
  recommendLimits,
  StaffApiError,
  requestProof,
  sendBackRuling,
  serverNow,
  setFreeze,
  takeCase,
  type CaseTrader,
  type DisputeCase,
  type Side,
} from '../api.js';
import { browserChatKeys, type ChatKeys } from '../chat/client.js';
import { ChatKeyError, modTextOk, type CaseChatLine, type ChatView, type DevicePublic } from '../chat/types.js';
import { DeviceCard } from '../ui/DeviceCard.js';
import { faultText } from '../refusals.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { Button, ChoiceGroup, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import {
  EVIDENCE_LINE_MAX,
  EVIDENCE_MAX,
  OUTCOME_LABELS,
  REASON_MIN,
  caseMatchesAddress,
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
import { ProofLookFor } from '../ui/ProofCard.js';

const isApprover = (role: StaffRole) => role === 'senior' || role === 'owner';
const nameOf = (t: CaseTrader | null, side: Side) => t?.displayName ?? (side === 'buyer' ? 'the buyer' : 'the seller');

/** A pending key tap: the dialog's intent and words, and what to do with the tap. */
interface Tap {
  intent: KeyTapIntent;
  title: string;
  body: string;
  /** X3: names next to the ids and hashes the key signs (KeyTapDialog `labels`). */
  labels: Readonly<Record<string, string>>;
  onDone: (tapId: string) => Promise<void>;
}

/**
 * X3 (re-verify round 3): what each field of a ruling tap is, in the words of this screen. The
 * hashes are this screen's own (`rulingIntent` hashes the reason and the evidence lines shown
 * here), and round 2 names round 1's ruling with its outcome. COPY-UNSIGNED, DESIGNER-REVIEW.
 */
function rulingLabels(c: DisputeCase, outcome: RulingOutcome): Record<string, string> {
  const r1 = c.ruling.round1 ?? null;
  return {
    rulingId: 'this ruling',
    // Review X3-1 (b): from the signed code itself, never the API's separate incident id.
    // DESIGN: wording
    code: `the trade on this page, ${codeText(c.code)}`,
    outcome: OUTCOME_LABELS[outcome],
    amountAtomic: `${xmrShort(c.escrow.amountAtomic)} XMR`,
    reasonSha256: 'the reason above',
    evidenceSha256: 'the evidence lines above',
    ...(c.round === 2 && r1 !== null ? { round1Id: `round 1 ruling (${OUTCOME_LABELS[r1.outcome]})` } : {}),
  };
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
 * Design build task 9: "Open the full chat" asks the API for the chat key re-wrapped to this
 * browser's certified device (DeviceCard confirms it first); the read is logged. Design build task
 * 10: the chat key worker (keys/, through chat/client.ts) verifies and decrypts it and keeps the
 * key; this page gets the lines to show. A message to both traders is sealed and countersigned in
 * the worker too. The key is wiped in the worker when this screen goes away.
 * NEEDS_P5_PROOF_ENVELOPE: the unblurred proof is not readable here yet.
 *
 * The board's account actions are not offered: a freeze is its own act (D-015, the Freeze card) and
 * the bans are Task 27's (the API refuses any account action on the ruling). The board's extra
 * trader lines (disputes, cancel rate, last ratings) are not in the case answer. DESIGNER-REVIEW.
 * Sentences the board does not word are COPY-UNSIGNED.
 */
export function ModCase({ role, keys: given }: { role: StaffRole; /** The chat key worker (the page's own by default; tests give one). */ keys?: ChatKeys }) {
  const { code = '' } = useParams();
  const [c, setC] = useState<DisputeCase | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [tap, setTap] = useState<Tap | null>(null);
  const [keys] = useState<ChatKeys>(() => given ?? browserChatKeys());
  const [device, setDevice] = useState<DevicePublic | null>(null);
  const [opened, setOpened] = useState<ChatView | null>(null);
  // The chat key never outlives the screen (review N1: wiped on unmount only, never after a message;
  // task 10: in the worker, by the opened chat's handle).
  const openedRef = useRef<ChatView | null>(null);
  openedRef.current = opened;
  useEffect(() => () => {
    if (openedRef.current !== null) keys.forget(openedRef.current.handle);
  }, []);

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
  // Review M2: in an appeal, someone involved in round 1 (mayWork false) never decides it (R37).
  const approving = c.status === 'awaiting-approval' && isApprover(role) && !c.proposedByYou && c.ruling.proposal !== null && (c.round === 1 || c.mayWork);
  // Review p4t22 M1 (e): a senior or the owner who did not propose it adds the second approval the gate asks for.
  const second = c.ruling.gateRefusal?.secondApproval ?? null;
  const rescuing = live && second !== null && isApprover(role) && !second.proposedByYou;
  // Review p4t22 N1: a senior or the owner proposes a new round 1 in place of one refused as revoked.
  const reProposing = live && (c.ruling.gateRefusal?.rePropose ?? null) !== null && isApprover(role);
  // Review X3-1 (a): no ruling tap opens for a case that is not the one in the address.
  const matches = caseMatchesAddress(code, c);
  const openTap = (t: Tap) => {
    if (matches) setTap(t);
  };

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
      {!matches ? (
        <Notice tone="danger" data-part="case-mismatch">
          {/* DESIGN: wording */}
          This case is not the one you opened: its trade code differs from the address. Nothing can be signed here.
        </Notice>
      ) : null}

      <div className="x2f-staff-case">
        <div className="x2f-stack">
          <ChatCard code={c.code} work={work} keys={keys} device={device} onDevice={setDevice} opened={opened} onOpened={setOpened} buyer={buyer} seller={seller} />
          {work ? <MessageCard code={c.code} keys={keys} device={device} opened={opened} onSent={(o) => setOpened(o)} /> : null}
        </div>
        <div className="x2f-stack">
          <TradersCard c={c} />
          <ProofCard c={c} buyer={buyer} seller={seller} work={work} />
          <EscrowCard c={c} buyer={buyer} seller={seller} />
          {c.mayWork ? <FreezeCard c={c} buyer={buyer} seller={seller} onChange={(freezes) => setC({ ...c, freezes })} /> : null}
          {c.mayWork ? <LimitsCard c={c} buyer={buyer} seller={seller} /> : null}
          <RulingCard c={c} proposing={proposing} approving={approving} rescuing={rescuing} reProposing={reProposing} buyer={buyer} seller={seller} setTap={openTap} reload={load} />
        </div>
      </div>

      {tap !== null ? (
        <KeyTapDialog
          intent={tap.intent}
          title={tap.title}
          body={tap.body}
          labels={tap.labels}
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
  return `${e.methodName} · ${xmrShort(e.amountAtomic)} XMR for ${fiatText(e.fiatCents, e.currency)} at ${fiatText(e.centsPerXmr, e.currency)} / XMR · opened by ${by} ${ago} ago: ${reasonText(c.openedBy, c.reason)}`;
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
  // Review p4t22 M1: a trade not priced in US dollars needs a second person whatever its value. COPY-UNSIGNED
  if (c.overLimit) chips.push(c.secondReason === 'non-usd' ? 'Needs a second approval: not in US dollars' : `Above the ${limitText(c.limitUsd)} limit`);
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
      {takeable(c, role) && (c.round === 1 || c.mayWork) ? (
        <Button variant="secondary" onClick={() => void take()}>
          Take this case
        </Button>
      ) : null}
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
    </div>
  );
}

/**
 * Design build task 9: the full chat, opened on this certified device. No board copy for these
 * states yet (A8): every string is COPY-UNSIGNED, DESIGNER-REVIEW.
 */
function ChatCard({ code, work, keys, device, onDevice, opened, onOpened, buyer, seller }: {
  code: string;
  work: boolean;
  keys: ChatKeys;
  device: DevicePublic | null;
  onDevice: (k: DevicePublic | null) => void;
  opened: ChatView | null;
  onOpened: (o: ChatView) => void;
  buyer: string;
  seller: string;
}) {
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  // Review N4: how many times the moderation process said this device is not certified; each one
  // shows DeviceCard afresh at its confirm step.
  const [refusedDevice, setRefusedDevice] = useState(0);
  const open = async () => {
    if (device === null) return;
    setBusy(true);
    setFault(null);
    try {
      // Verified and decrypted in the worker, against its own pinned moderation keys.
      onOpened(await keys.open(await readCaseChat(code, device.deviceKeyId)));
    } catch (e) {
      if (codeOf(e) === 'device-not-certified') {
        onDevice(null);
        setRefusedDevice((n) => n + 1);
        return;
      }
      // not-a-refusal: a check on what the server sent, or a fault; the refusals come through faultText
      if (e instanceof ChatKeyError) setFault('This chat did not check out on this device, so nothing is shown. Tell the owner.');
      else setFault(faultText(e, 'The chat could not be opened just now. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const who = (f: CaseChatLine['from']) => (f === 'mod' ? 'Moderator' : f === 'buyer' ? buyer : seller);
  return (
    <section className="x2f-card" data-part="chat">
      <h2 className="x2f-h2">Full chat</h2>
      {opened === null ? (
        <>
          {work ? <DeviceCard key={refusedDevice} notCertified={refusedDevice > 0} onReady={onDevice} load={() => keys.device()} /> : null}
          <p className="x2f-staff-hint">Opening the chat is written to the activity log.</p>
          <Button variant="secondary" disabled={!work || device === null || busy} onClick={() => void open()}>
            Open the full chat
          </Button>
        </>
      ) : (
        <ol className="x2f-staff-chat" data-part="chat-lines" aria-label="Messages">
          {/* COPY-UNSIGNED. Review N11 (f): the read returns the newest messages only. */}
          {opened.olderNotShown ? <li data-part="chat-older">Older messages not shown.</li> : null}
          {opened.lines.map((l) => (
            <Fragment key={l.id}>
              {/* COPY-UNSIGNED. Review N2: where the server dropped or held back messages, shown where it happened. */}
              {l.missingBefore > 0 ? <li data-part="chat-missing">{`${l.missingBefore} message(s) missing here`}</li> : null}
              <li data-from={l.from}>
                <span className="x2f-staff-chat__who">{`${who(l.from)}: `}</span>
                {l.text}
              </li>
            </Fragment>
          ))}
          {opened.unreadable > 0 ? <li data-part="chat-unreadable">{`${opened.unreadable} message(s) did not open on this device.`}</li> : null}
        </ol>
      )}
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
    </section>
  );
}

function MessageCard({ code, keys, device, opened, onSent }: { code: string; keys: ChatKeys; device: DevicePublic | null; opened: ChatView | null; onSent: (o: ChatView) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const ready = device !== null && opened !== null;

  const send = async () => {
    if (device === null || opened === null) return;
    setBusy(true);
    setNote(null);
    try {
      let seq = opened.nextSeq;
      let res: { id: string };
      try {
        res = await messageTraders(code, await keys.seal(opened.handle, text, serverNow(), seq));
      } catch (e) {
        // Another moderator message went first: seal again at the seq the moderation process names, once.
        const next = e instanceof StaffApiError ? e.extra.nextSeq : undefined;
        if (codeOf(e) !== 'stale-seq' || typeof next !== 'number') throw e;
        seq = next;
        res = await messageTraders(code, await keys.seal(opened.handle, text, serverNow(), seq));
      }
      onSent({ ...opened, nextSeq: seq + 1, lines: [...opened.lines, { id: res.id, from: 'mod', text, at: serverNow().toISOString(), missingBefore: 0 }] });
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
      <Button variant="secondary" disabled={busy || !ready || !modTextOk(text)} onClick={() => void send()}>
        Send
      </Button>
      {/* Board ModCase's line, always shown (parity); until the chat is open, how to write (COPY-UNSIGNED). */}
      <p className="x2f-staff-hint">Your messages show the X2F Moderator badge to both traders.</p>
      {ready ? null : <p className="x2f-staff-hint">Open the full chat on this device to write to both traders.</p>}
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
      {/* NEEDS_P5_PROOF_ENVELOPE: the proof itself is not readable here yet. COPY-UNSIGNED */}
      {/* not-a-refusal: an explanation: viewing the proof is not built yet */}
      <p className="x2f-staff-hint">The proof can't be viewed here yet. You can still ask a trader for the unblurred copy.</p>
      <ProofLookFor fiatCents={c.escrow.fiatCents} currency={c.escrow.currency} code={codeText(c.code)} />
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

/** Plan 4 Task 26: the API's bounds on a recommendation (apps/api staff/limits.ts). */
const LIMIT_REASON_MIN = 40;
const LIMIT_REASON_MAX = 2000;
const LIMIT_CAP_USD_MAX = 1_000_000;

/**
 * Recommend limits (Plan 4 Task 26; no board): for a habitual offender or an obvious hit-and-run
 * case, a cap on one trade or a stage the account is held to, with a reason for the decider. A
 * senior moderator or the owner decides; a lost dispute alone never limits anyone. Whoever may work
 * the case, open or closed. COPY-UNSIGNED, DESIGNER-REVIEW
 */
function LimitsCard({ c, buyer, seller }: { c: DisputeCase; buyer: string; seller: string }) {
  const headId = useId();
  const kindId = useId();
  const stageId = useId();
  const capId = useId();
  const reasonId = useId();
  const [side, setSide] = useState<Side | null>(null);
  const [kind, setKind] = useState<'cap' | 'stage' | null>(null);
  const [cap, setCap] = useState('');
  const [stage, setStage] = useState<'starter' | 'building' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [fault, setFault] = useState<string | null>(null);

  const capUsd = /^[1-9][0-9]{0,6}$/.test(cap.trim()) ? Number(cap.trim()) : null;
  const what = kind === 'cap' ? (capUsd !== null && capUsd <= LIMIT_CAP_USD_MAX ? { capUsd } : null) : kind === 'stage' && stage !== null ? { stage } : null;
  const reasonOk = reason.trim().length >= LIMIT_REASON_MIN && reason.length <= LIMIT_REASON_MAX;
  const ready = side !== null && what !== null && reasonOk && !busy;

  const send = async () => {
    if (!ready || side === null || what === null) return;
    setBusy(true);
    setFault(null);
    try {
      await recommendLimits(c.code, { side, reason, ...what });
      setSent(true);
    } catch (e) {
      // not-a-refusal: one recommendation waits per account at a time.
      if (codeOf(e) === 'wrong-state') setFault('A recommendation for this trader already waits for a decision.');
      else setFault(faultText(e, 'The recommendation could not be sent just now. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="x2f-card" data-part="limits">
      <h2 className="x2f-h2" id={headId}>
        Recommend limits
      </h2>
      {/* not-a-refusal: what the card is for, before any attempt */}
      <p className="x2f-staff-hint">For a habitual offender or an obvious hit-and-run. A senior moderator or the owner decides. The trader sees only their own limit, never your reason.</p>
      {sent ? (
        <Notice tone="info">Sent to a senior moderator or the owner to decide.</Notice>
      ) : (
        <>
          <ChoiceGroup look="tile" labelledBy={headId} options={[{ value: 'buyer', label: buyer }, { value: 'seller', label: seller }]} value={side} onChange={setSide} part="limits-side" />
          <p className="x2f-staff-eyebrow" id={kindId}>
            Limit
          </p>
          <ChoiceGroup look="tile" labelledBy={kindId} options={[{ value: 'cap', label: 'A cap per trade' }, { value: 'stage', label: 'A stage' }]} value={kind} onChange={setKind} part="limits-kind" />
          {kind === 'cap' ? (
            <div className="x2f-field">
              <label className="x2f-label" htmlFor={capId}>
                Largest trade (USD)
              </label>
              <input id={capId} className="x2f-input" inputMode="numeric" autoComplete="off" value={cap} onChange={(e) => setCap(e.target.value)} />
            </div>
          ) : null}
          {kind === 'stage' ? (
            <>
              <p className="x2f-staff-eyebrow" id={stageId}>
                Hold to
              </p>
              <ChoiceGroup look="tile" labelledBy={stageId} options={[{ value: 'starter', label: 'Starter limits' }, { value: 'building', label: 'Building limits' }]} value={stage} onChange={setStage} part="limits-stage" />
            </>
          ) : null}
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={reasonId}>
              Reason (staff only, at least 40 characters)
            </label>
            <textarea id={reasonId} className="x2f-textarea" rows={3} maxLength={LIMIT_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button variant="secondary" disabled={!ready} onClick={() => void send()}>
            Recommend limits
          </Button>
        </>
      )}
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
    </section>
  );
}

function RulingCard({
  c,
  proposing,
  approving,
  rescuing,
  reProposing,
  buyer,
  seller,
  setTap,
  reload,
}: {
  c: DisputeCase;
  proposing: boolean;
  approving: boolean;
  rescuing: boolean;
  reProposing: boolean;
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
      {/* Ruling-winner reasons (lead 22 Nov): why the moderation process's payout waits on the winner. Review m1: "committed" is the winner's own report; m3: `since` is when the reason was logged, not when the payout was recorded. COPY-UNSIGNED; DESIGNER-REVIEW (no board). */}
      {r.payoutWait ? (
        <p className="x2f-staff-hint" data-part="payout-waiting">
          {r.payoutWait.reason === 'winner-committed'
            ? `Since ${hhmm(r.payoutWait.since)}, the payout has been waiting: the winner's app reports it is committed to an earlier payout it built (it sent the moderator a built set for another outcome), so it will not sign this ruling's payout.`
            : `Since ${hhmm(r.payoutWait.since)}, the payout has been waiting: the winner's app has not taken part. Either it has not been opened, or it is committed to an earlier payout the moderator takes no part in.`}
        </p>
      ) : null}
      {/* Review p4t22 M1 (d): the moderation gate will not carry out a ruling, and why. COPY-UNSIGNED; DESIGNER-REVIEW (no board). */}
      {r.gateRefusal ? (
        <p className="x2f-staff-hint" data-part="gate-refused">
          {r.gateRefusal.reason === 'needs-second'
            ? `Since ${hhmm(r.gateRefusal.since)}, the moderation service will not carry out this ruling: it needs a second person's approval (a senior moderator or the owner).`
            : r.gateRefusal.reason === 'revoked'
              ? // Review p4t22 N1. COPY-UNSIGNED
                `Since ${hhmm(r.gateRefusal.since)}, the moderation service will not carry out this ruling: the moderator who signed it was switched off or removed before it was carried out.${r.gateRefusal.rePropose ? ' A senior moderator or the owner can propose a new ruling in its place.' : ''}`
              : r.gateRefusal.reason === 'no-terms'
                ? // Review p4t22 residual (b). COPY-UNSIGNED
                  `Since ${hhmm(r.gateRefusal.since)}, the moderation service will not carry out this ruling: it has no record of this trade's terms. ${c.afterRefund ? 'The seller is shown no payment form, and the time to comply does not run out meanwhile.' : 'No escrow payout is made meanwhile.'}`
                : `Since ${hhmm(r.gateRefusal.since)}, the moderation service will not carry out this ruling (${r.gateRefusal.reason}).`}
        </p>
      ) : null}
      {rescuing ? <SecondApprovalPanel c={c} setTap={setTap} reload={reload} /> : null}
      {reProposing ? <ProposeForm c={c} buyer={buyer} seller={seller} setTap={setTap} reload={reload} replaces={r.gateRefusal!.rePropose!.rulingId} /> : null}
      {/* RC-4 (lead default): the seller's proofs X2F's checker could not take, so a senior deciding a lapse sees X2F's fault. COPY-UNSIGNED; DESIGNER-REVIEW (no board). */}
      {(r.compliance?.failedChecks ?? []).length > 0 ? (
        <ul className="x2f-staff-hint" data-part="proof-check-failed">
          {r.compliance!.failedChecks!.map((f) => (
            <li key={`${f.at}-${f.reason}`}>{`Payment proof tried at ${hhmm(f.at)}, ${f.reason === 'busy' ? 'checker busy' : 'node unavailable'}.`}</li>
          ))}
        </ul>
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
  // not-a-refusal: review p4t22 M1 (e), the moderation service no longer asks for the second approval (it was added, or the case moved on).
  if (code === 'not-refused') return 'The moderation service no longer asks for a second approval. Reload the case.';
  // not-a-refusal: R37, someone involved in round 1 never decides the appeal.
  if (code === 'forbidden-case') return 'You took part in this case before, so you cannot decide it.';
  return faultText(e, fallback);
};

/**
 * `replaces` (review p4t22 N1): the published round-1 ruling the moderation gate refuses as revoked;
 * the form then proposes a new round 1 in its place (`…/re-propose`), with the same normal propose
 * tap. COPY-UNSIGNED for the re-proposal's words; DESIGNER-REVIEW (no board).
 */
function ProposeForm({ c, buyer, seller, setTap, reload, replaces }: { c: DisputeCase; buyer: string; seller: string; setTap: (t: Tap) => void; reload: () => Promise<void>; replaces?: string }) {
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
  const label = replaces !== undefined ? (c.overLimit ? 'Send new ruling for approval' : 'Send new ruling') : c.overLimit ? 'Send ruling for approval' : 'Send ruling';
  // A re-proposal is always a round 1 (review p4t22 N1).
  const round = replaces !== undefined ? 1 : c.round;
  const round1Id = replaces !== undefined ? null : (c.ruling.round1?.id ?? null);
  const xmr = xmrShort(c.escrow.amountAtomic);

  const submit = () => {
    if (!ready || outcome === null) return;
    setFault(null);
    const rulingId = crypto.randomUUID();
    const text = reason;
    const ev = lines;
    setTap({
      intent: rulingIntent('propose', { rulingId, code: c.code, round, round1Id, outcome, amountAtomic: c.escrow.amountAtomic, reason: text, evidence: ev }),
      title: label,
      body: `Tap your security key to sign this ruling: ${OUTCOME_LABELS[outcome]}.`,
      labels: rulingLabels(c, outcome),
      onDone: async (tapId) => {
        try {
          if (replaces !== undefined) await reProposeRuling(c.code, replaces, { rulingId, outcome, reason: text, evidence: ev, tapId });
          else await proposeRuling(c.code, { rulingId, outcome, reason: text, evidence: ev, tapId });
          await reload();
        } catch (e) {
          setFault(rulingFault(e, 'The ruling could not be sent just now. Try again.'));
        }
      },
    });
  };

  return (
    <section className="x2f-card" data-part={replaces !== undefined ? 're-propose' : 'ruling'}>
      <h2 className="x2f-h2" id={headId}>
        {replaces !== undefined ? 'Your new ruling in place of the refused one' : 'Your ruling'}
      </h2>
      {replaces !== undefined ? (
        <p className="x2f-staff-hint">The refused ruling is withdrawn when you send this one. Both traders then see the new ruling, with a new appeal window.</p>
      ) : null}
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
      {c.overLimit && c.secondReason === 'non-usd' ? (
        // Review p4t22 M1 (lead default, owner question OQ1). COPY-UNSIGNED
        <Notice tone="caution" title="Sent to a senior moderator or the owner for approval.">
          This trade is not priced in US dollars, so its ruling needs a second person to approve it. Nothing is signed until they approve.
        </Notice>
      ) : c.overLimit ? (
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

/**
 * Review p4t22 M1 (e), the rescue: a ruling published on one tap that the moderation gate refuses
 * for want of a second person. The tap is the very approve tap of that ruling (its outcome, the
 * trade's XMR, its published reason and evidence), so the key signs nothing a normal approval would
 * not. COPY-UNSIGNED; DESIGNER-REVIEW (no board).
 */
function SecondApprovalPanel({ c, setTap, reload }: { c: DisputeCase; setTap: (t: Tap) => void; reload: () => Promise<void> }) {
  const p = c.ruling.gateRefusal!.secondApproval!;
  const [fault, setFault] = useState<string | null>(null);
  const approve = () => {
    setFault(null);
    setTap({
      intent: rulingIntent('approve', { rulingId: p.rulingId, code: c.code, round: 1, round1Id: null, outcome: p.outcome, amountAtomic: c.escrow.amountAtomic, reason: p.reason, evidence: p.evidence }),
      title: 'Add the second approval',
      body: `Tap your security key to approve this published ruling: ${OUTCOME_LABELS[p.outcome]}. The moderation service then carries it out.`,
      labels: rulingLabels(c, p.outcome),
      onDone: async (tapId) => {
        try {
          await secondApproveRuling(c.code, p.rulingId, tapId);
          await reload();
        } catch (e) {
          setFault(rulingFault(e, 'The approval did not go through. Try again.'));
        }
      },
    });
  };
  return (
    <section className="x2f-card" data-part="second-approval">
      <h2 className="x2f-h2">Published ruling waiting for a second approval</h2>
      <p>{OUTCOME_LABELS[p.outcome]}</p>
      <p>{p.reason}</p>
      {p.evidence.length > 0 ? (
        <ul>
          {p.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      <Button variant="primary" onClick={approve}>
        Add the second approval
      </Button>
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
      intent: rulingIntent('approve', { rulingId: p.rulingId, code: c.code, round: c.round, round1Id: c.ruling.round1?.id ?? null, outcome, amountAtomic: c.escrow.amountAtomic, reason: p.reason, evidence: p.evidence }),
      title: 'Approve ruling',
      body: `Tap your security key to approve and publish this ruling: ${OUTCOME_LABELS[outcome]}.`,
      labels: rulingLabels(c, outcome),
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
