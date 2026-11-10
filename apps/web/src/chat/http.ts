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
  const cp = isRecord(v.counterparty) && typeof v.counterparty.displayName === 'string' ? v.counterparty.displayName : null;
  return {
    role: v.role,
    counterparty: cp,
    disputeOpen: v.disputeOpen === true,
    tradeSecuredAt: typeof v.tradeSecuredAt === 'string' ? v.tradeSecuredAt : null,
    mySignPublic: typeof v.mySignPublic === 'string' ? v.mySignPublic : null,
  };
}

export function httpChatApi(f: typeof fetch = (u, i) => fetch(u, i)): ChatApi {
  const path = (chat: string, rest = ''): string => `/v1/chats/${encodeURIComponent(chat)}${rest}`;
  const call = (url: string, init: RequestInit = {}): Promise<Response> =>
    f(url, { ...init, credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) } });
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
        envelopes.push({ id: e.id, senderRole: e.senderRole, envelope: e.envelope, at: typeof e.at === 'string' ? e.at : null });
      }
      return { envelopes, more: b?.more === true };
    },
    async postEnvelope(chat, envelope) {
      const res = await call(path(chat, '/envelopes'), { method: 'POST', body: JSON.stringify(envelope) });
      if (!res.ok) return fail(res);
      const b = (await res.json()) as { id?: unknown } | null;
      return typeof b?.id === 'string' ? b.id : '';
    },
  };
}
