import type pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRetention, type RetentionJob, type RetentionLog } from '../src/retention.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('startRetention', () => {
  it('keeps running later jobs when one fails, logs only { job, rows }, and stops', async () => {
    vi.useFakeTimers();
    const db = {} as pg.Pool;
    const now = new Date('2026-10-17T12:00:00Z');
    const seen: Date[] = [];
    let count = 0;
    const failing: RetentionJob = {
      name: 'failing',
      run: async () => {
        throw new Error('secret detail 4AdUndXHHZ6');
      },
    };
    const counting: RetentionJob = {
      name: 'counting',
      run: async (d, at) => {
        expect(d).toBe(db);
        seen.push(at);
        count++;
        return 3;
      },
    };
    const logs: RetentionLog[] = [];
    const stop = startRetention({ db, clock: () => now }, [failing, counting], 1_000, (e) => logs.push(e));

    expect(count).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(count).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(count).toBe(3);
    expect(seen.every((d) => d === now)).toBe(true);

    expect(logs).toContainEqual({ job: 'counting', rows: 3 });
    expect(logs).toContainEqual({ job: 'failing', failed: true });
    for (const l of logs) expect(Object.keys(l).sort()).toEqual(l.job === 'failing' ? ['failed', 'job'] : ['job', 'rows']);
    expect(JSON.stringify(logs)).not.toContain('4AdUndXHHZ6');

    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(count).toBe(3);
  });

  it('defaults to a 10-minute tick and runs jobs in order', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const job = (name: string): RetentionJob => ({ name, run: async () => (order.push(name), 0) });
    const stop = startRetention({ db: {} as pg.Pool, clock: () => new Date() }, [job('a'), job('b'), job('c')], undefined, () => {});
    await vi.advanceTimersByTimeAsync(599_999);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(['a', 'b', 'c']);
    stop();
  });
});
