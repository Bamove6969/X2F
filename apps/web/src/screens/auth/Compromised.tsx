/**
 * "My account has been compromised" (owner D-059; J-14, ported; board Compromised, flow map 1b):
 * open at the front door without a login, since the person may have lost every way in. Three
 * steps, as the board draws them:
 *
 * - `form`: the username (the private login name), the ways to log in still in the person's hands
 *   (COMPROMISED_METHODS, kinds only: the form has no field for a password, a code or a key) or
 *   "None of these", and an optional comment.
 * - `confirm`: "Freeze <name> now?", what a full lockout does, and what they told us.
 * - `frozen`: the ticket number (CT-n) to give a moderator, what happens next, and the moderator
 *   contact link from the owner's Settings.
 *
 * API: `POST /v1/tickets/compromised` (apps/api/src/tickets/compromisedRoutes.ts) answers 202 the
 * same whatever the name matched, so this screen never says whether the name exists, and it never
 * lists the account's trades (lead default, owner question pending: the board shows the paused
 * trades on its last step, which would tell anyone typing a name what that account trades).
 *
 * Open questions on the board, answered with lead defaults (owner question pending):
 * - "Must the user tick at least one box to send?": yes, at least one tick, "None of these"
 *   counting as one (the board's preview default, `tickRule=required`).
 * - "Does the user get a ticket number?": yes, CT-<number> (compromisedTicketLabel).
 * - The Matrix and Telegram handles are not decided: the screen links the one moderator contact the
 *   owner set in Settings, when there is one.
 *
 * All wording is the board's draft copy (COPY-UNSIGNED).
 */
import { COMPROMISED_METHODS, compromisedTicketLabel, type CompromisedMethod } from '@x2f/core';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiCallError, api } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { CANT_DO_TITLE } from '../../ui/cantDoCodes.js';
import { CheckRow } from '../../ui/CheckRow.js';
import { ExternalLink } from '../../ui/ExternalLink.js';
import { Facts } from '../../ui/Facts.js';
import { Notice } from '../../ui/Notice.js';
import { waitSentence } from './refusals.js';
import '../screens.css';

export const COMPROMISED_PATH = '/login/compromised';

/** The comment's length cap (the board's textarea; the API takes up to TICKET_BODY_MAX). */
export const COMPROMISED_NOTE_MAX = 2000;

/** The board's labels, in its order. COPY-UNSIGNED */
export const COMPROMISED_METHOD_LABEL: Readonly<Record<CompromisedMethod, string>> = {
  password: 'Password',
  passkey: 'Passkey',
  'security-key': 'Security key',
  pgp: 'PGP key',
  authenticator: 'Authenticator app',
  'recovery-code': 'Recovery code',
};

/** COPY-UNSIGNED: the board Compromised's draft copy. */
export const COMPROMISED_COPY = {
  title: 'My account has been compromised',
  lead: 'Tell us which account it is. When you send this, we freeze the account straight away, so nobody can use it.',
  username: 'Username',
  methods: 'Ways to log in you still have',
  methodsHint: "Tick every one you can still use. A moderator uses these to check it's really you.",
  none: 'None of these',
  note: 'Anything else we should know (optional)',
  notePlaceholder: 'For example: when you noticed, and what changed',
  send: 'Freeze my account',
  needName: 'Enter your username first.',
  needTick: 'Tick at least one box. Choose "None of these" if you have nothing left.',
  checkLabel: 'Check before you freeze',
  confirmTitle: (name: string) => `Freeze ${name} now?`,
  effects: [
    'Everyone is locked out at once, you included. Every device is logged out.',
    'If someone else has your login, they are locked out too.',
    'Your open trades are paused. Their timers stop, so nobody loses a trade while the account is frozen.',
    "To unfreeze it, you talk to a moderator, who checks it's really you.",
  ],
  told: 'What you told us',
  stillHave: 'Still have',
  comment: 'Comment',
  noComment: 'Nothing',
  yes: 'Yes, freeze it now',
  edit: 'Go back and edit',
  frozenLabel: 'Account frozen',
  frozenTitle: (name: string) => `Nobody can use ${name} now`,
  frozenLead: 'Every device is logged out, including any the attacker used.',
  ticket: 'Your ticket number',
  next: 'What happens next',
  steps: [
    'Message a moderator and give them your ticket number.',
    "They check it's really you, using the ways to log in you still have.",
    'Together you remove anything the attacker added and set up new ways to log in.',
    'Then we unfreeze the account, and your paused trades carry on where they stopped.',
  ],
  reach: 'Reach a moderator',
  contact: 'Message a moderator',
  // The owner has not set a moderator contact yet (Settings): the channels are still to be decided.
  noContact: 'The moderator contact address is still to be announced. Keep your ticket number until then.',
  failed: 'That did not send. Try again in a moment.',
  back: 'Back to log in',
} as const;

