import { ApiError } from './errors.js';

/** Caps concurrent CPU-heavy work: `running` at once, `queue` waiting, anything more gets 503 `busy`. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly running: number,
    private readonly queue: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.running) {
      this.active++;
    } else if (this.waiting.length < this.queue) {
      // The releasing task hands its slot straight to us, so `active` is unchanged.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      throw new ApiError(503, 'busy');
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/** Process-wide: Argon2 hashing is bounded by CPU, not by any one app instance. */
export const ARGON2_SLOTS = new Semaphore(4, 32);

/**
 * An in-memory token bucket (never persisted, so per API process; a restart refills it); an empty
 * bucket throws 503 `busy` with `retryAfterSeconds`. A budget that must hold across processes uses
 * `takeSharedBucket` (auth/throttle.ts) instead.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
    private readonly clock: () => Date,
  ) {
    this.tokens = capacity;
    this.last = clock().getTime();
  }

  take(): void {
    const now = this.clock().getTime();
    const elapsed = Math.max(0, now - this.last);
    this.last = Math.max(this.last, now);
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.perMinute) / 60_000);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const retryAfterSeconds = Math.ceil(((1 - this.tokens) * 60) / this.perMinute);
    throw new ApiError(503, 'busy', { retryAfterSeconds });
  }
}

export interface BucketSize {
  capacity: number;
  perMinute: number;
}

/** `/v1/register/*` finishing routes. */
export const REGISTER_BUCKET: BucketSize = { capacity: 20, perMinute: 20 };
/** All `/v1/login/*` and `/v1/register/*\/start` routes and `login/password`. */
export const START_BUCKET: BucketSize = { capacity: 120, perMinute: 120 };

/**
 * `PUT /v1/account/password`, per session (Plan 2 Task 17 review round 3, R3-I1): a refused change
 * costs a session one try, so a loop against the hold runs dry instead of racing the owner's login.
 */
export const SECURITY_CHANGE_BUCKET: BucketSize = { capacity: 10, perMinute: 5 };

/**
 * `POST /v1/account/approvals/:id`, per session (Plan 2 Task 17 review round 4, R4-I1): a refused
 * decision costs a session one try, so a loop against the hold runs dry instead of racing the
 * owner's login.
 */
export const APPROVAL_DECISION_BUCKET: BucketSize = { capacity: 10, perMinute: 5 };

/**
 * `POST /v1/register/name-check` (the sign-up's live "is available" tick, lead job 2026-11-08), site
 * wide, counted in Postgres for every API process together (`takeSharedBucket`, review F2). The tick answers whether a private login name exists, so this budget is what bounds
 * enumeration: at most 30 at once and 10 a minute (14,400 a day) for the whole site, however many
 * device cookies a script throws away. A person typing a few names uses a handful. When a script
 * drains it, the tick falls back to "checked when you finish" for everyone; sign-up itself is not
 * affected (`createAccount` checks again and answers only `names-unavailable`).
 */
export const NAME_CHECK_BUCKET: BucketSize = { capacity: 30, perMinute: 10 };
/**
 * The same route per device cookie, also in Postgres (checked first, so a device over its pace never
 * spends the site budget, review F3). Both sizes are also used for the route's in-memory load shed
 * (`nameCheckShed`, `nameCheckDeviceShed`, review S1), taken before the shared counts: one process
 * alone can never pass more than the shared budget, so the shed refuses nothing the shared count
 * would allow from that process, and an empty shed refuses without touching the database.
 */
export const NAME_CHECK_DEVICE_BUCKET: BucketSize = { capacity: 10, perMinute: 2 };

/** `POST /v1/method-suggestions` (Plan 3 Task 3): rows carry no account, so one budget for everyone. */
export const SUGGEST_BUCKET: BucketSize = { capacity: 30, perMinute: 10 };

/**
 * Keyed token buckets (per account or per session; in memory, never persisted, so per API process, like TokenBucket): one bucket per key,
 * created full. An empty bucket throws 429 `slow-down` with `retryAfterSeconds` (the caller's own
 * pace, so not 503 `busy`). At most `maxKeys` buckets are kept: past that, buckets that have
 * refilled are forgotten first (a forgotten bucket is a full one, so nothing changes for its key),
 * then the oldest.
 */
