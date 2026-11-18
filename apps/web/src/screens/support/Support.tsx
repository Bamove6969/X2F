/**
 * Plan 4 Task 31 / J-14: support tickets on the trader app (owner D-054, D-055, D-056, D-057, D-059).
 *
 * - `/support` (`Tickets`): the account's tickets (a team's are shared, owner Q69), and "Open a
 *   ticket": a category ("Everything else" last) and a message. One open ticket at a time (D-055)
 *   and TICKETS_DAILY a day (Q67) are refusals, shown with CantDoThat.
 * - `/support/:id` (`TicketThread`): the thread, a reply box and "Close ticket".
 * - `/support/compromised` (`Compromised`): "My account has been compromised", open without a
 *   login (D-059). The login name, the kinds of login method still in the person's hands (never a
 *   secret: the form has no field for one), and a comment. Sending locks the account at once; the
 *   page then says how to reach staff privately (Matrix or Jabber, owner W-015/W-016 still open).
 *
 * No board exists for these screens yet (Task 31's design step; tripwire NEEDS_DESIGN_TICKETS in
 * test/support.test.tsx): built from the kit's existing classes only, no styling of their own.
 * All wording is COPY-UNSIGNED, for design to word (DESIGN: wording).
 */
import { COMPROMISED_METHODS, TICKETS_DAILY, TICKET_BODY_MAX, TICKET_CATEGORIES, type CompromisedMethod, type TicketCategory } from '@x2f/core';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiCallError, api } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { TICKET_CANT_OPEN_TITLE, TICKET_LIMIT_CODE, TICKET_OPEN_CODE, ticketLimitText, ticketOpenText } from '../../ui/cantDoCodes.js';
import { waitSentence } from '../auth/refusals.js';
import '../screens.css';

// DESIGN: wording. COPY-UNSIGNED: every string below.
export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  'login-security': 'Logging in and security',
  trades: 'A trade',
  offers: 'My offers',
  wallets: 'Wallets',
  'everything-else': 'Everything else',
};

// DESIGN: wording. COPY-UNSIGNED
export const COMPROMISED_METHOD_LABEL: Record<CompromisedMethod, string> = {
  password: 'My password',
  passkey: 'A passkey',
  'security-key': 'A security key',
  pgp: 'My PGP key',
  authenticator: 'My authenticator app',
  'recovery-code': 'A recovery code',
};

export const SUPPORT_COPY = {
  title: 'Support',
  lead: 'Ask X2F staff for help. A team shares its tickets: every member sees them.',
  open: 'Open a ticket',
  category: 'What is it about?',
  message: 'Your message',
  send: 'Send',
  none: 'No tickets yet.',
  compromisedLink: 'My account has been compromised',
  // DESIGN: wording (owner Q67: explain the cap is there to stop spam; design to word it).
  dailyLimit: ticketLimitText(TICKETS_DAILY),
  oneOpen: ticketOpenText,
  badText: 'Your message has a hidden character the form does not take. Retype it, or paste it as plain text.',
  failed: 'That did not send. Try again in a moment.',
  loginFirst: 'Log in to open a ticket.',
  status: { open: 'Open', answered: 'Answered', closed: 'Closed' } as Record<string, string>,
  reply: 'Reply',
  close: 'Close ticket',
  closed: 'This ticket is closed.',
  staff: 'X2F staff',
  you: 'You',
} as const;

export const COMPROMISED_COPY = {
  title: 'My account has been compromised',
  lead: 'Use this if someone else can get into your account. Sending it locks the account at once: nobody can log in, trade or move money with it, and its open trades are paused, until X2F staff have checked it is you.',
  loginName: 'Your username (the private one you log in with, not your display name)',
  methods: 'Which ways to log in do you still have? Tick only what is still in your hands. Never type a password or a code here.',
  comment: 'Tell us what happened (as much as you like)',
  confirm: 'I understand my account will be locked until X2F staff unlock it.',
  send: 'Lock my account',
  sentTitle: 'Your account is locked',
  sent: (n: number) => `Your report is number ${n}. Contact a moderator now, and give them this number.`,
  // W-015/W-016 (owner): the channels are not chosen yet. Placeholders until he does.
  contact: 'X2F staff will talk with you privately on Matrix or on encrypted Jabber over Tor until this is sorted out. Then you log back in and set up your security again.',
  matrix: 'Matrix: address to come',
  jabber: 'Jabber (over Tor): address to come',
  failed: 'That did not send. Try again in a moment.',
} as const;

