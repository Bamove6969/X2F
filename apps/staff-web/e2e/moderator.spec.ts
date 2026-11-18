// Plan 4 Task 18: the moderator pages in a real browser, checked with the parity harness against
// their boards: ModQueue at 1280x1000 and ModCase at 1280x1600, with the trade codes masked; the
// stubbed times are set to the boards' own, and the chat's lines are not on the page (design build
// task 9: they show only once opened, which the parity run does not do; its device is confirmed).
// The staff API is stubbed with page.route in the shapes of apps/api/src/disputes/staffRoutes.ts and
// apps/api/src/staff/devices.ts, filled with the boards' own example data, so any board copy the
// page does not show is either listed below with its reason or fails the test. The case page is
// also checked to make no chat request.
//
// Design build task 9 end to end: a moderator confirms this browser's device key with a security-key
// tap (Chromium's virtual authenticator, the challenge rebuilt and the assertion verified here as
// the API does), opens the disputed chat and sends a countersigned message. The traders and the
// moderation process are played here with the real crypto of @x2f/protocol: the attestation is
// signed with the build's pinned moderation key (modKey.ts), the chat key is the buyer's signed key
// record, re-wrapped to the device's box key; the message's countersign is verified by the device's
// certified key, its freshness, request id and seq checked, it is signed as the moderator and a
// trader opens it. The whole run is under STAFF_CSP (no 'wasm-unsafe-eval'), and must report no CSP
// violation and no page error. FAILS on 6695ff61 (reported to the lead 18 Nov, the CSP not changed):
// libsodium-wrappers 0.8.4 has no JS fallback (both its ESM and CJS builds embed only WebAssembly),
// so under STAFF_CSP `sodium.ready` aborts with a WebAssembly CompileError and no device key is made.
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, verify, type KeyObject } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { newTradeCode } from '@x2f/core';
import {
  generateIdentity,
  makeChatKeyRecord,
  newChatKey,
  openChat,
  ReplayGuard,
  sealChat,
  signChatEnvelope,
  verifyModCountersign,
  wrapChatKey,
  type ChatEnvelopeV2,
  type ChatEnvelopeV2Body,
  type Identity,
  type Participants,
} from '@x2f/protocol';
import { staffDeviceKeyId, tapChallenge, type KeyTapIntent } from '@x2f/staff';
import { attestationBytes, channelFor, type Attestation } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { expectParity } from '../../web/e2e/parity.js';
import { MOD_TEST_SEED_HEX, MOD_TEST_SIGNING_PUBLIC } from './modKey.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const MIN = 60_000;
const H = 60 * MIN;
/** Half a minute of slack, so a "25 min" on the board stays 25 while the test runs. */
const at = (ms: number) => new Date(Date.now() + ms + (ms >= 0 ? 30_000 : -30_000)).toISOString();

const ACCOUNT_ID = '5b0c8f0e-2c1d-4b7a-9e3f-6a2d1c0b9e8f';
const ME = { displayName: 'dmitri_k', role: 'mod', nav: ['disputes', 'training', 'log'], sessionEndsAt: new Date(Date.now() + 8 * H).toISOString() };

const row = (o: Record<string, unknown>) => ({
  incidentId: 'D-0000', status: 'open', round: 1, openedBy: 'buyer', rulingDueAt: at(40 * H), approval: 'not-needed', assignee: null, mine: false, ...o,
});

/**
 * Board ModQueue's five example cases, in its order, with the catalog's real ids and names
 * (data/payment-methods.json), as the staff API sends them.
 */
