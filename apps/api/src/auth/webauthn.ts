import { createHmac, randomBytes } from 'node:crypto';
import { actionHash, type AccountKind, type ConfirmAction } from '@x2f/accounts';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import { assertDisplayNameFree, assertNewNames, assertTermsAccepted, createAccount, loginNameLookup, type NewNames } from '../accounts.js';
import { subkey } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { parseConfirmAction } from './actionInput.js';
import { hasCertificateChain, isUnknownAuthenticator } from './attestation.js';
import { consumeChallenge, takeStartBudgetUnlessOpen, type ChallengeRow } from './challenges.js';
import { issueConfirmToken, requireConfirm } from './confirm.js';
import { deviceHash, ensureDeviceCookie } from './device.js';
import { completeLogin, type LoginResult } from './login.js';
import { assertMethodAllowed } from './methods.js';
import { requireSession, startSession } from './sessions.js';

export type CredentialKind = 'passkey' | 'security-key';

/** WebAuthn challenges live 5 minutes; at exactly 5:00 they are refused. */
export const WEBAUTHN_TTL_MS = 5 * 60_000;
/**
 * At most this many security keys per account (FU-A review I2), so that a login by name can always
 * list exactly this many credential IDs, real ones padded with decoys: the entry count then never
 * says whether a login name exists. The next key is refused with 409 `security-key-limit`.
 */
export const MAX_SECURITY_KEYS = 5;
/** EdDSA, ES256, RS256. */
const ALGORITHMS = [-8, -7, -257];
const LABEL_MAX = 60;
/** base64url of a credential ID (at most 1023 bytes, WebAuthn's limit). */
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{16,1364}$/;
const ZERO_AAGUID = '00000000-0000-0000-0000-000000000000';
/** Never an account ID: the credentials query a decoy runs so it costs what a real lookup costs. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
/** WebAuthn's defined transports; anything else a client reports is dropped. */
const KNOWN_TRANSPORTS: ReadonlySet<string> = new Set(['usb', 'nfc', 'ble', 'hybrid', 'internal', 'smart-card']);

const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const failed = (): ApiError => new ApiError(401, 'webauthn-failed');
const expired = (): ApiError => new ApiError(400, 'challenge-expired');

function record(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  return body as Record<string, unknown>;
}

function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

