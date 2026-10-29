// The encrypted chat (Task 20) end to end in a real browser: the room's `#chat` section on a
// fixtures build served with the real CSP, the real chat engine in the escrow worker (device
// identity in IndexedDB, the attestation checked against the build's pinned moderation key), and a
// page.route stand-in for the chat API in Task 20's shapes. The other trader and the moderation
// service are played here with libsodium and @x2f/protocol: the test seals the buyer's line, signs
// the attestation, and opens what the browser posted.
import { expect, test, type Page, type Route } from '@playwright/test';
import { open, ReplayGuard, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, chatIdentityProofValid, type Attestation } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import sodium from 'libsodium-wrappers';
import { startFixtures } from './fixtures-serve.js';
import { BOARD, sellerView } from './refundViews.js';

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

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface FakeChat {
  registered: { signPublic: string; boxPublic: string; proof: string }[];
  posted: Envelope[];
  participants: () => Participants | null;
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
  const posted: Envelope[] = [];
  const envelopes: { id: string; senderRole: string; envelope: Envelope; at: string }[] = [];
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
      return json({ chat: CHAT, role: 'seller', offerId: '00000000-0000-4000-8000-000000000000', counterparty: { displayName: BOARD.buyer }, tradeCode: BOARD.code, disputeOpen: false, attested: attestation !== null, mySignPublic: registered[0]?.signPublic ?? null, createdAt: at, lastMessageAt: null })(r);
    }
    if (path === '/identity' && method === 'POST') {
      const body = r.request().postDataJSON() as FakeChat['registered'][number];
      if (!(await chatIdentityProofValid(CHAT, 'seller', body))) return json({ error: 'bad-proof' }, 400)(r);
      if (registered.length > 0) return json({ error: 'identity-exists' }, 409)(r);
      registered.push(body);
      // The moderation service attests the chat, and the buyer writes first.
      const a: Attestation = { v: 1, trade: CHAT, channels: { chat: channel }, participants: participants()!, issuedAt: at };
      attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), modKey.privateKey)) };
      const hello = await seal({ trade: channel, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'Hello from the buyer' }, to: ['buyer', 'seller', 'mod'], me: buyer, participants: participants()! });
      envelopes.push({ id: '1', senderRole: 'buyer', envelope: hello, at });
      return json({ ok: true, role: 'seller' }, 201)(r);
    }
    if (path === '/attestation' && method === 'GET') return attestation ? json(attestation)(r) : json({ status: 'pending' }, 202)(r);
    if (path === '/envelopes' && method === 'GET') {
      const after = BigInt(url.searchParams.get('after') ?? '0');
      return json({ envelopes: envelopes.filter((e) => BigInt(e.id) > after), more: false })(r);
    }
    if (path === '/envelopes' && method === 'POST') {
      const env = r.request().postDataJSON() as Envelope;
      posted.push(env);
      const id = String(envelopes.length + 1);
      envelopes.push({ id, senderRole: 'seller', envelope: env, at });
      return json({ id }, 201)(r);
    }
    return json({ error: 'not-found' }, 404)(r);
  });
  return { registered, posted, participants, buyer, mod, channel };
}

async function openRoom(page: Page): Promise<void> {
  const view = sellerView();
  await page.route(`**/v1/trades/${CODE}`, json(view));
  await page.addInitScript(
    ({ amountAtomic, fiatCents }) => {
      window.__x2fFixtureEscrow = { phase: 'ready', amountAtomic, fiatCents };
    },
    { amountAtomic: view.amountAtomic, fiatCents: view.fiatCents },
  );
  await page.goto(`${BASE}/trade/${CODE}#chat`);
}

test("the room's #chat: a device-bound identity, the buyer's line, and a sealed reply only the buyer and the mod open", async ({ page }) => {
  const chat = await stubChat(page);
  await openRoom(page);
  const panel = page.locator('#chat');
  await expect(panel).toContainText(NOTICE);
  await expect(panel.locator('[data-from="buyer"]')).toContainText('Hello from the buyer', { timeout: 30_000 });
  await expect(panel.locator('[data-from="buyer"] [data-username]')).toHaveText(BOARD.buyer);
  expect(chat.registered).toHaveLength(1);

  await panel.locator('textarea').fill('Sending the refund details now');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.locator('[data-mine]')).toContainText('Sending the refund details now');
  expect(chat.posted).toHaveLength(1);
  expect(JSON.stringify(chat.posted)).not.toContain('refund details');
  for (const [role, me] of [['buyer', chat.buyer], ['mod', chat.mod]] as const) {
    const o = await open(chat.posted[0]!, { me, myRole: role, participants: chat.participants()!, trade: chat.channel, guard: new ReplayGuard(chat.channel) });
    expect(o.payload).toEqual({ text: 'Sending the refund details now' });
  }

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
  await page.context().route(`**/v1/chats/${CHAT}`, json({ chat: CHAT, role: 'seller', offerId: '00000000-0000-4000-8000-000000000000', counterparty: { displayName: BOARD.buyer }, tradeCode: BOARD.code, disputeOpen: false, attested: true, mySignPublic: other.signPublic, createdAt: '2026-10-28T12:00:00.000Z', lastMessageAt: null }));
  await openRoom(page);
  const panel = page.locator('#chat');
  await expect(panel).toContainText('This conversation is open on another device', { timeout: 30_000 });
  await expect(panel.locator('textarea')).toHaveCount(0);
});
