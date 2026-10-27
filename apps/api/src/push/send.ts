import { Agent } from 'node:https';
import webpush, { type RequestOptions } from 'web-push';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { canonicalEndpoint, publicOnlyLookup, type LookupFn } from './endpoint.js';

export type PushKind = 'nudge' | 'trade' | 'alert';

/**
 * The only three things a push can ever say (spec 4; Global Constraints). Pushes pass through
 * Apple's, Google's and Mozilla's servers, so they never carry a trade code, an amount, a name, an
 * alert detail or a link; the service worker opens `/` on a tap. `alert` is the owner's price
 * health push (spec 11.6; push/ownerAlert.ts).
 */
export const PUSH_PAYLOADS: Readonly<Record<PushKind, string>> = Object.freeze({
  nudge: 'Someone nudged you on X2F',
  trade: 'Something changed in a trade on X2F',
  alert: 'Something needs your attention',
});

/** Subscriptions kept per account (browsers and devices); posting one more drops the oldest. */
export const PUSH_SUBSCRIPTION_CAP = 10;

/** How long a push service keeps an undelivered push: the final alert's 15 minutes (P3-I13). */
export const PUSH_TTL_SECONDS = 15 * 60;
const PUSH_TIMEOUT_MS = 10_000;

export interface PushSubscriptionRow {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushCall {
  subscription: PushSubscriptionRow;
  payload: string;
  options: RequestOptions;
}

/** Sends one push and returns the push service's status. Throws only for network errors. */
export type PushTransport = (call: PushCall) => Promise<{ statusCode: number }>;

/** The only log this module writes: a status code, never an endpoint, key or account. */
export interface PushLog {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface PushDeps {
  db: Queryable;
  clock: () => Date;
  config: Pick<Config, 'origins' | 'vapidPublic' | 'vapidPrivate'>;
  transport: PushTransport;
  log: PushLog;
}

/** The VAPID subject: the site's own https origin (X2F has no contact email, by design). */
function vapidSubject(config: Pick<Config, 'origins'>): string {
  return config.origins.find((o) => o.startsWith('https://')) ?? config.origins[0]!;
}

/** web-push options: VAPID from config, aes128gcm, a 15-minute TTL, high urgency. */
export function pushRequestOptions(config: Pick<Config, 'origins' | 'vapidPublic' | 'vapidPrivate'>): RequestOptions {
  return {
    vapidDetails: { subject: vapidSubject(config), publicKey: config.vapidPublic, privateKey: config.vapidPrivate },
    TTL: PUSH_TTL_SECONDS,
    urgency: 'high',
    contentEncoding: 'aes128gcm',
    timeout: PUSH_TIMEOUT_MS,
  };
}

/**
 * A real transport: web-push encrypts the payload to the browser's keys and POSTs it to the
 * endpoint. The endpoint is checked again here (`canonicalEndpoint`), and the connection goes
 * through an agent whose DNS lookup refuses any non-public address, so neither a bad row nor a
 * push-service name pointed at an internal address reaches inside the network. A refusal
 * (WebPushError) becomes its status code; other errors are dropped because they quote the endpoint.
 */
export function makeWebPushTransport(lookup?: LookupFn): PushTransport {
  const agent = new Agent({ keepAlive: true, lookup: publicOnlyLookup(lookup) as never });
  return async ({ subscription, payload, options }) => {
    if (!canonicalEndpoint(subscription.endpoint)) throw new Error('push: invalid endpoint');
    try {
      const r = await webpush.sendNotification(subscription, payload, { ...options, agent, proxy: undefined });
      return { statusCode: r.statusCode };
    } catch (e) {
      if (e instanceof webpush.WebPushError) return { statusCode: e.statusCode };
      throw new Error('push: network error');
    }
  };
}

export const webPushTransport: PushTransport = makeWebPushTransport();

/**
 * Pushes the fixed text for `kind` to every subscription of `accountId`. Returns true when at
 * least one push service answered 201 (accepted for delivery). A 404 or 410 means the browser
 * dropped the subscription: the row is deleted. Anything else is logged as its status only.
 */
export async function sendPush(deps: PushDeps, accountId: string, kind: PushKind): Promise<boolean> {
  // A trader's subscription whose session has ended (expired; a revoked one is already deleted by
  // the trigger) is never sent to: it is deleted here. The owner's belong to the account and are
  // exempt: an owner whose session idled out is away, which is when the price-health push matters
  // (re-review I3); only an explicit logout, endAllSessions or unsubscribe removes them.
  const now = deps.clock();
  await deps.db.query(
    `delete from push_subscriptions p using sessions s, accounts a
      where p.account_id = $1 and s.id = p.session_id and a.id = p.account_id and a.kind <> 'owner'
        and (s.revoked_at is not null or s.expires_at <= $2)`,
    [accountId, now],
  );
  const { rows } = await deps.db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    'select id, endpoint, p256dh, auth from push_subscriptions where account_id = $1',
    [accountId],
  );
  if (rows.length === 0) return false;
  const options = pushRequestOptions(deps.config);
  const payload = PUSH_PAYLOADS[kind];
  const results = await Promise.all(
    rows.map(async (row) => {
      // Never send to a row that fails the subscribe route's checks; it cannot become valid.
      if (!canonicalEndpoint(row.endpoint)) {
        await deps.db.query('delete from push_subscriptions where id = $1', [row.id]);
        deps.log.warn({ push: 'invalid-endpoint' }, 'push subscription dropped');
        return false;
      }
      let status: number;
      try {
        ({ statusCode: status } = await deps.transport({
          subscription: { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
          options,
        }));
      } catch {
        deps.log.warn({ push: 'network-error' }, 'push not sent');
        return false;
      }
      if (status === 201) return true;
      if (status === 404 || status === 410) {
        await deps.db.query('delete from push_subscriptions where id = $1', [row.id]);
        return false;
      }
      deps.log.warn({ push: 'refused', statusCode: status }, 'push not accepted');
      return false;
    }),
  );
  return results.some(Boolean);
}