const QUEUE = {
  settings: { firstResponseH: 4, largeTradeLimitUsd: 1000 },
  counts: { open: 5, overdue: 1, unassigned: 1, needApproval: 2 },
  rows: [
    row({ code: 'M3TB9HQZ6WCR1FXA', xmr: '2100000000000', usd: '693.00', method: 'PAY_BY_MAIL', methodName: 'Cash by mail', openedBy: 'seller', waitingMs: 4 * H + 25 * MIN, replyDueAt: at(-25 * MIN), deadlineTone: 'overdue', assignee: 'dmitri_k', mine: true }),
    row({ code: 'P9VC6KE1YB4M2HJD', xmr: '400000000000', usd: '132.00', method: 'REVOLUT', methodName: 'Revolut', openedBy: 'seller', waitingMs: 3 * H + 45 * MIN, replyDueAt: at(15 * MIN), deadlineTone: 'due' }),
    row({ code: '7RWD3MXEKQ84HN2T', xmr: '4000000000000', usd: '1320.00', method: 'ZELLE', methodName: 'Zelle', waitingMs: 2 * H + 40 * MIN, replyDueAt: at(80 * MIN), deadlineTone: 'due', approval: 'needs-second', assignee: 'dmitri_k', mine: true }),
    row({ code: 'K7M29QXA4FTR8WPN', xmr: '1250000000000', usd: '412.50', method: 'ZELLE', methodName: 'Zelle', waitingMs: 3 * H + 16 * MIN, replyDueAt: at(44 * MIN), deadlineTone: 'replied', assignee: 'sarah.v' }),
    row({
      code: 'B8NE4YJW2PVK7DSG', status: 'awaiting-approval', xmr: '6500000000000', usd: '2145.00', method: 'ACH_TRANSFER', methodName: 'ACH bank transfer (US)', waitingMs: 26 * H, replyDueAt: at(-22 * H),
      deadlineTone: 'replied', approval: { waitingFor: 'second-approval', proposedBy: 'sarah.v' }, assignee: 'sarah.v',
    }),
  ],
};

const trader = (name: string, trades: number, pct: number) => ({
  displayName: name, completedTrades: trades, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: pct, badges: [], stage: 'graduated', tradedOverXmr: null, imported: [],
});

/** Board ModCase's example case: 7RWD-3MXE-KQ84-HN2T, assigned to the viewer, above the limit. */
const CASE = {
  code: '7RWD3MXEKQ84HN2T', incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: '',
  afterRefund: false, openedAt: at(-(2 * H + 40 * MIN)), replyDueAt: at(80 * MIN), rulingDueAt: at(45 * H), firstReplyAt: null,
  usd: '1320.00', overLimit: true, limitUsd: 1000, assignee: 'dmitri_k', assignedToYou: true, proposedByYou: false, taken: null, mayWork: true, moderator: null,
  traders: { buyer: trader('harbor_lin', 31, 100), seller: trader('quietfox', 145, 97) },
  escrow: { state: 'escrow-secured', amountAtomic: '4000000000000', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '132000', confirmations: 10, takenAt: at(-4 * H) },
  ruling: { proposal: null, sentBack: null, draft: null, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null },
  freezes: { buyer: false, seller: false },
};

/** This browser's device key, as DeviceCard stored it (the public halves are kept in the clear). */
const browserDevice = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ signPublic: string; boxPublic: string } | null>((resolve, reject) => {
        const r = indexedDB.open('x2f-staff-device', 1);
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const g = db.transaction('device').objectStore('device').get('key');
          g.onerror = () => reject(g.error);
          g.onsuccess = () => {
            db.close();
            const k = g.result as { signPublic: string; boxPublic: string } | undefined;
            resolve(k ? { signPublic: k.signPublic, boxPublic: k.boxPublic } : null);
          };
        };
      }),
  );

interface Device {
  deviceKeyId: string;
  signPublic: string;
  boxPublic: string;
  certifiedAt: string;
  expiresAt: string;
}

/** One soft security key: Chromium's virtual authenticator with one P-256 credential for `localhost`. */
interface SoftKey {
  credentialId: string;
  publicKey: KeyObject;
}

async function softKey(page: Page): Promise<SoftKey> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const id = randomBytes(16);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await cdp.send('WebAuthn.addCredential', {
    authenticatorId,
    credential: { credentialId: id.toString('base64'), isResidentCredential: false, rpId: 'localhost', privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), signCount: 0 },
  });
  return { credentialId: id.toString('base64url'), publicKey: createPublicKey(publicKey.export({ format: 'pem', type: 'spki' })) };
}

/** The chat as the traders and the moderation process hold it (design build task 9). */
interface ChatWorld {
  chat: string;
  channel: string;
  ids: { buyer: Identity; seller: Identity; mod: Identity };
  participants: Participants;
  tk: Uint8Array;
  attestation: { attestation: Attestation; sig: string };
  record: Awaited<ReturnType<typeof makeChatKeyRecord>>;
  envelopes: Array<{ id: string; senderRole: string; envelope: ChatEnvelopeV2; at: string }>;
  /** The moderator's next seq (moderation's mod_chat_seq). */
  nextSeq: number;
  requestIds: Set<string>;
}

/** What the traders wrote before the dispute: the board's own lines (ModCase). */
const LINES: ReadonlyArray<['buyer' | 'seller', string]> = [
  ['buyer', 'Hi, is the 4 XMR still available?'],
  ['seller', 'Yes. Please pay by Zelle and send the screenshot.'],
  ['buyer', 'Will do.'],
  ['seller', 'Nothing in my Zelle yet.'],
];

