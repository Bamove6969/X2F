// A disputed chat as the moderator's read sees it (design build task 9): an attested chat signed by
// a test moderation key, its trader-signed key record, a staff device key (in memory) and the chat
// key re-wrapped to it, and a few envelopes. Shared by caseChat.test.ts and modCaseChat.test.tsx.
// `workerPair` runs the chat key worker's keeper in this process behind a message pair that copies
// every message (structured clone) and delivers it later, as postMessage does.
import { newTradeCode } from '@x2f/core';
import { generateIdentity, makeChatKeyRecord, newChatKey, sealChat, wrapChatKey, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, type Attestation } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { connectChatKeys, type ChatKeys, type Endpoint } from '../src/chat/client.js';
import type { CaseChatAnswer } from '../src/chat/types.js';
import { staffDeviceKey, type DeviceKeyBackend, type StoredDeviceKey } from '../src/keys/deviceKey.js';
import { ChatKeeper, serveChatKeeper } from '../src/keys/keeper.js';

export function memory(): DeviceKeyBackend & { rec: unknown } {
  const m = {
    rec: null as unknown,
    load: async () => m.rec,
    save: async (r: StoredDeviceKey) => {
      // As IndexedDB stores it: a structured clone (CryptoKeys stay non-extractable).
      m.rec = structuredClone(r);
    },
  };
  return m;
}

let modSign: { publicKey: Uint8Array; privateKey: Uint8Array } | null = null;
/** The test moderation signing key pair (made once). */
export async function modKey(): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  await sodium.ready;
  modSign ??= sodium.crypto_sign_keypair();
  return modSign;
}
export const MOD_PUB = async (): Promise<string> => sodium.to_hex((await modKey()).publicKey);

export async function world(o: { signer?: Uint8Array; chat?: string; backend?: DeviceKeyBackend } = {}) {
  const mk = await modKey();
  const chat = o.chat ?? newTradeCode();
  const channel = await channelFor(chat, 'chat');
  const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  const participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  const attestation: Attestation = { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: '2026-11-18T12:00:00.000Z' };
  const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), o.signer ?? mk.privateKey));
  const tk = await newChatKey();
  const record = await makeChatKeyRecord({ chat: channel, by: 'buyer', tk, me: ids.buyer, participants });
  const device = await staffDeviceKey(o.backend ?? memory());
  const seal = (from: 'buyer' | 'seller' | 'mod', seq: number, text: string, key = tk) => sealChat({ trade: channel, from, seq, type: 'chat.msg', payload: { text }, tk: key, me: ids[from] });
  const envelopes = [
    { id: '1', senderRole: 'buyer', envelope: await seal('buyer', 0, 'I paid.'), at: 'a' },
    { id: '2', senderRole: 'seller', envelope: await seal('seller', 0, 'Not received.'), at: 'b' },
    // Under another key: it never opens, so it is counted, never shown.
    { id: '3', senderRole: 'seller', envelope: await seal('seller', 1, 'hidden', await newChatKey()), at: 'c' },
  ];
  const answer: CaseChatAnswer = { chat, channel, wrap: await wrapChatKey(device.boxPublic, tk), tkh: record.tkh, nextSeq: 0, attestation: { attestation, sig }, record, envelopes };
  return { chat, channel, ids, participants, tk, record, device, answer, seal };
}

/** Two ends of a message channel: each message is structured-cloned and delivered on a later task. */
function pair(): [Endpoint, Endpoint] {
  const listeners: [Array<(e: { data: unknown }) => void>, Array<(e: { data: unknown }) => void>] = [[], []];
  const end = (me: 0 | 1): Endpoint => ({
    postMessage(m) {
      const data = structuredClone(m);
      setTimeout(() => {
        for (const l of listeners[me === 0 ? 1 : 0]) l({ data });
      }, 0);
    },
    addEventListener(_t, l) {
      listeners[me].push(l);
    },
  });
  return [end(0), end(1)];
}

/** A chat key worker in this process (its keeper, served on one end) and the page's client (the other). */
export async function workerPair(o: { backend?: DeviceKeyBackend; now?: () => number } = {}): Promise<{ keeper: ChatKeeper; keys: ChatKeys }> {
  const [page, worker] = pair();
  const keeper = new ChatKeeper({ backend: o.backend ?? memory(), modKeys: [{ signPublic: await MOD_PUB(), notBefore: null, notAfter: null }], ...(o.now ? { now: o.now } : {}) });
  serveChatKeeper(keeper, worker);
  return { keeper, keys: connectChatKeys(page) };
}
