import { createHash } from 'node:crypto';
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';
import { canonicalJson, evidenceSha256, inviteRegistrationChallenge, involvedIn, limitUsdCentsOf, type KeyTapIntent } from '@x2f/staff';
import type pg from 'pg';
import { ADD_OWNER_KEY_PAIR_MS, LINK_MAX_LIFETIME_MS, MAX_TAP_AGE_MS, SWITCH_ON_SKEW_MS, type GateState, type InvitableRole, type PinnedCred } from './store.js';
import { credOf, noteCounter, verifyTap, type GateContext, type GateRuling, type StoredTap } from './verify.js';
import { revokeDevicesOf, syncDevices } from './devices.js';

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
 * - **the owner's tapped `reset-staff-security`** (D-032, lead call) drops the person's keys and
 *   binds the reset link; keys come back only as registrations made through that link, verified as
 *   an invite's, while it is open. A reset the owner did not tap changes nothing in the gate;
 * - **the owner's tapped `remove-staff`** removes for good, and **`emergency-stop`** stops every
 *   ruling until a newer tapped `resume-trading` (review I1);
 * - registry taps carry a signed `issuedAt` (the API's start time; a tap without one has no valid
 *   challenge) and apply in order (review M1, lead call on P4): per subject not issued before the
 *   last one applied, by either owner key, and per key above its signature-counter high-water mark;
 *   a switch-on counts only when issued after the switch-off this gate first saw, less 2 minutes.
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

const REGISTRY_KINDS = [
  'create-invite', 'set-role', 'switch-on', 'settings', 'add-owner-key', 'remove-staff', 'emergency-stop', 'resume-trading',
  'reset-staff-security',
] as const satisfies readonly KeyTapIntent['kind'][];
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
      requireUserVerification: true,
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
 * NEEDS_OWNER_STAFF_KEY_TAP (review B1, an owner question): whether a staff key the gate verified
 * through an invite is trusted. Today: yes, while the invite is open (bound, unexpired, the person
 * not yet joined). If the owner chooses to confirm each staff key with a tap (`add-staff-key`
 * `{accountId, credentialId, publicKeySha256}` after comparing the key check code, as
 * `add-owner-key`), this is where the gate requires that verified owner tap.
 */
function staffKeyAccepted(_g: GateState, _accountId: string, _cred: PinnedCred): boolean {
  return true;
}

/**
 * Pulls new staff, role changes, revocations, settings, the owner's stop and owner keys into `g`
 * (the caller saves it). Does nothing before the owner is pinned.
 */
