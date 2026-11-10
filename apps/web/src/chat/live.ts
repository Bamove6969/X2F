/**
 * The `chat` live event (Task 19's `{ type: 'chat', chat }`, sent when an envelope is stored) fanned
 * out to open chat panels. App.tsx's one `/v1/events` connection calls `emitChatLive`; the panel
 * never opens an EventSource of its own. An event is only a hint to sync again.
 */
import { useEffect, useRef } from 'react';

const listeners = new Set<(chat: string) => void>();

export function emitChatLive(chat: string): void {
  for (const l of [...listeners]) l(chat);
}

const norm = (c: string): string => c.replace(/-/g, '').toUpperCase();

/** Calls `onChange` on every live event for `chat` (any spelling of the code) until the returned function is called. */
export function onChatLive(chat: string, onChange: () => void): () => void {
  const want = norm(chat);
  const l = (c: string): void => {
    if (norm(c) === want) onChange();
  };
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** `onChatLive` as a hook. */
export function useChatLive(chat: string | null, onChange: () => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (chat === null) return;
    return onChatLive(chat, () => cb.current());
  }, [chat]);
}