async function chatWorld(): Promise<ChatWorld> {
  await sodium.ready;
  const mod = sodium.crypto_sign_seed_keypair(sodium.from_hex(MOD_TEST_SEED_HEX));
  expect(sodium.to_hex(mod.publicKey), 'modKey.ts: the seed is the pinned key\'s').toBe(MOD_TEST_SIGNING_PUBLIC);
  const chat = newTradeCode();
  const channel = await channelFor(chat, 'chat');
  const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  const participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  const a: Attestation = { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: at(-5 * H) };
  const attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), mod.privateKey)) };
  // The buyer made the chat key (its signed key record), and both traders wrote under it.
  const tk = await newChatKey();
  const record = await makeChatKeyRecord({ chat: channel, by: 'buyer', tk, me: ids.buyer, participants });
  const seqs = { buyer: 0, seller: 0 };
  const envelopes: ChatWorld['envelopes'] = [];
  for (const [i, [from, text]] of LINES.entries()) {
    const envelope = await sealChat({ trade: channel, from, seq: seqs[from]++, type: 'chat.msg', payload: { text }, tk, me: ids[from] });
    envelopes.push({ id: String(i + 1), senderRole: from, envelope, at: at(-(4 * H - i * 10 * MIN)) });
  }
  return { chat, channel, ids, participants, tk, attestation, record, envelopes, nextSeq: 0, requestIds: new Set() };
}

interface Stub {
  calls: string[];
  devices: Device[];
  /** The moderator envelopes moderation signed, as the traders receive them. */
  sent: ChatEnvelopeV2[];
  world: ChatWorld | null;
}

/**
 * The staff API (and, behind it, the moderation process) for one moderator. `certified`: this
 * browser's device is already confirmed (read from its IndexedDB on the first device list).
 */
