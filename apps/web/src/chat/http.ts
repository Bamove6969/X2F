/**
 * The chat engine's API calls (Task 20 routes, apps/api/src/chat/routes.ts) over the worker's own
 * same-origin fetch. Answers are checked for shape; anything else is a refusal.
 */
import type { ApiEnvelope, ChatApi, ChatApiView } from './engine.js';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const ID = /^(0|[1-9][0-9]{0,17})$/;

/** Reads `GET /v1/chats/:chat` (the fields the engine needs). */
export function parseChatView(v: unknown): ChatApiView | null {
  if (!isRecord(v) || (v.role !== 'buyer' && v.role !== 'seller')) return null;
  const cp = isRecord(v.counterparty) && typeof v.counterparty.tradeTag === 'string' ? v.counterparty.tradeTag : null;
  return {
    role: v.role,
    counterparty: cp,
    disputeOpen: v.disputeOpen === true,
    tradeSecuredAt: typeof v.tradeSecuredAt === 'string' ? v.tradeSecuredAt : null,
    mySignPublic: typeof v.mySignPublic === 'string' ? v.mySignPublic : null,
    grants: Array.isArray(v.grants)
      ? v.grants.filter(isRecord).map((g) => ({ grant: g.grant, accepted: g.accepted ?? null }))
      : [],
    notice: v.notice ?? null,
  };
}

/**
 * Review m3 (wip/lead-chat-tab-lock): the longest one chat API call may take (headers and body). Each
 * call runs while its operation holds the cross-tab per-chat Web Lock, so a stalled one must fail and
 * free it, never hold every tab's chat (and the escrow's prepare) for minutes. The escrow adapters' bound.
 */
export const CHAT_API_TIMEOUT_MS = 15_000;

export function httpChatApi(f: typeof fetch = (u, i) => fetch(u, i), timeoutMs = CHAT_API_TIMEOUT_MS): ChatApi {
  const path = (chat: string, rest = ''): string => `/v1/chats/${encodeURIComponent(chat)}${rest}`;
  const call = (url: string, init: RequestInit = {}): Promise<Response> =>
    f(url, {
      ...init,
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
  const fail = async (res: Response): Promise<never> => {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw Object.assign(new Error(`api ${res.status}`), { status: res.status, code: typeof body?.error === 'string' ? body.error : 'internal' });
  };
  return {
    async getChat(chat) {
      const res = await call(path(chat));
      if (!res.ok) return fail(res);
      const v = parseChatView(await res.json());
      if (!v) throw Object.assign(new Error('bad chat view'), { status: 502, code: 'internal' });
      return v;
    },
    async registerIdentity(chat, body) {
      const res = await call(path(chat, '/identity'), { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) return 'ok';
      if (res.status === 409) {
        const b = (await res.clone().json().catch(() => null)) as { error?: unknown } | null;
        if (b?.error === 'identity-exists') return 'exists';
      }
      return fail(res);
    },
    async getAttestation(chat) {
      const res = await call(path(chat, '/attestation'));
      if (res.status === 202) return null;
      if (!res.ok) return fail(res);
      const b = (await res.json()) as { attestation?: unknown; sig?: unknown } | null;
      return { attestation: b?.attestation, sig: b?.sig };
    },
    async listEnvelopes(chat, after) {
      const res = await call(path(chat, `/envelopes?after=${encodeURIComponent(after)}`));
      if (!res.ok) return fail(res);
      const b = (await res.json()) as { envelopes?: unknown; more?: unknown } | null;
      const list = Array.isArray(b?.envelopes) ? b.envelopes : [];
      const envelopes: ApiEnvelope[] = [];
      for (const e of list) {
        if (!isRecord(e) || typeof e.id !== 'string' || !ID.test(e.id) || typeof e.senderRole !== 'string') continue;
        // Private lanes: `to` is the lane of a v3 envelope (the caller's own), null for a shared one.
        const to = e.to === 'buyer' || e.to === 'seller' ? e.to : null;
        envelopes.push({ id: e.id, senderRole: e.senderRole, envelope: e.envelope, at: typeof e.at === 'string' ? e.at : null, to });
      }
      return { envelopes, more: b?.more === true };
    },
    async getKey(chat) {
      const res = await call(path(chat, '/key'));
      if (res.status === 404) {
        const b = (await res.clone().json().catch(() => null)) as { error?: unknown } | null;
        if (b?.error === 'no-key') return null;
      }
      if (!res.ok) return fail(res);
      const b = (await res.json()) as { record?: unknown } | null;
      return b?.record ?? null;
    },
    async getLane(chat) {
      // Private lanes: `GET …/lane` → `{ record }` for the caller's own role, or 404 `no-lane`.
      const res = await call(path(chat, '/lane'));
      if (res.status === 404) {
        const b = (await res.clone().json().catch(() => null)) as { error?: unknown } | null;
        if (b?.error === 'no-lane') return null;
      }
      if (!res.ok) return fail(res);
      const b = (await res.json()) as { record?: unknown } | null;
      return b?.record ?? null;
    },
    async postKey(chat, record) {
      const res = await call(path(chat, '/key'), { method: 'POST', body: JSON.stringify(record) });
      if (res.ok) return 'ok';
      if (res.status === 409) {
        const b = (await res.clone().json().catch(() => null)) as { error?: unknown } | null;
        if (b?.error === 'key-exists') return 'exists';
      }
      return fail(res);
    },
    async postGrant(chat, grant) {
      const res = await call(path(chat, '/grant'), { method: 'POST', body: JSON.stringify(grant) });
      if (res.ok) return 'ok';
      if (res.status === 409) {
        const b = (await res.clone().json().catch(() => null)) as { error?: unknown } | null;
        if (b?.error === 'grant-not-needed') return 'not-needed';
      }
      return fail(res);
    },
    async postEnvelope(chat, envelope) {
      const res = await call(path(chat, '/envelopes'), { method: 'POST', body: JSON.stringify(envelope) });
      if (!res.ok) return fail(res);
      const b = (await res.json()) as { id?: unknown } | null;
      return typeof b?.id === 'string' ? b.id : '';
    },
  };
}

/**
 * Regtest e2e gap 5: `POST /v1/trades/:code/chat` over the worker's own same-origin fetch (the page's
 * `openTradeChat` in client.ts is the same call through the page's api()). Answers the trade's chat
 * code; a refusal is thrown with its status and code, an answer without a code as a 502.
 */
export function httpOpenTradeChat(f: typeof fetch = (u, i) => fetch(u, i), timeoutMs = CHAT_API_TIMEOUT_MS): (code: string) => Promise<string> {
  return async (code) => {
    const res = await f(`/v1/trades/${encodeURIComponent(code)}/chat`, {
      method: 'POST',
      body: '{}',
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    });
    const b = (await res.json().catch(() => null)) as { chat?: unknown; error?: unknown } | null;
    if (!res.ok) throw Object.assign(new Error(`api ${res.status}`), { status: res.status, code: typeof b?.error === 'string' ? b.error : 'internal' });
    if (typeof b?.chat !== 'string') throw Object.assign(new Error('bad trade chat answer'), { status: 502, code: 'internal' });
    return b.chat;
  };
}
