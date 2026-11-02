// Plan 4 Task 7 test helpers: a staff app whose security keys are attested (a test CA and FIDO
// metadata on both allowlists), keys registered on the staff relying party, taps through the
// staff routes, and the owner with two keys and a PGP key.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KeyTapIntent, LoginHours, StaffRole } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../src/app.js';
import { fileAttestationPolicy } from '../../src/auth/attestation.js';
import { insertPgpKey } from '../../src/auth/pgp.js';
import { verifyWebAuthnRegistration, webauthnRegistrationOptions } from '../../src/auth/webauthn.js';
import { genKey, type Pair } from './pgpKeys.js';
import { createSoftAuthenticator, createTestCa, writeTestMds, type SoftAuthenticator } from './softAuthenticator.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff, staffApps } from './staffApp.js';

/** On the staff and the owner allowlists. */
export const KEY_AAGUID = '11111111-2222-4333-8444-555555555555';

export type AttestedStaffApps = Awaited<ReturnType<typeof staffApps>> & { newKey(o?: { passkey?: boolean }): SoftAuthenticator };

/** `staffApps` with an attestation policy that accepts the test CA's keys (staff and owner). */
export async function attestedStaffApps(): Promise<AttestedStaffApps> {
  const ca = createTestCa();
  const dir = await mkdtemp(join(tmpdir(), 'x2f-mds-staff-'));
  await writeTestMds(dir, ca, { statements: [KEY_AAGUID], allow: [KEY_AAGUID], ownerAllow: [KEY_AAGUID] });
  const attestation = fileAttestationPolicy(dir);
  await attestation.init();
  const apps = await staffApps({ attestation });
  return {
    ...apps,
    newKey: (o = {}) =>
      o.passkey
        ? createSoftAuthenticator({ backedUp: true, userVerified: true })
        : createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: KEY_AAGUID, ca } }),
    async close() {
      await apps.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Registers `key` for the account on the staff relying party (as setup or an invite would). */
export async function registerKey(app: FastifyInstance, accountId: string, key: SoftAuthenticator, o: { passkey?: boolean } = {}): Promise<void> {
  const challenge = randomBytes(32);
  const options = await webauthnRegistrationOptions(app.deps, accountId, { kind: o.passkey ? 'passkey' : 'security-key', challenge });
  await verifyWebAuthnRegistration(app.deps, accountId, key.register(options, STAFF_ORIGIN), challenge, o.passkey ? { kind: 'passkey' } : {});
}

export async function addPgpKey(deps: Deps, accountId: string): Promise<Pair> {
  const pair = await genKey();
  await insertPgpKey(deps.db, deps.config, { accountId, fingerprint: pair.fingerprint, armored: pair.publicKey, now: deps.clock() });
  return pair;
}

export interface Person {
  id: string;
  loginName: string;
  keys: SoftAuthenticator[];
  browser: StaffBrowser;
}

/** A staff member (or the owner) with `keys` attested security keys and a live staff session. */
export async function staffWithKeys(
  t: AttestedStaffApps,
  o: { role: StaffRole; keys?: number; hours?: LoginHours },
): Promise<Person> {
  const s = await seedStaff(t.deps, { role: o.role, ...(o.hours ? { hours: o.hours } : {}) });
  const keys: SoftAuthenticator[] = [];
  for (let i = 0; i < (o.keys ?? (o.role === 'owner' ? 2 : 1)); i++) {
    const k = t.newKey();
    await registerKey(t.app, s.id, k);
    keys.push(k);
  }
  const { token } = await insertSession(t.deps, s.id, 'staff');
  return { ...s, keys, browser: new StaffBrowser(t.app).withSession(token) };
}

/** A finished tap for `intent` through the staff routes; returns its id. */
export async function tap(p: Person, intent: KeyTapIntent, key = p.keys[0]!): Promise<string> {
  const start = await p.browser.post('/staff/v1/taps/start', intent);
  if (start.statusCode !== 200) throw new Error(`taps/start ${start.statusCode} ${start.body}`);
  const { tapId, options } = start.json();
  const fin = await p.browser.post(`/staff/v1/taps/${tapId}/finish`, { response: key.authenticate(options, STAFF_ORIGIN) });
  if (fin.statusCode !== 200) throw new Error(`taps/finish ${fin.statusCode} ${fin.body}`);
  return tapId as string;
}

/** What the owner's browser makes for a new invite: the token never leaves it except in the create request. */
export function newInvite(now: Date, o: { role: Exclude<StaffRole, 'owner'>; ttlMs?: number }) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const inviteId = randomUUID();
  const expiresAt = new Date(now.getTime() + (o.ttlMs ?? 24 * 3_600_000)).toISOString();
  const intent: KeyTapIntent = { kind: 'create-invite', inviteId, role: o.role, tokenHash, expiresAt };
  return { token, tokenHash, inviteId, expiresAt, intent };
}
