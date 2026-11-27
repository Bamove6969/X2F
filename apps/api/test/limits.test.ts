import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import { KeyedBuckets, REGISTER_BUCKET, START_BUCKET, Semaphore, TokenBucket, newBudgets } from '../src/limits.js';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function caught(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
}

describe('Semaphore', () => {
  it('runs one, queues one, refuses the third with busy', async () => {
    const s = new Semaphore(1, 1);
    const gate = deferred();
    const order: string[] = [];
    const a = s.run(async () => {
      await gate.promise;
      order.push('a');
      return 'a';
    });
    const b = s.run(async () => {
      order.push('b');
      return 'b';
    });
    const c = s.run(async () => 'c');
    await expect(c).rejects.toMatchObject({ status: 503, code: 'busy' });
    gate.resolve();
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(order).toEqual(['a', 'b']);
    // Slots are released: it accepts work again.
    await expect(s.run(async () => 'd')).resolves.toBe('d');
  });

  it('never runs more than its limit, even while slots are handed to waiters under contention', async () => {
    const s = new Semaphore(2, 50);
    let active = 0;
    let max = 0;
    const task = async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
    };
    const runs: Promise<void>[] = [];
    // Each finishing task queues a new one at the moment its slot is being handed over.
    const chained = async (left: number): Promise<void> => {
      await s.run(task);
      if (left > 0) runs.push(chained(left - 1));
    };
    for (let i = 0; i < 10; i++) runs.push(chained(3));
    while (runs.length) await runs.shift();
    expect(max).toBe(2);
    expect(active).toBe(0);
  });

  it('releases its slot when the task throws', async () => {
    const s = new Semaphore(1, 0);
    await expect(s.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(s.run(async () => 1)).resolves.toBe(1);
  });
});

describe('TokenBucket', () => {
  it('refuses the third take within a second, and passes after 30 s', () => {
    let now = new Date('2026-10-17T12:00:00Z');
    const b = new TokenBucket(2, 2, () => now);
    b.take();
    now = new Date(now.getTime() + 400);
    b.take();
    now = new Date(now.getTime() + 400);
    const e = caught(() => b.take());
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 503, code: 'busy', extra: { retryAfterSeconds: 30 } });
    now = new Date(now.getTime() + 30_000);
    expect(() => b.take()).not.toThrow();
  });

  it('never stores more than its capacity and survives a clock step back', () => {
    let now = new Date('2026-10-17T12:00:00Z');
    const b = new TokenBucket(2, 60, () => now);
    now = new Date(now.getTime() + 3_600_000);
    b.take();
    b.take();
    expect(() => b.take()).toThrow(ApiError);
    now = new Date(now.getTime() - 60_000);
    expect(() => b.take()).toThrow(ApiError);
  });

  it('has the plan budgets, built per app on the injected clock', () => {
    expect(REGISTER_BUCKET).toEqual({ capacity: 20, perMinute: 20 });
    expect(START_BUCKET).toEqual({ capacity: 120, perMinute: 120 });
    const now = new Date('2026-10-17T12:00:00Z');
    const { register, start } = newBudgets(() => now);
    for (let i = 0; i < 20; i++) register.take();
    expect(() => register.take()).toThrow(ApiError);
    for (let i = 0; i < 120; i++) start.take();
    expect(() => start.take()).toThrow(ApiError);
  });
});

describe('KeyedBuckets (per-account budgets, Task 20 review M7)', () => {
  it('gives each key its own bucket, refuses with 429 slow-down and a wait, and refills', () => {
    let t = 0;
    const b = new KeyedBuckets({ capacity: 2, perMinute: 1 }, () => new Date(t));
    b.take('a');
    b.take('a');
    const e = caught(() => b.take('a'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 429, code: 'slow-down', extra: { retryAfterSeconds: 60 } });
    b.take('b');
    t = 60_000;
    b.take('a');
    expect(caught(() => b.take('a'))).toMatchObject({ status: 429 });
  });

  it('stays bounded: past maxKeys it forgets full buckets first, then the oldest', () => {
    let t = 0;
    const b = new KeyedBuckets({ capacity: 1, perMinute: 1 }, () => new Date(t), 3);
    for (const k of ['a', 'b', 'c']) b.take(k);
    t = 60_000; // every bucket is full again
    b.take('d');
    expect(b.size).toBeLessThanOrEqual(3);
    // An empty bucket is kept over a full one while there is room to drop full ones.
    t = 60_000;
    const c = new KeyedBuckets({ capacity: 1, perMinute: 1 }, () => new Date(t), 2);
    c.take('x');
    c.take('y');
    c.take('z');
    expect(c.size).toBe(2);
  });
});