function optStr(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

function credentialKind(v: unknown): CredentialKind {
  if (v === 'passkey' || v === 'security-key') return v;
  throw new ApiError(400, 'bad-request');
}

/** Control and format characters removed (as device labels), trimmed, at most 60 code points; a default when empty. */
function cleanLabel(label: string | undefined, kind: CredentialKind): string {
  const visible = (label ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  const l = Array.from(visible).slice(0, LABEL_MAX).join('').trim();
  return l === '' ? (kind === 'passkey' ? 'Passkey' : 'Security key') : l;
}

// ---------------------------------------------------------------------------------------------
// Policy

/**
 * Which credentials an account kind may log in with (R1, P2-I5). Owner: only an attested security
 * key. Staff: an attested security key, or a passkey (unattested), which Task 10's `pairAllowed`
 * accepts only as the partner of PGP. Traders: any passkey or security key. The authenticator's
 * self-reported device type and backup flags are never trusted for this. Otherwise 403
 * `method-not-allowed`.
 */
export function assertCredentialAllowed(accountKind: AccountKind, info: { kind: string; attested: boolean }): void {
  const ok =
    accountKind === 'trader'
      ? info.kind === 'passkey' || info.kind === 'security-key'
      : (info.kind === 'security-key' && info.attested) || (accountKind === 'staff' && info.kind === 'passkey');
  if (!ok) throw new ApiError(403, 'method-not-allowed');
}

/**
 * The registration settings for a credential kind and account kind. Passkey: resident key and user
 * verification required. Security key: no resident key, user verification preferred, roaming
 * authenticators only. Attestation `direct` for staff and owner security keys, `none` otherwise
 * (a staff passkey cannot be attested). An owner passkey → 403 `method-not-allowed`.
 */
export function registrationOptionsFor(kind: CredentialKind, accountKind: AccountKind) {
  if (accountKind === 'owner' && kind === 'passkey') throw new ApiError(403, 'method-not-allowed');
  return {
    attestationType: accountKind !== 'trader' && kind === 'security-key' ? ('direct' as const) : ('none' as const),
    authenticatorSelection:
      kind === 'passkey'
        ? { residentKey: 'required' as const, userVerification: 'required' as const }
        : {
            residentKey: 'discouraged' as const,
            userVerification: 'preferred' as const,
            authenticatorAttachment: 'cross-platform' as const,
          },
    supportedAlgorithmIDs: ALGORITHMS,
    timeout: WEBAUTHN_TTL_MS,
  };
}

// ---------------------------------------------------------------------------------------------
// Storage

interface CredentialRow {
  id: string;
  account_id: string;
  credential_id: Buffer;
  public_key: Buffer;
  counter: string;
  kind: CredentialKind;
  transports: string[] | null;
  attested: boolean;
  account_kind: AccountKind;
  webauthn_user_id: Buffer;
}

const CREDENTIAL_SELECT = `select c.id, c.account_id, c.credential_id, c.public_key, c.counter, c.kind, c.transports, c.attested,
                                  a.kind as account_kind, a.webauthn_user_id
                             from webauthn_credentials c join accounts a on a.id = c.account_id`;

interface AccountRow {
  id: string;
  /** The public display name: the only name an authenticator ever stores or shows (never the login name). */
  display_name: string;
  kind: AccountKind;
  webauthn_user_id: Buffer;
}

async function accountById(db: Queryable, accountId: string): Promise<AccountRow> {
  const { rows } = await db.query<AccountRow>('select id, display_name, kind, webauthn_user_id from accounts where id = $1', [accountId]);
  if (!rows[0]) throw new ApiError(401, 'not-authenticated');
  return rows[0];
}

async function credentialsOf(db: Queryable, accountId: string): Promise<Array<{ credential_id: Buffer; kind: CredentialKind; attested: boolean }>> {
  const { rows } = await db.query<{ credential_id: Buffer; kind: CredentialKind; attested: boolean }>(
    'select credential_id, kind, attested from webauthn_credentials where account_id = $1 order by created_at, id',
    [accountId],
  );
  return rows;
}

interface NewCredential {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  kind: CredentialKind;
  transports: string[];
  backedUp: boolean;
  deviceType: string;
  attested: boolean;
  aaguid: string | null;
}

/** How many security keys the account holds; 409 `security-key-limit` when another would exceed `MAX_SECURITY_KEYS`. */
async function assertSecurityKeyRoom(db: Queryable, accountId: string): Promise<void> {
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from webauthn_credentials where account_id = $1 and kind = 'security-key'",
    [accountId],
  );
  if (rows[0]!.n >= MAX_SECURITY_KEYS) throw new ApiError(409, 'security-key-limit');
}

/**
 * Stores a credential. A security key is counted against `MAX_SECURITY_KEYS` first; a caller that
 * must be race-proof locks the account row in its transaction (`addKeyFinish`).
 */
async function insertCredential(db: Queryable, accountId: string, c: NewCredential, label: string, now: Date): Promise<string> {
  if (c.kind === 'security-key') await assertSecurityKeyRoom(db, accountId);
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into webauthn_credentials
         (account_id, credential_id, public_key, counter, kind, transports, backed_up, device_type, attested, aaguid, label, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [
        accountId, Buffer.from(c.credentialId, 'base64url'), Buffer.from(c.publicKey), c.counter, c.kind, c.transports,
        c.backedUp, c.deviceType, c.attested, c.aaguid, label, now,
      ],
    );
    return rows[0]!.id;
  } catch (e) {
    // The same authenticator credential on any account: refused without saying where.
    if ((e as { code?: string }).code === '23505') throw failed();
    throw e;
  }
}

async function storeChallenge(
  deps: Deps,
  req: FastifyRequest,
  a: { accountId: string | null; sessionId: string | null; purpose: string; method: string; challenge: string; payload: object },
): Promise<string> {
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into challenges (account_id, session_id, device_hash, purpose, method, webauthn_challenge, payload, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      a.accountId, a.sessionId, deviceHash(req), a.purpose, a.method, a.challenge, JSON.stringify(a.payload), now,
      new Date(now.getTime() + WEBAUTHN_TTL_MS),
    ],
  );
  return rows[0]!.id;
}

// ---------------------------------------------------------------------------------------------
// Ceremonies

function challengeString(c: string | Uint8Array): string {
  return typeof c === 'string' ? c : b64url(c);
}

async function buildRegistrationOptions(
  deps: Pick<Deps, 'config'>,
  a: { kind: CredentialKind; accountKind: AccountKind; userID: Uint8Array; userName: string; exclude: Buffer[]; challenge?: Uint8Array },
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: deps.config.siteName,
    rpID: deps.config.rpId,
    userName: a.userName,
    userID: new Uint8Array(a.userID),
    excludeCredentials: a.exclude.map((id) => ({ id: b64url(id) })),
    ...(a.challenge ? { challenge: new Uint8Array(a.challenge) } : {}),
    ...registrationOptionsFor(a.kind, a.accountKind),
  });
}

