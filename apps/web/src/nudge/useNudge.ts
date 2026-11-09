import { useCallback, useEffect, useState } from 'react';
import { ApiCallError, api } from '../api/client.js';
import { buzz, NUDGE_NOTIFICATION, wakeUpText, type BuzzAudio } from './buzz.js';

/** Task 19's live event for a nudge to this account (`from` is the sender's public name). */
export interface NudgeEvent {
  type: 'nudge';
  from: string;
  context: string;
}

/**
 * Subscribes to this account's nudge events and returns the unsubscribe. Task 19's
 * `apps/web/src/api/events.ts` (the SSE client) provides it; tests pass a fake.
 */
export type NudgeSubscribe = (on: (ev: NudgeEvent) => void) => () => void;

/** What the page can do when a nudge arrives. */
export interface NudgeEnv {
  hidden(): boolean;
  /** Shows an OS notification with exactly this title and nothing else. */
  notify(title: typeof NUDGE_NOTIFICATION): void;
  buzz(): void;
}

let audio: AudioContext | undefined;

export function browserNudgeEnv(): NudgeEnv {
  return {
    hidden: () => document.visibilityState === 'hidden',
    notify: (title) => {
      // Only when already allowed: a nudge never triggers a permission prompt.
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      new Notification(title);
    },
    buzz: () => {
      if (typeof AudioContext === 'undefined') return;
      audio ??= new AudioContext();
      buzz(audio as unknown as BuzzAudio);
    },
  };
}

/**
 * While the tab is visible: the buzz and "Wake up, <name> wants to trade" (returned for the page to
 * show). While hidden: only the generic OS notification, which names nobody. (A closed tab gets
 * Task 19's Web Push, with the same generic text.)
 */
export function handleNudge(ev: NudgeEvent, env: NudgeEnv): string | null {
  if (env.hidden()) {
    env.notify(NUDGE_NOTIFICATION);
    return null;
  }
  env.buzz();
  return wakeUpText(ev.from);
}

/**
 * What the sender can learn: `sent` (which is also what a silently dropped nudge answers),
 * `too-soon` (their own 15 minutes) or `no-shared-context`.
 */
export type SendResult = { result: 'sent' } | { result: 'too-soon'; retryAfterSeconds?: number } | { result: 'no-shared-context' };

export async function sendNudge(to: string, context: string): Promise<SendResult> {
  try {
    await api('/v1/nudges', { method: 'POST', body: { to, context } });
    return { result: 'sent' };
  } catch (e) {
    // not-a-refusal: maps the API code to the sender's result; SellerRefund shows it in CantDoThat
    if (e instanceof ApiCallError && e.code === 'too-soon') {
      // not-a-refusal: as above
      return e.retryAfterSeconds === undefined ? { result: 'too-soon' } : { result: 'too-soon', retryAfterSeconds: e.retryAfterSeconds };
    }
    if (e instanceof ApiCallError && e.code === 'no-shared-context') return { result: 'no-shared-context' };
    throw e;
  }
}

/** Receives nudges for this account and sends them: `alert` is the in-tab text to show, if any. */
export function useNudge(
  subscribe: NudgeSubscribe,
  env: NudgeEnv = browserNudgeEnv(),
): { alert: string | null; dismiss: () => void; send: typeof sendNudge } {
  const [alert, setAlert] = useState<string | null>(null);
  useEffect(
    () =>
      subscribe((ev) => {
        const text = handleNudge(ev, env);
        if (text !== null) setAlert(text);
      }),
    // `env` is a fresh object per render by default; the subscription follows `subscribe` only.
    [subscribe],
  );
  const dismiss = useCallback(() => setAlert(null), []);
  return { alert, dismiss, send: sendNudge };
}