async function stub(page: Page, o: { key?: SoftKey; certified?: boolean } = {}): Promise<Stub> {
  const s: Stub = { calls: [], devices: [], sent: [], world: null };
  const taps = new Map<string, { intent: KeyTapIntent; challenge: string; done: boolean; used: boolean }>();
  const device = (id: unknown) => s.devices.find((d) => d.deviceKeyId === id);
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    s.calls.push(`${method} ${path}`);
    const b = (method === 'POST' ? req.postDataJSON() : {}) as Record<string, unknown>;
    if (path === '/staff/v1/me') return json(ME)(route);
    if (path === '/staff/v1/disputes') return json(QUEUE)(route);
    if (path === `/staff/v1/disputes/${CASE.code}`) return json(CASE)(route);

    // Chat membership task 8: one's own device keys (apps/api/src/staff/devices.ts).
    if (path === '/staff/v1/devices' && method === 'GET') {
      if (o.certified && s.devices.length === 0) {
        const k = await browserDevice(page);
        if (k !== null) s.devices.push({ deviceKeyId: staffDeviceKeyId(k.signPublic), ...k, certifiedAt: at(-H), expiresAt: at(364 * 24 * H) });
      }
      return json({ accountId: ACCOUNT_ID, devices: s.devices })(route);
    }
    if (path === '/staff/v1/taps/start' && o.key !== undefined) {
      // The API stamps issuedAt on a certify-device intent and signs nothing else (keyTap.ts).
      const intent = { ...b, issuedAt: new Date().toISOString() } as KeyTapIntent;
      if (intent.kind !== 'certify-device' || intent.accountId !== ACCOUNT_ID) return json({ error: 'bad-request' }, 400)(route);
      const nonce = randomBytes(32);
      const challenge = Buffer.from(tapChallenge(intent, nonce)).toString('base64url');
      const tapId = randomUUID();
      taps.set(tapId, { intent, challenge, done: false, used: false });
      return json({
        tapId,
        nonce: nonce.toString('hex'),
        issuedAt: intent.issuedAt,
        options: { challenge, rpId: 'localhost', allowCredentials: [{ id: o.key.credentialId, type: 'public-key', transports: ['usb'] }], userVerification: 'discouraged', timeout: 60_000 },
      })(route);
    }
    const finish = /^\/staff\/v1\/taps\/([^/]+)\/finish$/.exec(path);
    if (finish !== null && o.key !== undefined) {
      const tap = taps.get(finish[1]!);
      const r = (b.response ?? {}) as { id?: string; response?: { clientDataJSON?: string; authenticatorData?: string; signature?: string } };
      const cd = Buffer.from(r.response?.clientDataJSON ?? '', 'base64url');
      const client = JSON.parse(cd.toString('utf8') || '{}') as { type?: string; challenge?: string; origin?: string };
      const auth = Buffer.from(r.response?.authenticatorData ?? '', 'base64url');
      // As the API's finishKeyTap: our credential, this challenge, this origin, and the key's signature.
      const ok = tap !== undefined && !tap.done && r.id === o.key.credentialId && client.type === 'webauthn.get' && client.challenge === tap.challenge
        && client.origin === new URL(req.url()).origin && auth.subarray(0, 32).equals(createHash('sha256').update('localhost').digest())
        && verify('sha256', Buffer.concat([auth, createHash('sha256').update(cd).digest()]), o.key.publicKey, Buffer.from(r.response?.signature ?? '', 'base64url'));
      if (!ok) return json({ error: 'tap-failed' }, 400)(route);
      tap.done = true;
      return json({ tapId: finish[1] })(route);
    }
    if (path === '/staff/v1/devices' && method === 'POST') {
      const tap = taps.get(String(b.tapId));
      const signPublic = String(b.signPublic);
      const want = { kind: 'certify-device', accountId: ACCOUNT_ID, deviceKeyId: staffDeviceKeyId(signPublic), signPublic, boxPublic: b.boxPublic };
      const { issuedAt, ...signed } = (tap?.intent ?? {}) as KeyTapIntent & { issuedAt: string };
      // consumeKeyTap: a finished, unused tap of exactly this intent.
      if (tap === undefined || !tap.done || tap.used || JSON.stringify(signed) !== JSON.stringify(want)) return json({ error: 'tap-mismatch' }, 403)(route);
      tap.used = true;
      const d: Device = { deviceKeyId: want.deviceKeyId, signPublic, boxPublic: String(b.boxPublic), certifiedAt: issuedAt, expiresAt: new Date(Date.parse(issuedAt) + 365 * 24 * H).toISOString() };
      s.devices.push(d);
      return json({ deviceKeyId: d.deviceKeyId, expiresAt: d.expiresAt }, 201)(route);
    }

    // Design build task 9: the read (the chat key re-wrapped to a certified device) and the message.
    if (path === `/staff/v1/disputes/${CASE.code}/chat` && method === 'POST') {
      const d = device(b.deviceKeyId);
      if (d === undefined) return json({ error: 'device-not-certified' }, 403)(route);
      const w = (s.world ??= await chatWorld());
      return json({
        chat: w.chat,
        channel: w.channel,
        wrap: await wrapChatKey(d.boxPublic, w.tk),
        tkh: w.record.tkh,
        nextSeq: w.nextSeq,
        attestation: w.attestation,
        record: w.record,
        envelopes: [...w.envelopes],
      })(route);
    }
    if (path === `/staff/v1/disputes/${CASE.code}/messages` && method === 'POST' && s.world !== null) {
      const w = s.world;
      const d = device(b.deviceKeyId);
      if (d === undefined) return json({ error: 'device-not-certified' }, 403)(route);
      const body: ChatEnvelopeV2Body = { v: 2, trade: w.channel, from: 'mod', seq: b.seq as number, nonce: String(b.nonce), ct: String(b.ct) };
      try {
        await verifyModCountersign({ chat: w.channel, seq: b.seq, nonce: b.nonce, ctSha256: b.ctSha256, requestId: b.requestId, issuedAt: b.issuedAt, sig: b.sig }, { body, signPublic: d.signPublic });
      } catch {
        return json({ error: 'bad-countersign' }, 400)(route);
      }
      const age = Date.now() - Date.parse(String(b.issuedAt));
      if (age > 5 * MIN || age < -MIN) return json({ error: 'stale-countersign' }, 403)(route);
      if (w.requestIds.has(String(b.requestId))) return json({ error: 'replayed' }, 403)(route);
      if (b.seq !== w.nextSeq) return json({ error: 'stale-seq', nextSeq: w.nextSeq }, 409)(route);
      w.requestIds.add(String(b.requestId));
      w.nextSeq += 1;
      const envelope = await signChatEnvelope(body, w.ids.mod);
      const id = String(w.envelopes.length + 1);
      w.envelopes.push({ id, senderRole: 'mod', envelope, at: new Date().toISOString() });
      s.sent.push(envelope);
      return json({ id }, 201)(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
  return s;
}

/** The parity failures, as the harness lists them (an empty list when it passed). */
async function parityFailures(page: Page, board: string, viewport: '1280x1000' | '1280x1600', masks: ReturnType<Page['locator']>[]): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  try {
    await expectParity(page, board, { viewport, masks });
    return [];
  } catch (e) {
    return String((e as Error).message).split('\n  - ').slice(1).map((l) => l.trim());
  }
}

/**
 * ModCase copy the page does not show, each for a reason recorded in ModCase.tsx:
 * - design build task 9: the chat is not opened in this run (the device is confirmed, the chat not opened), so no transcript and no "Opened by you at" header;
 * - the proof itself is not viewable yet, so its three facts are not shown, and the request names
 *   the trader asked (the API asks for a side; the board has one button for the uploader);
 * - the board's trader lines past trades and positive share are not in the case answer;
 * - the escrow's "Secured · 10 of 10": the case answer has the confirmations, not the target.
 */
const KNOWN_CASE = [
  // The chat (not opened in this run, design build task 9): its header, both sections and every line.
  /^board copy missing: "Opened by you at \d\d:\d\d · logged"$/,
  /^board copy missing: "Before the trade"$/,
  /^board copy missing: "Trade"$/,
  /^board copy missing: "(harbor_lin|quietfox) · (buyer|seller) · \d\d:\d\d"$/,
  /^board copy missing: "\d\d:\d\d · .*"$/,
  /^board copy missing: "(Hi, is the 4 XMR|Yes\. Please pay|Will do\.|Nothing in my Zelle|Yes, the screenshot).*"$/,
  // The proof itself (not viewable yet); its request names the trader (the API asks for a side).
  /^board copy missing: "(Shows \$1,320\.00, the right amount|Note says .*|Sender name blurred by harbor_lin)"$/,
  /^board copy missing: "Request unblurred proof"$/,
  // Trader lines not in the case answer.
  /^board copy missing: "(0 disputes · joined Mar 2026|2 disputes, 1 lost · joined Nov 2025|Cancel rate \d%|Last ratings: .*)"$/,
  // The escrow's state in words (the case answer has the state and confirmations, not the target).
  /^board copy missing: "Secured · 10 of 10"$/,
];

test('ModQueue parity at 1280x1000, the codes masked (the stubbed times are the board\'s own)', async ({ page }) => {
  await stub(page);
  await page.goto('/disputes');
  await expect(page.locator('[data-screen="mod-queue"]')).toBeVisible();
  await expect(page.locator('table[aria-label="Disputes"] tbody tr')).toHaveCount(5);
  expect(await parityFailures(page, 'ModQueue', '1280x1000', [page.locator('[data-part="queue-code"]')])).toEqual([]);
});

test('ModCase parity at 1280x1600, the code masked, on a confirmed device; no chat is fetched', async ({ page }) => {
  const { calls } = await stub(page, { certified: true });
  await page.goto(`/disputes/${CASE.code}`);
  await expect(page.locator('[data-screen="mod-case"]')).toBeVisible();
  await expect(page.locator('[data-part="device-certified"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open the full chat' })).toBeEnabled();
  const failures = await parityFailures(page, 'ModCase', '1280x1600', [page.locator('h1')]);
  expect(failures.filter((f) => !KNOWN_CASE.some((k) => k.test(f)))).toEqual([]);
  // Every known difference still occurs: one that no longer does is stale and must go.
  expect(KNOWN_CASE.filter((k) => !failures.some((f) => k.test(f))).map(String)).toEqual([]);
  expect(calls.filter((c) => /\/chat\b/.test(c))).toEqual([]);
});