/**
 * Checks a registration response: origin, RP ID, type `webauthn.create`, user presence, the
 * challenge, and user verification for a passkey; then decides `attested` (a `packed` statement
 * with a certificate chain that `MetadataService` verified against the snapshot, and an allowlisted
 * AAGUID) and applies `assertCredentialAllowed`. `kind` null (Plan 4's helper) means: attested →
 * security key, otherwise passkey. Any verification error → 401 `webauthn-failed`.
 */
async function verifyRegistration(
  deps: Deps,
  a: { accountKind: AccountKind; kind: CredentialKind | null; response: unknown; expectedChallenge: string },
): Promise<NewCredential> {
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: a.response as RegistrationResponseJSON,
      expectedChallenge: a.expectedChallenge,
      expectedOrigin: deps.config.origins,
      expectedRPID: deps.config.rpId,
      expectedType: 'webauthn.create',
      requireUserPresence: true,
      requireUserVerification: a.kind === 'passkey',
      supportedAlgorithmIDs: ALGORITHMS,
    });
  } catch (e) {
    // Strict metadata: an attested authenticator outside the snapshot is not allowed for staff or the owner.
    if (a.accountKind !== 'trader' && isUnknownAuthenticator(e)) throw new ApiError(403, 'method-not-allowed');
    throw failed();
  }
  if (!result.verified) throw failed();
  const info = result.registrationInfo;
  const attested =
    info.fmt === 'packed' && hasCertificateChain(info.attestationObject) && deps.attestation.isAllowed(info.aaguid, info.fmt);
  const kind = a.kind ?? (attested ? 'security-key' : 'passkey');
  if (kind === 'passkey' && !info.userVerified) throw failed();
  assertCredentialAllowed(a.accountKind, { kind, attested });
  return {
    credentialId: info.credential.id,
    publicKey: info.credential.publicKey,
    counter: info.credential.counter,
    kind,
    transports: [...new Set((info.credential.transports ?? []).filter((t) => KNOWN_TRANSPORTS.has(t)))],
    backedUp: info.credentialBackedUp,
    deviceType: info.credentialDeviceType,
    attested,
    aaguid: info.aaguid === ZERO_AAGUID ? null : info.aaguid,
  };
}

async function buildAssertionOptions(
  deps: Pick<Deps, 'config'>,
  creds: Array<{ credential_id: Buffer; kind: CredentialKind }>,
  challenge?: Uint8Array,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: deps.config.rpId,
    allowCredentials: creds.map((c) => ({ id: b64url(c.credential_id) })),
    userVerification: creds.some((c) => c.kind === 'passkey') ? 'required' : 'preferred',
    timeout: WEBAUTHN_TTL_MS,
    ...(challenge ? { challenge: new Uint8Array(challenge) } : {}),
  });
}

/**
 * Checks an assertion against the stored credential it names: origin, RP ID, type `webauthn.get`,
 * user presence, the challenge, the signature, user verification for a passkey, and the counter (a
 * non-zero counter that does not increase is refused). `accountId` null accepts any account's
 * credential (discoverable login); otherwise the credential must belong to that account. Stores
 * the new counter and `last_used_at`. Any failure → 401 `webauthn-failed`.
 */
async function verifyAssertion(
  deps: Deps,
  a: { accountId: string | null; response: unknown; expectedChallenge: string },
): Promise<CredentialRow> {
  const id = a.response !== null && typeof a.response === 'object' ? (a.response as { id?: unknown }).id : undefined;
  if (typeof id !== 'string' || !CREDENTIAL_ID.test(id)) throw failed();
  const { rows } = await deps.db.query<CredentialRow>(`${CREDENTIAL_SELECT} where c.credential_id = $1`, [Buffer.from(id, 'base64url')]);
  const row = rows[0];
  if (!row || (a.accountId !== null && row.account_id !== a.accountId)) throw failed();
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: a.response as AuthenticationResponseJSON,
      expectedChallenge: a.expectedChallenge,
      expectedOrigin: deps.config.origins,
      expectedRPID: deps.config.rpId,
      expectedType: 'webauthn.get',
      credential: {
        id,
        publicKey: new Uint8Array(row.public_key),
        counter: Number(row.counter),
        ...(row.transports ? { transports: row.transports } : {}),
      },
      requireUserVerification: row.kind === 'passkey',
    });
  } catch {
    throw failed();
  }
  if (!result.verified) throw failed();
  const next = result.authenticationInfo.newCounter;
  const updated = await deps.db.query(
    'update webauthn_credentials set counter = $2, last_used_at = $3 where id = $1 and (counter < $2 or (counter = 0 and $2 = 0))',
    [row.id, next, deps.clock()],
  );
  if ((updated.rowCount ?? 0) === 0) throw failed(); // a parallel assertion moved the counter first
  return row;
}

