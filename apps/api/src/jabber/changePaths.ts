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
    changes: [
      'id', 'display_name', 'display_key', 'kind', 'terms_version', 'terms_accepted_at', 'created_at', 'disabled_at',
      'legacy_login_name', 'one_device', 'idle_hours', 'show_traded_total',
    ],
    bookkeeping: {
      had_wallet: 'set with the first wallet, which notifies through wallets',
      webauthn_user_id: 'set once in the sign-up transaction',
      login_tag: 'rotated to the current key after a login (retagLoginName); a name set also flips legacy_login_name',
      login_tag_key_id: 'rotated with login_tag',
      login_name: 'nulled by the one-time tag-login-names tool',
      login_key: 'nulled by the one-time tag-login-names tool',
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
    changes: ['id', 'account_id', 'fingerprint', 'created_at'],
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
      'id', 'account_id', 'display_name', 'display_key', 'roles', 'invite_hash', 'invite_expires_at', 'member_account_id',
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
    changes: ['id', 'account_id', 'created_at', 'lifted_at'],
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
  'feedback_form.account_id': 'feedback sent to X2F',
  'team_members.member_account_id': "a member's login account; its changes notify the team account through the trigger",
};