export class KeyedBuckets {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();

  constructor(
    private readonly bucket: BucketSize,
    private readonly clock: () => Date,
    private readonly maxKeys = 100_000,
  ) {}

  get size(): number {
    return this.buckets.size;
  }

  private level(b: { tokens: number; last: number }, now: number): number {
    return Math.min(this.bucket.capacity, b.tokens + (Math.max(0, now - b.last) * this.bucket.perMinute) / 60_000);
  }

  take(key: string): void {
    const now = this.clock().getTime();
    const old = this.buckets.get(key);
    const tokens = old ? this.level(old, now) : this.bucket.capacity;
    const last = old ? Math.max(old.last, now) : now;
    if (tokens < 1) {
      this.buckets.set(key, { tokens, last });
      const retryAfterSeconds = Math.ceil(((1 - tokens) * 60) / this.bucket.perMinute);
      throw new ApiError(429, 'slow-down', { retryAfterSeconds });
    }
    // Re-inserted so the Map's order is least recently used first.
    this.buckets.delete(key);
    this.buckets.set(key, { tokens: tokens - 1, last });
    if (this.buckets.size > this.maxKeys) this.prune(now);
  }

  private prune(now: number): void {
    for (const [k, b] of this.buckets) {
      if (this.buckets.size <= this.maxKeys) return;
      if (this.level(b, now) >= this.bucket.capacity) this.buckets.delete(k);
    }
    for (const k of this.buckets.keys()) {
      if (this.buckets.size <= this.maxKeys) return;
      this.buckets.delete(k);
    }
  }
}

/**
 * `PUT /v1/account/webauthn/label` per account (security review of wip/lead-seckey-fix): every
 * rename queues a Jabber notice (jabber/changePaths.ts), so 10 at once and 10 an hour. Naming a new
 * key, and a few fixes, never come near it; a loop runs dry. Every try counts, refused ones too.
 */
export const KEY_LABEL_BUCKET: BucketSize = { capacity: 10, perMinute: 10 / 60 };

/** `POST /v1/chats` (Task 20 review M7): new pre-trade chats per trader, 20 an hour. */
export const CHAT_OPEN_BUCKET: BucketSize = { capacity: 20, perMinute: 20 / 60 };
/** `POST /v1/chats/:chat/envelopes` (Task 20 review M7): chat lines per trader across all chats, 30 a minute. */
export const CHAT_POST_BUCKET: BucketSize = { capacity: 30, perMinute: 30 };

/**
 * J-23 review F6: the chat-key courier's writes per account (lead default). A handover posts one
 * box per device and collects it once, so a person never comes near these; a loop runs dry.
 */
/**
 * S-085 review S2 and re-verify R2, per session: refused proofs only (`POST /v1/account/session/proof`
 * answered 401 `proof-invalid`). A valid proof is never charged, and challenges are not capped per
 * session (they write nothing). The web treats the 429 as "retry later", never as a logout.
 */
export const SESSION_PROOF_BUCKET: BucketSize = { capacity: 20, perMinute: 10 };
export const CHAT_KEY_POST_BUCKET: BucketSize = { capacity: 30, perMinute: 10 };
export const CHAT_KEY_COLLECT_BUCKET: BucketSize = { capacity: 30, perMinute: 10 };

/**
 * `PUT /v1/trades/:code/proofs/:id` per account (lead 2026-11-12, proof-store review M1): every try
 * counts, refused ones too, and it is taken before the body (up to 4 MiB) is read. A trade holds at
 * most 5 payment proofs and 5 pieces of evidence per side, plus an unblurred copy per request, so
 * 20 at once and 2 a minute (120 an hour) cover several trades with retries; a loop runs dry.
 */
export const PROOF_PUT_BUCKET: BucketSize = { capacity: 20, perMinute: 2 };

/**
 * `POST /v1/account/past-rep/start` (Plan 5 Task 10, lead follow-up 2026-11-01): starts per account
 * an hour. Each start inspects a pasted key and stores a challenge. The owner may change it.
 */