// ---------------------------------------------------------------------------------------------
// Exported for Plan 4 (staff and owner setup and login on the staff app)

/**
 * Registration options for an existing account: its `webauthn_user_id`, its credentials excluded,
 * the settings of `registrationOptionsFor` (default kind `security-key`). The caller keeps the
 * challenge (`options.challenge`, or the bytes it passed).
 */
export async function webauthnRegistrationOptions(
  deps: Pick<Deps, 'db' | 'config'>,
  accountId: string,
  o: { kind?: CredentialKind; challenge?: Uint8Array } = {},
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const account = await accountById(deps.db, accountId);
  const exclude = (await credentialsOf(deps.db, accountId)).map((c) => c.credential_id);
  return buildRegistrationOptions(deps, {
    kind: o.kind ?? 'security-key',
    accountKind: account.kind,
    userID: account.webauthn_user_id,
    userName: account.display_name,
    exclude,
    ...(o.challenge ? { challenge: o.challenge } : {}),
  });
}

/**
 * Verifies a registration for an existing account, applies `assertCredentialAllowed` and stores the
 * credential. Without `o.kind` the credential counts as a security key only when attested (an
 * unattested credential can only ever be a passkey, R1).
 */
export async function verifyWebAuthnRegistration(
  deps: Deps,
  accountId: string,
  response: unknown,
  expectedChallenge: string | Uint8Array,
  o: { kind?: CredentialKind; label?: string } = {},
): Promise<{ credentialId: string; kind: CredentialKind; attested: boolean; aaguid: string | null }> {
  const account = await accountById(deps.db, accountId);
  const cred = await verifyRegistration(deps, {
    accountKind: account.kind, kind: o.kind ?? null, response, expectedChallenge: challengeString(expectedChallenge),
  });
  await insertCredential(deps.db, accountId, cred, cleanLabel(o.label, cred.kind), deps.clock());
  return { credentialId: cred.credentialId, kind: cred.kind, attested: cred.attested, aaguid: cred.aaguid };
}

/** Assertion options listing the account's credentials that its kind may use (`assertCredentialAllowed`). */
export async function webauthnAssertionOptions(
  deps: Pick<Deps, 'db' | 'config'>,
  accountId: string,
  challenge: Uint8Array,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const account = await accountById(deps.db, accountId);
  const creds = (await credentialsOf(deps.db, accountId)).filter((c) => allowed(account.kind, c));
  return buildAssertionOptions(deps, creds, challenge);
}

/** Verifies an assertion by one of the account's own credentials, then `assertCredentialAllowed`. */
export async function verifyWebAuthnAssertion(
  deps: Deps,
  accountId: string,
  response: unknown,
  expectedChallenge: string | Uint8Array,
): Promise<{ credentialId: string; kind: CredentialKind; attested: boolean }> {
  const row = await verifyAssertion(deps, { accountId, response, expectedChallenge: challengeString(expectedChallenge) });
  assertCredentialAllowed(row.account_kind, { kind: row.kind, attested: row.attested });
  return { credentialId: b64url(row.credential_id), kind: row.kind, attested: row.attested };
}

