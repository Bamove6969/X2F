/**
 * Plan 4 Task 31 / J-14 on the staff site: the ticket queue and a ticket's case (perm
 * `tickets.handle`), and the "My account has been compromised" queue and case (perm
 * `accounts.freeze`: senior moderators and the owner), with the unlock (a security-key tap).
 *
 * No board yet (Task 31's design step; NEEDS_DESIGN): StaffLog's table styles and the kit only.
 * DESIGNER-REVIEW. Every sentence on these pages is draft copy. COPY-UNSIGNED, DESIGN: wording.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router';
import {
  compromisedCase,
  compromisedClose,
  compromisedQueue,
  compromisedUnlock,
  ticketCase,
  ticketClose,
  ticketQueue,
  ticketReply,
  type CompromisedCase,
  type CompromisedItem,
  type StaffTicket,
  type StaffTicketMessage,
  type TicketStatus,
} from '../api.js';
import { faultText, refusalOf } from '../refusals.js';
import { KeyTapDialog } from '../ui/KeyTapDialog.js';
import { Button, CantDoThat, Notice } from '../ui/kit.js';
import { PageTitle } from '../ui/StaffShell.js';
import { Table } from '../ui/Table.js';
import '../ui/staff.css';

export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  'login-security': 'Logging in and security',
  trades: 'A trade',
  offers: 'My offers',
  wallets: 'Wallets',
  'everything-else': 'Everything else',
};
const STATUS_LABELS: Readonly<Record<TicketStatus, string>> = { open: 'Open', answered: 'Answered', closed: 'Closed' };
const METHOD_LABELS: Readonly<Record<string, string>> = {
  password: 'Password',
  passkey: 'Passkey',
  'security-key': 'Security key',
  pgp: 'PGP key',
  authenticator: 'Authenticator app',
  'recovery-code': 'Recovery code',
};
const when = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

export function Tickets() {
  return (
    <Routes>
      <Route index element={<TicketQueue />} />
      <Route path=":id" element={<TicketCase />} />
    </Routes>
  );
}

function TicketQueue() {
  const [status, setStatus] = useState<TicketStatus>('open');
  const [rows, setRows] = useState<StaffTicket[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    ticketQueue(status).then(
      (r) => live && setRows(r.tickets),
      (e: unknown) => live && setFault(faultText(e, 'X2F could not load the tickets just now. Reload to try again.')),
    );
    return () => {
      live = false;
    };
  }, [status]);
  return (
    <section data-screen="tickets">
      <PageTitle title="Tickets">
        <p className="x2f-staff-page__lead">Oldest first. Open a ticket to answer it.</p>
      </PageTitle>
      <p className="x2f-row" data-part="ticket-filter">
        {(['open', 'answered', 'closed'] as const).map((s) => (
          <Button key={s} variant={s === status ? 'secondary' : 'quiet'} aria-pressed={s === status} onClick={() => setStatus(s)}>
            {STATUS_LABELS[s]}
          </Button>
        ))}
      </p>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      <Table
        label="Tickets"
        rows={rows ?? []}
        rowKey={(r) => r.id}
        empty="No tickets here."
        columns={[
          { title: 'Ticket', mono: true, cell: (r) => <Link className="x2f-link" to={`/tickets/${r.id}`}>{`#${r.number}`}</Link> },
          { title: 'About', cell: (r) => CATEGORY_LABELS[r.category] ?? r.category },
          { title: 'Trader', cell: (r) => r.displayName ?? '' },
          { title: 'Opened', mono: true, cell: (r) => when(r.createdAt) },
        ]}
      />
    </section>
  );
}

function TicketCase() {
  const { id = '' } = useParams();
  const [data, setData] = useState<{ ticket: StaffTicket; displayName: string | null; messages: StaffTicketMessage[] } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const replyId = useId();
  const load = useCallback(async () => {
    try {
      setData(await ticketCase(id));
    } catch (e) {
      setFault(faultText(e, 'X2F could not load this ticket. Reload to try again.'));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFault(null);
    try {
      await fn();
      setText('');
      await load();
    } catch (e) {
      setFault(faultText(e, 'That did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const t = data?.ticket;
  return (
    <section data-screen="ticket-case">
      <PageTitle title={t ? `Ticket #${t.number}` : 'Ticket'}>
        {t ? (
          <p className="x2f-staff-page__lead">
            {`${CATEGORY_LABELS[t.category] ?? t.category} · ${data?.displayName ?? ''} · ${STATUS_LABELS[t.status]}`}
            {t.tradeCode !== null ? ` · Trade ${t.tradeCode}` : ''}
          </p>
        ) : null}
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      <ol className="x2f-stack" data-part="ticket-thread">
        {(data?.messages ?? []).map((m, i) => (
          <li key={i} data-author={m.author}>
            <p className="x2f-staff-page__lead">{`${m.author === 'staff' ? `Staff: ${m.staffName ?? ''}` : (m.memberName ? `Team member ${m.memberName}` : 'Trader')} · ${when(m.at)}`}</p>
            <p>{m.body}</p>
          </li>
        ))}
      </ol>
      {t && t.status !== 'closed' ? (
        <form
          className="x2f-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() !== '' && !busy) void act(() => ticketReply(id, text.trim()));
          }}
        >
          <label className="x2f-label" htmlFor={replyId}>
            Answer
          </label>
          <textarea id={replyId} className="x2f-input" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          <Button variant="primary" type="submit" disabled={text.trim() === '' || busy}>
            Send answer
          </Button>
          <Button variant="quiet" type="button" disabled={busy} onClick={() => void act(() => ticketClose(id))}>
            Close ticket
          </Button>
        </form>
      ) : null}
    </section>
  );
}

export function Compromised() {
  return (
    <Routes>
      <Route index element={<CompromisedQueue />} />
      <Route path=":id" element={<CompromisedCaseView />} />
    </Routes>
  );
}

function CompromisedQueue() {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [rows, setRows] = useState<CompromisedItem[] | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    compromisedQueue(status).then(
      (r) => live && setRows(r.tickets),
      (e: unknown) => live && setFault(faultText(e, 'X2F could not load the reports just now. Reload to try again.')),
    );
    return () => {
      live = false;
    };
  }, [status]);
  return (
    <section data-screen="compromised">
      <PageTitle title="Compromised accounts">
        <p className="x2f-staff-page__lead">
          Each report locked the account it named at once. Talk with the person on Matrix or Jabber, check it is the real owner, then unlock.
        </p>
      </PageTitle>
      <p className="x2f-row">
        {(['open', 'closed'] as const).map((s) => (
          <Button key={s} variant={s === status ? 'secondary' : 'quiet'} aria-pressed={s === status} onClick={() => setStatus(s)}>
            {s === 'open' ? 'Open' : 'Closed'}
          </Button>
        ))}
      </p>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      <Table
        label="Compromised-account reports"
        rows={rows ?? []}
        rowKey={(r) => r.id}
        empty="No reports here."
        columns={[
          { title: 'Report', mono: true, cell: (r) => <Link className="x2f-link" to={`/compromised/${r.id}`}>{`#${r.number}`}</Link> },
          { title: 'Account', cell: (r) => (r.matched ? (r.displayName ?? 'Team member login') : 'No account matched') },
          { title: 'Locked', cell: (r) => (r.locked ? 'Locked' : 'Not locked') },
          { title: 'Sent', mono: true, cell: (r) => when(r.createdAt) },
        ]}
      />
    </section>
  );
}

function CompromisedCaseView() {
  const { id = '' } = useParams();
  const [data, setData] = useState<CompromisedCase | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ code: string; text: string } | null>(null);
  const [tapping, setTapping] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await compromisedCase(id));
    } catch (e) {
      setFault(faultText(e, 'X2F could not load this report. Reload to try again.'));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>) => {
    setFault(null);
    try {
      await fn();
      await load();
    } catch (e) {
      const r = refusalOf(e);
      if (r !== null) setRefusal(r);
      else setFault(faultText(e, 'That did not go through. Try again.'));
    }
  };
  const t = data?.ticket;
  const a = data?.account ?? null;
  return (
    <section data-screen="compromised-case">
      <PageTitle title={t ? `Report #${t.number}` : 'Report'}>
        {t ? <p className="x2f-staff-page__lead">{`Sent ${when(t.createdAt)} · ${t.status === 'closed' ? 'Closed' : 'Open'}`}</p> : null}
      </PageTitle>
      {fault !== null ? <Notice tone="danger">{fault}</Notice> : null}
      {data ? (
        <div className="x2f-stack">
          <h2 className="x2f-h2">What they sent</h2>
          <p data-part="compromised-methods">
            {`Still has: ${data.methodsLeft.length === 0 ? 'nothing ticked' : data.methodsLeft.map((m) => METHOD_LABELS[m] ?? m).join(', ')}`}
          </p>
          <p data-part="compromised-comment">{data.comment ?? 'No comment.'}</p>
          <h2 className="x2f-h2">Account</h2>
          {a === null ? (
            <p>No account matched the username, so nothing was locked.</p>
          ) : (
            <>
              <p data-part="compromised-account">
                {`${a.displayName ?? 'A team member login'} · since ${a.createdAt.slice(0, 10)} · ${a.lockedAt !== null ? `locked ${when(a.lockedAt)}` : 'not locked'}`}
              </p>
              <Table
                label="Open trades"
                rows={a.openTrades}
                rowKey={(r) => r.code}
                empty="No open trades."
                columns={[
                  { title: 'Trade', mono: true, cell: (r) => r.code },
                  { title: 'Side', cell: (r) => (r.side === 'seller' ? 'Seller' : 'Buyer') },
                  { title: 'State', cell: (r) => r.state },
                  { title: 'Timers', cell: (r) => (r.paused ? 'Paused' : 'Running') },
                ]}
              />
              {a.lockedAt !== null ? (
                <Button variant="danger" onClick={() => setTapping(true)}>
                  Unlock account
                </Button>
              ) : null}
            </>
          )}
          {t && t.status !== 'closed' ? (
            <Button variant="quiet" onClick={() => void run(() => compromisedClose(id))}>
              Close report
            </Button>
          ) : null}
        </div>
      ) : null}
      {tapping && t && data?.account ? (
        <UnlockTap
          ticketId={id}
          accountId={data.account.id}
          onDone={() => {
            setTapping(false);
            void load();
          }}
          onCancel={() => setTapping(false)}
          onFault={(m) => {
            setTapping(false);
            setFault(m);
          }}
        />
      ) : null}
      {refusal !== null ? <CantDoThat body={refusal.text} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
    </section>
  );
}

/** The unlock, tapped with a security key bound to the account (`unlock-account`). */
function UnlockTap({
  ticketId,
  accountId,
  onDone,
  onCancel,
  onFault,
}: {
  ticketId: string;
  accountId: string;
  onDone: () => void;
  onCancel: () => void;
  onFault: (m: string) => void;
}) {
  return (
    <KeyTapDialog
      intent={{ kind: 'unlock-account', accountId }}
      title="Unlock this account?"
      body="Only unlock once you are sure you are talking with the real owner. They can log in and trade again at once, and their paused trades start again."
      onDone={(tapId) =>
        void compromisedUnlock(ticketId, tapId).then(onDone, (e: unknown) => onFault(faultText(e, 'The unlock did not go through. Try again.')))
      }
      onCancel={onCancel}
    />
  );
}
