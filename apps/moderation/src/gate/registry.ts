import { createHash } from 'node:crypto';
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';
import { canonicalJson, inviteRegistrationChallenge, involvedIn, type KeyTapIntent } from '@x2f/staff';
import type pg from 'pg';
import type { GateState, InvitableRole, PinnedCred } from './store.js';
import { verifyTap, type GateContext, type GateRuling, type StoredTap } from './verify.js';

/**
 * Plan 4 Task 13: the chain of trust. Everything here is read from the API's database through the
 * read-only role (`x2f_mod_reader`, migrations 208 and 211), and none of it is believed as read:
 * - **a new staff member** only with an owner `create-invite` tap (verified against the pinned
 *   owner keys) whose token hash is the invite's, and a key registration made through that invite
 *   whose challenge is `inviteRegistrationChallenge(tokenHash)` and that verifies with a packed
 *   attestation certificate chain from an allowlisted AAGUID; the role is the tap's;
 * - **role changes and switch-on** only with owner taps (`set-role`, `switch-on`) the gate has not
 *   used before, applied in the order the gate first sees them (an earlier tap never undoes a later one);
 * - **revocation** (switch-off, removal) as the API shows it, without a signature: it only takes
 *   power away. A switched-off person stays revoked until a new owner `switch-on` tap; a removed one for good;
 * - **settings** (the large-trade limit, the appeal window) only from owner `settings` taps;
 * - **a new owner key** only with `add-owner-key` taps by two different pinned owner keys, for a
 *   credential whose public key hashes to the tapped `publicKeySha256`.
 * Anything else is ignored and logged as `gate.refused` (a reason only).
 */

/** What the gate reads from the API's database (`pgGateSource`); every value is the API's word. */
export interface GateSource {
  /** The owner account and its attested security keys (`pin-owner` only). */
  ownerKeys(): Promise<{ accountId: string; keys: Array<{ credentialId: string; publicKey: Uint8Array; aaguid: string | null }> } | null>;
  /** Finished and used taps whose intent is one of `kinds`, oldest first. */
  usedTaps(kinds: readonly KeyTapIntent['kind'][]): Promise<StoredTap[]>;
  /** A credential by its base64url id. */
  credential(credentialId: string): Promise<{ accountId: string; publicKey: Uint8Array; aaguid: string | null } | null>;
  /** An invite with its account and the key registrations made through it. */
  invite(inviteId: string): Promise<{
    inviteId: string;
    tokenHash: string;
    accountId: string | null;
    used?: boolean;
    registrations: Array<{ credentialId: string; response: unknown }>;
  } | null>;
  /** Every staff row: the role and whether switched off or removed. */
  staff(): Promise<Array<{ accountId: string; role: string; switchedOff: boolean; removed: boolean }>>;
  /** The used taps of one ruling. */
  rulingTaps(rulingId: string): Promise<StoredTap[]>;
}

const REGISTRY_KINDS = ['create-invite', 'set-role', 'switch-on', 'settings', 'add-owner-key'] as const satisfies readonly KeyTapIntent['kind'][];
const INVITABLE: readonly string[] = ['senior', 'mod', 'helper'];
const ALGORITHMS = [-8, -7, -257];

const refused = (ctx: GateContext, what: string): void => ctx.log({ reason: `gate.refused.${what}` });

/** A key registration made through an invite, verified here with its attestation, or null. */
async function verifiedRegistration(response: unknown, tokenHash: string, ctx: GateContext): Promise<PinnedCred | null> {
  try {
    const v = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: Buffer.from(inviteRegistrationChallenge(tokenHash)).toString('base64url'),
      expectedOrigin: ctx.rp.origins,
      expectedRPID: ctx.rp.rpId,
      expectedType: 'webauthn.create',
      requireUserPresence: true,
      requireUserVerification: false,
      supportedAlgorithmIDs: ALGORITHMS,
    });
    const info = v.registrationInfo;
    if (!v.verified || !info || info.fmt !== 'packed') return null;
    // Self attestation proves nothing about the device: a certificate chain is required.
    const x5c = decodeAttestationObject(info.attestationObject).get('attStmt').get('x5c');
    if (!Array.isArray(x5c) || x5c.length === 0) return null;
    if (!ctx.attestation.isAllowed(info.aaguid, 'staff')) return null;
    return { credentialId: info.credential.id, publicKey: Buffer.from(info.credential.publicKey).toString('base64url'), aaguid: info.aaguid };
  } catch {
    return null;
  }
}

