// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { disablePush, enablePush, pushStatus, usePush, type PushEnv } from '../src/push/usePush.js';
import { render } from './render.js';

const KEY_BYTES = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i));
const KEY = Buffer.from(KEY_BYTES).toString('base64url');
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

interface Calls {
  api: Array<{ path: string; method?: string; body?: unknown }>;
  registered: Array<{ url: string; scope?: string }>;
  subscribed: Array<{ userVisibleOnly: boolean; applicationServerKey: Uint8Array }>;
  unsubscribed: number;
}

function env(o: { permission?: NotificationPermission; grant?: NotificationPermission; existing?: boolean; noPush?: boolean; failPost?: boolean } = {}): {
  env: PushEnv;
  calls: Calls;
} {
  const calls: Calls = { api: [], registered: [], subscribed: [], unsubscribed: 0 };
  let current: PushSubscription | null = null;
  const makeSub = (): PushSubscription =>
    ({
      endpoint: ENDPOINT,
      toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'P', auth: 'A' } }),
      unsubscribe: async () => {
        calls.unsubscribed++;
        current = null;
        return true;
      },
    }) as unknown as PushSubscription;
  if (o.existing) current = makeSub();
  const pushManager = {
    getSubscription: async () => current,
    subscribe: async (opts: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
      calls.subscribed.push(opts);
      current = makeSub();
      return current;
    },
  };
  const registration = { pushManager } as unknown as ServiceWorkerRegistration;
  const Notification = {
    permission: o.permission ?? 'default',
    requestPermission: async () => {
      Notification.permission = o.grant ?? 'granted';
      return Notification.permission;
    },
  };
  const e: PushEnv = {
    serviceWorker: {
      register: async (url: string, opts?: { scope?: string }) => {
        calls.registered.push({ url, ...(opts?.scope ? { scope: opts.scope } : {}) });
        return registration;
      },
      getRegistration: async () => (calls.registered.length > 0 || o.existing ? registration : undefined),
    },
    hasPushManager: !o.noPush,
    Notification,
    api: async <T,>(path: string, init?: { method?: string; body?: unknown }) => {
      calls.api.push({ path, ...(init?.method ? { method: init.method } : {}), ...(init?.body !== undefined ? { body: init.body } : {}) });
      if (path === '/v1/account/push' && (init?.method ?? 'GET') === 'GET') return { vapidPublic: KEY } as T;
      if (o.failPost && init?.method === 'POST') throw new Error('refused');
      return undefined as T;
    },
  };
  return { env: e, calls };
}

describe('pushStatus', () => {
  it('is unsupported without a service worker, Push API or Notification', async () => {
    expect(await pushStatus({ ...env().env, serviceWorker: undefined })).toBe('unsupported');
    expect(await pushStatus(env({ noPush: true }).env)).toBe('unsupported');
    expect(await pushStatus({ ...env().env, Notification: undefined })).toBe('unsupported');
  });

  it('is denied when the person blocked notifications, on with a subscription, off otherwise', async () => {
    expect(await pushStatus(env({ permission: 'denied' }).env)).toBe('denied');
    expect(await pushStatus(env({ permission: 'granted', existing: true }).env)).toBe('on');
    expect(await pushStatus(env({ permission: 'granted' }).env)).toBe('off');
  });
});

describe('enablePush', () => {
  it('registers the same-origin /sw.js, subscribes with the server key and posts only endpoint and keys', async () => {
    const { env: e, calls } = env();
    expect(await enablePush(e)).toBe('on');
    expect(calls.registered).toEqual([{ url: '/sw.js', scope: '/' }]);
    expect(calls.subscribed).toHaveLength(1);
    expect(calls.subscribed[0]!.userVisibleOnly).toBe(true);
    expect([...calls.subscribed[0]!.applicationServerKey]).toEqual([...KEY_BYTES]);
    expect(calls.api).toEqual([
      { path: '/v1/account/push' },
      { path: '/v1/account/push', method: 'POST', body: { endpoint: ENDPOINT, keys: { p256dh: 'P', auth: 'A' } } },
    ]);
  });

  it('stops at a refused permission without subscribing or calling the API', async () => {
    const { env: e, calls } = env({ grant: 'denied' });
    expect(await enablePush(e)).toBe('denied');
    expect(calls.subscribed).toEqual([]);
    expect(calls.api).toEqual([]);
  });

  it('unsubscribes again when the API refuses the subscription', async () => {
    const { env: e, calls } = env({ failPost: true });
    await expect(enablePush(e)).rejects.toThrow('refused');
    expect(calls.unsubscribed).toBe(1);
  });
});

describe('disablePush', () => {
  it('unsubscribes in the browser and deletes that endpoint on the server', async () => {
    const { env: e, calls } = env({ permission: 'granted', existing: true });
    expect(await disablePush(e)).toBe('off');
    expect(calls.unsubscribed).toBe(1);
    expect(calls.api).toEqual([{ path: '/v1/account/push', method: 'DELETE', body: { endpoint: ENDPOINT } }]);
  });

  it('with no subscription calls nothing', async () => {
    const { env: e, calls } = env({ permission: 'granted' });
    expect(await disablePush(e)).toBe('off');
    expect(calls.api).toEqual([]);
  });
});

describe('usePush', () => {
  it('reports the status and switches it on', async () => {
    const { env: e } = env();
    let hook: ReturnType<typeof usePush> | undefined;
    function Probe() {
      hook = usePush(e);
      return <span>{hook.status}</span>;
    }
    const { host } = render(<Probe />);
    await act(async () => undefined);
    expect(host.textContent).toBe('off');
    await act(async () => {
      await hook!.enable();
    });
    expect(host.textContent).toBe('on');
    await act(async () => {
      await hook!.disable();
    });
    expect(host.textContent).toBe('off');
  });
});
