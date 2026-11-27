import { useCallback, useEffect, useId, useState } from 'react';
import { codeOf, pastRepApprove, pastRepList, pastRepReject, pastRepRevoke, pastRepSetUsd, type PastRepClaim, type PastRepPage } from '../api.js';
import { faultText, refusalOf, type StaffRefusal } from '../refusals.js';
import { Button, CantDoThat, EmptyState, ExternalLink, Notice } from '../ui/kit.js';
import { PageTitle, useMe } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import '../ui/staff.css';
import { FaultLine } from '../ui/FaultLine.js';

// Plan 5 Task 11. No board (DESIGN: not drawn; Claude Design owns the look): the staff kit's card,
// field and table styles. DESIGNER-REVIEW
// Every sentence on this page is draft copy. COPY-UNSIGNED

/** The plan's line under the evidence link. */
export const EVIDENCE_NOTE = 'Opens the archive in your browser. X2F never fetches it.';
/** A reject or revoke reason: at least this many characters, as the API checks (PAST_REP_REASON_MIN). */
export const REASON_MIN = 10;
/** The longest reason the API takes (PAST_REP_REASON_MAX, a lead default). */
export const REASON_MAX = 500;
/** Owner Q58: a verified imported figure is at most $100,000 (MAX_VERIFIED_USD_CENTS). */
const MAX_USD_CENTS = 100_000 * 100;

const count = (n: number) => n.toLocaleString('en-US');

/** "$12,500", or "$4,000.50" when there are cents. */
export function usdText(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** The field's text as whole cents: null for an empty field, undefined when it is not a figure the API takes. */
export function parseUsd(text: string): number | null | undefined {
  const t = text.trim().replace(/,/g, '');
  if (t === '') return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return undefined;
  const [d, c = ''] = t.split('.') as [string, string?];
  const cents = Number(d) * 100 + Number(c.padEnd(2, '0'));
  return cents > 0 && cents <= MAX_USD_CENTS ? cents : undefined;
}

const usdField = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));
const reasonOk = (r: string) => r.trim().length >= REASON_MIN && r.trim().length <= REASON_MAX;

/**
 * The moderators' Past reputation page (Plan 5 Task 11; spec 5.5, P5-A23): the claims a trader
 * proved with a signature by the PGP key their archived old profile shows, one at a time. The
 * moderator opens the archive in their own browser (a new tab, no referrer or opener: X2F never
 * fetches it), compares the fingerprint, and approves with the trades the archive shows, or
 * rejects with a reason the trader reads. Senior moderators and the owner also see the approved
 * claims, to revoke one (perm `reputation.revoke`), and enter the verified dollar figure on either
 * (perm `reputation.verify`, owner 2026-11-02: it counts only once the claim is approved). The role
 * here only picks what to show; the API refuses whatever the role may not do.
 */
