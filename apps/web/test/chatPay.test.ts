/**
 * J-08 (S-090): the payee's packaged payment details inside the encrypted chat envelope. The
 * package rides in the same `chat.msg` envelope as a plain line, as `{ text, pay }`: `text` is the
 * plain rendering every reader shows (the fallback for a reader that knows only `text`), `pay` the
 * boxes for the card. The API only ever sees the ciphertext.
 */
import { newTradeCode, type Role } from '@x2f/core';
import { ProtocolError, open, ReplayGuard, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { ChatEnvelopeError, PAY_DETAILS_V, PayDetailsError, channelFor, renderPayDetailsText, type PayDetailsPayload } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChatError, chatChannel, newChatState, openChatMessage, sealChatMessage, sealPayDetails, type ChatState } from '../src/chat/chatCrypto.js';

async function testIdentity(): Promise<Identity> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}
const pub = (i: Identity) => ({ signPublic: i.signPublic, boxPublic: i.boxPublic });

let ids: Record<Role, Identity>;
let participants: Participants;
let chat: string;
let channel: string;

beforeAll(async () => {
  ids = { buyer: await testIdentity(), seller: await testIdentity(), mod: await testIdentity() };
  participants = { buyer: pub(ids.buyer), seller: pub(ids.seller), mod: pub(ids.mod) };
  chat = newTradeCode();
  channel = await chatChannel(chat);
  expect(channel).toBe(await channelFor(chat, 'chat'));
});

const INTERAC: PayDetailsPayload = { v: PAY_DETAILS_V, method: 'INTERAC_E_TRANSFER', fields: [{ key: 'name', value: 'Jane Doe' }, { key: 'email', value: 'jane@example.ca' }] };

async function read(body: unknown, role: Role, state = newChatState(channel)) {
  return openChatMessage(body, { role, me: ids[role], participants, state, modMayPost: true });
}

/** Seals an arbitrary inner payload as the seller, bypassing the chat's own checks (what a tampered client could send). */
async function raw(payload: unknown, from: Role = 'seller', type = 'chat.msg', seq = 0): Promise<Envelope> {
  return seal({ trade: channel, from, seq, type, payload, to: ['buyer', 'seller', 'mod'], me: ids[from], participants });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ProtocolError || e instanceof ChatError || e instanceof ChatEnvelopeError || e instanceof PayDetailsError) return e.code;
    throw e;
  }
}