const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/**
 * Pulls new staff, role changes, revocations, settings and owner keys into `g` (the caller saves
 * it). Does nothing before the owner is pinned.
 */
export async function syncRegistry(source: GateSource, g: GateState, ctx: GateContext): Promise<void> {
  if (g.ownerAccountId === null || g.ownerCreds.length < 2) {
    ctx.log({ reason: 'gate.unpinned' });
    return;
  }
  const taps = await source.usedTaps(REGISTRY_KINDS);
  // Owner taps only, each verified against the pinned keys.
  const owner: Array<{ tap: StoredTap; intent: KeyTapIntent; credentialId: string }> = [];
  for (const tap of taps) {
    if (tap.accountId !== g.ownerAccountId) {
      refused(ctx, 'not-owner');
      continue;
    }
    const c = await verifyTap(g, tap, ctx);
    if (!c.ok) {
      refused(ctx, c.reason);
      continue;
    }
    owner.push({ tap, intent: c.intent, credentialId: c.credentialId });
  }
  const fresh = (t: StoredTap): boolean => !Object.hasOwn(g.usedNonces, t.nonceHex);
  const spend = (t: StoredTap, what: string): void => {
    g.usedNonces[t.nonceHex] = what;
  };

  // 1. Invites, every sync until the gate has seen the invite finished (a key is registered after
  //    the owner's tap was used to create the invite).
  for (const { tap, intent } of owner) {
    if (intent.kind !== 'create-invite') continue;
    const tapped = g.usedNonces[tap.nonceHex];
    if (tapped !== undefined && tapped !== `invite:${intent.inviteId}`) continue;
    const inv = await source.invite(intent.inviteId);
    if (!inv || inv.tokenHash !== intent.tokenHash || inv.accountId === null) continue;
    spend(tap, `invite:${intent.inviteId}`);
    const accountId = inv.accountId;
    if (accountId === g.ownerAccountId) continue;
    const have = Object.hasOwn(g.staff, accountId) ? g.staff[accountId] : undefined;
    if (have !== undefined && (have.inviteId !== intent.inviteId || have.inviteClosed)) continue;
    const creds: PinnedCred[] = [...(have?.creds ?? [])];
    for (const reg of inv.registrations) {
      const cred = await verifiedRegistration(reg.response, intent.tokenHash, ctx);
      if (cred === null) {
        refused(ctx, 'registration');
        continue;
      }
      if (!creds.some((c) => c.credentialId === cred.credentialId)) creds.push(cred);
    }
    if (have === undefined && creds.length === 0) continue;
    g.staff[accountId] = have
      ? { ...have, creds, inviteClosed: inv.used === true }
      : { role: intent.role, creds, revoked: false, removed: false, joined: false, inviteId: intent.inviteId, inviteClosed: inv.used === true };
  }

  // 2. Role changes, switch-on and settings, in the order first seen; each tap counts once.
  const rows = new Map((await source.staff()).map((s) => [s.accountId, s]));
  for (const { tap, intent } of owner) {
    if (!fresh(tap)) continue;
    if (intent.kind === 'settings') {
      const usd = intent.largeTradeLimitUsd;
      const h = intent.appealWindowH;
      spend(tap, 'settings');
      if (!Number.isFinite(usd) || usd < 1 || usd > 1_000_000 || !Number.isInteger(h) || h < 1) {
        refused(ctx, 'settings');
        continue;
      }
      g.limitUsdCents = BigInt(Math.round(usd * 100));
      g.appealWindowH = h;
      continue;
    }
    if (intent.kind !== 'set-role' && intent.kind !== 'switch-on') continue;
    const s = Object.hasOwn(g.staff, intent.accountId) ? g.staff[intent.accountId] : undefined;
    if (s === undefined) continue; // not (yet) someone the gate knows: keep the tap for later
    spend(tap, intent.kind);
    if (s.removed || !INVITABLE.includes(intent.role)) continue;
    const row = rows.get(intent.accountId);
    s.role = intent.role as InvitableRole;
    if (intent.kind === 'switch-on' && row !== undefined && !row.switchedOff && !row.removed) s.revoked = false;
  }

  // 3. Revocation, no signature needed: whatever the API shows as switched off or removed, or no
  //    longer shows at all once they had joined. Before their staff row exists (the invite not yet
  //    finished) they are not joined and sign nothing, which revokes nothing.
  for (const [accountId, s] of Object.entries(g.staff)) {
    const row = rows.get(accountId);
    if (row === undefined) {
      if (s.joined) s.revoked = true;
      continue;
    }
    s.joined = true;
    if (row.switchedOff || row.removed) s.revoked = true;
    if (row.removed) s.removed = true;
  }

  // 4. New owner keys: two taps by two different pinned owner keys for the same key.
  const byKey = new Map<string, Array<{ tap: StoredTap; credentialId: string }>>();
  for (const { tap, intent, credentialId } of owner) {
    if (intent.kind !== 'add-owner-key' || !fresh(tap)) continue;
    const k = canonicalJson(intent);
    byKey.set(k, [...(byKey.get(k) ?? []), { tap, credentialId }]);
  }
  for (const [k, list] of byKey) {
    const keys = new Set(list.map((l) => l.credentialId));
    if (keys.size < 2) continue;
    for (const l of list) spend(l.tap, 'add-owner-key');
    const intent = JSON.parse(k) as Extract<KeyTapIntent, { kind: 'add-owner-key' }>;
    if (g.ownerCreds.some((c) => c.credentialId === intent.credentialId)) continue;
    const row = await source.credential(intent.credentialId);
    if (!row || row.accountId !== g.ownerAccountId || sha256Hex(row.publicKey) !== intent.publicKeySha256) {
      refused(ctx, 'owner-key');
      continue;
    }
    g.ownerCreds.push({ credentialId: intent.credentialId, publicKey: Buffer.from(row.publicKey).toString('base64url'), aaguid: row.aaguid });
  }
}

