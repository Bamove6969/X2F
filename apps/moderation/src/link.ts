import { createHash } from 'node:crypto';
import type { Role } from '@x2f/core';
import { canonicalJson } from '@x2f/protocol';
import { INTERNAL_AT_HEADER, INTERNAL_SIG_HEADER, internalSignedBytes, SETTLE_KINDS, type AttestedTerms, type SettleKind } from '@x2f/trade';
import sodium from 'libsodium-wrappers';

/**
 * The moderation service's only network contact: OUTBOUND requests, each signed with the moderation
 * signing key. It never listens. To the API's private internal listener it pulls work and posts
 * reports; to the relay's private admin listener it registers trade channels.
 *
 * The relay admin message format is rebuilt here rather than imported from `@x2f/relay` (which
 * would pull in fastify): domain `x2f/relay-register/v1\0` + canonical JSON of
 * `{ channel, signPublics, at }`, base64 signature — exactly `adminMessage` in apps/relay/src/admin.ts.
 */
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export interface WorkItem {
  trade: string;
  participants: Record<'buyer' | 'seller', { signPublic: string; boxPublic: string; proof: string }>;
  /** The trade record's deal and both addresses (lead answer 4); signed into the attestation as they are. */
  terms: AttestedTerms;
}

/** A chat both traders registered a chat identity for (`GET /internal/v1/chat-work`, Task 20). */
export interface ChatWorkItem {
  chat: string;
  participants: Record<'buyer' | 'seller', { signPublic: string; boxPublic: string; proof: string }>;
}

/** A chat the API purged (`GET /internal/v1/chat-shred`): its keys here are to be destroyed. */
export interface ChatShredOrder {
  chat: string;
  /** The trade the chat was linked to, or null for a pre-trade chat. */
  trade: string | null;
}

/** A trader's dispute grant the API lists as not accepted (build task 6), with its chat's key record; both untrusted. */
export interface ChatGrantItem {
  chat: string;
  grant: unknown;
  record: unknown;
}

/** Build task 7: a keyed chat of a disputed trade the API lists for a dispute notice; every field untrusted. */
export interface ChatNoticeCandidate {
  chat: string;
  trade: string;
  disputeSeq: number;
  openedAt: string;
  openedBy: string;
}

/** One trade on the API's watch list. */
export interface WatchItem {
  state: string;
  /**
   * The chat linked to the trade (review I1), or null (none, or already purged). The shred pass
   * records it (`mod_chat_trade`) so its dispute hold goes by the chat, never only by an order's trade.
   */
  chat: string | null;
  /** settleKindFor(trade): the kind a `settled` report would be applied as, or null (review I1). */
  settleKind: SettleKind | null;
  /** Paused for maintenance (review M3). */
  paused: boolean;
}

export interface Link {
  pullWork(): Promise<WorkItem[]>;
  pullChatWork(): Promise<ChatWorkItem[]>;
  /** The API's chat shred orders; malformed items come back as `{ chat: '', trade: null }` (logged and skipped). */
  pullChatShred(): Promise<ChatShredOrder[]>;
  /** Build task 6: unaccepted dispute grants; malformed items come back with chat ''. */
  pullChatGrants(): Promise<ChatGrantItem[]>;
  /** Build task 7: dispute notice candidates; malformed fields come back empty (logged and skipped). */
  pullChatNotices(): Promise<ChatNoticeCandidate[]>;
  postReport(report: unknown): Promise<number>;
  /** Like postReport, with the API's refusal code (`{ error }`) when it gives one. */
  report(report: unknown): Promise<{ status: number; error: string | null }>;
  /**
   * The API's view of every attested trade it still lists (Task 9 watcher), plus the buyer's
   * final-alert seen-receipt time (Task 10; null when not seen or absent). Malformed items are left out.
   */
  pullWatch(): Promise<Map<string, WatchItem>>;
  registerChannel(channel: string, signPublics: Record<Role, string>): Promise<number>;
  /** The signed relay close of one channel (Task 7's `closeTrade`); 200 when done. */
  closeChannel(channel: string): Promise<number>;
}

const RELAY_REGISTER_DOMAIN = 'x2f/relay-register/v1\0';
const RELAY_CLOSE_DOMAIN = 'x2f/relay-close/v1\0';

export class LinkError extends Error {
  constructor(readonly status: number, what: string) {
    super(`${what}: HTTP ${status}`);
    this.name = 'LinkError';
  }
}

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

export function relayRegisterMessage(body: { channel: string; signPublics: Record<Role, string>; at: number }): Uint8Array {
  return new TextEncoder().encode(RELAY_REGISTER_DOMAIN + canonicalJson(body));
}

/** The relay's close message: `x2f/relay-close/v1\0` + canonical JSON of `{ channel, at }` (apps/relay/src/admin.ts). */
export function relayCloseMessage(body: { channel: string; at: number }): Uint8Array {
  return new TextEncoder().encode(RELAY_CLOSE_DOMAIN + canonicalJson(body));
}