function allowed(accountKind: AccountKind, c: { kind: string; attested: boolean }): boolean {
  try {
    assertCredentialAllowed(accountKind, c);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Login routes

/** How many stored security-key credential IDs have each byte length: the distribution the decoys draw from. */
export interface IdLengths {
  len: number;
  n: number;
}

/** Grouped, so the result is a handful of rows however many keys there are. Runs on every name-based start (parity). */
async function securityKeyIdLengths(db: Queryable): Promise<IdLengths[]> {
  const { rows } = await db.query<{ len: number; n: string }>(
    "select length(credential_id) as len, count(*) as n from webauthn_credentials where kind = 'security-key' group by len order by len",
  );
  return rows.map((r) => ({ len: r.len, n: Number(r.n) }));
}

/**
 * `count` decoy credential IDs for a login name (P2-I7, review I2): deterministic under
 * `subkey('decoy')` for the name's tag (`loginNameLookup`), so repeated starts for one name are
 * identical and different names differ. Each decoy's byte length is drawn, by HMAC, from the
 * lengths of the security keys actually stored (`lengths`, weighted by count), so a stranger's name
 * lists IDs of the same lengths as registered accounts do; with nothing stored yet, 64 bytes (a
 * YubiKey's non-discoverable credential ID). The bytes come from HMAC-SHA-512 in counter mode.
 */
export function decoyCredentialIds(deps: Pick<Deps, 'config'>, nameTag: string, count: number, lengths: readonly IdLengths[]): Buffer[] {
  const key = subkey(deps.config, 'decoy');
  const mac = (label: string, i: number, j: number) =>
    createHmac('sha512', key).update(Buffer.concat([Buffer.from(`${label}/${nameTag}/`, 'utf8'), Buffer.from([i, j])])).digest();
  const total = lengths.reduce((sum, l) => sum + l.n, 0);
  // A uniform draw in [0, 1) per decoy, mapped through the cumulative distribution of the stored
  // lengths, so a shift in the stored mix moves only the few draws near a boundary (the modulo
  // alternative would re-pick nearly every decoy on every registration site-wide).
  const lengthFor = (i: number): number => {
    if (total === 0) return 64;
    const u = mac('len', i, 0).readUInt32BE(0) / 2 ** 32;
    let seen = 0;
    for (const l of lengths) {
      seen += l.n;
      if (u < seen / total) return l.len;
    }
    return lengths[lengths.length - 1]!.len;
  };
  return Array.from({ length: count }, (_, i) => {
    const len = lengthFor(i);
    const blocks: Buffer[] = [];
    for (let j = 0; blocks.length * 64 < len; j++) blocks.push(mac('id', i, j));
    return Buffer.concat(blocks).subarray(0, len);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when `pendingId` names this account's open pending login (purpose `second-factor`) started
 * from this device whose first factor was PGP. Read without consuming it: `completeLogin` consumes
 * it when the second factor finishes.
 */
async function pendingAfterPgp(deps: Deps, req: FastifyRequest, accountId: string, pendingId: string | undefined): Promise<boolean> {
  const device = deviceHash(req);
  if (pendingId === undefined || !UUID.test(pendingId) || device === null) return false;
  const { rows } = await deps.db.query(
    `select 1 from challenges
      where id = $1 and account_id = $2 and device_hash = $3 and purpose = 'second-factor' and method = 'pair'
        and used_at is null and expires_at > $4 and payload->'first'->>'method' = 'pgp'`,
    [pendingId, accountId, device, deps.clock()],
  );
  return rows.length > 0;
}

interface LoginRouteOptions {
  kinds: AccountKind[];
  afterAuthenticate?: (accountId: string) => Promise<void>;
}

function loginRoutes(app: FastifyInstance, opts: LoginRouteOptions & { discoverable: boolean }): void {
  app.post('/start', async (req: FastifyRequest, reply: FastifyReply) => {
    const deps = req.server.deps;
    ensureDeviceCookie(req, reply);
    req.server.budgets.start.take();
    const body = record(req.body);

    if (body.loginName === undefined && opts.discoverable) {
      // Discoverable passkey login (traders): no name, the authenticator picks the credential.
      const options = await generateAuthenticationOptions({
        rpID: deps.config.rpId, allowCredentials: [], userVerification: 'required', timeout: WEBAUTHN_TTL_MS,
      });
      const challengeId = await storeChallenge(deps, req, {
        accountId: null, sessionId: null, purpose: 'login', method: 'passkey', challenge: options.challenge, payload: { mode: 'discoverable' },
      });
      return { challengeId, options };
    }

    // The private login name (owner, 2026-10-23), never the public display name.
    const loginName = str(body, 'loginName');
    const pendingId = optStr(body, 'pendingId');
    const name = loginNameLookup(deps.config, loginName);
    // The same queries for a real account, an unknown name and a malformed one (review M3): an
    // account lookup ('' matches no login key) and a credentials lookup (NIL_UUID matches none).
    const { rows } = await deps.db.query<{ id: string; kind: AccountKind }>('select id, kind from accounts where login_key = $1', [
      name.key ?? '',
    ]);
    const found = rows[0] && opts.kinds.includes(rows[0].kind) ? rows[0] : null;
    // The pending-step lookup runs whenever a pendingId is given, whatever the account, so the
    // query count does not reveal a staff login name (second review).
    const afterPgp = pendingId !== undefined && (await pendingAfterPgp(deps, req, found?.id ?? NIL_UUID, pendingId));
    const withPasskeys = afterPgp && found?.kind === 'staff';
    let creds = (await credentialsOf(deps.db, found?.id ?? NIL_UUID)).filter(
      (c) => found !== null && (c.kind === 'security-key' || (withPasskeys && c.kind === 'passkey')) && allowed(found.kind, c),
    );
    let account: { id: string; kind: AccountKind } | null = null;
    // Passkeys are in `creds` only after a staff member's PGP first factor (they may then be the only
    // credential listed: PGP + passkey is a staff pair).
    if (found !== null && creds.length > 0) account = found;
    else creds = [];
    // Always exactly MAX_SECURITY_KEYS entries (review I2): real IDs padded with decoys whose lengths
    // follow the stored keys, ordered by their bytes so real and decoy entries interleave. Only a
    // staff second step after a PGP first factor (passkeys listed too) can exceed that, and it
    // already named the account.
    const lengths = await securityKeyIdLengths(deps.db);
    const decoys = decoyCredentialIds(deps, name.tag, Math.max(0, MAX_SECURITY_KEYS - creds.length), lengths);
    creds = [...creds, ...decoys.map((id) => ({ credential_id: id, kind: 'security-key' as const, attested: false }))].sort((x, y) =>
      Buffer.compare(x.credential_id, y.credential_id),
    );
    const options = await buildAssertionOptions(deps, creds);
    const challengeId = await storeChallenge(deps, req, {
      accountId: account?.id ?? null, sessionId: null, purpose: 'login', method: 'security-key', challenge: options.challenge,
      // The pendingId this start was given (any, even one that matched nothing): `finish` uses it and
      // refuses a different one, so a second step is bound to the pending login it was started for.
      payload: { mode: 'login-name', listed: creds.map((c) => b64url(c.credential_id)), ...(pendingId !== undefined ? { pendingId } : {}) },
    });
    return { challengeId, options };
  });

  app.post('/finish', async (req: FastifyRequest, reply: FastifyReply): Promise<LoginResult> => {
    const deps = req.server.deps;
    ensureDeviceCookie(req, reply);
    const body = record(req.body);
    await takeStartBudgetUnlessOpen(req, body.challengeId, { purpose: 'login', methods: ['passkey', 'security-key'] });
    const challengeId = str(body, 'challengeId');
    const deviceLabel = str(body, 'deviceLabel');
    const pendingId = optStr(body, 'pendingId');
    const ch = await consumeChallenge(deps.db, challengeId, deps.clock());
    if (!ch || ch.purpose !== 'login' || (ch.method !== 'passkey' && ch.method !== 'security-key') || ch.webauthn_challenge === null) {
      throw expired();
    }
    // The second step of a staff or owner login is bound to the pendingId its start was given.
    const boundPending = typeof ch.payload.pendingId === 'string' ? ch.payload.pendingId : undefined;
    if (pendingId !== undefined && pendingId !== boundPending) throw expired();
    let row: CredentialRow;
    if (ch.payload.mode === 'discoverable') {
      if (!opts.discoverable) throw expired();
      row = await verifyAssertion(deps, { accountId: null, response: body.response, expectedChallenge: ch.webauthn_challenge });
      const handle = (body.response as { response?: { userHandle?: unknown } }).response?.userHandle;
      if (row.kind !== 'passkey' || handle !== b64url(row.webauthn_user_id)) throw failed();
      if (row.account_kind !== 'trader' || !opts.kinds.includes(row.account_kind)) throw failed();
    } else {
      // A decoy challenge has no account: nothing can match it.
      if (ch.account_id === null) throw failed();
      row = await verifyAssertion(deps, { accountId: ch.account_id, response: body.response, expectedChallenge: ch.webauthn_challenge });
      if (!opts.kinds.includes(row.account_kind)) throw failed();
    }
    assertCredentialAllowed(row.account_kind, { kind: row.kind, attested: row.attested });
    if (ch.payload.mode !== 'discoverable') assertListed(ch, row);
    return completeLogin(deps, req, reply, {
      account: { id: row.account_id, kind: row.account_kind },
      factor: { method: row.kind, credentialId: b64url(row.credential_id), attested: row.attested },
      ...(boundPending !== undefined ? { pendingId: boundPending } : {}),
      deviceLabel,
      ...(opts.afterAuthenticate ? { afterAuthenticate: opts.afterAuthenticate } : {}),
    });
  });
}

/**
 * The login-name-based WebAuthn login (`POST <prefix>/start { loginName, pendingId? }` and
 * `POST <prefix>/finish { challengeId, response, deviceLabel, pendingId? }`), registered as a
 * fastify plugin. An account whose kind is not in `kinds` gets decoy options; `afterAuthenticate`
 * runs in `completeLogin` after the credential check passes. Plan 4 mounts it on the staff app.
 */
export async function securityKeyLoginRoutes(app: FastifyInstance, opts: LoginRouteOptions): Promise<void> {
  loginRoutes(app, { kinds: opts.kinds, ...(opts.afterAuthenticate ? { afterAuthenticate: opts.afterAuthenticate } : {}), discoverable: false });
}

/** `buildApi`'s mount at `/v1/login/webauthn`: the login-name-based routes plus discoverable passkey login (`start {}`). */
export async function webauthnLoginRoutes(app: FastifyInstance, opts: LoginRouteOptions): Promise<void> {
  loginRoutes(app, { kinds: opts.kinds, ...(opts.afterAuthenticate ? { afterAuthenticate: opts.afterAuthenticate } : {}), discoverable: true });
}

// ---------------------------------------------------------------------------------------------
// Sign-up, confirm and add-key routes

/**
 * The credential must be one the challenge offered (`payload.listed`, review M2): a staff passkey
 * cannot answer a security-key-only challenge. Checked after `assertCredentialAllowed`, so a kind
 * the account may never use still reads `method-not-allowed`.
 */
function assertListed(ch: ChallengeRow, row: CredentialRow): void {
  const listed = ch.payload.listed;
  if (!Array.isArray(listed) || !listed.includes(b64url(row.credential_id))) throw failed();
}

function sameSession(ch: ChallengeRow, req: FastifyRequest, purpose: string): boolean {
  return ch.purpose === purpose && ch.account_id === req.auth.accountId && ch.session_id === req.auth.sessionId && ch.webauthn_challenge !== null;
}

async function registerStart(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.start.take();
  const body = record(req.body);
  const names = await assertNewNames(deps.db, body.displayName, body.loginName);
  const kind = credentialKind(body.kind);
  await assertDisplayNameFree(deps.db, names);
  // The account does not exist yet: its WebAuthn user handle is chosen now and kept with the challenge.
  const userID = randomBytes(32);
  const options = await buildRegistrationOptions(deps, { kind, accountKind: 'trader', userID, userName: names.displayName, exclude: [] });
  const challengeId = await storeChallenge(deps, req, {
    accountId: null, sessionId: null, purpose: 'register', method: kind, challenge: options.challenge,
    payload: { names, userId: b64url(userID) },
  });
  return { challengeId, options };
}

async function registerFinish(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  ensureDeviceCookie(req, reply);
  req.server.budgets.register.take();
  const body = record(req.body);
  const terms = assertTermsAccepted(deps, body.acceptedTerms);
  const challengeId = str(body, 'challengeId');
  const deviceLabel = str(body, 'deviceLabel');
  const label = optStr(body, 'label');
  const ch = await consumeChallenge(deps.db, challengeId, deps.clock());
  if (!ch || ch.purpose !== 'register' || ch.account_id !== null || ch.webauthn_challenge === null) throw expired();
  const kind = credentialKind(ch.method);
  const { names, userId } = ch.payload as { names: NewNames; userId: string };
  const cred = await verifyRegistration(deps, { accountKind: 'trader', kind, response: body.response, expectedChallenge: ch.webauthn_challenge });

  const now = deps.clock();
  const client = await deps.db.connect();
  let accountId: string;
  try {
    await client.query('begin');
    try {
      accountId = await createAccount(client, { ...names, kind: 'trader', termsVersion: terms, now });
      await client.query('update accounts set webauthn_user_id = $2 where id = $1', [accountId, Buffer.from(userId, 'base64url')]);
      await insertCredential(client, accountId, cred, cleanLabel(label, kind), now);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  await startSession(deps, req, reply, { accountId, level: 'full', deviceLabel, method: kind, firstSession: true });
  return reply.code(201).send({ displayName: names.displayName });
}

async function confirmStart(req: FastifyRequest) {
  const deps = req.server.deps;
  const body = record(req.body);
  const action = parseConfirmAction(body.action);
  const creds = (await credentialsOf(deps.db, req.auth.accountId)).filter((c) => allowed(req.auth.kind, c));
  if (creds.length === 0) throw new ApiError(403, 'method-not-allowed');
  const options = await buildAssertionOptions(deps, creds);
  const challengeId = await storeChallenge(deps, req, {
    accountId: req.auth.accountId, sessionId: req.auth.sessionId, purpose: 'confirm', method: 'webauthn', challenge: options.challenge,
    payload: { action, actionHash: await actionHash(action), listed: creds.map((c) => b64url(c.credential_id)) },
  });
  return { challengeId, options };
}

async function confirmFinish(req: FastifyRequest) {
  const deps = req.server.deps;
  const body = record(req.body);
  const ch = await consumeChallenge(deps.db, str(body, 'challengeId'), deps.clock());
  if (!ch || ch.method !== 'webauthn' || !sameSession(ch, req, 'confirm')) throw expired();
  const row = await verifyAssertion(deps, { accountId: req.auth.accountId, response: body.response, expectedChallenge: ch.webauthn_challenge! });
  assertCredentialAllowed(row.account_kind, { kind: row.kind, attested: row.attested });
  assertListed(ch, row);
  const action: ConfirmAction = parseConfirmAction(ch.payload.action);
  if ((await actionHash(action)) !== ch.payload.actionHash) throw expired();
  // The method is the kind of the stored credential that just verified, never anything the client sent.
  const confirmToken = await issueConfirmToken(deps, {
    sessionId: req.auth.sessionId, accountId: req.auth.accountId, action, method: row.kind,
  });
  return { confirmToken };
}

/**
 * The add-method action of `/v1/account/webauthn/start`; a kind the account may not hold (an owner
 * passkey) is refused by `assertMethodAllowed` before any token is spent.
 */
function addKeyAction(req: FastifyRequest): ConfirmAction {
  const kind = credentialKind(record(req.body).kind);
  assertMethodAllowed(req.auth.kind, kind);
  return { kind: 'add-method', method: kind };
}

async function addKeyStart(req: FastifyRequest) {
  const deps = req.server.deps;
  const kind = credentialKind(record(req.body).kind);
  const account = await accountById(deps.db, req.auth.accountId);
  if (kind === 'security-key') await assertSecurityKeyRoom(deps.db, account.id);
  const exclude = (await credentialsOf(deps.db, account.id)).map((c) => c.credential_id);
  const options = await buildRegistrationOptions(deps, {
    kind, accountKind: account.kind, userID: account.webauthn_user_id, userName: account.display_name, exclude,
  });
  const challengeId = await storeChallenge(deps, req, {
    accountId: account.id, sessionId: req.auth.sessionId, purpose: 'add-key', method: kind, challenge: options.challenge, payload: {},
  });
  return { challengeId, options };
}

async function addKeyFinish(req: FastifyRequest, reply: FastifyReply) {
  const deps = req.server.deps;
  const body = record(req.body);
  const label = optStr(body, 'label');
  const ch = await consumeChallenge(deps.db, str(body, 'challengeId'), deps.clock());
  if (!ch || !sameSession(ch, req, 'add-key')) throw expired();
  const kind = credentialKind(ch.method);
  assertMethodAllowed(req.auth.kind, kind);
  const cred = await verifyRegistration(deps, { accountKind: req.auth.kind, kind, response: body.response, expectedChallenge: ch.webauthn_challenge! });
  const now = deps.clock();
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    try {
      // The account row is locked so two parallel finishes cannot both pass the security-key count.
      await client.query('select 1 from accounts where id = $1 for update', [req.auth.accountId]);
      await insertCredential(client, req.auth.accountId, cred, cleanLabel(label, kind), now);
      await addAlert(client, req.auth.accountId, 'login-method-added', { method: kind }, now);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  return reply.code(201).send({ ok: true });
}

/**
 * Passkey and security-key sign-up (`/v1/register/webauthn/start|finish`, traders), confirm
 * (`/v1/confirm/webauthn/start|finish`, full session, token bound to the session and the action)
 * and adding a credential (`/v1/account/webauthn/start|finish`, behind `requireConfirm` with the
 * onboarding and recovery exemptions). Both add routes leave out `allowHeld`, so `requireSession`
 * refuses a recovery session still inside its 24-hour hold (403 `recovery-hold`).
 */
export function webauthnRoutes(app: FastifyInstance): void {
  app.post('/v1/register/webauthn/start', registerStart);
  app.post('/v1/register/webauthn/finish', registerFinish);
  app.post('/v1/confirm/webauthn/start', { preHandler: requireSession() }, confirmStart);
  app.post('/v1/confirm/webauthn/finish', { preHandler: requireSession() }, confirmFinish);
  app.post(
    '/v1/account/webauthn/start',
    {
      preHandler: [
        requireSession({ allowRecovery: true }),
        requireConfirm(addKeyAction, { onboarding: true, recovery: true }),
      ],
    },
    addKeyStart,
  );
  app.post('/v1/account/webauthn/finish', { preHandler: requireSession({ allowRecovery: true }) }, addKeyFinish);
}
