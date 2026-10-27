import { afterEach, describe, expect, it } from 'vitest';
import { cancelAndRefundSteps, extendSteps, forgetRefundRuns, pendingRefundRun, refundRun, steps } from '../src/screens/trade/refundFlow.js';
import type { RefundEscrow } from '../src/screens/trade/refundSlot.js';

function fakes(fail: Partial<Record<'post' | 'signal' | 'build', number>> = {}) {
  const calls: string[] = [];
  const left = { post: fail.post ?? 0, signal: fail.signal ?? 0, build: fail.build ?? 0 };
  const maybe = async (k: keyof typeof left, name: string) => {
    calls.push(name);
    if (left[k] > 0) {
      left[k] -= 1;
      throw new Error(`${k} failed`);
    }
  };
  const post = (e: { type: 'extend' | 'request-refund' }) => maybe('post', `post:${e.type}`);
  const escrow: RefundEscrow = {
    signal: (s) => maybe('signal', `signal:${s}`),
    buildRefund: () => maybe('build', 'build'),
  };
  return { calls, post, escrow };
}

describe('Cancel & get refund', () => {
  it('posts request-refund, then signals, then builds the refund: each exactly once', async () => {
    const f = fakes();
    await cancelAndRefundSteps(f)();
    expect(f.calls).toEqual(['post:request-refund', 'signal:trade.refund-request', 'build']);
  });

  it('a double tap runs the steps once', async () => {
    const f = fakes();
    const run = cancelAndRefundSteps(f);
    await Promise.all([run(), run(), run()]);
    await run();
    expect(f.calls).toEqual(['post:request-refund', 'signal:trade.refund-request', 'build']);
  });

  it('a refused request-refund sends no signal and builds nothing (no refund without the final alert)', async () => {
    const f = fakes({ post: 1 });
    await expect(cancelAndRefundSteps(f)()).rejects.toThrow('post failed');
    expect(f.calls).toEqual(['post:request-refund']);
  });

  it('a retry after a failed signal resumes there: the API event is not posted twice', async () => {
    const f = fakes({ signal: 1 });
    const run = cancelAndRefundSteps(f);
    await expect(run()).rejects.toThrow('signal failed');
    await run();
    expect(f.calls).toEqual(['post:request-refund', 'signal:trade.refund-request', 'signal:trade.refund-request', 'build']);
  });

  it('a retry after a failed build sends the signal only once', async () => {
    const f = fakes({ build: 1 });
    const run = cancelAndRefundSteps(f);
    await expect(run()).rejects.toThrow('build failed');
    await run();
    expect(f.calls.filter((c) => c.startsWith('signal:'))).toHaveLength(1);
    expect(f.calls.filter((c) => c === 'build')).toHaveLength(2);
  });
});

describe('Give 30 more min', () => {
  it('posts extend, then signals trade.extend; builds nothing', async () => {
    const f = fakes();
    await extendSteps(f)();
    expect(f.calls).toEqual(['post:extend', 'signal:trade.extend']);
  });

  it('a refused extend sends no signal', async () => {
    const f = fakes({ post: 1 });
    await expect(extendSteps(f)()).rejects.toThrow();
    expect(f.calls).toEqual(['post:extend']);
  });
});

describe('steps', () => {
  it('reports done once every step has run', async () => {
    const run = steps([async () => undefined]);
    expect(run.done()).toBe(false);
    await run();
    expect(run.done()).toBe(true);
  });
});

describe('refundRun: the one Cancel & get refund run per trade, kept across remounts', () => {
  afterEach(() => forgetRefundRuns());

  it('returns the same run for a trade, done or not: a trade is refunded once per page', async () => {
    const f = fakes();
    const run = refundRun('T-1', f);
    expect(refundRun('T-1', f)).toBe(run);
    expect(refundRun('T-2', f)).not.toBe(run);
    await run();
    expect(run.done()).toBe(true);
    expect(refundRun('T-1', f)).toBe(run);
    await refundRun('T-1', f)();
    expect(f.calls).toEqual(['post:request-refund', 'signal:trade.refund-request', 'build']);
  });

  it('a run that failed half-way is pending; a finished or unknown trade has none', async () => {
    const f = fakes({ signal: 1 });
    const run = refundRun('T-1', f);
    await expect(run()).rejects.toThrow('signal failed');
    expect(pendingRefundRun('T-1')).toBe(run);
    expect(pendingRefundRun('T-9')).toBeNull();
    await run();
    expect(pendingRefundRun('T-1')).toBeNull();
    expect(f.calls).toEqual(['post:request-refund', 'signal:trade.refund-request', 'signal:trade.refund-request', 'build']);
  });

  it('a resumed run calls the deps it was last given, not the ones it was created with', async () => {
    const first = fakes({ signal: 1 });
    const run = refundRun('T-1', first);
    await expect(run()).rejects.toThrow('signal failed');
    const second = fakes();
    expect(refundRun('T-1', second)).toBe(run);
    await run();
    expect(first.calls).toEqual(['post:request-refund', 'signal:trade.refund-request']);
    expect(second.calls).toEqual(['signal:trade.refund-request', 'build']);
  });
});
