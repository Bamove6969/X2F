// The encrypted chat (Task 20) end to end in a real browser: the room's chat (the `#chat` sheet on a
// phone, the side pane with two panes) on a fixtures build served with the real CSP, with Task 20's
// real TradeChatPanel kept in the chat seam (window.__x2fRealChat, src/fixtures/payChat.tsx; other
// specs get the board's stand-in chat), the real chat engine in the escrow worker (device
// identity in IndexedDB, the attestation checked against the build's pinned moderation key), and a
// page.route stand-in for the chat API in Task 20's shapes. The other trader and the moderation
// service are played here with libsodium and @x2f/protocol: the test signs the attestation, makes the
// chat key and its signed record as the buyer (the first trader there, design build task 5), seals
// the buyer's line under it (envelope v2), and opens what the browser posted with the buyer's copy.
import { expect, test, type Page, type Route } from '@playwright/test';
import { makeChatKeyRecord, newChatKey, openChat, openChatKeyRecord, ReplayGuard, sealChat, type ChatEnvelopeV2, type ChatKeyRecord, type Identity, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, chatIdentityProofValid, type Attestation } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import sodium from 'libsodium-wrappers';
import { startFixtures } from './fixtures-serve.js';
import { BOARD, sellerView } from './refundViews.js';
import { signedIn } from './session.js';

const PORT = 4323;
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = encodeURIComponent(BOARD.code);
const CHAT = 'C7AT-2M9Q-XA4F-TR8W';
const NOTICE = 'Chats are encrypted. If a dispute is opened, a moderator can read this conversation.';

let server: FastifyInstance;
let modKey: { publicKey: Uint8Array; privateKey: Uint8Array };

function identity(): Identity {
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await sodium.ready;
  modKey = sodium.crypto_sign_keypair();
  // The build pins this moderation signing key (the chat engine reads VITE_MOD_SIGNING_PUBLIC).
  process.env.VITE_MOD_SIGNING_PUBLIC = sodium.to_hex(modKey.publicKey);
  server = await startFixtures(PORT, 'dist-fixtures-chat');
});
test.afterAll(async () => {
  await server?.close();
});
// The room is behind the front door (owner, 8 Nov 2026): a signed-in, set-up trader.
test.beforeEach(async ({ page }) => {
  await signedIn(page);
});

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface FakeChat {
  registered: { signPublic: string; boxPublic: string; proof: string }[];
  posted: ChatEnvelopeV2[];
  participants: () => Participants | null;
  /** The chat key record the buyer made (null until the attestation). */
  record: () => ChatKeyRecord | null;
  buyer: Identity;
  mod: Identity;
  channel: string;
}

/** The chat API for one chat in which the browser is the seller. */
async function stubChat(page: Page): Promise<FakeChat> {
  const channel = await channelFor(CHAT, 'chat');
  const buyer = identity();
  const mod = identity();
  const registered: FakeChat['registered'] = [];
  const posted: ChatEnvelopeV2[] = [];
  const envelopes: { id: string; senderRole: string; envelope: ChatEnvelopeV2; at: string }[] = [];
  let record: ChatKeyRecord | null = null;
  let attestation: { attestation: Attestation; sig: string } | null = null;
  const participants = (): Participants | null => {
    const me = registered[0];
    return me ? { buyer: { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic }, seller: { signPublic: me.signPublic, boxPublic: me.boxPublic }, mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic } } : null;
  };
  const at = '2026-10-28T12:00:00.000Z';

  await page.route(`**/v1/trades/${CODE}/chat`, json({ chat: CHAT, role: 'seller' }));
  // The chat engine's calls come from the escrow worker: routed on the context, which covers workers.
  await page.context().route('**/v1/chats/**', async (r) => {
    const url = new URL(r.request().url());
    const path = url.pathname.replace(`/v1/chats/${CHAT}`, '');
    const method = r.request().method();
    if (path === '' && method === 'GET') {
      return json({ chat: CHAT, role: 'seller', offerId: '00000000-0000-4000-8000-000000000000', counterparty: { tradeTag: BOARD.buyer }, tradeCode: BOARD.code, disputeOpen: false, attested: attestation !== null, mySignPublic: registered[0]?.signPublic ?? null, createdAt: at, lastMessageAt: null })(r);
    }
    if (path === '/identity' && method === 'POST') {
      const body = r.request().postDataJSON() as FakeChat['registered'][number];
      if (!(await chatIdentityProofValid(CHAT, 'seller', body))) return json({ error: 'bad-proof' }, 400)(r);
      if (registered.length > 0) return json({ error: 'identity-exists' }, 409)(r);
      registered.push(body);
      // The moderation service attests the chat, and the buyer writes first.
      const a: Attestation = { v: 1, trade: CHAT, channels: { chat: channel }, participants: participants()!, issuedAt: new Date().toISOString() };
      attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), modKey.privateKey)) };
      // Envelope v2: the buyer makes the chat key and its record (locked to the attested buyer and
      // seller), and seals its line under the key.
      const tk = await newChatKey();
      record = await makeChatKeyRecord({ chat: channel, by: 'buyer', tk, me: buyer, participants: participants()! });
      const hello = await sealChat({ trade: channel, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'Hello from the buyer' }, tk, me: buyer });
      tk.fill(0);
      envelopes.push({ id: '1', senderRole: 'buyer', envelope: hello, at });
      return json({ ok: true, role: 'seller' }, 201)(r);
    }
    if (path === '/key' && method === 'GET') return record ? json({ record })(r) : json({ error: 'no-key' }, 404)(r);
    // The buyer's record came first: the browser must read it, never make a second key.
    if (path === '/key' && method === 'POST') return json({ error: record ? 'key-exists' : 'chat-not-ready' }, 409)(r);
    if (path === '/attestation' && method === 'GET') return attestation ? json(attestation)(r) : json({ status: 'pending' }, 202)(r);
    if (path === '/envelopes' && method === 'GET') {
      const after = BigInt(url.searchParams.get('after') ?? '0');
      return json({ envelopes: envelopes.filter((e) => BigInt(e.id) > after), more: false })(r);
    }
    if (path === '/envelopes' && method === 'POST') {
      const env = r.request().postDataJSON() as ChatEnvelopeV2;
      posted.push(env);
      const id = String(envelopes.length + 1);
      envelopes.push({ id, senderRole: 'seller', envelope: env, at });
      return json({ id }, 201)(r);
    }
    return json({ error: 'not-found' }, 404)(r);
  });
  return { registered, posted, participants, record: () => record, buyer, mod, channel };
}

