import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import { ARGON2_SLOTS, REGISTER_BUCKET, START_BUCKET, Semaphore, TokenBucket, newBudgets } from '../src/limits.js';

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

  it('releases its slot when the task throws', async () => {
    const s = new Semaphore(1, 0);
    await expect(s.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(s.run(async () => 1)).resolves.toBe(1);
  });

  it('gives Argon2 four running slots and a queue of 32', async () => {
    const gate = deferred();
    const runs = Array.from({ length: 36 }, () => ARGON2_SLOTS.run(() => gate.promise));
    await expect(ARGON2_SLOTS.run(async () => undefined)).rejects.toMatchObject({ code: 'busy' });
    gate.resolve();
    await Promise.all(runs);
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
