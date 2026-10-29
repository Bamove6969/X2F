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
 *   event (a dispute opening), and on a timer as a backstop.
 *
 * `TradeChatPanel` resolves a trade's chat (`POST /v1/trades/:code/chat`) and is the component
 * Task 23's `setTradeChat` seam takes (`{ code, name }`); `OfferChatPanel` opens the pre-trade chat
 * on an offer (the quote's Chat button).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiCallError } from '../api/client.js';
import { ModeratorBadge } from '../ui/ModeratorBadge.js';
import { useTradeLive } from '../screens/trade/seams.js';
import { ChatFailed, chatClient, openOfferChat, openTradeChat, type ChatFailure, type ChatSnapshot } from './client.js';
import { useChatLive } from './live.js';
import './chat.css';

/** The spec 6.6 notice, word for word (P3-M2). */
export const CHAT_NOTICE = 'Chats are encrypted. If a dispute is opened, a moderator can read this conversation.';
export const OTHER_DEVICE = 'This conversation is open on another device';
/** How often an open panel syncs with no live event: quickly while the chat is being secured. */
export const CHAT_POLL_MS = { waiting: 3_000, ready: 15_000 } as const;

const SEND_ERRORS: Record<ChatFailure, string> = {
  'not-ready': "This chat isn't ready yet. Try again in a moment.",
  'bad-text': 'Type a message first. Some hidden characters are not allowed.',
  'too-large': 'This message is too long.',
  refused: "Couldn't send. Check your connection and try again.",
  unavailable: "Couldn't send. Check your connection and try again.",
  'not-found': 'This chat is no longer available.',
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
  const alive = useRef(true);
  const seq = useRef(0);

  const sync = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const s = await chatClient().sync(chat);
      if (alive.current && mine === seq.current) {
        setSnap(s);
        setLoadFailed(null);
      }
    } catch (e) {
      // A failed re-sync keeps the last lines on screen.
      if (alive.current && mine === seq.current) setLoadFailed(failureOf(e));
    }
  }, [chat]);

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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setSendError(null);
    try {
      const s = await chatClient().send(chat, draft);
      seq.current++;
      if (!alive.current) return;
      setSnap(s);
      setDraft('');
    } catch (err) {
      if (alive.current) setSendError(failureOf(err));
    } finally {
      if (alive.current) setSending(false);
    }
  };

  return (
    <section className="x2f-chat" aria-label={`Chat with ${name}`} data-chat-phase={phase ?? 'loading'}>
      <p className="x2f-chat__notice">{CHAT_NOTICE}</p>
      {snap?.disputeOpen ? (
        <p className="x2f-chat__system" data-system="dispute">
          A dispute is open. An X2F moderator can read this conversation and write here.
        </p>
      ) : null}

      <ol className="x2f-chat__lines" aria-live="polite">
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
              </span>
              <span className="x2f-chat__text">{l.text}</span>
            </li>,
          );
          return items;
        })}
      </ol>

      {snap === null && loadFailed === null ? <p className="x2f-chat__status">Opening the chat…</p> : null}
      {snap === null && loadFailed !== null ? (
        <p role="alert" className="x2f-chat__status">
          {loadFailed === 'not-found' ? 'This chat is no longer available.' : "Couldn't open the chat. Check your connection and try again."}
        </p>
      ) : null}
      {phase === 'waiting' ? <p className="x2f-chat__status">Securing this chat…</p> : null}
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
      {phase === 'other-device' ? <p className="x2f-chat__status">{OTHER_DEVICE}</p> : null}

      {phase === 'ready' ? (
        <form className="x2f-chat__composer" onSubmit={(e) => void onSubmit(e)}>
          <label className="x2f-chat__label">
            <span className="x2f-chat__hidden">Message {name}</span>
            <textarea
              className="x2f-chat__input"
              value={draft}
              rows={2}
              placeholder="Message"
              onChange={(e) => setDraft(e.target.value)}
              disabled={sending}
            />
          </label>
          <button type="submit" className="x2f-chat__send" disabled={sending || draft.trim() === ''}>
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

type Resolved = { kind: 'loading' } | { kind: 'ready'; chat: string } | { kind: 'failed'; message: string };

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
        const message =
          code === 'own-offer'
            ? 'This is your own offer.'
            : code === 'not-found'
              ? 'This chat is not available.'
              : code === 'chat-unavailable'
                ? 'The chat for this trade is not available.'
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
  if (r.kind === 'ready') return <ChatPanel chat={r.chat} name={name} tradeCode={tradeCode} />;
  return (
    <section className="x2f-chat" aria-label={`Chat with ${name}`} data-chat-phase={r.kind === 'loading' ? 'loading' : 'failed'}>
      <p className="x2f-chat__notice">{CHAT_NOTICE}</p>
      {r.kind === 'loading' ? (
        <p className="x2f-chat__status">Opening the chat…</p>
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
