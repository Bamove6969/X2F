// S-085 review S4: the staff API ignores `X2F-Session-Key` (staff-web is not wired, spec section 8):
// a staff login with the header, valid or malformed, opens an unbound staff session and sets no
// bound cookie, with X2F_DEVICE_BOUND_SESSIONS on.
import { generateKeyPairSync } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttestationPolicy, Deps } from '../../src/app.js';
import { BOUND_COOKIE, SESSION_KEY_HEADER } from '../../src/auth/deviceBound.js';
import type { Config } from '../../src/config.js';
import { createSoftAuthenticator, type SoftAuthenticator } from '../helpers/softAuthenticator.js';
import { STAFF_ORIGIN, STAFF_SESSION_COOKIE, seedStaff, staffApps } from '../helpers/staffApp.js';

const MIN = 60_000;
const KEY_AAGUID = '0b0c0d0e-1111-4222-8333-444455556666';
const attestation: AttestationPolicy = { async init() {}, isAllowed: (aaguid, fmt) => fmt !== 'none' && aaguid.toLowerCase() === KEY_AAGUID };

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps({ attestation }));
  setNow(new Date('2026-11-02T12:00:00Z'));
  await seedStaff(deps, { role: 'owner' });
  (deps.config as Config).deviceBoundSessions = true;
});
afterAll(async () => close());

class Browser {
  cookies: Record<string, string> = {};
  constructor(private readonly header: string) {}
  async post(url: string, payload: unknown): Promise<LightMyRequestResponse> {
    const res = await app.inject({ method: 'POST', url, headers: { origin: STAFF_ORIGIN, [SESSION_KEY_HEADER]: this.header }, cookies: this.cookies, payload: payload as object });
    for (const c of res.cookies) this.cookies[c.name] = c.value;
    return res;
  }
}

async function addKey(accountId: string): Promise<SoftAuthenticator> {
  const key = createSoftAuthenticator({ backedUp: false, userVerified: true });
  await deps.db.query(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, aaguid, label, created_at)
     values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', true, $4, 'k', $5)`,
    [accountId, Buffer.from(key.credentialId, 'base64url'), key.cosePublicKey, KEY_AAGUID, deps.clock()],
  );
  return key;
}

/** A PGP first factor recorded for this browser (as staff/login.test.ts does), then the security key. */
async function fullLogin(b: Browser, accountId: string, loginName: string, key: SoftAuthenticator) {
  const probe = (await b.post('/staff/v1/login/security-key/start', { loginName })).json();
  const { rows: dev } = await deps.db.query<{ device_hash: Buffer }>('select device_hash from challenges where id = $1', [probe.challengeId]);
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
     values ($1, $2, 'second-factor', 'pair', $3, $4, $5) returning id`,
    [accountId, dev[0]!.device_hash, JSON.stringify({ first: { method: 'pgp', fingerprint: 'a'.repeat(40), fingerprints: ['a'.repeat(40)] }, app: 'staff' }), now, new Date(now.getTime() + 5 * MIN)],
  );
  const pendingId = rows[0]!.id;
  const start = (await b.post('/staff/v1/login/security-key/start', { pendingId })).json();
  return b.post('/staff/v1/login/security-key/finish', { challengeId: start.challengeId, response: key.authenticate(start.options, STAFF_ORIGIN), deviceLabel: 'Desk', pendingId });
}

describe('the staff API and X2F-Session-Key', () => {
  it('ignores the header, valid or malformed: an unbound staff session, no bound cookie', async () => {
    const spki = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
    for (const header of [spki, 'not base64!']) {
      const s = await seedStaff(deps, { role: 'mod' });
      const key = await addKey(s.id);
      const b = new Browser(header);
      const res = await fullLogin(b, s.id, s.loginName, key);
      expect(res.json(), res.body).toEqual({ status: 'ok' });
      expect(b.cookies[STAFF_SESSION_COOKIE]).toBeDefined();
      expect(b.cookies[BOUND_COOKIE]).toBeUndefined();
      const { rows } = await deps.db.query('select bound_key from sessions where account_id = $1 and revoked_at is null', [s.id]);
      expect(rows).toEqual([{ bound_key: null }]);
    }
  });
});
