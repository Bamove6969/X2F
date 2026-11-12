/**
 * ChatPanel (Plan 3 Task 20): the encrypted chat between a buyer and a seller, before and during a
 * trade. Every key and every ciphertext stays in the escrow worker's chat engine (engine.ts); the
 * panel only ever sees verified plain lines (`ChatSnapshot`).
 *
 * - Always shows the spec 6.6 notice (P3-M2).
 * - A moderator's line: the engine shows one only while a dispute is open, signed by the chat's
 *   attested mod identity AND recorded by the server as the moderator, so it cannot be put on a
 *   trader's words. Inside DisputeRoom (`dispute` prop) it carries the violet badge through Task
 *   27's ModeratorTag (only when the server's dispute record names a moderator; the badge stays in
 *   the dispute screens, test/moderator-badge-scope.test.ts); elsewhere it reads "Moderator".
 * - Another device of the same account reads "This conversation is open on another device" and
 *   gets no composer (the chat identity lives on the device that made it).
 * - A sender whose seq skipped shows "A message is missing" before the next line (review M5).
 * - Re-syncs on the chat's live event (App.tsx's one connection, live.ts), on the trade's live
 *   event (a dispute opening), and on a timer as a backstop. A sync that stopped at the engine's
 *   page cap (`more`) is followed by another at once while it keeps showing new lines (review M8).
 * - Accessibility (review M3): the composer stays focusable while sending (read-only and
 *   aria-disabled, never disabled) and gets focus back after a send; only new lines from the other
 *   side are announced, in a visually hidden status region; each line reads "Sam: hello"; the list
 *   is a labelled, focusable scroll region kept at its newest line; the waiting states are a status.
 *
 * - "Block <name>" (Task 37's `BlockAction`, kit parts) sits under the notice. After a block the
 *   panel re-syncs: a pre-trade chat then answers 404 (the API refuses a blocked pair) and the
 *   panel drops its composer with "This chat has been closed."; the chat of a trade still
 *   open stays usable until the trade closes.
 *
 * - The payee's payment details boxes (J-08, S-090; owner p7-3: "those boxes can appear in the
 *   chat window on the person's side who is sending that payment type ... they just have to click
 *   send, and it sends it all nicely packaged over to the other person"): in a trade's chat, the
 *   seller (who receives the payment) gets the method's boxes (packages/trade payFields.ts) above
 *   the composer; Send packages them through the worker (`chatClient().sendPay`), sealed like any
 *   line. Both sides see a package as a card (`PayCard`); its plain text is what is announced.
 *   The buyer never gets the boxes. Owner Q12: Send is closed, and says why, until the escrow is
 *   secured (`snapshot.paySecured`); the engine refuses a package sent early on the reading side. Each snapshot of a trade's chat is handed to payDetailsFeed, so
 *   the buyer's "Send exactly" card follows the chat.
 *
 * `TradeChatPanel` resolves a trade's chat (`POST /v1/trades/:code/chat`) and is the component
 * Task 23's `setTradeChat` seam takes (`{ code, name, methodId }`); `OfferChatPanel` opens the
 * pre-trade chat on an offer (the quote's Chat button).
 */
import { PAY_DETAILS_TITLE, PAY_DETAILS_V, PayDetailsError, checkPayDetails, payFieldsFor, payNoteFor, payeeGivesNothing, renderPayDetailsText, type PayDetailsPayload, type PayFieldSpec } from '@x2f/trade';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiCallError } from '../api/client.js';
import { CantDoThat } from '../ui/CantDoThat.js';
import { formatDateTime as utcDateTime } from '../ui/dates.js';
import { CANT_DO_TITLE, chatCantDoText, isCantDoCode, type CantDoCode } from '../ui/cantDoCodes.js';
import { ModeratorTag } from '../screens/dispute/ModeratorTag.js';
import { BlockAction } from '../screens/settings/BlockAction.js';
import { useTradeLive } from '../screens/trade/seams.js';
import { ChatFailed, chatClient, openOfferChat, openTradeChat, type ChatFailure, type ChatSnapshot } from './client.js';
import { useChatLive } from './live.js';
import { panelPublishing, publishPaySnapshot } from './payDetailsFeed.js';
import './chat.css';

