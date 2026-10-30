/**
 * ChatPanel (Plan 3 Task 20): the encrypted chat between a buyer and a seller, before and during a
 * trade. Every key and every ciphertext stays in the escrow worker's chat engine (engine.ts); the
 * panel only ever sees verified plain lines (`ChatSnapshot`).
 *
 * - Always shows the spec 6.6 notice (P3-M2).
 * - A moderator's line carries the "X2F Moderator" badge. The engine shows one only while a dispute
 *   is open, signed by the chat's attested mod identity AND recorded by the server as the
 *   moderator, so the badge cannot be put on a trader's words.
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
 * `TradeChatPanel` resolves a trade's chat (`POST /v1/trades/:code/chat`) and is the component
 * Task 23's `setTradeChat` seam takes (`{ code, name }`); `OfferChatPanel` opens the pre-trade chat
 * on an offer (the quote's Chat button).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiCallError } from '../api/client.js';
import { CantDoThat } from '../ui/CantDoThat.js';
import { CANT_DO_TITLE, chatCantDoText, isCantDoCode, type CantDoCode } from '../ui/cantDoCodes.js';
import { ModeratorBadge } from '../ui/ModeratorBadge.js';
import { BlockAction } from '../screens/settings/BlockAction.js';
import { useTradeLive } from '../screens/trade/seams.js';
import { ChatFailed, chatClient, openOfferChat, openTradeChat, type ChatFailure, type ChatSnapshot } from './client.js';
import { useChatLive } from './live.js';
import './chat.css';

/** The spec 6.6 notice, word for word (P3-M2). */
export const CHAT_NOTICE = 'Chats are encrypted. If a dispute is opened, a moderator can read this conversation.';
export const OTHER_DEVICE = 'This conversation is open on another device';
/** A chat that answers 404: purged, or (silently) a block between the two outside an open trade. */
export const CHAT_CLOSED = 'This chat has been closed.';
/** How often an open panel syncs with no live event: quickly while the chat is being secured. */
export const CHAT_POLL_MS = { waiting: 3_000, ready: 15_000 } as const;

const SEND_ERRORS: Record<ChatFailure, string> = {
  'not-ready': "This chat isn't ready yet. Try again in a moment.",
  'bad-text': 'Type a message first, and leave out hidden characters.',
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
}

export function ChatPanel({ chat, name, tradeCode }: ChatPanelProps) {
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
    if (incoming) setAnnounce(`${incoming.from === 'mod' ? 'X2F Moderator' : nameRef.current}: ${incoming.text}`);
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
        setLoadFailed(null);
        // Stopped at the page cap: read on at once, but only while it keeps finding new lines.
        if (s.more && grew) void sync();
      }
    } catch (e) {
      // A failed re-sync keeps the last lines on screen.
      if (alive.current && mine === seq.current) setLoadFailed(failureOf(e));
    }
  }, [chat, take]);

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
      seq.current++;
      if (!alive.current) return;
      take(s);
      setSnap(s);
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
      {snap?.disputeOpen ? (
        <p className="x2f-chat__system" data-system="dispute">
          A dispute is open. An X2F moderator can read this conversation and write here.
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
            <li key={l.id} className="x2f-chat__line" data-from={l.from} data-mine={l.mine ? '' : undefined}>
              <span className="x2f-chat__who">
                {l.from === 'mod' ? <ModeratorBadge /> : l.mine ? 'You' : <span data-username="">{name}</span>}
                <span className="x2f-chat__hidden">: </span>
              </span>
              <span className="x2f-chat__text">{l.text}</span>
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

function Resolving({ r, name, tradeCode }: { r: Resolved; name: string; tradeCode?: string }) {
  const [closed, setClosed] = useState(false);
  if (r.kind === 'ready') return <ChatPanel chat={r.chat} name={name} tradeCode={tradeCode} />;
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

/** A trade's chat (Task 23's `TradeChatProps`: the trade code and the counterparty's public name). */
export function TradeChatPanel({ code, name }: { code: string; name: string }) {
  const r = useResolvedChat(() => openTradeChat(code), code);
  return <Resolving r={r} name={name} tradeCode={code} />;
}

/** The pre-trade chat with an offer's poster (the quote's Chat button). */
export function OfferChatPanel({ offerId, name }: { offerId: string; name: string }) {
  const r = useResolvedChat(() => openOfferChat(offerId), offerId);
  return <Resolving r={r} name={name} />;
}
