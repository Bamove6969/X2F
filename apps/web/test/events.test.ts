import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectEvents, finalAlertSeen, parseLiveEvent, type LiveEvent } from '../src/api/events.js';

/** A stand-in for the browser's EventSource. */
class FakeSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeSource[] = [];
  readyState = FakeSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = FakeSource.CLOSED;
  }
  open() {
    this.readyState = FakeSource.OPEN;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  /** The browser gave up on this source (an HTTP error such as 401 or 429). */
  fail() {
    this.readyState = FakeSource.CLOSED;
    this.onerror?.();
  }
  /** A dropped connection the browser retries by itself. */
  blip() {
    this.readyState = FakeSource.CONNECTING;
    this.onerror?.();
  }
}

const Source = FakeSource as unknown as typeof EventSource;
const last = () => FakeSource.all.at(-1)!;

beforeEach(() => {
  FakeSource.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('parseLiveEvent', () => {
  it.each<LiveEvent>([
    { type: 'trade', code: 'X2F-7KQ4-M9TD', state: 'secured' },
    { type: 'accepted', code: 'X2F-7KQ4-M9TD', by: 'Someone' },
    { type: 'chat', chat: 'c1' },
    { type: 'nudge', from: 'Someone', context: 'X2F-7KQ4-M9TD' },
  ])('accepts %o', (ev) => {
    expect(parseLiveEvent(JSON.stringify(ev))).toEqual(ev);
  });

  it.each([
    'not json',
    '{"type":"evil"}',
    '{"type":"accepted","code":"X"}',
    '{"type":"trade","code":1,"state":"secured"}',
    '[]',
    'null',
  ])('drops %s', (raw) => {
    expect(parseLiveEvent(raw)).toBeNull();
  });

  it('keeps only the known fields', () => {
    expect(parseLiveEvent('{"type":"chat","chat":"c1","extra":"x"}')).toEqual({ type: 'chat', chat: 'c1' });
  });
});

describe('connectEvents', () => {
  it('opens /v1/events and hands each valid event to the handler', () => {
    const got: LiveEvent[] = [];
    const stop = connectEvents((e) => got.push(e), { EventSource: Source });
    expect(last().url).toBe('/v1/events');
    last().open();
    last().message({ type: 'trade', code: 'X2F-7KQ4-M9TD', state: 'secured' });
    last().message('garbage');
    expect(got).toEqual([{ type: 'trade', code: 'X2F-7KQ4-M9TD', state: 'secured' }]);
    stop();
  });

  it('reconnects with growing back-off after the browser gives up, and resets it once open', () => {
    const stop = connectEvents(() => undefined, { EventSource: Source, random: () => 0.5 });
    last().fail();
    expect(FakeSource.all).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(FakeSource.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSource.all).toHaveLength(2);
    expect(FakeSource.all[0]!.closed).toBe(true);
    last().fail();
    vi.advanceTimersByTime(1999);
    expect(FakeSource.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSource.all).toHaveLength(3);
    last().open();
    last().fail();
    vi.advanceTimersByTime(1000);
    expect(FakeSource.all).toHaveLength(4);
    stop();
  });

  it('never waits more than a minute between tries', () => {
    const stop = connectEvents(() => undefined, { EventSource: Source, random: () => 0.5 });
    for (let i = 0; i < 12; i++) {
      last().fail();
      vi.advanceTimersByTime(60_000);
    }
    expect(FakeSource.all).toHaveLength(13);
    stop();
  });

  it('leaves a dropped connection to the browser’s own retry', () => {
    const stop = connectEvents(() => undefined, { EventSource: Source });
    last().blip();
    vi.advanceTimersByTime(120_000);
    expect(FakeSource.all).toHaveLength(1);
    stop();
  });

  it('stop() closes the source and cancels a pending reconnect', () => {
    const stop = connectEvents(() => undefined, { EventSource: Source });
    last().fail();
    stop();
    vi.advanceTimersByTime(120_000);
    expect(FakeSource.all).toHaveLength(1);
    expect(FakeSource.all[0]!.closed).toBe(true);
  });

  it('does nothing where the browser has no EventSource', () => {
    const stop = connectEvents(() => undefined, { EventSource: undefined });
    expect(FakeSource.all).toHaveLength(0);
    stop();
  });
});

describe('finalAlertSeen (the final alert seen-receipt, P3-I13)', () => {
  it('posts the receipt for the live refund_requested event, with the code encoded', async () => {
    const posted: string[] = [];
    finalAlertSeen({ type: 'trade', code: 'X2F-7KQ4-M9TD', state: 'refund_requested' }, async (p) => void posted.push(p));
    expect(posted).toEqual(['/v1/trades/X2F-7KQ4-M9TD/final-alert-seen']);
  });

  it('posts nothing for any other event', () => {
    const posted: string[] = [];
    const post = async (p: string) => void posted.push(p);
    finalAlertSeen({ type: 'trade', code: 'X2F-7KQ4-M9TD', state: 'paid' }, post);
    finalAlertSeen({ type: 'accepted', code: 'X2F-7KQ4-M9TD', by: 'mira' }, post);
    expect(posted).toEqual([]);
  });

  it('swallows a refusal (the seller gets the same event and a 409)', async () => {
    expect(() =>
      finalAlertSeen({ type: 'trade', code: 'X2F-7KQ4-M9TD', state: 'refund_requested' }, () => Promise.reject(new Error('409'))),
    ).not.toThrow();
    await Promise.resolve();
  });
});
