/**
 * Owner rule p5-7: every change to an account sends one Jabber notice (when the user set Jabber up).
 * The choke point is a row trigger on each table below (migration 331, `jabber_note_change`), so no
 * code path can change one of them without queueing the notice in its own transaction. This file
 * is the reviewed list; apps/api/test/jabber-paths.test.ts checks it against the live schema both
 * ways: every trigger matches an entry, every column of these tables is classified, and every
 * other column that refers to an account is listed in `NOT_ACCOUNT_CHANGES` with its reason. A new
 * table or column fails that test until someone decides which it is.
 */
export interface ChangeTable {
  table: string;
  /** The column naming the account the change belongs to. */
  accountColumn: string;
  ops: ReadonlyArray<'insert' | 'update' | 'delete'>;
  /** Columns whose writes are a change (an update touching only bookkeeping columns sends nothing). */
  changes: readonly string[];
  /** Columns written by logins, rotations or purges, never by a change the person made: why each. */
  bookkeeping: Readonly<Record<string, string>>;
}

const ALL = ['insert', 'update', 'delete'] as const;

export const CHANGE_TABLES: readonly ChangeTable[] = [
  {
    table: 'accounts',
    accountColumn: 'id',
    // A new account has no Jabber yet; an account's deletion cascades to its contact (notified there).
    ops: ['update'],
    // Batch 4 classification (lead default, owner p11-119): the account's type and vendor date, its
    // close (closed_at, closed_reason) and the idle reminder are changes the owner should hear about;
    // last_login_at and the sealed Terms signature are bookkeeping. idle_hours went with migration 307.
    changes: [
      'id', 'display_name', 'display_key', 'kind', 'terms_version', 'terms_accepted_at', 'created_at', 'disabled_at',
      'legacy_login_name', 'one_device', 'show_traded_total', 'account_type', 'vendor_since', 'closed_at', 'closed_reason',
      'idle_reminder_minutes',
    ],
    bookkeeping: {
      had_wallet: 'set with the first wallet, which notifies through wallets',
      last_login_at: 'set by every login (new logins have their own push and alert); lead default, owner p11-119',
      terms_signature: 'the sealed signature stored with terms_accepted_at (which notifies) and erased by the close (closed_at notifies); lead default, owner p11-119',
      webauthn_user_id: 'set once in the sign-up transaction',
      login_tag: 'rotated to the current key after a login (retagLoginName); a name set also flips legacy_login_name',
      login_tag_key_id: 'rotated with login_tag',
      login_name: 'nulled by the one-time tag-login-names tool',
      login_key: 'nulled by the one-time tag-login-names tool',
      // J-23 groundwork (migration 500; lead default, owner p11-119 pattern): nothing moves it yet.
      chat_key_epoch: 'the account chat-key epoch; a rotation comes with the removal or recovery that causes it, which notifies there',
    },
  },
  {
    table: 'passwords', accountColumn: 'account_id', ops: ALL,
    changes: ['account_id', 'updated_at'],
    bookkeeping: { hash: 'rehashed under the current pepper at login (updated_at stays)', pepper_id: 'rehash' },
  },
  {
    table: 'totp', accountColumn: 'account_id', ops: ALL,
    changes: ['account_id', 'created_at'],
    bookkeeping: { secret_enc: 'rewrapped under the current key (rewrap-totp)', last_step: 'advanced by every login code' },
  },
  {
    table: 'recovery_codes', accountColumn: 'account_id', ops: ALL,
    changes: ['id', 'account_id', 'code_hash', 'key_id'],
    bookkeeping: { used_at: 'set by a backup login' },
  },
  {
    table: 'webauthn_credentials', accountColumn: 'account_id', ops: ALL,
    changes: ['id', 'account_id', 'credential_id', 'public_key', 'kind', 'transports', 'backed_up', 'device_type', 'attested', 'aaguid', 'label', 'created_at'],
    bookkeeping: { counter: 'the sign counter, at every login', last_used_at: 'every login' },
  },
  {
    table: 'pgp_keys', accountColumn: 'account_id', ops: ALL,
    // proved_subkeys (210) is set once with the key and never updated: a change if it ever were (lead default, owner p11-119).
    changes: ['id', 'account_id', 'fingerprint', 'created_at', 'proved_subkeys'],
    bookkeeping: { armored_enc: 'the refreshed key stored at login (same fingerprint)', last_used_at: 'every login' },
  },
  {
    table: 'wallets', accountColumn: 'account_id', ops: ALL,
    changes: ['id', 'account_id', 'app', 'label', 'created_at', 'usable_from', 'removed_at'],
    bookkeeping: { address: "nulled by the purge 90 days after removal (the removal notified)" },
  },
  {
    table: 'team_members', accountColumn: 'account_id', ops: ALL,
    changes: [
      'id', 'account_id', 'display_name', 'display_key', 'abilities', 'invite_hash', 'invite_expires_at', 'member_account_id',
      'joined_at', 'created_at', 'removed_at',
    ],
    bookkeeping: {},
  },
  {
    table: 'account_holds', accountColumn: 'account_id', ops: ALL,
    changes: ['account_id', 'started_at', 'hold_until', 'reason', 'pending_change', 'started_methods', 'started_by'],
    bookkeeping: {},
  },
  {
    table: 'trading_holds', accountColumn: 'account_id', ops: ALL,
    // 208's freeze columns (kind, reason, side, who placed or lifted it, the dispute) are changes like the
    // rest of a hold (lead default, owner p11-119).
    changes: ['id', 'account_id', 'created_at', 'lifted_at', 'kind', 'reason', 'side', 'placed_by', 'lifted_by', 'dispute_code', 'dispute_seq'],
    bookkeeping: {},
  },
  {
    table: 'nudge_settings', accountColumn: 'account_id', ops: ALL,
    changes: ['account_id', 'enabled', 'quiet_from', 'quiet_to', 'tz'],
    bookkeeping: {},
  },
  {
    table: 'account_blocks', accountColumn: 'account_id', ops: ALL,
    changes: ['account_id', 'blocked_id', 'created_at'],
    bookkeeping: {},
  },
  {
    table: 'past_reputation', accountColumn: 'account_id', ops: ALL,
    changes: [
      'id', 'account_id', 'site', 'evidence_url', 'claimed_trades', 'fingerprint', 'key_enc', 'challenge_text', 'signature_enc', 'status',
      'verified_trades', 'reviewer_id', 'decided_at', 'reason', 'created_at', 'verified_usd_cents', 'verified_usd_by', 'verified_usd_at',
    ],
    bookkeeping: {},
  },
  {
    // A ban of one of this account's identifiers (migration 017): the owner should hear about it
    // (lead default, owner p11-119). account_id is set null when the account goes; the trigger is
    // in migration 334.
    table: 'banned_identifiers', accountColumn: 'account_id', ops: ALL,
    changes: ['id', 'kind', 'tag_key_id', 'tag', 'account_id', 'banned_at'],
    bookkeeping: {},
  },
];