type Step = { kind: 'form' } | { kind: 'confirm' } | { kind: 'frozen'; number: number; moderatorUrl: string | null };

export function Compromised() {
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [name, setName] = useState('');
  const [have, setHave] = useState<readonly CompromisedMethod[]>([]);
  const [none, setNone] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ body: string; code: string } | null>(null);
  const nameId = useId();
  const noteId = useId();
  const hintId = useId();

  const user = name.trim();
  const ticked = have.length > 0 || none;
  // Lead default (owner question pending, board "Must the user tick at least one box to send?"): at least one tick.
  const hint = user === '' ? COMPROMISED_COPY.needName : !ticked ? COMPROMISED_COPY.needTick : null;
  const toggle = (m: CompromisedMethod, on: boolean) => {
    setHave((cur) => (on ? [...cur.filter((x) => x !== m), m] : cur.filter((x) => x !== m)));
    if (on) setNone(false);
  };
  const pickNone = (on: boolean) => {
    setNone(on);
    if (on) setHave([]);
  };

  const toConfirm = (e: FormEvent) => {
    e.preventDefault();
    if (hint === null) setStep({ kind: 'confirm' });
  };

  const freeze = async () => {
    if (busy) return;
    setBusy(true);
    setFault(null);
    try {
      const methodsLeft = COMPROMISED_METHODS.filter((m) => have.includes(m));
      const r = await api<{ number: number; moderatorUrl: string | null }>('/v1/tickets/compromised', {
        method: 'POST',
        body: { loginName: user, methodsLeft, comment: note.trim() },
      });
      setStep({ kind: 'frozen', number: r.number, moderatorUrl: typeof r.moderatorUrl === 'string' ? r.moderatorUrl : null });
    } catch (err) {
      if (err instanceof ApiCallError && (err.status === 429 || err.status === 503)) setRefusal({ body: waitSentence(err.retryAfterSeconds), code: err.code });
      else setFault(COMPROMISED_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'frozen') {
    return (
      <main className="x2f-screen" data-screen="compromised" data-step="frozen">
        <p className="x2f-fine">{COMPROMISED_COPY.frozenLabel}</p>
        <h1 className="x2f-screen__title" data-part="compromised-frozen">
          {COMPROMISED_COPY.frozenTitle(user)}
        </h1>
        <p className="x2f-screen__lead">{COMPROMISED_COPY.frozenLead}</p>
        <Facts layout="stacked" part="compromised-ticket" rows={[{ key: COMPROMISED_COPY.ticket, value: compromisedTicketLabel(step.number), mono: true, strong: true }]} />
        <section className="x2f-stack" aria-labelledby={`${hintId}-next`}>
          <h2 id={`${hintId}-next`}>{COMPROMISED_COPY.next}</h2>
          <ol className="x2f-list" data-part="compromised-next">
            {COMPROMISED_COPY.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>
        <section className="x2f-stack" aria-labelledby={`${hintId}-reach`} data-part="compromised-contact">
          <h2 id={`${hintId}-reach`}>{COMPROMISED_COPY.reach}</h2>
          {step.moderatorUrl !== null && /^https:\/\//i.test(step.moderatorUrl) ? (
            <p>
              <ExternalLink href={step.moderatorUrl}>{COMPROMISED_COPY.contact}</ExternalLink>
            </p>
          ) : (
            <p className="x2f-note">{COMPROMISED_COPY.noContact}</p>
          )}
        </section>
      </main>
    );
  }

  if (step.kind === 'confirm') {
    const stillHave = none ? COMPROMISED_COPY.none : COMPROMISED_METHODS.filter((m) => have.includes(m)).map((m) => COMPROMISED_METHOD_LABEL[m]).join(', ');
    return (
      <main className="x2f-screen" data-screen="compromised" data-step="confirm">
        <p className="x2f-fine">{COMPROMISED_COPY.checkLabel}</p>
        <h1 className="x2f-screen__title">{COMPROMISED_COPY.confirmTitle(user)}</h1>
        <ul className="x2f-list" data-part="compromised-effects">
          {COMPROMISED_COPY.effects.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <h2>{COMPROMISED_COPY.told}</h2>
        <Facts
          layout="raised"
          part="compromised-told"
          rows={[
            { key: COMPROMISED_COPY.username, value: user, mono: true },
            { key: COMPROMISED_COPY.stillHave, value: stillHave },
            { key: COMPROMISED_COPY.comment, value: note.trim() === '' ? COMPROMISED_COPY.noComment : note.trim() },
          ]}
        />
        {fault !== null ? (
          <Notice tone="danger" data-part="compromised-failed">
            {fault}
          </Notice>
        ) : null}
        <div className="x2f-stack">
          <Button variant="danger" data-primary="" onClick={() => void freeze()} disabled={busy} aria-busy={busy} data-part="compromised-freeze">
            {COMPROMISED_COPY.yes}
          </Button>
          <Button variant="quiet" onClick={() => setStep({ kind: 'form' })} disabled={busy} data-part="compromised-edit">
            {COMPROMISED_COPY.edit}
          </Button>
        </div>
        {refusal !== null ? <CantDoThat title={CANT_DO_TITLE.compromised} body={refusal.body} from={refusal.code} onClose={() => setRefusal(null)} /> : null}
      </main>
    );
  }

  return (
    <main className="x2f-screen" data-screen="compromised" data-step="form">
      <h1 className="x2f-screen__title">{COMPROMISED_COPY.title}</h1>
      <p className="x2f-screen__lead">{COMPROMISED_COPY.lead}</p>
      <form className="x2f-stack" onSubmit={toConfirm} noValidate>
        <div className="x2f-field">
          <label className="x2f-field-label" htmlFor={nameId}>
            {COMPROMISED_COPY.username}
          </label>
          <input
            id={nameId}
            className="x2f-input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={name}
            maxLength={256}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <fieldset className="x2f-stack" data-part="compromised-methods">
          <legend className="x2f-field-label">{COMPROMISED_COPY.methods}</legend>
          <p className="x2f-fine">{COMPROMISED_COPY.methodsHint}</p>
          {COMPROMISED_METHODS.map((m) => (
            <CheckRow key={m} part={`have-${m}`} checked={have.includes(m)} onChange={(on) => toggle(m, on)} title={COMPROMISED_METHOD_LABEL[m]} />
          ))}
          <CheckRow part="have-none" checked={none} onChange={pickNone} title={COMPROMISED_COPY.none} />
        </fieldset>
        <div className="x2f-field">
          <label className="x2f-field-label" htmlFor={noteId}>
            {COMPROMISED_COPY.note}
          </label>
          <textarea
            id={noteId}
            className="x2f-input x2f-input--message"
            rows={4}
            maxLength={COMPROMISED_NOTE_MAX}
            placeholder={COMPROMISED_COPY.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {hint !== null ? (
          <p id={hintId} className="x2f-fine" data-part="compromised-hint">
            {hint}
          </p>
        ) : null}
        <Button variant="primary" type="submit" disabled={hint !== null} aria-describedby={hint !== null ? hintId : undefined} data-part="compromised-send">
          {COMPROMISED_COPY.send}
        </Button>
      </form>
      <p className="x2f-screen__foot">
        <Link className="x2f-link" to="/login" data-part="back-to-login">
          {COMPROMISED_COPY.back}
        </Link>
      </p>
    </main>
  );
}