// ---------------------------------------------------------------------------------------------
// The API's database, through x2f_mod_reader

interface TapRow {
  id: string;
  account_id: string;
  credential_id: string;
  intent: string;
  nonce: Buffer;
  response: StoredTap['response'];
}

const TAP_COLUMNS = 'id, account_id, credential_id, intent, nonce, response';
const tapOf = (r: TapRow): StoredTap => ({
  id: r.id,
  accountId: r.account_id,
  credentialId: r.credential_id,
  intent: r.intent,
  nonceHex: r.nonce.toString('hex'),
  response: r.response,
});

/** What the executor (Task 14) gives `gateCheck`: the stored ruling(s) of a trade's current dispute. */
export interface StoredRulings {
  /** The current round's ruling, once published; null before. */
  current: GateRuling | null;
  /** Round 1 once there is an appeal (the machine keeps it whole in `round1`): round 1 pays from it. */
  round1: GateRuling | null;
  /** R37: staff with an activity-log entry on the trade before its appeal (empty without one). */
  involved: string[];
}

export interface PgGateSource extends GateSource {
  storedRulings(code: string): Promise<StoredRulings>;
}

/** The gate's source on the API database, through the read-only role (`MOD_API_READER_DATABASE_URL`). */
export function pgGateSource(db: Pick<pg.Pool, 'query'>): PgGateSource {
  return {
    async ownerKeys() {
      const { rows: a } = await db.query<{ id: string }>(`select id from accounts where kind = 'owner'`);
      const id = a[0]?.id;
      if (id === undefined) return null;
      const { rows } = await db.query<{ credential_id: Buffer; public_key: Buffer; aaguid: string | null }>(
        `select credential_id, public_key, aaguid from webauthn_credentials
          where account_id = $1 and kind = 'security-key' and attested order by credential_id`,
        [id],
      );
      return {
        accountId: id,
        keys: rows.map((r) => ({ credentialId: r.credential_id.toString('base64url'), publicKey: new Uint8Array(r.public_key), aaguid: r.aaguid })),
      };
    },
    async usedTaps(kinds) {
      const { rows } = await db.query<TapRow>(
        `select ${TAP_COLUMNS} from key_taps
          where used_at is not null and finished_at is not null and (intent::jsonb ->> 'kind') = any($1::text[])
          order by finished_at, id`,
        [kinds],
      );
      return rows.map(tapOf);
    },
    async rulingTaps(rulingId) {
      const { rows } = await db.query<TapRow>(
        `select ${TAP_COLUMNS} from key_taps
          where used_at is not null and finished_at is not null
            and (intent::jsonb ->> 'kind') = 'ruling' and (intent::jsonb ->> 'rulingId') = $1
          order by finished_at, id`,
        [rulingId],
      );
      return rows.map(tapOf);
    },
    async credential(credentialId) {
      const { rows } = await db.query<{ account_id: string; public_key: Buffer; aaguid: string | null }>(
        'select account_id, public_key, aaguid from webauthn_credentials where credential_id = $1',
        [Buffer.from(credentialId, 'base64url')],
      );
      const r = rows[0];
      return r ? { accountId: r.account_id, publicKey: new Uint8Array(r.public_key), aaguid: r.aaguid } : null;
    },
    async invite(inviteId) {
      const { rows } = await db.query<{ id: string; token_hash: string; account_id: string | null; used: boolean }>(
        'select id, token_hash, account_id, used_at is not null as used from staff_invites where id = $1',
        [inviteId],
      );
      const i = rows[0];
      if (!i) return null;
      const { rows: regs } = await db.query<{ credential_id: Buffer; response: unknown }>(
        'select credential_id, response from staff_key_registrations where invite_id = $1 order by credential_id',
        [inviteId],
      );
      return {
        inviteId: i.id,
        tokenHash: i.token_hash,
        accountId: i.account_id,
        used: i.used,
        registrations: regs.map((r) => ({ credentialId: r.credential_id.toString('base64url'), response: r.response })),
      };
    },
    async staff() {
      const { rows } = await db.query<{ account_id: string; role: string; off: boolean; removed: boolean }>(
        'select account_id, role, switched_off_at is not null as off, removed_at is not null as removed from staff_members',
      );
      return rows.map((r) => ({ accountId: r.account_id, role: r.role, switchedOff: r.off, removed: r.removed }));
    },
    async storedRulings(code) {
      type Draft = { id: string; outcome: GateRuling['outcome']; accountAction: GateRuling['accountAction']; proposer: string; approver: string | null };
      const { rows } = await db.query<{ seq: number; round: 1 | 2; ruling: Draft | null; round1: Draft | null }>(
        'select seq, round, ruling, round1 from disputes where code = $1 order by seq desc limit 1',
        [code],
      );
      const d = rows[0];
      if (!d) return { current: null, round1: null, involved: [] };
      const { rows: pub } = await db.query<{ round: 1 | 2; h: string }>(
        `select round, encode(sha256(convert_to(reason, 'UTF8')), 'hex') as h from dispute_rulings where code = $1 and seq = $2`,
        [code, d.seq],
      );
      const hashOf = (round: 1 | 2): string | undefined => pub.find((p) => p.round === round)?.h;
      const of = (r: Draft, round: 1 | 2, round1Id?: string): GateRuling | null => {
        const h = hashOf(round);
        if (h === undefined) return null;
        return { id: r.id, code, round, outcome: r.outcome, accountAction: r.accountAction, proposer: r.proposer, approver: r.approver, reasonSha256: h, ...(round1Id ? { round1Id } : {}) };
      };
      const round1 = d.round1 ? of(d.round1, 1) : null;
      const current = d.ruling ? of(d.ruling, d.round, d.round === 2 ? d.round1?.id : undefined) : null;
      let involved: string[] = [];
      if (d.round === 2) {
        const { rows: log } = await db.query<{ id: string; trade_code: string | null; actor_kind: 'staff' | 'trader' | 'system'; actor_id: string | null; action: string }>(
          'select id::text as id, trade_code, actor_kind, actor_id, action from activity_log where trade_code = $1 order by id',
          [code],
        );
        const appeal = [...log].reverse().find((e) => e.action === 'appeal.opened');
        if (appeal) {
          involved = [...involvedIn(log.map((e) => ({ id: e.id, tradeCode: e.trade_code, actorKind: e.actor_kind, actorId: e.actor_id, action: e.action })), code, { beforeId: appeal.id })];
        }
      }
      return { current, round1, involved };
    },
  };
}