describe('sealPayDetails', () => {
  it('seals { text, pay } for buyer, seller and mod, with the text the plain rendering of the boxes', async () => {
    const { envelope, state } = await sealPayDetails({ role: 'seller', me: ids.seller, participants, state: newChatState(channel), pay: INTERAC });
    expect(state.nextSeq).toBe(1);
    const inner = await open(envelope, { me: ids.buyer, myRole: 'buyer', participants, trade: channel, guard: new ReplayGuard(channel) });
    expect(inner).toEqual({ from: 'seller', type: 'chat.msg', payload: { text: 'Payment details\nFull name: Jane Doe\nEmail: jane@example.ca', pay: INTERAC } });
    // The buyer opens it as a package; the sender re-reads its own.
    const got = await read(envelope, 'buyer');
    expect(got.message).toEqual({ from: 'seller', seq: 0, text: renderPayDetailsText(INTERAC), pay: INTERAC });
    expect((await read(envelope, 'seller')).message.pay).toEqual(INTERAC);
  });

  it('the envelope the API stores carries none of the boxes in the clear (names, values, labels, keys)', async () => {
    const { envelope } = await sealPayDetails({ role: 'seller', me: ids.seller, participants, state: newChatState(channel), pay: INTERAC });
    const wire = JSON.stringify(envelope);
    // Each has a character base64 and hex never produce (a space, '@', '_' or a quote), so a match could only be plaintext.
    for (const s of ['Jane Doe', 'jane@example.ca', 'Full name', 'Payment details', 'INTERAC_E_TRANSFER', '"pay"', '"text"', '"name"', '"email"']) {
      expect(wire, s).not.toContain(s);
    }
    // And it is a well-formed chat envelope like any other (the API's shape check passes).
    const { checkChatEnvelope } = await import('@x2f/trade');
    expect(() => checkChatEnvelope(JSON.parse(wire), channel, 'seller')).not.toThrow();
  });

  it('refuses a bad package before sealing anything, by its box', async () => {
    const noName = { ...INTERAC, fields: [{ key: 'email', value: 'jane@example.ca' }] };
    await expect(sealPayDetails({ role: 'seller', me: ids.seller, participants, state: newChatState(channel), pay: noName })).rejects.toMatchObject({ code: 'missing', key: 'name' });
    const hidden = { ...INTERAC, fields: [{ key: 'name', value: 'Jane​Doe' }, { key: 'email', value: 'jane@example.ca' }] };
    expect(await codeOf(sealPayDetails({ role: 'seller', me: ids.seller, participants, state: newChatState(channel), pay: hidden }))).toBe('bad-text');
  });

  it('only a trader seals one (the role check of sealChatMessage)', async () => {
    await expect(sealPayDetails({ role: 'mod' as 'seller', me: ids.mod, participants, state: newChatState(channel), pay: INTERAC })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('openChatMessage with a package', () => {
  it('a plain { text } line still opens exactly as before (the shape old clients send)', async () => {
    const { envelope } = await sealChatMessage({ role: 'buyer', me: ids.buyer, participants, state: newChatState(channel), text: 'hello' });
    const got = await read(envelope, 'seller');
    expect(got.message).toEqual({ from: 'buyer', seq: 0, text: 'hello' });
    expect('pay' in got.message).toBe(false);
  });

  it('a package whose text is not the rendering of its boxes is not a chat message (the two can never disagree)', async () => {
    const lying = await raw({ text: 'Payment details\nFull name: Jane Doe\nEmail: other@example.ca', pay: INTERAC });
    expect(await codeOf(read(lying, 'buyer'))).toBe('bad-message');
    const plainOnly = await raw({ text: renderPayDetailsText(INTERAC), pay: INTERAC }, 'seller', 'chat.msg', 1);
    expect(await codeOf(read(plainOnly, 'buyer'))).toBe('ok');
  });

  it('a malformed package is not a chat message, and the guard does not move for it', async () => {
    const state = newChatState(channel);
    const bad: unknown[] = [
      { text: renderPayDetailsText(INTERAC), pay: { ...INTERAC, v: 2 } },
      { text: renderPayDetailsText(INTERAC), pay: { ...INTERAC, extra: 1 } },
      { text: renderPayDetailsText(INTERAC), pay: { ...INTERAC, fields: [{ key: 'email', value: 'jane@example.ca' }] } },
      { text: renderPayDetailsText(INTERAC), pay: 'INTERAC' },
      { text: renderPayDetailsText(INTERAC), pay: INTERAC, more: true },
      { pay: INTERAC },
    ];
    for (const p of bad) {
      const env = await raw(p);
      expect(await codeOf(read(env, 'buyer', state)), JSON.stringify(p)).toBe('bad-message');
    }
    // The same seq then opens fine: nothing was recorded for the refused ones.
    const good = await raw({ text: renderPayDetailsText(INTERAC), pay: INTERAC });
    expect((await read(good, 'buyer', state)).message.pay).toEqual(INTERAC);
  });

  it('a moderator never sends payment details: a mod-signed package is not a chat message', async () => {
    const env = await raw({ text: renderPayDetailsText(INTERAC), pay: INTERAC }, 'mod');
    expect(await codeOf(read(env, 'buyer'))).toBe('bad-message');
  });

  it('the state round-trips: a package counts like any line for the seq', async () => {
    let state: ChatState = newChatState(channel);
    const a = await sealChatMessage({ role: 'seller', me: ids.seller, participants, state, text: 'first' });
    state = a.state;
    const b = await sealPayDetails({ role: 'seller', me: ids.seller, participants, state, pay: INTERAC });
    expect(b.envelope.seq).toBe(1);
    expect(b.state.nextSeq).toBe(2);
  });
});