export function createLink(o: {
  apiInternalUrl: string;
  relayAdminUrl: string;
  signingSecret: Uint8Array;
  fetch: Fetch;
  now: () => number;
}): Link {
  const base = o.apiInternalUrl.replace(/\/+$/, '');
  const relay = o.relayAdminUrl.replace(/\/+$/, '');
  const b64 = (b: Uint8Array): string => sodium.to_base64(b, sodium.base64_variants.ORIGINAL);

  const internal = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    await sodium.ready;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const at = o.now();
    const sig = sodium.crypto_sign_detached(internalSignedBytes({ method, path, at, bodyHash: sha256Hex(payload ?? '') }), o.signingSecret);
    const headers: Record<string, string> = { [INTERNAL_AT_HEADER]: String(at), [INTERNAL_SIG_HEADER]: b64(sig) };
    if (payload !== undefined) headers['content-type'] = 'application/json';
    return o.fetch(`${base}${path}`, { method, headers, ...(payload === undefined ? {} : { body: payload }) });
  };

  return {
    async pullWork() {
      const res = await internal('GET', '/internal/v1/work');
      if (res.status !== 200) throw new LinkError(res.status, 'pull work');
      const body = (await res.json()) as { work?: unknown };
      return Array.isArray(body.work) ? (body.work as WorkItem[]) : [];
    },
    async pullChatWork() {
      const res = await internal('GET', '/internal/v1/chat-work');
      if (res.status !== 200) throw new LinkError(res.status, 'pull chat work');
      const body = (await res.json()) as { work?: unknown };
      return Array.isArray(body.work) ? (body.work as ChatWorkItem[]) : [];
    },
    async pullChatShred() {
      const res = await internal('GET', '/internal/v1/chat-shred');
      if (res.status !== 200) throw new LinkError(res.status, 'pull chat shred');
      const body = (await res.json()) as { orders?: unknown };
      if (!Array.isArray(body.orders)) return [];
      // A trade that is neither a string nor null makes the whole order bad: never read as "no trade".
      return (body.orders as Array<{ chat?: unknown; trade?: unknown }>).map((x) =>
        typeof x?.chat === 'string' && (x.trade === null || typeof x.trade === 'string')
          ? { chat: x.chat, trade: x.trade }
          : { chat: '', trade: null },
      );
    },
    async pullChatGrants() {
      const res = await internal('GET', '/internal/v1/chat-grants');
      if (res.status !== 200) throw new LinkError(res.status, 'pull chat grants');
      const body = (await res.json()) as { grants?: unknown };
      if (!Array.isArray(body.grants)) return [];
      return (body.grants as Array<{ chat?: unknown; grant?: unknown; record?: unknown }>).map((x) => ({
        chat: typeof x?.chat === 'string' ? x.chat : '',
        grant: x?.grant,
        record: x?.record,
      }));
    },
    async pullChatNotices() {
      const res = await internal('GET', '/internal/v1/chat-notices');
      if (res.status !== 200) throw new LinkError(res.status, 'pull chat notices');
      const body = (await res.json()) as { candidates?: unknown };
      if (!Array.isArray(body.candidates)) return [];
      return (body.candidates as Array<Record<string, unknown> | null>).map((x) => ({
        chat: typeof x?.chat === 'string' ? x.chat : '',
        trade: typeof x?.trade === 'string' ? x.trade : '',
        disputeSeq: typeof x?.disputeSeq === 'number' ? x.disputeSeq : 0,
        openedAt: typeof x?.openedAt === 'string' ? x.openedAt : '',
        openedBy: typeof x?.openedBy === 'string' ? x.openedBy : '',
      }));
    },
    async postReport(report) {
      const res = await internal('POST', '/internal/v1/reports', report);
      return res.status;
    },
    async report(report) {
      const res = await internal('POST', '/internal/v1/reports', report);
      let error: string | null = null;
      if (res.status >= 400) {
        try {
          const b = (await res.json()) as { error?: unknown };
          if (typeof b?.error === 'string') error = b.error;
        } catch {
          error = null;
        }
      }
      return { status: res.status, error };
    },
    async pullWatch() {
      const res = await internal('GET', '/internal/v1/watch');
      if (res.status !== 200) throw new LinkError(res.status, 'pull watch');
      const body = (await res.json()) as { trades?: unknown };
      const out = new Map<string, WatchItem>();
      if (!Array.isArray(body.trades)) return out;
      for (const t of body.trades as Array<{ trade?: unknown; state?: unknown; chat?: unknown; settleKind?: unknown; paused?: unknown }>) {
        if (typeof t?.trade !== 'string' || typeof t.state !== 'string') continue;
        const chat = typeof t.chat === 'string' ? t.chat : null;
        const settleKind = SETTLE_KINDS.includes(t.settleKind as SettleKind) ? (t.settleKind as SettleKind) : null;
        out.set(t.trade, { state: t.state, chat, settleKind, paused: t.paused === true });
      }
      return out;
    },
    async closeChannel(channel) {
      await sodium.ready;
      const body = { channel, at: o.now() };
      const sig = b64(sodium.crypto_sign_detached(relayCloseMessage(body), o.signingSecret));
      const res = await o.fetch(`${relay}/v1/admin/trades/close`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, sig }),
      });
      return res.status;
    },
    async registerChannel(channel, signPublics) {
      await sodium.ready;
      const body = { channel, signPublics, at: o.now() };
      const sig = b64(sodium.crypto_sign_detached(relayRegisterMessage(body), o.signingSecret));
      const res = await o.fetch(`${relay}/v1/admin/trades`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, sig }),
      });
      return res.status;
    },
  };
}