export function PastRep() {
  const me = useMe();
  const senior = me?.role === 'senior' || me?.role === 'owner';
  const [queue, setQueue] = useState<PastRepClaim[] | null>(null);
  // Re-review m2: the queue's next page, so Skip reaches past the first page.
  const [queueNext, setQueueNext] = useState<string | null>(null);
  const [approved, setApproved] = useState<PastRepPage | null>(null);
  // Review M1: the approved list's trader-name search, as typed and as last asked of the API.
  const [nameText, setNameText] = useState('');
  const [name, setName] = useState('');
  const [at, setAt] = useState(0);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: StaffRefusal; text: string } | null>(null);
  const [openApproved, setOpenApproved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [q, a] = await Promise.all([pastRepList('signed'), senior ? pastRepList('approved', { name }) : Promise.resolve(null)]);
    setQueue(q.items);
    setQueueNext(q.next);
    setApproved(a);
  }, [senior, name]);

  /** Skip: the next claim; past the last one loaded, the queue's next page; past the end, the first. */
  const skip = async (index: number, length: number) => {
    if (index + 1 < length) return setAt(index + 1);
    if (queueNext === null) return setAt(0);
    try {
      const p = await pastRepList('signed', { cursor: queueNext });
      setQueue((q) => [...(q ?? []), ...p.items]);
      setQueueNext(p.next);
      setAt(p.items.length > 0 ? index + 1 : 0);
    } catch (e) {
      setFault(faultText(e, 'X2F could not load more claims just now. Try again.'));
    }
  };

  const moreApproved = async () => {
    if (approved?.next == null) return;
    try {
      const p = await pastRepList('approved', { cursor: approved.next, name });
      setApproved({ items: [...approved.items, ...p.items], next: p.next });
    } catch (e) {
      setFault(faultText(e, 'X2F could not load more claims just now. Try again.'));
    }
  };

  useEffect(() => {
    let live = true;
    load().catch((e: unknown) => {
      if (live) setFault(faultText(e, 'X2F could not load the claims just now. Reload to try again.'));
    });
    return () => {
      live = false;
    };
  }, [load]);

  /** Runs a decision; on success (or a claim someone else decided) the lists are read again. */
  const act = async (run: () => Promise<unknown>): Promise<boolean> => {
    setFault(null);
    try {
      await run();
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) {
        setRefusal(r);
        return false;
      }
      const code = codeOf(e);
      // not-a-refusal: the claim was decided (or revoked) by someone else meanwhile, a state conflict; the list reloads.
      if (code === 'wrong-state' || code === 'not-found' || code === 'not-live') {
        setFault('This claim changed meanwhile. The list is up to date again.');
      } else {
        setFault(faultText(e, 'X2F could not save that just now. Try again.'));
        return false;
      }
    }
    await load().catch((e: unknown) => setFault(faultText(e, 'X2F could not load the claims just now. Reload to try again.')));
    return true;
  };

  const current = queue !== null && queue.length > 0 ? queue[Math.min(at, queue.length - 1)]! : null;
  const index = queue !== null && queue.length > 0 ? Math.min(at, queue.length - 1) : 0;
  const shownApproved = approved?.items.find((c) => c.id === openApproved) ?? null;
  const searchId = useId();

  return (
    <section data-screen="past-rep">
      <PageTitle title="Past reputation">
        <p className="x2f-staff-page__lead">
          Traders prove their record on another site by signing with the PGP key their archived old profile shows. X2F checked the signature. You check the archive.
        </p>
      </PageTitle>
      {fault !== null ? (
        <div data-part="past-rep-fault">
          <Notice tone="danger">
            {/* DESIGN: owner 17 Nov black+orange rule: the load fault's retry is the orange text button. */}
            <FaultLine text={fault} />
          </Notice>
        </div>
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
      <h2 className="x2f-h2">Waiting for a moderator</h2>
      {queue === null ? null : current === null ? (
        <EmptyState icon="shield" title="No claims are waiting" data-part="no-claims">
          New claims show here once a trader signs one.
        </EmptyState>
      ) : (
        <>
          <p className="x2f-staff-hint" data-part="claim-count">
            Claim {index + 1} of {queue.length}
            {queueNext !== null ? '+' : ''}
          </p>
          <WaitingClaim
            key={current.id}
            claim={current}
            canSetFigure={senior}
            act={act}
            onSkip={() => void skip(index, queue.length)}
          />
        </>
      )}
      {senior && approved !== null ? (
        <div data-part="approved-claims" className="x2f-stack">
          <h2 className="x2f-h2">Approved claims</h2>
          <p className="x2f-staff-hint">Newest approval first.</p>
          <form
            className="x2f-field"
            onSubmit={(e) => {
              e.preventDefault();
              setOpenApproved(null);
              setName(nameText.trim());
            }}
          >
            <label className="x2f-label" htmlFor={searchId}>
              Trader name
            </label>
            <input id={searchId} className="x2f-input" value={nameText} maxLength={64} onChange={(e) => setNameText(e.target.value)} />
            <Button variant="secondary" type="submit">
              Search
            </Button>
          </form>
          <Table
            label="Approved claims"
            rows={approved.items}
            rowKey={(r) => r.id}
            empty="No approved claims."
            columns={[
              { title: 'Trader', cell: (r) => r.displayName },
              { title: 'Site', cell: (r) => r.site },
              { title: 'Verified trades', cell: (r) => (r.verifiedTrades === null ? '' : count(r.verifiedTrades)), mono: true },
              { title: 'Verified figure', cell: (r) => (r.verifiedUsdCents === null ? 'None' : usdText(r.verifiedUsdCents)), mono: true },
              {
                title: 'Action',
                cell: (r) => (
                  <Button variant="secondary" onClick={() => setOpenApproved(r.id === openApproved ? null : r.id)}>
                    Review
                  </Button>
                ),
              },
            ]}
          />
          {approved.next !== null ? (
            <Button variant="secondary" onClick={() => void moreApproved()}>
              Show more approved claims
            </Button>
          ) : null}
          {shownApproved !== null ? (
            <ApprovedClaim
              key={shownApproved.id}
              claim={shownApproved}
              act={act}
              onDone={() => setOpenApproved(null)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type Act = (run: () => Promise<unknown>) => Promise<boolean>;

/** What the moderator compares with the archive: who, which site, the link and the fingerprint. */
function ClaimFacts({ claim }: { claim: PastRepClaim }) {
  return (
    <>
      <dl className="x2f-staff-facts">
        <dt>Trader</dt>
        <dd>{claim.displayName}</dd>
        <dt>Site</dt>
        <dd>{claim.site}</dd>
        <dt>Trades claimed</dt>
        <dd className="x2f-mono">{count(claim.claimedTrades)}</dd>
        {claim.verifiedTrades !== null ? (
          <>
            <dt>Trades verified</dt>
            <dd className="x2f-mono">{count(claim.verifiedTrades)}</dd>
          </>
        ) : null}
        <dt>Filed</dt>
        <dd className="x2f-mono">{claim.createdAt.slice(0, 10)}</dd>
        <dt>Signature</dt>
        <dd>Checked by X2F with the key below</dd>
      </dl>
      <p data-part="evidence-link">
        <ExternalLink href={claim.url}>Open the archived profile</ExternalLink>
      </p>
      {/* Review M2 (lead call): the whole link as plain text, so the moderator reads where it goes. */}
      <p className="x2f-mono x2f-staff-url" data-part="evidence-url">
        {claim.url}
      </p>
      <p data-part="original-host">
        {claim.originalHost !== null ? `Archived site: ${claim.originalHost}` : "The link doesn't name the archived site. Read the address on the archived page."}
      </p>
      <p className="x2f-staff-hint" data-part="evidence-note">
        {EVIDENCE_NOTE}
      </p>
      <p className="x2f-staff-hint">Key fingerprint</p>
      <p className="x2f-mono x2f-staff-fingerprint" data-part="fingerprint">
        {claim.fingerprint}
      </p>
      <p className="x2f-staff-hint">Key ID {claim.keyId}</p>
    </>
  );
}

/** The verified dollar figure (senior moderators and the owner; owner Q58: at most $100,000). */
function FigureForm({ claim, act }: { claim: PastRepClaim; act: Act }) {
  const id = useId();
  const [text, setText] = useState(usdField(claim.verifiedUsdCents));
  const cents = parseUsd(text);
  return (
    <div className="x2f-field" data-part="verified-usd">
      <label className="x2f-label" htmlFor={id}>
        Verified dollar figure (US$)
      </label>
      <input id={id} className="x2f-input" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="x2f-staff-hint">The volume the archive proves, up to $100,000. It counts only once the claim is approved. Leave it empty for none.</p>
      <Button variant="secondary" disabled={cents === undefined} onClick={() => void act(() => pastRepSetUsd(claim.id, cents ?? null))}>
        Save figure
      </Button>
    </div>
  );
}

function WaitingClaim({ claim, canSetFigure, act, onSkip }: { claim: PastRepClaim; canSetFigure: boolean; act: Act; onSkip: () => void }) {
  const tradesId = useId();
  const reasonId = useId();
  const [seen, setSeen] = useState(false);
  const [profileSeen, setProfileSeen] = useState(false);
  const [trades, setTrades] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const n = /^\d{1,10}$/.test(trades.trim()) ? Number(trades.trim()) : Number.NaN;
  const tradesOk = Number.isSafeInteger(n) && n >= 1 && n <= claim.claimedTrades;
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await act(f);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="x2f-card x2f-stack" data-part="claim">
      <ClaimFacts claim={claim} />
      <label className="x2f-check">
        <input type="checkbox" data-part="fingerprint-seen" checked={seen} onChange={(e) => setSeen(e.target.checked)} />
        <span>The archived page shows this exact full fingerprint</span>
      </label>
      <label className="x2f-check">
        <input type="checkbox" data-part="profile-seen" checked={profileSeen} onChange={(e) => setProfileSeen(e.target.checked)} />
        {/* Re-review m3: "Other" names no site, so the tick says which page it means. */}
        <span>{claim.site === 'Other' ? "The archived page is the trader's own profile on the archived site" : `The archived page is the trader's profile on ${claim.site}`}</span>
      </label>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor={tradesId}>
          Trades shown on the archived page
        </label>
        <input id={tradesId} className="x2f-input" inputMode="numeric" value={trades} onChange={(e) => setTrades(e.target.value)} />
        {/* not-a-refusal: the field's hint, saying what it takes. */}
        <p className="x2f-staff-hint">At most the {count(claim.claimedTrades)} the trader claimed.</p>
      </div>
      <Button variant="primary" disabled={busy || !seen || !profileSeen || !tradesOk} onClick={() => void run(() => pastRepApprove(claim.id, n))}>
        Approve
      </Button>
      <div className="x2f-field">
        <label className="x2f-label" htmlFor={reasonId}>
          Reason for rejecting
        </label>
        <textarea id={reasonId} className="x2f-textarea" rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="x2f-staff-hint">The trader sees this reason. At least {REASON_MIN} characters.</p>
      </div>
      <Button variant="danger-outline" disabled={busy || !reasonOk(reason)} onClick={() => void run(() => pastRepReject(claim.id, reason.trim()))}>
        Reject
      </Button>
      <Button variant="quiet" disabled={busy} onClick={onSkip}>
        Skip for now
      </Button>
      {canSetFigure ? <FigureForm claim={claim} act={act} /> : null}
    </article>
  );
}

function ApprovedClaim({ claim, act, onDone }: { claim: PastRepClaim; act: Act; onDone: () => void }) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    setBusy(true);
    try {
      if (await act(() => pastRepRevoke(claim.id, reason.trim()))) onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="x2f-card x2f-stack" data-part="approved-claim">
      <ClaimFacts claim={claim} />
      <FigureForm claim={claim} act={act} />
      <div className="x2f-field">
        <label className="x2f-label" htmlFor={reasonId}>
          Reason for revoking
        </label>
        <textarea id={reasonId} className="x2f-textarea" rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="x2f-staff-hint">The trader sees this reason. The claim stops counting at once.</p>
      </div>
      <Button variant="danger-outline" disabled={busy || !reasonOk(reason)} onClick={() => void revoke()}>
        Revoke
      </Button>
    </article>
  );
}