/** The spec 6.6 notice, word for word (P3-M2). */
export const CHAT_NOTICE = 'Chats are encrypted. If a dispute is opened, a moderator can read this conversation.';
export const OTHER_DEVICE = 'This conversation is open on another device';
/** A chat that answers 404: purged, or (silently) a block between the two outside an open trade. */
export const CHAT_CLOSED = 'This chat has been closed.';
/** Review I2: a line this device took earlier whose envelope the server no longer serves as it was. */
// COPY-UNSIGNED (chat shred review I2: the gap line). not-a-refusal: a note in place of a chat line, not a rule the user ran into
export const MISSING_LINE = 'A message you saw earlier is no longer on the server.';
// COPY-UNSIGNED (review payee-fields-2 m-4): the payer's line for a package this device could not show. not-a-refusal: a note in place of a chat line, not a rule the user ran into
export const UNREADABLE_PAY_LINE = "Their payment details couldn't be shown. Ask them to send again.";
/** How often an open panel syncs with no live event: quickly while the chat is being secured. */
export const CHAT_POLL_MS = { waiting: 3_000, ready: 15_000 } as const;

const SEND_ERRORS: Record<ChatFailure, string> = {
  'not-ready': "This chat isn't ready yet. Try again in a moment.",
  'bad-text': 'Type a message first, and leave out hidden characters.',
  // COPY-UNSIGNED (J-08): the worker refused the package (a box the page's own check let through).
  'bad-details': 'Check the details and try again.',
  'too-large': 'This message is too long.',
  'slow-down': "You're sending messages too fast. Wait a minute and try again.",
  refused: "Couldn't send. Check your connection and try again.",
  unavailable: "Couldn't send. Check your connection and try again.",
  'not-found': CHAT_CLOSED,
};

const failureOf = (e: unknown): ChatFailure => (e instanceof ChatFailed ? e.code : 'unavailable');

export interface ChatPanelProps {
  chat: string;
  /** The counterparty's public display name (never a login name, FU-A). */
  name: string;
  /** The linked trade, when there is one: its live events re-sync the panel (a dispute opening). */
  tradeCode?: string | undefined;
  /**
   * Set inside DisputeRoom (Task 27): the moderator the server's dispute record names, if any. The
   * room shows its own dispute notices, and moderator lines get ModeratorTag's badge.
   */
  dispute?: { moderator: string | null } | undefined;
  /**
   * The trade's payment method (J-08): the payee's side (the seller, who receives the payment) gets
   * that method's boxes. Absent for a pre-trade chat.
   */
  pay?: { methodId: string } | undefined;
}