export const PAST_REP_STARTS_PER_HOUR = 10;
export const PAST_REP_START_BUCKET: BucketSize = { capacity: PAST_REP_STARTS_PER_HOUR, perMinute: PAST_REP_STARTS_PER_HOUR / 60 };
/**
 * `POST /v1/account/past-rep/finish` (Task 10 review round 1 N5): finishes per account an hour. Each
 * opens the sealed key and runs up to four signature checks. Same number as start until decided
 * (open question for the lead/owner).
 */
export const PAST_REP_FINISHES_PER_HOUR = 10;
export const PAST_REP_FINISH_BUCKET: BucketSize = { capacity: PAST_REP_FINISHES_PER_HOUR, perMinute: PAST_REP_FINISHES_PER_HOUR / 60 };

/**
 * `POST /v1/trades/:code/payment-proof` (Plan 4 Task 12 review m4), per account: every proof costs a
 * round trip to X2F's node and a turn in the one-at-a-time check queue, so one seller cannot starve
 * the others' checks. A seller retyping a mistyped key a few times never comes near it. Lead
 * default; the owner may change it.
 */
export const PAYMENT_PROOF_BUCKET: BucketSize = { capacity: 10, perMinute: 1 };

/**
 * `GET /staff/v1/accounts/lookup` per staff member (staff Accounts page, lead default): a person
 * looking up a few traders never comes near it; a loop that walks names or trade codes runs dry
 * (20 at once, then 4 a minute). Every try counts, misses and bad queries too.
 */
export const ACCOUNT_LOOKUP_BUCKET: BucketSize = { capacity: 20, perMinute: 4 };

/**
 * `POST /v1/tickets/compromised` (D-059; J-14 review J5, ported), site wide, in this process: the
 * form needs no login, so it has its own budget, apart from the login starts (a flood of reports
 * never starves logins, nor the reverse); empty → 503 `busy`. Each report costs one HMAC per login
 * name key and a lookup. Lead default; the owner may change it.
 *
 * Review of feat/lockout, item 4 (lead default, owner question pending): this is the ACCEPT budget
 * only, sized well above what a flood of locks could use, so that draining it costs a steady 120
 * requests a minute and real victims still file between bursts. Locks have their own, much smaller
 * cap in the database (tickets/lock.ts LOCK_CAP_PER_HOUR, 20 an hour site wide): over it a report is
 * still recorded but locks nothing, and the owner is alerted.
 */
export const COMPROMISED_BUCKET: BucketSize = { capacity: 300, perMinute: 120 };
/**
 * `GET /v1/team/log/integrity` per account (review of team audit v2): each check walks and rehashes
 * the account's whole chain, so 30 at once and 30 an hour. The Team log screen checks once when it
 * opens and when asked; a loop runs dry. Every try counts, refused ones too.
 */
export const TEAM_LOG_INTEGRITY_BUCKET: BucketSize = { capacity: 30, perMinute: 30 / 60 };
/**
 * `GET /v1/team/log/export` per account (same review): each download reads every matching row and
 * walks the whole chain as well, so 10 at once and 10 an hour.
 */
export const TEAM_LOG_EXPORT_BUCKET: BucketSize = { capacity: 10, perMinute: 10 / 60 };