/**
 * Every other `table.column` that refers to an account, and why a write there is not a change to
 * that account. (The Jabber setting itself is `jabber_contacts`, with its own trigger.)
 */
export const NOT_ACCOUNT_CHANGES: Readonly<Record<string, string>> = {
  'account_blocks.blocked_id': 'the blocked person: never told (spec 2.4); the blocker is notified',
  'sessions.account_id': 'a login or logout; new logins have their own push and alert. Ending other sessions comes with the change that caused it',
  'trusted_devices.account_id': 'remembered at login, forgotten by the purge',
  'challenges.account_id': 'a login or set-up step in flight; its finish writes the change',
  'alerts.account_id': 'the in-app record of changes, not a change',
  'confirm_tokens.account_id': 'a re-authentication token for a change; the change notifies',
  'login_approvals.account_id': 'a new device asking to log in (push and alert)',
  'push_subscriptions.account_id': 'a browser subscribing to pushes, renewed by the browser itself',
  'name_keys.account_id': 'kept by a trigger from accounts (which notifies)',
  'team_audit.account_id': "the team's audit log, written with the member change (team_members notifies)",
  'offers.account_id': 'trading, not the account',
  'trades.seller_account_id': 'trading, not the account',
  'trades.buyer_account_id': 'trading, not the account',
  'chats.buyer_account_id': 'trading chat',
  'chats.seller_account_id': 'trading chat',
  'nudges.from_id': 'a nudge sent',
  'nudges.to_id': 'a nudge received',
  'reviews.reviewer_id': 'a review written about a trade',
  'reviews.subject_id': 'a review received from someone else',
  'past_reputation.reviewer_id': 'the moderator who decided a claim (the claimant is notified)',
  'past_reputation.verified_usd_by': 'the moderator who verified a figure (the claimant is notified)',
  'account_traded_totals.account_id': 'running totals kept by finished trades',
  'staff_members.account_id': 'staff records (staff and owner accounts have no Jabber set-up)',
  'staff_invites.created_by': 'staff records',
  'staff_invites.account_id': 'staff records',
  'key_taps.account_id': 'a staff security-key tap',
  // Batch 4 (lead default, owner p11-119): silent.
  // Hold model v3 and team abilities (team-perms-port; lead default pending the owner, p11-119 extension): silent.
  'hold_changes.account_id': 'a draft or waiting change (hold v3); the change notifies when it applies, through the table it writes',
  'held_trades.account_id': 'the trades a hold pauses, kept by the hold job; the hold itself notifies (account_holds)',
  'recovery_code_reveals.account_id': 'a one-time reveal of the new recovery code after a recovery-code login (a login step)',
  'trader_notes.account_id': "the account's own private notes on traders (staff-like records of its own)",
  'trader_notes.about_account_id': 'the trader a note is about: never told (private notes)',
  'account_action_minutes.account_id': 'pay and release timings kept by finished trades (the Fast badge), not the account',
  'closed_account_keys.account_id': "a closed account's identifier tags kept for the ban scope, written by the close itself (closed_at notifies)",
  'feedback_form.account_id': 'feedback sent to X2F',
  'team_members.member_account_id': "a member's login account; its changes notify the team account through the trigger",
  // J-23 groundwork (migration 500; lead default, owner p11-119 pattern): silent.
  'chat_key_envelopes.account_id': "a sealed chat key in flight between the account's own strong devices (ciphertext the API cannot open); the login that brought the device notifies",
  // J-14 support tickets and the compromised-account lock (migrations 450, 451; lead default, owner p11-119 pattern): silent here.
  'tickets.account_id': 'a support ticket or compromised report: help asked, not an account change; the lock a report starts sets accounts.disabled_at, which notifies',
  'ticket_messages.staff_id': 'the staff member who answered a ticket (staff records)',
  'account_locks.account_id': 'the compromised-account lock record; the lock sets accounts.disabled_at and the unlock clears it, which notify',
  'account_locks.unlocked_by': 'the staff member who lifted a lock (staff records)',
};
