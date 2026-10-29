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

/** An in-memory token bucket (never persisted); an empty bucket throws 503 `busy` with `retryAfterSeconds`. */
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

/** `POST /v1/method-suggestions` (Plan 3 Task 3): rows carry no account, so one budget for everyone. */
export const SUGGEST_BUCKET: BucketSize = { capacity: 30, perMinute: 10 };

export interface Budgets {
  register: TokenBucket;
  start: TokenBucket;
  suggest: TokenBucket;
}

/** One set of request budgets per app, on that app's clock (`buildApi` decorates it as `app.budgets`). */
export function newBudgets(clock: () => Date): Budgets {
  return {
    register: new TokenBucket(REGISTER_BUCKET.capacity, REGISTER_BUCKET.perMinute, clock),
    start: new TokenBucket(START_BUCKET.capacity, START_BUCKET.perMinute, clock),
    suggest: new TokenBucket(SUGGEST_BUCKET.capacity, SUGGEST_BUCKET.perMinute, clock),
  };
}
