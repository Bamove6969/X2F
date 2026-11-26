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
    // one_time (620, owner demo note #6) is set once with the wallet and never updated: a change if it
    // ever were. A one-time wallet used up by a trade sets removed_at, a change that notifies like a removal.
    // is_default (630, owner 17 Nov): the person's choice of default payout wallet, a change.
    // used_by_trade (640, owner Q10): the trade that used up a one-time wallet. Set and cleared with
    // removed_at (use-up, restore), a change either way; cleared alone by a removal, which notifies too.
    changes: ['id', 'account_id', 'app', 'label', 'created_at', 'usable_from', 'removed_at', 'one_time', 'is_default', 'used_by_trade'],
    bookkeeping: { address: "nulled by the purge 90 days after removal (the removal notified)" },
  },
  {
    table: 'team_members', accountColumn: 'account_id', ops: ALL,
    changes: [
      'id', 'account_id', 'display_name', 'display_key', 'abilities', 'invite_hash', 'invite_expires_at', 'member_account_id',
      'joined_at', 'created_at', 'removed_at',
      // Migration 390 (S-105): the member's chat number, set with the invite (its insert notifies).
      'assistant_no',
      // J-20 (migration 380): the member's trade-size band and working hours, set by the lead.
      'band_min_atomic', 'band_max_atomic', 'hours',
    ],
    bookkeeping: {
      first_login_at: "set once by the member's first login, which queues its own notice (kind team-member-first-login, J-20)",
    },
  },
  {
    // J-06 (migration 400): a lien on the account and a 1% it owes are changes to it, like a freeze
    // (lead default, owner p11-119 pattern; owner may change). Neither is ever deleted (400's guards).
    table: 'liens', accountColumn: 'debtor_account_id', ops: ['insert', 'update'],
    changes: [
      'id', 'debtor_account_id', 'creditor_account_id', 'amount_atomic', 'fee_atomic', 'from_code', 'dispute_seq', 'round', 'cause',
      'status', 'created_at', 'changed_at', 'lifted_at', 'repayment_code',
      // Lien recovery (migration 820; lead default, owner p11-119 pattern): the share of the debtor's
      // proceeds each trade recovers is a change to their lien, set only by a senior-approved request.
      'recovery_rate_bps',
    ],
    bookkeeping: {
      // Q2 (migration 820): where the CREDITOR's recoveries go, set by the creditor's own signed
      // statement; it changes nothing the debtor owes or does, so the debtor is not notified.
      creditor_address: "the creditor's own recovery address (the creditor's choice, not a change to the debtor's account)",
      creditor_address_statement: "the creditor device's signed statement of that address",
      creditor_address_sig: "the signature on that statement",
    },
  },
  {
    table: 'fees_owed', accountColumn: 'account_id', ops: ['insert', 'update'],
    changes: ['id', 'account_id', 'amount_atomic', 'from_code', 'dispute_seq', 'created_at', 'collected_atomic', 'settled_at'],
    bookkeeping: {},
  },
  {
    // Plan 4 Task 26 (migration 760): an approved account limit is a change to the account, like a
    // lien or a freeze (lead default, owner p11-119 pattern; owner may change). The notice never
    // carries the staff-only reason, which lives on the recommendation.
    table: 'account_limits', accountColumn: 'account_id', ops: ALL,
    changes: ['id', 'account_id', 'cap_usd', 'stage', 'until', 'set_by', 'recommendation_id', 'created_at'],
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
    // S-093 (migration 362): the blocker's own note is a change they made, like the block itself.
    changes: ['account_id', 'blocked_id', 'created_at', 'note'],
    bookkeeping: {},
  },
  {
    // Plan 5 Tasks 5 and 12 (migration 303, trigger in 702; lead call, owner p5-7): which earned
    // badges the profile shows, and publishing the signed record on it, are changes to the account,
    // like show_traded_total. One row per account, never deleted except by the account's deletion,
    // which cascades (notified there), so the trigger watches inserts and updates.
    table: 'badge_prefs', accountColumn: 'account_id', ops: ['insert', 'update'],
    changes: ['account_id', 'chosen', 'levels', 'featured_order', 'portable_public'],
    bookkeeping: { updated_at: "set with every save; the save's other columns notify" },
  },
  {
    table: 'past_reputation', accountColumn: 'account_id', ops: ALL,
    changes: [
      'id', 'account_id', 'site', 'evidence_url', 'claimed_trades', 'fingerprint', 'key_enc', 'challenge_text', 'signature_enc', 'status',
      'verified_trades', 'reviewer_id', 'decided_at', 'reason', 'created_at', 'verified_usd_cents', 'verified_usd_by', 'verified_usd_at',
      // Migration 751 (Task 11 review m3): who revoked an approved claim, and when.
      'revoked_by', 'revoked_at',
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
  {
    // Plan 4 Task 27 (migration 780): a ban placed, ended by its time or lifted (lead default, as
    // trading_holds). The staff note is part of the row; the notice never says what changed.
    table: 'account_bans', accountColumn: 'account_id', ops: ALL,
    changes: ['id', 'account_id', 'kind', 'rule_id', 'reason_code', 'until', 'note', 'placed_by', 'tap_id', 'created_at', 'ended_at', 'lifted_at', 'lifted_by'],
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
  'limit_recommendations.account_id': 'a recommendation waiting for a senior moderator (staff only, Task 26); an approved one notifies through account_limits',
  'limit_recommendations.recommended_by': 'the staff member who recommended limits, not a change to their account',
  'limit_recommendations.decided_by': 'the senior moderator or owner who decided a recommendation, not a change to their account',
  'account_limits.set_by': 'the senior moderator or owner who approved the limit (the limited account is notified)',
  'review_disputes.decided_by': "the moderator's stamp on a review dispute, not a change to that account; decisions are logged as review.dispute-decided",
  'past_reputation.reviewer_id': 'the moderator who decided a claim (the claimant is notified)',
  'past_reputation.verified_usd_by': 'the moderator who verified a figure (the claimant is notified)',
  'past_reputation.revoked_by': 'the senior moderator or owner who revoked a claim (the claimant is notified)',
  'account_traded_totals.account_id': 'running totals kept by finished trades',
  'staff_members.account_id': 'staff records (staff and owner accounts have no Jabber set-up)',
  'staff_invites.created_by': 'staff records',
  'staff_invites.account_id': 'staff records',
  'account_bans.placed_by': 'staff records (who placed a ban; the banned account is account_id)',
  'account_bans.lifted_by': 'staff records (who lifted a ban)',
  'key_taps.account_id': 'a staff security-key tap',
  // Plan 4 Task 33 (staff pay, migration 420), classified at the batch 9 merge.
  'staff_shifts.staff_id': 'staff records: a staff session\'s shift (staff accounts have no Jabber set-up)',
  'staff_pay_items.staff_id': 'staff records: the staff pay ledger',
  'staff_payouts.staff_id': 'staff records: a staff payout',
  'staff_payout_addresses.staff_id': 'staff records: a staff member\'s payout address (added with a security-key tap)',
  // Batch 4 (lead default, owner p11-119): silent.
  // Hold model v3 and team abilities (team-perms-port; lead default pending the owner, p11-119 extension): silent.
  'recovery_code_reveals.account_id': 'a one-time reveal of the new recovery code after a recovery-code login (a login step)',
  'trader_notes.account_id': "the account's own private notes on traders (staff-like records of its own)",
  'trader_notes.about_account_id': 'the trader a note is about: never told (private notes)',
  'account_action_minutes.account_id': 'pay and release timings kept by finished trades (the Fast badge), not the account',
  'closed_account_keys.account_id': "a closed account's identifier tags kept for the ban scope, written by the close itself (closed_at notifies)",
  'feedback_form.account_id': 'feedback sent to X2F',
  // Plan 4 Task 30: support tickets. A ticket is the trader's own question to staff, not a change to
  // the account; who took it and which staff member wrote a line are staff-side.
  'tickets.account_id': "a support ticket the account's owner opened to X2F staff",
  'tickets.taken_by': 'the staff member working a ticket (staff side)',
  'ticket_messages.staff_id': 'the staff member who wrote a ticket reply (staff side, never shown to the trader)',
  'team_members.member_account_id': "a member's login account; its changes notify the team account through the trigger",
  // J-23 groundwork (migration 500; lead default, owner p11-119 pattern): silent.
  // J-06 (migration 400; lead default): the person a lien is owed to; the dispute's own notices tell them.
  'liens.creditor_account_id': 'the person a lien is owed to: the debtor is notified (liens.debtor_account_id); the dispute tells the creditor',
  // Lien recovery (migration 820; lead default): the staff on a rate request; the approved rate notifies the debtor (liens.recovery_rate_bps).
  'lien_rate_requests.proposed_by': 'the moderator who proposed a lien rate (the debtor is notified when it is approved)',
  'lien_rate_requests.decided_by': 'the senior moderator who decided a lien rate request (the debtor is notified when it is approved)',
  'chat_key_envelopes.account_id': "a sealed chat key in flight between the account's own strong devices (ciphertext the API cannot open); the login that brought the device notifies",
  // Plan 4 Task 19 (migration 750; lead call 18 Nov 2026): silent.
  'training_cases.marked_by': "the curator's (owner's) stamp on a training case, not a change to that account; marking is logged as staff.training-marked",
};