export interface TicketItem {
  id: string;
  number: number;
  category: string;
  tradeCode: string | null;
  status: 'open' | 'answered' | 'closed';
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface TicketMessage {
  author: 'trader' | 'staff';
  memberName: string | null;
  body: string;
  at: string;
}

const categoryLabel = (c: string): string => (TICKET_CATEGORY_LABEL as Record<string, string>)[c] ?? c;
const when = (iso: string): string => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

type CantDo = { code: string; text: string } | null;

export function Tickets() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketItem[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [category, setCategory] = useState<TicketCategory>('everything-else');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cantDo, setCantDo] = useState<CantDo>(null);
  const catId = useId();
  const textId = useId();

  const load = useCallback(async () => {
    try {
      setTickets((await api<{ tickets: TicketItem[] }>('/v1/tickets')).tickets);
    } catch (e) {
      if (e instanceof ApiCallError && e.status === 401) setSignedOut(true);
      else setError(SUPPORT_COPY.failed);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const clean = text.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (clean === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { ticket } = await api<{ ticket: TicketItem }>('/v1/tickets', { method: 'POST', body: { category, body: clean } });
      void navigate(`/support/${ticket.id}`);
    } catch (err) {
      if (err instanceof ApiCallError && err.code === TICKET_OPEN_CODE) {
        setCantDo({ code: TICKET_OPEN_CODE, text: SUPPORT_COPY.oneOpen(Number(err.extra.number)) });
      } else if (err instanceof ApiCallError && err.status === 429 && err.extra.limit === 'daily') {
        setCantDo({ code: TICKET_LIMIT_CODE, text: SUPPORT_COPY.dailyLimit });
      } else if (err instanceof ApiCallError && (err.status === 429 || err.status === 503)) setError(waitSentence(err.retryAfterSeconds));
      else if (err instanceof ApiCallError && err.status === 400) setError(SUPPORT_COPY.badText);
      else if (err instanceof ApiCallError && err.status === 401) setSignedOut(true);
      else setError(SUPPORT_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="x2f-screen" data-screen="support">
      <h1 className="x2f-screen__title">{SUPPORT_COPY.title}</h1>
      <p className="x2f-screen__lead">{SUPPORT_COPY.lead}</p>
      {signedOut ? (
        <p className="x2f-note" data-part="support-login-first">
          <Link className="x2f-link" to="/login?returnTo=%2Fsupport">
            {SUPPORT_COPY.loginFirst}
          </Link>
        </p>
      ) : (
        <>
          <section className="x2f-card x2f-stack" aria-labelledby="open-ticket-h" data-part="open-ticket">
            <h2 id="open-ticket-h">{SUPPORT_COPY.open}</h2>
            <form className="x2f-stack" onSubmit={(e) => void submit(e)}>
              <div className="x2f-field">
                <label className="x2f-label" htmlFor={catId}>
                  {SUPPORT_COPY.category}
                </label>
                <select className="x2f-select" id={catId} value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
                  {TICKET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {TICKET_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="x2f-field">
                <label className="x2f-label" htmlFor={textId}>
                  {SUPPORT_COPY.message}
                </label>
                <textarea id={textId} className="x2f-input" rows={5} maxLength={TICKET_BODY_MAX} value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              {error !== null ? (
                <p className="x2f-error" role="alert">
                  {error}
                </p>
              ) : null}
              <Button variant="primary" type="submit" disabled={clean === '' || busy} aria-busy={busy}>
                {SUPPORT_COPY.send}
              </Button>
            </form>
          </section>
          <ul className="x2f-list" data-part="ticket-list">
            {tickets !== null && tickets.length === 0 ? <li className="x2f-note">{SUPPORT_COPY.none}</li> : null}
            {(tickets ?? []).map((t) => (
              <li key={t.id} data-ticket={t.number}>
                <Link className="x2f-link" to={`/support/${t.id}`}>
                  {`#${t.number} ${categoryLabel(t.category)}`}
                </Link>{' '}
                <span data-part="ticket-status">{SUPPORT_COPY.status[t.status]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        <Link className="x2f-link" to="/support/compromised" data-part="compromised-link">
          {SUPPORT_COPY.compromisedLink}
        </Link>
      </p>
      {cantDo !== null ? <CantDoThat title={TICKET_CANT_OPEN_TITLE} body={cantDo.text} from={cantDo.code} onClose={() => setCantDo(null)} /> : null}
    </main>
  );
}

export function TicketThread() {
  const { id = '' } = useParams();
  const [data, setData] = useState<{ ticket: TicketItem; messages: TicketMessage[] } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replyId = useId();

  const load = useCallback(async () => {
    try {
      setData(await api<{ ticket: TicketItem; messages: TicketMessage[] }>(`/v1/tickets/${encodeURIComponent(id)}`));
    } catch {
      setError(SUPPORT_COPY.failed);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', ...(body !== undefined ? { body } : {}) });
      setText('');
      await load();
    } catch (err) {
      setError(err instanceof ApiCallError && err.status === 400 ? SUPPORT_COPY.badText : SUPPORT_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  const t = data?.ticket;
  return (
    <main className="x2f-screen" data-screen="ticket">
      <h1 className="x2f-screen__title">{t ? `#${t.number} ${categoryLabel(t.category)}` : SUPPORT_COPY.title}</h1>
      {t ? <p data-part="ticket-status">{SUPPORT_COPY.status[t.status]}</p> : null}
      <ol className="x2f-list" data-part="ticket-thread">
        {(data?.messages ?? []).map((m, i) => (
          <li key={i} data-author={m.author}>
            <p className="x2f-note">{`${m.author === 'staff' ? SUPPORT_COPY.staff : (m.memberName ?? SUPPORT_COPY.you)} · ${when(m.at)}`}</p>
            <p data-part="ticket-body">{m.body}</p>
          </li>
        ))}
      </ol>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
      {t && t.status !== 'closed' ? (
        <form
          className="x2f-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() !== '' && !busy) void act(`/v1/tickets/${encodeURIComponent(id)}/messages`, { body: text.trim() });
          }}
        >
          <div className="x2f-field">
            <label className="x2f-label" htmlFor={replyId}>
              {SUPPORT_COPY.reply}
            </label>
            <textarea id={replyId} className="x2f-input" rows={4} maxLength={TICKET_BODY_MAX} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <Button variant="primary" type="submit" disabled={text.trim() === '' || busy}>
            {SUPPORT_COPY.send}
          </Button>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => void act(`/v1/tickets/${encodeURIComponent(id)}/close`)}>
            {SUPPORT_COPY.close}
          </Button>
        </form>
      ) : t ? (
        <p className="x2f-note">{SUPPORT_COPY.closed}</p>
      ) : null}
    </main>
  );
}

export function Compromised() {
  const [loginName, setLoginName] = useState('');
  const [methods, setMethods] = useState<CompromisedMethod[]>([]);
  const [comment, setComment] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [number, setNumber] = useState<number | null>(null);
  const nameId = useId();
  const commentId = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loginName.trim() === '' || !confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ number: number }>('/v1/tickets/compromised', {
        method: 'POST',
        body: { loginName: loginName.trim(), methodsLeft: [...methods].sort(), comment: comment.trim() },
      });
      setNumber(r.number);
    } catch (err) {
      if (err instanceof ApiCallError && (err.status === 429 || err.status === 503)) setError(waitSentence(err.retryAfterSeconds));
      else setError(COMPROMISED_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  if (number !== null) {
    return (
      <main className="x2f-screen" data-screen="compromised">
        <h1 className="x2f-screen__title" data-part="compromised-sent">
          {COMPROMISED_COPY.sentTitle}
        </h1>
        <p role="status" data-part="compromised-number">
          {COMPROMISED_COPY.sent(number)}
        </p>
        <p>{COMPROMISED_COPY.contact}</p>
        <ul className="x2f-list" data-part="compromised-contact">
          <li>{COMPROMISED_COPY.matrix}</li>
          <li>{COMPROMISED_COPY.jabber}</li>
        </ul>
      </main>
    );
  }

  return (
    <main className="x2f-screen" data-screen="compromised">
      <h1 className="x2f-screen__title">{COMPROMISED_COPY.title}</h1>
      <p className="x2f-screen__lead">{COMPROMISED_COPY.lead}</p>
      <form className="x2f-stack" onSubmit={(e) => void submit(e)}>
        <div className="x2f-field">
          <label className="x2f-label" htmlFor={nameId}>
            {COMPROMISED_COPY.loginName}
          </label>
          <input id={nameId} className="x2f-input" autoComplete="username" value={loginName} maxLength={256} onChange={(e) => setLoginName(e.target.value)} />
        </div>
        <fieldset className="x2f-stack" data-part="compromised-methods">
          <legend className="x2f-label">{COMPROMISED_COPY.methods}</legend>
          {COMPROMISED_METHODS.map((m) => (
            <label key={m} className="x2f-row">
              <input
                type="checkbox"
                checked={methods.includes(m)}
                onChange={(e) => setMethods((cur) => (e.target.checked ? [...cur, m] : cur.filter((x) => x !== m)))}
              />
              {COMPROMISED_METHOD_LABEL[m]}
            </label>
          ))}
        </fieldset>
        <div className="x2f-field">
          <label className="x2f-label" htmlFor={commentId}>
            {COMPROMISED_COPY.comment}
          </label>
          <textarea id={commentId} className="x2f-input" rows={5} maxLength={TICKET_BODY_MAX} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <label className="x2f-row">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          {COMPROMISED_COPY.confirm}
        </label>
        {error !== null ? (
          <p className="x2f-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button variant="primary" type="submit" disabled={loginName.trim() === '' || !confirmed || busy} aria-busy={busy}>
          {COMPROMISED_COPY.send}
        </Button>
      </form>
    </main>
  );
}