async function openRoom(page: Page): Promise<void> {
  const view = sellerView();
  await page.route(`**/v1/trades/${CODE}`, json(view));
  await page.addInitScript(
    ({ amountAtomic, fiatCents }) => {
      window.__x2fFixtureEscrow = { phase: 'ready', amountAtomic, fiatCents };
      window.__x2fRealChat = true;
    },
    { amountAtomic: view.amountAtomic, fiatCents: view.fiatCents },
  );
  await page.goto(`${BASE}/trade/${CODE}#chat`);
}

/** The room's chat sheet that `#chat` opens on a phone. */
const chatSheet = (page: Page) => page.getByRole('dialog', { name: `Chat with ${BOARD.buyer}` });

test("the room's #chat sheet: a device-bound identity, the buyer's line, and a v2 reply sealed under the chat key", async ({ page }) => {
  const chat = await stubChat(page);
  await openRoom(page);
  const panel = chatSheet(page);
  await expect(panel).toContainText(NOTICE);
  await expect(panel.locator('[data-from="buyer"]')).toContainText('Hello from the buyer', { timeout: 30_000 });
  await expect(panel.locator('[data-from="buyer"] [data-username]')).toHaveText(BOARD.buyer);
  expect(chat.registered).toHaveLength(1);

  await panel.locator('textarea').fill('Sending the refund details now');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.locator('[data-mine]')).toContainText('Sending the refund details now');
  expect(chat.posted).toHaveLength(1);
  expect(JSON.stringify(chat.posted)).not.toContain('refund details');
  // Envelope v2 only (R16: no sender can leave the moderator's copy out), under the buyer's key: the
  // browser read the buyer's record and made no key of its own. The buyer opens it with its own copy
  // (the moderator gets the same key through a grant once a dispute opens: chatEngine/chatGrant tests).
  expect(chat.posted[0]!.v).toBe(2);
  const tk = await openChatKeyRecord(chat.record()!, 'buyer', chat.buyer);
  const o = await openChat(chat.posted[0]!, { tk, trade: chat.channel, participants: chat.participants()!, guard: new ReplayGuard(chat.channel) });
  expect(o.from).toBe('seller');
  expect(o.payload).toEqual({ text: 'Sending the refund details now' });

  // A reload keeps the identity (no second registration) and the lines (the persisted guard).
  await page.reload();
  await expect(panel.locator('li')).toHaveText([/Hello from the buyer/, /Sending the refund details now/], { timeout: 30_000 });
  expect(chat.registered).toHaveLength(1);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
});

test('another device of the account (the API holds another key) reads only the notice and the read-only line', async ({ page }) => {
  const other = identity();
  await page.route(`**/v1/trades/${CODE}/chat`, json({ chat: CHAT, role: 'seller' }));
  await page.context().route(`**/v1/chats/${CHAT}`, json({ chat: CHAT, role: 'seller', offerId: '00000000-0000-4000-8000-000000000000', counterparty: { tradeTag: BOARD.buyer }, tradeCode: BOARD.code, disputeOpen: false, attested: true, mySignPublic: other.signPublic, createdAt: '2026-10-28T12:00:00.000Z', lastMessageAt: null }));
  await openRoom(page);
  const panel = chatSheet(page);
  await expect(panel).toContainText('This conversation is open on another device', { timeout: 30_000 });
  await expect(panel.locator('textarea')).toHaveCount(0);
});

test('two panes: the real chat sits beside the screen, and #chat focuses its composer once the chat is ready (round-2 review m3)', async ({ page }) => {
  await stubChat(page);
  await page.setViewportSize({ width: 840, height: 900 });
  await openRoom(page);
  const pane = page.locator('[data-pane="side"]');
  await expect(pane).toContainText(NOTICE);
  await expect(pane.locator('[data-from="buyer"]')).toContainText('Hello from the buyer', { timeout: 30_000 });
  await expect(pane.locator('textarea')).toBeFocused();
  await expect(chatSheet(page)).toHaveCount(0);
});

test('wide (1280 px): #chat opens the real chat in a sheet (round-2 review I2)', async ({ page }) => {
  await stubChat(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openRoom(page);
  await expect(page.locator('html')).toHaveAttribute('data-fold', 'wide');
  const panel = chatSheet(page);
  await expect(panel.locator('[data-from="buyer"]')).toContainText('Hello from the buyer', { timeout: 30_000 });
  await expect(panel.locator('textarea')).toBeVisible();
});