/** Every CSP violation the page reports (the event, which the console line also shows), and console errors. */
async function watchCsp(page: Page): Promise<{ violations: () => Promise<string[]>; console: string[] }> {
  const console: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /content security policy|refused to/i.test(m.text())) console.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => console.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
  return { violations: () => page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations.slice()), console };
}

test('design build task 9: a moderator confirms this device, opens the disputed chat and sends a countersigned message, under STAFF_CSP', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== origin) foreign.push(r.url());
  });
  const csp = await watchCsp(page);
  const key = await softKey(page);
  const s = await stub(page, { key });

  const res = await page.goto(`/disputes/${CASE.code}`);
  expect(res?.headers()['content-security-policy']).not.toContain('wasm-unsafe-eval');
  await expect(page.locator('[data-screen="mod-case"]')).toBeVisible();
  const openChatButton = page.getByRole('button', { name: 'Open the full chat' });
  // A new browser: its device key is made (libsodium, in the page) and is not yet confirmed.
  await expect(page.locator('[data-part="device-uncertified"]')).toBeVisible();
  await expect(openChatButton).toBeDisabled();

  await page.getByRole('button', { name: 'Confirm this device' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm this device' });
  await expect(dialog.locator('[data-part="key-tap-intent"]')).toContainText('certify-device');
  await dialog.getByRole('button', { name: 'Tap security key' }).click();
  await expect(page.locator('[data-part="device-certified"]')).toHaveText('This device can open disputed chats.');
  await expect(dialog).toHaveCount(0);
  expect(s.devices).toHaveLength(1);
  const mine = await browserDevice(page);
  expect(s.devices[0]).toMatchObject({ signPublic: mine!.signPublic, boxPublic: mine!.boxPublic, deviceKeyId: staffDeviceKeyId(mine!.signPublic) });

  // The read: the attestation checked against the pinned key, the wrap opened with the device key, every line verified.
  await openChatButton.click();
  const lines = page.locator('[data-part="chat-lines"] > li');
  const name = { buyer: 'harbor_lin', seller: 'quietfox' } as const;
  await expect(lines).toHaveText(LINES.map(([from, text]) => `${name[from]}: ${text}`));
  await expect(page.locator('[data-part="chat-unreadable"]')).toHaveCount(0);
  for (const [i, [from]] of LINES.entries()) await expect(lines.nth(i)).toHaveAttribute('data-from', from);

  const text = 'Both of you, please upload the payment screenshot here within the hour.';
  await page.getByRole('textbox', { name: 'Message both traders' }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('[data-part="message"] .x2f-staff-ok')).toHaveText('Sent and logged.');
  await expect(lines.last()).toHaveText(`Moderator: ${text}`);
  await expect(lines.last()).toHaveAttribute('data-from', 'mod');

  // What the traders receive: the moderator's envelope, signed by the attested mod identity, opens to the text.
  const w = s.world!;
  expect(s.sent).toHaveLength(1);
  const got = await openChat(s.sent[0], { tk: w.tk, trade: w.channel, participants: w.participants, guard: new ReplayGuard(w.channel) });
  expect([got.from, got.type, got.payload]).toEqual(['mod', 'chat.msg', { text }]);
  expect(w.nextSeq).toBe(1);
  expect(s.calls.filter((c) => c.startsWith('POST '))).toEqual([
    'POST /staff/v1/taps/start',
    expect.stringMatching(/^POST \/staff\/v1\/taps\/[0-9a-f-]+\/finish$/),
    'POST /staff/v1/devices',
    `POST /staff/v1/disputes/${CASE.code}/chat`,
    `POST /staff/v1/disputes/${CASE.code}/messages`,
  ]);

  // All of it under a page that may not compile WebAssembly (no 'wasm-unsafe-eval'), and nothing refused on the way.
  expect(await csp.violations()).toEqual([]);
  expect(csp.console).toEqual([]);
  expect(foreign).toEqual([]);
  const wasm = await page.evaluate(() =>
    WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(
      () => 'compiled',
      (e: unknown) => String(e),
    ),
  );
  expect(wasm).toMatch(/CompileError.*(Content Security Policy|unsafe-eval)/i);
});

// Disputes-stack review 2026-11-16 (merge 3c63c18e): the owner's unread badge (O-040) is styled at
// a wide and a narrow width, not only inside ModCase's `@media (max-width: 900px)`.
test('the owner\'s unread badge is styled at 1280 and at 800 px wide', async ({ page }) => {
  const owner = { ...ME, displayName: 'lumen.k', role: 'owner', nav: ['disputes'] };
  await page.route('**/staff/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/staff/v1/me') return json(owner)(route);
    if (path === '/staff/v1/disputes') return json(QUEUE)(route);
    if (path === '/staff/v1/owner/alerts') return json({ items: [], unread: 3, next: null })(route);
    return json({ error: 'not-found' }, 404)(route);
  });
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/disputes');
    const badge = page.locator('[data-part="alerts-badge"]');
    await expect(badge).toHaveText('3');
    const style = await badge.evaluate((el) => {
      const s = getComputedStyle(el);
      return { display: s.display, borderRadius: s.borderTopLeftRadius, textAlign: s.textAlign };
    });
    expect(style, `${width} px`).toEqual({ display: 'inline-block', borderRadius: '999px', textAlign: 'center' });
  }
});