export async function syncRegistry(source: GateSource, g: GateState, ctx: GateContext): Promise<void> {
  if (g.ownerAccountId === null || g.ownerCreds.length < 2) {
    ctx.log({ reason: 'gate.unpinned' });
    return;
  }
  const now = ctx.now().getTime();
  // Review N8: every key's signature-counter mark as it stood before this sync, and the counters this
  // sync's registry steps take, so the device step (5) judges its taps in counter order together
  // with the registry taps of the same key, not after a mark step 2 already raised.
  const marksBefore = new Map<string, number>();
  for (const c of g.ownerCreds) marksBefore.set(`${g.ownerAccountId}\0${c.credentialId}`, c.counter ?? 0);
  for (const [id, s] of Object.entries(g.staff)) for (const c of s.creds) marksBefore.set(`${id}\0${c.credentialId}`, c.counter ?? 0);
  const takenThisSync = new Map<string, Set<number>>();
  const note = (credentialId: string, counter: number): void => {
    noteCounter(g, ownerId, credentialId, counter);
    const k = `${ownerId}\0${credentialId}`;
    takenThisSync.set(k, (takenThisSync.get(k) ?? new Set()).add(counter));
  };
  const taps = await source.usedTaps(REGISTRY_KINDS);
  // Owner taps only, each verified against the pinned keys.
  const owner: Array<{ tap: StoredTap; intent: KeyTapIntent; credentialId: string; counter: number }> = [];
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
    owner.push({ tap, intent: c.intent, credentialId: c.credentialId, counter: c.counter });
  }
  const fresh = (t: StoredTap): boolean => !Object.hasOwn(g.usedNonces, t.nonceHex);
  const spend = (t: StoredTap, what: string): void => {
    g.usedNonces[t.nonceHex] = what;
  };
  const ownerId = g.ownerAccountId;
  const issuedOf = (t: { intent: KeyTapIntent }): number => Date.parse((t.intent as { issuedAt?: string }).issuedAt ?? '');
  /**
   * Review D-2: when an invite or reset link closes by the gate's clock: its signed expiresAt, but
   * never later than LINK_MAX_LIFETIME_MS after its signed issuedAt (NaN, so closed, without either).
   */
  const linkClosesAt = (t: { intent: KeyTapIntent & { expiresAt: string } }): number =>
    Math.min(Date.parse(t.intent.expiresAt), issuedOf(t) + LINK_MAX_LIFETIME_MS);

  // 0. Every fresh owner tap is checked once, before any step acts (re-verify N1-N4, N7):
  //    - its signed issuedAt is not after the gate's clock plus the skew (a far-future stamp would
  //      pin its subject for good), nor more than MAX_TAP_AGE_MS before it (a stale tap first shown
  //      a day late is not applied);
  //    - its key's signature counter is above the key's high-water mark, judged in (key, counter)
  //      order across the whole batch, so a step that runs first can never make a later step's
  //      older-but-legitimate tap look out of order.
  //    A tap that fails is spent and logged, and counts for nothing.
  //    A create-invite tap that passes is spent at once as `invite:<id>` (its key's mark rises
  //    now), so step 1 can keep re-reading the invite until the invitee has registered.
  const pending = new Set<StoredTap>();
  const byCred = new Map<string, typeof owner>();
  for (const t of owner) if (fresh(t.tap)) byCred.set(t.credentialId, [...(byCred.get(t.credentialId) ?? []), t]);
  for (const [credentialId, list] of byCred) {
    list.sort((a, b) => a.counter - b.counter);
    let hw = credOf(g, ownerId, credentialId)?.counter ?? 0;
    for (const t of list) {
      const issued = issuedOf(t);
      let why: string | null = null;
      if (!Number.isFinite(issued)) why = 'no-issued-at';
      else if (issued > now + SWITCH_ON_SKEW_MS) why = 'issued-in-future';
      else if (now - issued > MAX_TAP_AGE_MS) why = 'issued-too-long-ago';
      else if (hw > 0 && t.counter <= hw) why = 'out-of-order';
      else if ((t.intent.kind === 'create-invite' || t.intent.kind === 'reset-staff-security') && !(Date.parse(t.intent.expiresAt) - issued <= LINK_MAX_LIFETIME_MS)) {
        // Review D-2: a link signed to stay open longer than the API itself allows.
        why = 'link-too-long';
      }
      if (why !== null) {
        spend(t.tap, why);
        refused(ctx, why);
        continue;
      }
      hw = Math.max(hw, t.counter);
      pending.add(t.tap);
      if (t.intent.kind === 'create-invite') {
        spend(t.tap, `invite:${t.intent.inviteId}`);
        note(credentialId, t.counter);
      } else if (t.intent.kind === 'reset-staff-security') {
        // As an invite: spent at once as this link's, re-read each sync while the link is open.
        spend(t.tap, `reset:${t.intent.inviteId}`);
        note(credentialId, t.counter);
      }
    }
  }
  const ready = (t: { tap: StoredTap }): boolean => pending.has(t.tap);
  /**
   * Review M1: a fresh owner tap counts only when it is newer than every tap the gate has accepted
   * from that key (its signature counter), and newer than the last one applied to its subject by
   * the same key. An older tap held back and released late is spent and ignored.
   */
  const inOrder = (t: { tap: StoredTap; intent: KeyTapIntent; credentialId: string; counter: number }, subject: string | null): boolean => {
    const last = subject === null ? undefined : g.applied[subject];
    // Per subject, by the signed issuedAt across both owner keys (lead call on P4), and by the
    // same key's counter; the key's own high-water mark was step 0's.
    const earlier = last?.issuedAt !== undefined && issuedOf(t) < Date.parse(last.issuedAt);
    if (earlier || (last !== undefined && last.credentialId === t.credentialId && t.counter <= last.counter)) {
      spend(t.tap, 'out-of-order');
      refused(ctx, 'out-of-order');
      return false;
    }
    return true;
  };
  const accept = (t: { tap: StoredTap; intent: KeyTapIntent; credentialId: string; counter: number }, what: string, subject: string | null): void => {
    spend(t.tap, what);
    note(t.credentialId, t.counter);
    const issuedAt = (t.intent as { issuedAt?: string }).issuedAt;
    if (subject !== null) g.applied[subject] = { credentialId: t.credentialId, counter: t.counter, ...(issuedAt !== undefined ? { issuedAt } : {}) };
  };

  // 1. Invites (review B1). An invite is bound, the first time the gate acts on it, to the account
  //    the database then names, and never re-pointed. Keys are taken from it only while it is open:
  //    before its signed `expiresAt` by the gate's clock and before the person has joined. It is
  //    re-read each sync while open, because the invitee registers after the owner's tap was used.
  for (const { tap, intent } of owner) {
    if (intent.kind !== 'create-invite') continue;
    // Only a tap step 0 let through (now or in an earlier sync): spent as this invite's.
    if (g.usedNonces[tap.nonceHex] !== `invite:${intent.inviteId}`) continue;
    // A reset link's id is never an invite (lead call on the D-032 reset gap).
    if (Object.hasOwn(g.resets, intent.inviteId)) {
      refused(ctx, 'invite-is-reset');
      continue;
    }
    const binding = Object.hasOwn(g.invites, intent.inviteId) ? g.invites[intent.inviteId] : undefined;
    if (binding?.closed) continue;
    const expires = linkClosesAt({ intent });
    if (!Number.isFinite(expires) || now >= expires) {
      if (binding) binding.closed = true;
      else refused(ctx, 'invite-expired');
      continue;
    }
    const inv = await source.invite(intent.inviteId);
    if (!inv || inv.tokenHash !== intent.tokenHash || inv.accountId === null) continue;
    if (binding && inv.accountId !== binding.accountId) {
      refused(ctx, 'invite-rebound');
      continue;
    }
    const accountId = inv.accountId;
    if (!binding) {
      const taken = Object.values(g.invites).some((b) => b.accountId === accountId);
      if (accountId === ownerId || taken || Object.hasOwn(g.staff, accountId) || g.removedIds.includes(accountId)) {
        refused(ctx, 'invite-account');
        continue;
      }
      g.invites[intent.inviteId] = { accountId, closed: false };
    }
    const have = Object.hasOwn(g.staff, accountId) ? g.staff[accountId] : undefined;
    if (have?.joined) {
      g.invites[intent.inviteId]!.closed = true;
      continue;
    }
    const creds: PinnedCred[] = [...(have?.creds ?? [])];
    for (const reg of inv.registrations) {
      const cred = await verifiedRegistration(reg.response, intent.tokenHash, ctx);
      if (cred === null || !staffKeyAccepted(g, accountId, cred)) {
        refused(ctx, 'registration');
        continue;
      }
      if (!creds.some((c) => c.credentialId === cred.credentialId)) creds.push(cred);
    }
    if (have === undefined && creds.length === 0) continue;
    g.staff[accountId] = have
      ? { ...have, creds }
      : { role: intent.role, creds, revoked: false, removed: false, joined: false, inviteId: intent.inviteId, inviteClosed: false };
  }

  // 1b. Lead call on the D-032 reset gap: the owner's tapped `reset-staff-security`. The first time
  //     the gate acts on it (a person it knows, not removed, not the owner, in issuedAt order for
  //     that person, a link id no invite or earlier reset holds), the person's keys are dropped,
  //     any earlier reset link of theirs closes, and the link is bound to them. While the link is
  //     open (before its signed expiry, until the API says it finished), registrations made through
  //     it (`inviteRegistrationChallenge(tokenHash)`, attested, allowlisted) are their only keys.
  //     A reset without the owner's tap is the API's word only: nothing changes here.
  for (const t of owner) {
    const { tap, intent } = t;
    if (intent.kind !== 'reset-staff-security') continue;
    if (g.usedNonces[tap.nonceHex] !== `reset:${intent.inviteId}`) continue;
    let binding = Object.hasOwn(g.resets, intent.inviteId) ? g.resets[intent.inviteId] : undefined;
    if (binding === undefined) {
      const s = Object.hasOwn(g.staff, intent.accountId) ? g.staff[intent.accountId] : undefined;
      if (s === undefined || s.removed || intent.accountId === ownerId || g.removedIds.includes(intent.accountId) || Object.hasOwn(g.invites, intent.inviteId)) {
        spend(tap, 'reset-refused');
        refused(ctx, 'reset-refused');
        continue;
      }
      if (!inOrder(t, `security:${intent.accountId}`)) continue;
      accept(t, `reset:${intent.inviteId}`, `security:${intent.accountId}`);
      for (const b of Object.values(g.resets)) if (b.accountId === intent.accountId) b.closed = true;
      // Review D-3: their own invite closes too, joined or not, so step 1 never puts a key
      // registered through it back after the reset.
      for (const b of Object.values(g.invites)) if (b.accountId === intent.accountId) b.closed = true;
      s.inviteClosed = true;
      s.creds = [];
      // Design task 8: a security reset revokes every device the person certified with the old keys.
      // Re-review M1: as of the reset tap's signed issuedAt (never later than now), as N5 does, so the
      // same browser key certified again after the reset but before this sync counts. The person is
      // disabled from the reset tap on, and their old keys no longer verify.
      revokeDevicesOf(g, intent.accountId, new Date(Math.min(issuedOf(t), ctx.now().getTime())), { watermark: true });
      binding = { accountId: intent.accountId, closed: false };
      g.resets[intent.inviteId] = binding;
    } else if (binding.accountId !== intent.accountId) {
      // The same link named again for someone else: never re-pointed.
      spend(tap, 'reset-rebound');
      refused(ctx, 'reset-rebound');
      continue;
    }
    if (binding.closed) continue;
    const expires = linkClosesAt({ intent });
    if (!Number.isFinite(expires) || now >= expires) {
      binding.closed = true;
      continue;
    }
    const s = Object.hasOwn(g.staff, binding.accountId) ? g.staff[binding.accountId] : undefined;
    if (s === undefined || s.removed) {
      binding.closed = true;
      continue;
    }
    const inv = await source.invite(intent.inviteId);
    if (!inv || inv.tokenHash !== intent.tokenHash || inv.accountId !== binding.accountId) {
      refused(ctx, 'reset-link');
      continue;
    }
    const creds: PinnedCred[] = [...s.creds];
    for (const reg of inv.registrations) {
      const cred = await verifiedRegistration(reg.response, intent.tokenHash, ctx);
      if (cred === null || !staffKeyAccepted(g, binding.accountId, cred)) {
        refused(ctx, 'registration');
        continue;
      }
      if (!creds.some((c) => c.credentialId === cred.credentialId)) creds.push(cred);
    }
    s.creds = creds;
    // The link finished (the API's word, which only takes power away): no key is taken from it again.
    if (inv.used === true) binding.closed = true;
  }

  // 2. Role changes, switch-on, removal, settings and the stop, in counter order per key; each tap counts once.
  const rows = new Map((await source.staff()).map((s) => [s.accountId, s]));
  for (const t of owner) {
    const { tap, intent } = t;
    if (!fresh(tap) || !ready(t)) continue;
    switch (intent.kind) {
      case 'settings': {
        if (!inOrder(t, 'settings')) continue;
        const usd = intent.largeTradeLimitUsd;
        const h = intent.appealWindowH;
        if (!Number.isFinite(usd) || usd < 1 || usd > 1_000_000 || !Number.isInteger(h) || h < 1) {
          spend(tap, 'settings');
          refused(ctx, 'settings');
          continue;
        }
        accept(t, 'settings', 'settings');
        // Review p4t22 M1: the same conversion as the API's (@x2f/staff `limitUsdCentsOf`).
        g.limitUsdCents = limitUsdCentsOf(usd);
        g.appealWindowH = h;
        continue;
      }
      case 'emergency-stop':
      case 'resume-trading':
        if (!inOrder(t, 'stop')) continue;
        accept(t, intent.kind, 'stop');
        g.stopped = intent.kind === 'emergency-stop';
        continue;
      case 'remove-staff': {
        // Only takes power away: applied whatever its order.
        accept(t, 'remove-staff', null);
        if (!g.removedIds.includes(intent.accountId)) g.removedIds.push(intent.accountId);
        const s = Object.hasOwn(g.staff, intent.accountId) ? g.staff[intent.accountId] : undefined;
        if (s) {
          if (!s.revoked) s.offSeenAt = ctx.now().toISOString();
          s.removed = true;
          s.revoked = true;
        }
        continue;
      }
      case 'set-role':
      case 'switch-on': {
        const s = Object.hasOwn(g.staff, intent.accountId) ? g.staff[intent.accountId] : undefined;
        if (s === undefined) continue; // not (yet) someone the gate knows: keep the tap for later
        if (!inOrder(t, `role:${intent.accountId}`)) continue;
        // Lead call on P4: a switch-on counts only when signed as issued after the switch-off this
        // gate saw (less the clock skew); an older one held back and released late is spent.
        if (intent.kind === 'switch-on' && s.offSeenAt !== undefined && !(issuedOf(t) > Date.parse(s.offSeenAt) - SWITCH_ON_SKEW_MS)) {
          spend(tap, 'switch-on-before-off');
          refused(ctx, 'switch-on-before-off');
          continue;
        }
        accept(t, intent.kind, `role:${intent.accountId}`);
        // Review N5: a switch-on always follows a switch-off, which this gate may never have seen (off
        // and on again between two syncs). Every device the person certified before it is revoked,
        // as of the switch-on's signed issuedAt (never later than now), so a device tapped after the
        // switch-on may be certified again.
        if (intent.kind === 'switch-on') revokeDevicesOf(g, intent.accountId, new Date(Math.min(issuedOf(t), ctx.now().getTime())), { watermark: true });
        if (s.removed || !INVITABLE.includes(intent.role)) continue;
        const row = rows.get(intent.accountId);
        s.role = intent.role as InvitableRole;
        if (intent.kind === 'switch-on' && row !== undefined && !row.switchedOff && !row.removed) s.revoked = false;
        continue;
      }
      default:
        continue;
    }
  }

  // 3. Revocation, no signature needed: whatever the API shows as switched off or removed, or no
  //    longer shows at all once they had joined. Before their staff row exists (the invite not yet
  //    finished) they are not joined and sign nothing, which revokes nothing. Joining closes the
  //    invite in the gate (review B1), whatever `used_at` says.
  for (const [accountId, s] of Object.entries(g.staff)) {
    const row = rows.get(accountId);
    const revoke = (): void => {
      // The first sight of this switch-off, by the gate's clock (lead call on P4).
      if (!s.revoked) s.offSeenAt = ctx.now().toISOString();
      s.revoked = true;
    };
    if (row === undefined) {
      if (s.joined) revoke();
      continue;
    }
    s.joined = true;
    s.inviteClosed = true;
    if (Object.hasOwn(g.invites, s.inviteId)) g.invites[s.inviteId]!.closed = true;
    if (row.switchedOff || row.removed) revoke();
    if (row.removed) s.removed = true;
  }

  // 4. New owner keys: two in-order taps by two different pinned owner keys for the same key.
  const byKey = new Map<string, Array<{ tap: StoredTap; intent: KeyTapIntent; credentialId: string; counter: number }>>();
  for (const t of owner) {
    if (t.intent.kind !== 'add-owner-key' || !fresh(t.tap) || !ready(t)) continue;
    // The same key to add, whenever each of the two taps was issued.
    const { issuedAt: _at, ...what } = t.intent as KeyTapIntent & { issuedAt?: string };
    const k = canonicalJson(what as KeyTapIntent);
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  for (const [k, list] of byKey) {
    // Re-verify N6 (lead call): two taps by two different pinned keys, issued within
    // ADD_OWNER_KEY_PAIR_MS of each other. An unpaired tap waits (step 0's age limit ends it).
    let pair: [typeof list[number], typeof list[number]] | null = null;
    for (const a of list) {
      for (const b of list) {
        if (a.credentialId !== b.credentialId && Math.abs(issuedOf(a) - issuedOf(b)) <= ADD_OWNER_KEY_PAIR_MS) pair = [a, b];
      }
    }
    if (pair === null) continue;
    for (const l of pair) accept(l, 'add-owner-key', null);
    const intent = JSON.parse(k) as Extract<KeyTapIntent, { kind: 'add-owner-key' }>;
    if (g.ownerCreds.some((c) => c.credentialId === intent.credentialId)) continue;
    const row = await source.credential(intent.credentialId);
    if (!row || row.accountId !== g.ownerAccountId || sha256Hex(row.publicKey) !== intent.publicKeySha256) {
      refused(ctx, 'owner-key');
      continue;
    }
    g.ownerCreds.push({ credentialId: intent.credentialId, publicKey: Buffer.from(row.publicKey).toString('base64url'), aaguid: row.aaguid });
  }

  // 5. Design task 8: staff device certifications and revocations (gate/devices.ts), after every
  //    revocation above, so a person switched off this sync certifies nothing and loses every device.
  await syncDevices(source, g, ctx, { marksBefore, takenThisSync });
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
  /**
   * Review p4t22 M2: the trades whose current dispute is an after-refund one that is not closed,
   * for the after-refund statement pass (afterRefund.ts), at most `limit`. Residual (a): and one
   * closed in the last 7 days whose ruling has no statement yet (migration 791's grants).
   */
  afterRefundCodes(limit?: number): Promise<string[]>;
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
    async afterRefundCodes(limit = 200) {
      const { rows } = await db.query<{ code: string }>(
        // Review p4t22 residual (a): also a dispute closed in the last 7 days whose ruling has no
        // statement yet (a decided round with nothing to send closes its dispute at once).
        `select d.code from disputes d
          where d.after_refund and d.seq = (select max(x.seq) from disputes x where x.code = d.code)
            and (d.status <> 'closed'
                 or (d.closed_at > now() - interval '7 days'
                     and not exists (select 1 from after_refund_statements s where s.ruling_id::text = d.ruling ->> 'id')))
          order by d.code limit $1`,
        [limit],
      );
      return rows.map((r) => r.code);
    },
    async storedRulings(code) {
      type Draft = { id: string; outcome: GateRuling['outcome']; accountAction: GateRuling['accountAction']; proposer: string; approver: string | null };
      const { rows } = await db.query<{ seq: number; round: 1 | 2; ruling: Draft | null; round1: Draft | null }>(
        'select seq, round, ruling, round1 from disputes where code = $1 order by seq desc limit 1',
        [code],
      );
      const d = rows[0];
      if (!d) return { current: null, round1: null, involved: [] };
      // Re-verify M-R1: the reason's text, hashed here, never a hash the database computed.
      const { rows: pub } = await db.query<{ round: 1 | 2; reason: string; evidence: unknown }>(
        'select round, reason, evidence from dispute_rulings where code = $1 and seq = $2',
        [code, d.seq],
      );
      const of = (r: Draft, round: 1 | 2, round1Id?: string): GateRuling | null => {
        const p = pub.find((x) => x.round === round);
        if (p === undefined) return null;
        // The lines as the ruling stores them, through the same function the API binds them with.
        let ev: string;
        try {
          ev = evidenceSha256(p.evidence as string[]);
        } catch {
          return null;
        }
        if (typeof p.reason !== 'string') return null;
        const reasonSha256 = createHash('sha256').update(p.reason, 'utf8').digest('hex');
        return { id: r.id, code, round, outcome: r.outcome, accountAction: r.accountAction, proposer: r.proposer, approver: r.approver, reasonSha256, evidenceSha256: ev, ...(round1Id ? { round1Id } : {}) };
      };
      const round1 = d.round1 ? of(d.round1, 1) : null;
      const current = d.ruling ? of(d.ruling, d.round, d.round === 2 ? d.round1?.id : undefined) : null;
      let involved: string[] = [];
      if (d.round === 2) {
        const { rows: log } = await db.query<{ id: string; trade_code: string | null; actor_kind: 'staff' | 'trader' | 'system'; actor_id: string | null; action: string }>(
          // By the bigint id: `order by id` would sort by the text alias ('10' before '9').
          'select id::text as id, trade_code, actor_kind, actor_id, action from activity_log where trade_code = $1 order by activity_log.id',
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