export interface Budgets {
  register: TokenBucket;
  start: TokenBucket;
  suggest: TokenBucket;
  /**
   * `POST /v1/register/name-check`, site wide, in this process only: a load shed in front of the
   * shared `name-check:site` bucket (review S1, 9 Nov), so a flood is refused before any query.
   */
  nameCheckShed: TokenBucket;
  /** The same per device cookie, in this process only: the shed in front of `name-check:dev:<hash>`. */
  nameCheckDeviceShed: KeyedBuckets;
  /** Per session: `PUT /v1/account/password` (review round 3 R3-I1). */
  securityChange: KeyedBuckets;
  /** Per session: `POST /v1/account/approvals/:id` (review round 4 R4-I1). */
  approvalDecision: KeyedBuckets;
  /** Per account. */
  chatOpen: KeyedBuckets;
  /** Per account. */
  chatPost: KeyedBuckets;
  /** Per account: `POST /v1/account/past-rep/start`. */
  pastRepStart: KeyedBuckets;
  /** Per account: `POST /v1/account/chat-keys` (J-23 review F6). */
  chatKeyPost: KeyedBuckets;
  /** Per account: `DELETE /v1/account/chat-keys/:id` (J-23 review F6). */
  chatKeyCollect: KeyedBuckets;
  /** Per account: `PUT /v1/trades/:code/proofs/:id` (proof-store review M1 follow-up). */
  proofPut: KeyedBuckets;
  /** Per account: `POST /v1/account/past-rep/finish`. */
  pastRepFinish: KeyedBuckets;
  /** Per account: `POST /v1/trades/:code/payment-proof` (Plan 4 Task 12 review m4). */
  paymentProof: KeyedBuckets;
  /** Per account: `PUT /v1/account/webauthn/label` (security review of wip/lead-seckey-fix). */
  keyLabel: KeyedBuckets;
  /** Per staff member: `GET /staff/v1/accounts/lookup` (the staff Accounts page). */
  accountLookup: KeyedBuckets;
  /** Per session: refused S-085 proofs (review S2, re-verify R2). */
  sessionProof: KeyedBuckets;
  /** Site wide: `POST /v1/tickets/compromised` (D-059, J-14 review J5). */
  compromised: TokenBucket;
  /** Per account: `GET /v1/team/log/integrity`. */
  teamLogIntegrity: KeyedBuckets;
  /** Per account: `GET /v1/team/log/export`. */
  teamLogExport: KeyedBuckets;
}

/** One set of request budgets per app, on that app's clock (`buildApi` decorates it as `app.budgets`). */
export function newBudgets(clock: () => Date): Budgets {
  return {
    register: new TokenBucket(REGISTER_BUCKET.capacity, REGISTER_BUCKET.perMinute, clock),
    start: new TokenBucket(START_BUCKET.capacity, START_BUCKET.perMinute, clock),
    suggest: new TokenBucket(SUGGEST_BUCKET.capacity, SUGGEST_BUCKET.perMinute, clock),
    nameCheckShed: new TokenBucket(NAME_CHECK_BUCKET.capacity, NAME_CHECK_BUCKET.perMinute, clock),
    nameCheckDeviceShed: new KeyedBuckets(NAME_CHECK_DEVICE_BUCKET, clock),
    securityChange: new KeyedBuckets(SECURITY_CHANGE_BUCKET, clock),
    approvalDecision: new KeyedBuckets(APPROVAL_DECISION_BUCKET, clock),
    chatOpen: new KeyedBuckets(CHAT_OPEN_BUCKET, clock),
    chatPost: new KeyedBuckets(CHAT_POST_BUCKET, clock),
    pastRepStart: new KeyedBuckets(PAST_REP_START_BUCKET, clock),
    chatKeyPost: new KeyedBuckets(CHAT_KEY_POST_BUCKET, clock),
    chatKeyCollect: new KeyedBuckets(CHAT_KEY_COLLECT_BUCKET, clock),
    proofPut: new KeyedBuckets(PROOF_PUT_BUCKET, clock),
    pastRepFinish: new KeyedBuckets(PAST_REP_FINISH_BUCKET, clock),
    paymentProof: new KeyedBuckets(PAYMENT_PROOF_BUCKET, clock),
    keyLabel: new KeyedBuckets(KEY_LABEL_BUCKET, clock),
    accountLookup: new KeyedBuckets(ACCOUNT_LOOKUP_BUCKET, clock),
    sessionProof: new KeyedBuckets(SESSION_PROOF_BUCKET, clock),
    compromised: new TokenBucket(COMPROMISED_BUCKET.capacity, COMPROMISED_BUCKET.perMinute, clock),
    teamLogIntegrity: new KeyedBuckets(TEAM_LOG_INTEGRITY_BUCKET, clock),
    teamLogExport: new KeyedBuckets(TEAM_LOG_EXPORT_BUCKET, clock),
  };
}
