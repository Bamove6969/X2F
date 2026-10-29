import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ApiInit } from '../api/client.js';
import { clearFeedbackDraft } from '../screens/feedbackDraft.js';

export type PushStatus = 'unsupported' | 'denied' | 'off' | 'on';

/** The browser surfaces this needs, injectable for tests. */
export interface PushEnv {
  serviceWorker:
    | {
        register(url: string, options?: { scope?: string }): Promise<ServiceWorkerRegistration>;
        getRegistration(scope?: string): Promise<ServiceWorkerRegistration | undefined>;
      }
    | undefined;
  hasPushManager: boolean;
  Notification: { permission: NotificationPermission; requestPermission(): Promise<NotificationPermission> } | undefined;
  api: <T>(path: string, init?: ApiInit) => Promise<T>;
}

/** The service worker, same-origin (CSP worker-src 'self'), controlling the whole site. */
export const SW_URL = '/sw.js';
const SCOPE = '/';
const PUSH_PATH = '/v1/account/push';

export function browserPushEnv(): PushEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    serviceWorker: nav && 'serviceWorker' in nav ? nav.serviceWorker : undefined,
    hasPushManager: typeof globalThis.PushManager !== 'undefined',
    Notification: typeof globalThis.Notification === 'undefined' ? undefined : globalThis.Notification,
    api,
  };
}

function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const supported = (env: PushEnv): boolean => Boolean(env.serviceWorker && env.hasPushManager && env.Notification);

export async function pushStatus(env: PushEnv): Promise<PushStatus> {
  if (!supported(env)) return 'unsupported';
  if (env.Notification!.permission === 'denied') return 'denied';
  const reg = await env.serviceWorker!.getRegistration(SCOPE);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && env.Notification!.permission === 'granted' ? 'on' : 'off';
}

/**
 * Asks for permission, registers /sw.js, subscribes with the server's VAPID key and hands the
 * API only the endpoint and the two keys. A subscription the API refuses is dropped again.
 */
export async function enablePush(env: PushEnv): Promise<PushStatus> {
  if (!supported(env)) return 'unsupported';
  const permission = await env.Notification!.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await env.serviceWorker!.register(SW_URL, { scope: SCOPE });
  const { vapidPublic } = await env.api<{ vapidPublic: string }>(PUSH_PATH);
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64urlToBytes(vapidPublic) }));
  const json = sub.toJSON();
  try {
    await env.api(PUSH_PATH, {
      method: 'POST',
      body: { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } },
    });
  } catch (e) {
    await sub.unsubscribe().catch(() => false);
    throw e;
  }
  return 'on';
}

/** Unsubscribes this browser and tells the API to forget its endpoint. */
export async function disablePush(env: PushEnv): Promise<PushStatus> {
  if (!supported(env)) return 'unsupported';
  const reg = await env.serviceWorker!.getRegistration(SCOPE);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return 'off';
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await env.api(PUSH_PATH, { method: 'DELETE', body: { endpoint } });
  return 'off';
}

/**
 * Logging out (every log-out button calls this): first unsubscribes this browser from pushes and
 * tells the API to forget it, while the session can still do that, then ends the session. A push
 * failure never blocks the logout; the API also deletes the session's subscriptions itself.
 */
export async function logOut(env: PushEnv): Promise<void> {
  try {
    await disablePush(env);
  } catch {
    // best-effort: POST /v1/logout drops this session's subscriptions on the server anyway
  }
  await env.api('/v1/logout', { method: 'POST' });
  // A feedback draft never outlives the account in this tab (Plan 5 Task 21, round-2 N-M6).
  clearFeedbackDraft();
}

/** Phone alerts on or off for this browser (Security settings and onboarding use it). */
export function usePush(env?: PushEnv): {
  status: PushStatus | 'loading';
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  error: unknown;
} {
  const e = useMemo(() => env ?? browserPushEnv(), [env]);
  const [status, setStatus] = useState<PushStatus | 'loading'>('loading');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    pushStatus(e).then(
      (s) => live && setStatus(s),
      () => live && setStatus('off'),
    );
    return () => {
      live = false;
    };
  }, [e]);

  const run = useCallback(
    async (f: (env: PushEnv) => Promise<PushStatus>) => {
      setError(null);
      try {
        setStatus(await f(e));
      } catch (err) {
        setError(err);
      }
    },
    [e],
  );

  return { status, error, enable: useCallback(() => run(enablePush), [run]), disable: useCallback(() => run(disablePush), [run]) };
}