export function ChatPanel({ chat, name, tradeCode, dispute, pay }: ChatPanelProps) {
  const [snap, setSnap] = useState<ChatSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState<ChatFailure | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<ChatFailure | null>(null);
  const [announce, setAnnounce] = useState('');
  const alive = useRef(true);
  const seq = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLOListElement>(null);
  /** The newest line id seen so far (null before the first snapshot: the history is never announced). */
  const seen = useRef<bigint | null>(null);
  const nameRef = useRef(name);
  nameRef.current = name;

  /** Announces the newest line from the other side that arrived since the last snapshot. */
  const take = useCallback((s: ChatSnapshot): boolean => {
    let newest: bigint | null = seen.current;
    let incoming: ChatSnapshot['lines'][number] | null = null;
    for (const l of s.lines) {
      const id = BigInt(l.id);
      if (seen.current !== null && id > seen.current && !l.mine) incoming = l;
      if (newest === null || id > newest) newest = id;
    }
    const grew = newest !== seen.current;
    // Review R1: a package is read with this reader's own labels, never the line's text.
    if (incoming) setAnnounce(`${incoming.from === 'mod' ? 'Moderator' : nameRef.current}: ${incoming.pay !== undefined ? announcePay(incoming.pay) : incoming.text}`);
    seen.current = newest ?? -1n;
    return grew;
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    const mine = ++seq.current;
    try {
      const s = await chatClient().sync(chat);
      if (alive.current && mine === seq.current) {
        const grew = take(s);
        setSnap(s);
        if (tradeCode) publishPaySnapshot(tradeCode, s);
        setLoadFailed(null);
        // Stopped at the page cap: read on at once, but only while it keeps finding new lines.
        if (s.more && grew) void sync();
      }
    } catch (e) {
      // A failed re-sync keeps the last lines on screen.
      if (alive.current && mine === seq.current) setLoadFailed(failureOf(e));
    }
  }, [chat, take, tradeCode]);

  /** A send (a line or a package) answered with the chat as it now stands. */
  const sent = useCallback(
    (s: ChatSnapshot): void => {
      seq.current++;
      if (!alive.current) return;
      take(s);
      setSnap(s);
      if (tradeCode) publishPaySnapshot(tradeCode, s);
    },
    [take, tradeCode],
  );

  useEffect(() => {
    alive.current = true;
    void sync();
    return () => {
      alive.current = false;
    };
  }, [sync]);

  const phase = snap?.phase ?? null;
  useEffect(() => {
    if (phase === 'failed' || phase === 'other-device') return;
    const id = setInterval(() => void sync(), phase === 'ready' ? CHAT_POLL_MS.ready : CHAT_POLL_MS.waiting);
    return () => clearInterval(id);
  }, [phase, sync]);

  useChatLive(chat, () => void sync());
  useTradeLive(tradeCode ?? '', () => {
    if (tradeCode) void sync();
  });
  // While this panel is open it publishes every snapshot, so the trade room's feed pauses its own poll (review M5).
  useEffect(() => (tradeCode ? panelPublishing(tradeCode) : undefined), [tradeCode]);

  // Keep the list at its newest line.
  const lineCount = snap?.lines.length ?? 0;
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lineCount]);

  const empty = draft.trim() === '';
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending || empty) return;
    setSending(true);
    setSendError(null);
    try {
      const s = await chatClient().send(chat, draft);
      sent(s);
      if (!alive.current) return;
      setDraft('');
    } catch (err) {
      if (alive.current) setSendError(failureOf(err));
    } finally {
      if (alive.current) {
        setSending(false);
        // Back to the box, unless the person has moved on to something outside the composer.
        const active = document.activeElement;
        const form = box.current?.form ?? null;
        if (box.current && (active === null || active === document.body || (form !== null && form.contains(active)))) box.current.focus();
      }
    }
  };

  // Gone (purged, or a block between the two outside an open trade): the lines stay, the composer goes.
  const gone = loadFailed === 'not-found';
  let status: string | null = null;
  if (snap === null && loadFailed === null) status = 'Opening the chat…';
  else if (phase === 'waiting') status = 'Securing this chat…';
  else if (phase === 'other-device') status = OTHER_DEVICE;
  else if (phase === 'ready' && snap?.more) status = 'Loading more messages…';

  return (
    <section className="x2f-chat" aria-label={`Chat with ${name}`} data-chat-phase={phase ?? 'loading'}>
      <p className="x2f-chat__notice">{CHAT_NOTICE}</p>
      <BlockAction displayName={name} onBlocked={() => void sync()} />
      {snap?.disputeOpen && dispute === undefined ? (
        <p className="x2f-chat__system" data-system="dispute">
          A dispute is open. A moderator can read this conversation and write here.
        </p>
      ) : null}

      <ol ref={list} className="x2f-chat__lines" tabIndex={0} aria-label="Messages">
        {(snap?.lines ?? []).flatMap((l) => {
          const items = [];
          if (l.gapBefore) {
            items.push(
              <li key={`gap-${l.id}`} className="x2f-chat__gap">
                A message is missing here.
              </li>,
            );
          }
          items.push(
            <li key={l.id} className="x2f-chat__line" data-from={l.from} data-mine={l.mine ? '' : undefined} data-missing={l.missing ? '' : undefined}>
              <span className="x2f-chat__who">
                {l.from === 'mod' ? (
                  dispute !== undefined && snap?.disputeOpen === true && dispute.moderator ? (
                    <ModeratorTag from="mod" inDispute moderator={dispute.moderator} />
                  ) : (
                    'Moderator'
                  )
                ) : l.mine ? 'You' : <span data-username="">{name}</span>}
                <span className="x2f-chat__hidden">: </span>
              </span>
              {/* A line this device showed before that the server no longer serves (review I2): a gap, not a silence. */}
              {l.pay !== undefined ? (
                <PayCard pay={l.pay} />
              ) : l.unreadablePay === true ? (
                <span className="x2f-chat__text" data-pay-unreadable="">
                  {UNREADABLE_PAY_LINE}
                </span>
              ) : (
                <span className="x2f-chat__text">
                  {l.missing ? (
                    <>
                      {MISSING_LINE}
                      {l.at !== null && !Number.isNaN(new Date(l.at).getTime()) ? (
                        <>
                          {/* COPY-UNSIGNED (chat shred review I2): the gap line's "Sent <time>." suffix. */}
                          {' Sent '}
                          <time dateTime={l.at}>{utcDateTime(new Date(l.at))}</time>.
                        </>
                      ) : null}
                    </>
                  ) : (
                    l.text
                  )}
                </span>
              )}
            </li>,
          );
          return items;
        })}
      </ol>

      <p className="x2f-chat__hidden" role="status" data-chat-announce="">
        {announce}
      </p>
      <div className="x2f-chat__statusbox" role="status">
        {status === null ? null : <p className="x2f-chat__status">{status}</p>}
      </div>
      {(snap === null && loadFailed !== null) || gone ? (
        <p role="alert" className="x2f-chat__status">
          {loadFailed === 'not-found' ? CHAT_CLOSED : "Couldn't open the chat. Check your connection and try again."}
        </p>
      ) : null}
      {phase === 'failed' && snap?.problem === 'security' ? (
        <p role="alert" className="x2f-chat__status x2f-chat__status--danger">
          Security check failed. Don't share payment details in this chat.
        </p>
      ) : null}
      {phase === 'failed' && snap?.problem === 'refused' ? (
        <p role="alert" className="x2f-chat__status x2f-chat__status--danger">
          This chat couldn't be secured.
        </p>
      ) : null}

      {phase === 'ready' && !gone && pay !== undefined && snap?.role === 'seller' ? (
        payeeGivesNothing(pay.methodId) ? (
          // Review F1: like the boxes' Send, only once the escrow is secured (owner Q12).
          snap.paySecured ? (
            // COPY-UNSIGNED (payee fields, 10 Nov 2026): a gift card or face-to-face cash method has no boxes.
            <p className="x2f-chat__pay-hint" data-pay-nothing="">
              Nothing to send: the buyer sends the card or cash details here in the chat.
            </p>
          ) : null
        ) : (
          <PayBoxes chat={chat} name={name} methodId={pay.methodId} secured={snap.paySecured} onSent={sent} />
        )
      ) : null}
      {phase === 'ready' && !gone ? (
        <form className="x2f-chat__composer" onSubmit={(e) => void onSubmit(e)}>
          <label className="x2f-chat__label">
            <span className="x2f-chat__hidden">Message {name}</span>
            <textarea
              ref={box}
              className="x2f-chat__input"
              value={draft}
              rows={2}
              placeholder="Message"
              onChange={(e) => setDraft(e.target.value)}
              readOnly={sending}
              aria-disabled={sending ? 'true' : undefined}
            />
          </label>
          <button type="submit" className="x2f-chat__send" aria-disabled={sending || empty ? 'true' : undefined}>
            Send
          </button>
          {sendError ? (
            <p role="alert" className="x2f-chat__error">
              {SEND_ERRORS[sendError]}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

/** A package's plain text with this reader's labels (renderPayDetailsText); the title alone if a box is unknown here. */
function announcePay(pay: PayDetailsPayload): string {
  try {
    return renderPayDetailsText(pay);
  } catch {
    return PAY_DETAILS_TITLE;
  }
}

/** A package as a card, on both sides: the title and one row per filled box, labelled from the method table. */
function PayCard({ pay }: { pay: PayDetailsPayload }) {
  const spec = payFieldsFor(pay.method);
  return (
    <div className="x2f-chat__paycard x2f-chat__text" data-pay-card={pay.method}>
      <span className="x2f-chat__paycard-title">{PAY_DETAILS_TITLE}</span>
      <dl className="x2f-chat__paycard-rows">
        {pay.fields.map((f) => (
          <div key={f.key} className="x2f-chat__paycard-row">
            <dt className="x2f-ink-muted">{spec.find((s) => s.key === f.key)?.label ?? f.key}</dt>
            <dd className="x2f-mono">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const inputType = (kind: PayFieldSpec['kind']): string => (kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'text');

/** The one-of groups of a method, each with its labels in table order. */
function groupsOf(spec: readonly PayFieldSpec[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of spec) if (typeof f.need === 'object') groups.set(f.need.oneOf, [...(groups.get(f.need.oneOf) ?? []), f.label]);
  return groups;
}

// COPY-UNSIGNED (J-08, owner Q12): why Send is closed while the escrow is securing (and the worker's own refusal of an early package).
const PAY_NOT_SECURED = 'You can send these once the escrow is secured.';
// COPY-UNSIGNED (J-08): the boxes' own words. `joinLabels` reads "Email, Phone number".
const joinLabels = (labels: string[]): string => labels.join(', ');
const oneOfHint = (labels: string[]): string => `Fill in at least one of: ${joinLabels(labels)}.`;

/** What a refused package says, by box. Never a value. */
function payErrorText(e: unknown, spec: readonly PayFieldSpec[]): string {
  if (e instanceof PayDetailsError) {
    const field = spec.find((f) => f.key === e.key);
    const label = field?.label ?? 'this box';
    switch (e.code) {
      case 'missing':
        return `Fill in ${label}.`;
      case 'one-of':
        return oneOfHint(groupsOf(spec).get(e.key ?? '') ?? []);
      case 'too-long':
        return `${label} is too long.`;
      case 'bad-value':
        // not-a-refusal: an input check on a payment-details box (a field hint, J-08), not a rule
        return field?.kind === 'postal' ? `${label} has too many lines.` : `${label} can't have line breaks.`;
      case 'bad-chars':
        // COPY-UNSIGNED (J-08, pay-details review M6): a tab, joiner, separator or other hidden character in an account box.
        // not-a-refusal: an input check on a payment-details box (a field hint, J-08), not a rule
        return `${label} can't have tabs or hidden characters.`;
      default:
        return SEND_ERRORS['bad-details'];
    }
  }
  if (e instanceof ChatFailed && e.code === 'bad-text') return 'Leave out hidden characters.';
  // The worker's own gate (owner Q12, pay-details review M2): the boxes only show in a ready chat, so not-ready here means not secured.
  if (e instanceof ChatFailed && e.code === 'not-ready') return PAY_NOT_SECURED;
  return SEND_ERRORS[failureOf(e)];
}

/**
 * The payee's boxes for the trade's method (owner p7-3), above the composer. Send checks them on
 * the page (checkPayDetails: the same rule the worker applies again), packages the filled ones and
 * hands them to the worker, which seals them like any line; the boxes clear once the package is in
 * the chat. Values never leave the page except inside that sealed envelope.
 */
function PayBoxes({ chat, name, methodId, secured, onSent }: { chat: string; name: string; methodId: string; secured: boolean; onSent: (s: ChatSnapshot) => void }) {
  const spec = payFieldsFor(methodId);
  const note = payNoteFor(methodId);
  const whyId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const groups = groupsOf(spec);
  // Review payee-fields-2 m-3: a method whose boxes are all optional (ATM cash, Amazon) has nothing to
  // send until one is filled; an empty package is refused, so no Send is offered for it.
  const nothingYet = spec.length > 0 && spec.every((f) => f.need === 'no') && spec.every((f) => (values[f.key] ?? '').trim() === '');
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Owner Q12: nothing is sent before the escrow is secured (the button is closed; a submit by key is not).
    if (sending || !secured || nothingYet) return;
    setError(null);
    let pay: PayDetailsPayload;
    try {
      pay = { v: PAY_DETAILS_V, method: methodId, fields: checkPayDetails(methodId, values) };
    } catch (err) {
      setError(payErrorText(err, spec));
      return;
    }
    setSending(true);
    try {
      const s = await chatClient().sendPay(chat, pay);
      onSent(s);
      if (alive.current) setValues({});
    } catch (err) {
      if (alive.current) setError(payErrorText(err, spec));
    } finally {
      if (alive.current) setSending(false);
    }
  };
  return (
    <form className="x2f-chat__pay" data-pay-boxes="" aria-label="Your payment details" onSubmit={(e) => void onSubmit(e)}>
      {/* COPY-UNSIGNED (J-08): the boxes' title and lead. */}
      <p className="x2f-chat__pay-title">Your payment details</p>
      <p className="x2f-chat__pay-lead">Fill these in and send them to {name} here, encrypted.</p>
      {/* COPY-UNSIGNED (12 Nov recheck): the method's own note, from the table. */}
      {note !== undefined ? (
        <p className="x2f-chat__pay-hint" data-pay-note="">
          {note}
        </p>
      ) : null}
      {spec.map((f) => {
        const id = `pay-${chat}-${f.key}`;
        const common = {
          id,
          className: 'x2f-chat__pay-input',
          value: values[f.key] ?? '',
          readOnly: sending,
          'aria-disabled': sending ? ('true' as const) : undefined,
          'data-pay-field': f.key,
          onChange: (ev: { target: { value: string } }) => setValues((v) => ({ ...v, [f.key]: ev.target.value })),
        };
        return (
          <div key={f.key} className="x2f-chat__pay-box">
            <label htmlFor={id} className="x2f-chat__pay-label">
              {f.label}
              {f.need === 'no' ? <span className="x2f-ink-muted"> (optional)</span> : null}
            </label>
            {f.kind === 'postal' ? <textarea {...common} rows={3} /> : <input {...common} type={inputType(f.kind)} />}
          </div>
        );
      })}
      {[...groups.values()].map((labels) => (
        <p key={labels.join('|')} className="x2f-chat__pay-hint">
          {oneOfHint(labels)}
        </p>
      ))}
      {nothingYet ? (
        // COPY-UNSIGNED (payee fields, 10 Nov 2026; review payee-fields-2 m-3): every box is optional and none is filled.
        <p className="x2f-chat__pay-hint" data-pay-nothing="">
          Nothing to send: the buyer sends the card or cash details here in the chat.
        </p>
      ) : (
        <button type="submit" className="x2f-chat__send" disabled={!secured} aria-disabled={sending ? 'true' : undefined} aria-describedby={secured ? undefined : whyId}>
          Send payment details
        </button>
      )}
      {secured ? null : (
        <p id={whyId} className="x2f-chat__pay-hint" data-pay-block="not-secured">
          {PAY_NOT_SECURED}
        </p>
      )}
      {error !== null ? (
        <p role="alert" className="x2f-chat__error" data-pay-error="">
          {error}
        </p>
      ) : null}
    </form>
  );
}

type Resolved =
  | { kind: 'loading' }
  | { kind: 'ready'; chat: string }
  | { kind: 'failed'; message: string }
  // A rule of X2F's (Plan 5 Task 21): shown in CantDoThat, then only the notice stays.
  | { kind: 'refused'; code: CantDoCode };

function useResolvedChat(open: () => Promise<string>, key: string): Resolved {
  const [r, setR] = useState<Resolved>({ kind: 'loading' });
  const opener = useRef(open);
  opener.current = open;
  useEffect(() => {
    let live = true;
    setR({ kind: 'loading' });
    opener
      .current()
      .then((chat) => live && setR({ kind: 'ready', chat }))
      .catch((e: unknown) => {
        if (!live) return;
        const code = e instanceof ApiCallError ? e.code : null;
        if (isCantDoCode(code)) {
          setR({ kind: 'refused', code });
          return;
        }
        const message =
          code === 'not-found'
            ? CHAT_CLOSED
            : code === 'chat-unavailable'
              ? 'This trade has no chat.'
              : "Couldn't open the chat. Check your connection and try again.";
        setR({ kind: 'failed', message });
      });
    return () => {
      live = false;
    };
  }, [key]);
  return r;
}

function Resolving({ r, name, tradeCode, dispute, pay }: { r: Resolved; name: string; tradeCode?: string; dispute?: ChatPanelProps['dispute']; pay?: ChatPanelProps['pay'] }) {
  const [closed, setClosed] = useState(false);
  if (r.kind === 'ready') return <ChatPanel chat={r.chat} name={name} tradeCode={tradeCode} dispute={dispute} pay={pay} />;
  return (
    <section className="x2f-chat" aria-label={`Chat with ${name}`} data-chat-phase={r.kind === 'loading' ? 'loading' : 'failed'}>
      <p className="x2f-chat__notice">{CHAT_NOTICE}</p>
      {r.kind === 'loading' ? (
        <div className="x2f-chat__statusbox" role="status">
          <p className="x2f-chat__status">Opening the chat…</p>
        </div>
      ) : r.kind === 'refused' ? (
        <CantDoThat open={!closed} title={CANT_DO_TITLE.chat} body={chatCantDoText(r.code)} from={r.code} onClose={() => setClosed(true)} />
      ) : (
        <p role="alert" className="x2f-chat__status">
          {r.message}
        </p>
      )}
    </section>
  );
}

/** A trade's chat (Task 23's `TradeChatProps`: the trade code, the counterparty's public name and the payment method). */
export function TradeChatPanel({ code, name, methodId, dispute }: { code: string; name: string; methodId?: string | undefined; dispute?: ChatPanelProps['dispute'] }) {
  const r = useResolvedChat(() => openTradeChat(code), code);
  return <Resolving r={r} name={name} tradeCode={code} dispute={dispute} pay={methodId === undefined ? undefined : { methodId }} />;
}

/** The pre-trade chat with an offer's poster (the quote's Chat button). */
export function OfferChatPanel({ offerId, name }: { offerId: string; name: string }) {
  const r = useResolvedChat(() => openOfferChat(offerId), offerId);
  return <Resolving r={r} name={name} />;
}
