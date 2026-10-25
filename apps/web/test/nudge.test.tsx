// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buzz, BUZZ_SECONDS, NUDGE_NOTIFICATION, wakeUpText } from '../src/nudge/buzz.js';
import { browserNudgeEnv, handleNudge, sendNudge, useNudge, type NudgeEnv, type NudgeEvent } from '../src/nudge/useNudge.js';
import { render } from './render.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ev: NudgeEvent = { type: 'nudge', from: 'Monero_Mike', context: 'K7Q2-M9XW' };

function fakeEnv(hidden: boolean) {
  const env = { hidden: vi.fn(() => hidden), notify: vi.fn(), buzz: vi.fn() } satisfies NudgeEnv;
  return env;
}

describe('the copy', () => {
  it('in the tab: "Wake up, <name> wants to trade" with the name exactly as set', () => {
    expect(wakeUpText('Monero_Mike')).toBe('Wake up, Monero_Mike wants to trade');
  });

  it('the OS notification is exactly the generic line (no name, no amount)', () => {
    expect(NUDGE_NOTIFICATION).toBe('Someone nudged you on X2F');
  });
});

describe('handleNudge', () => {
  it('a visible tab buzzes and shows the alert, with no OS notification', () => {
    const env = fakeEnv(false);
    expect(handleNudge(ev, env)).toBe('Wake up, Monero_Mike wants to trade');
    expect(env.buzz).toHaveBeenCalledTimes(1);
    expect(env.notify).not.toHaveBeenCalled();
  });

  it('a hidden tab shows only the generic Notification: neither name nor amount nor code', () => {
    const env = fakeEnv(true);
    expect(handleNudge(ev, env)).toBeNull();
    expect(env.buzz).not.toHaveBeenCalled();
    expect(env.notify).toHaveBeenCalledTimes(1);
    const shown = JSON.stringify(env.notify.mock.calls[0]);
    expect(shown).toBe(JSON.stringify([NUDGE_NOTIFICATION]));
    expect(shown).not.toContain('Monero_Mike');
    expect(shown).not.toContain('K7Q2');
    expect(shown).not.toMatch(/\d+\.\d+|XMR|USD/);
  });
});

describe('browserNudgeEnv', () => {
  it('notify creates a Notification with only the title, when permission was granted', () => {
    const made: unknown[][] = [];
    class FakeNotification {
      static permission = 'granted';
      constructor(...args: unknown[]) {
        made.push(args);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    browserNudgeEnv().notify(NUDGE_NOTIFICATION);
    expect(made).toEqual([[NUDGE_NOTIFICATION]]);
  });

  it('notify does nothing without permission (never asks from a nudge)', () => {
    const made: unknown[] = [];
    class FakeNotification {
      static permission = 'default';
      static requestPermission = vi.fn();
      constructor(...args: unknown[]) {
        made.push(args);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    browserNudgeEnv().notify(NUDGE_NOTIFICATION);
    expect(made).toEqual([]);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('hidden follows document.visibilityState', () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(browserNudgeEnv().hidden()).toBe(true);
    spy.mockReturnValue('visible');
    expect(browserNudgeEnv().hidden()).toBe(false);
    spy.mockRestore();
  });
});

describe('buzz', () => {
  it('plays one loud, short square-wave buzz through WebAudio', () => {
    const started: number[] = [];
    const stopped: number[] = [];
    const osc = {
      type: 'sine', frequency: { value: 0 }, connect: vi.fn(),
      start: (t: number) => started.push(t), stop: (t: number) => stopped.push(t),
    };
    const gainValues: Array<[number, number]> = [];
    const gain = { gain: { setValueAtTime: (v: number, t: number) => gainValues.push([v, t]) }, connect: vi.fn() };
    const ctx = { currentTime: 10, destination: {}, createOscillator: () => osc, createGain: () => gain };
    buzz(ctx as never);
    expect(osc.type).toBe('square');
    expect(started).toEqual([10]);
    expect(stopped).toEqual([10 + BUZZ_SECONDS]);
    expect(BUZZ_SECONDS).toBeLessThanOrEqual(1.5);
    expect(Math.max(...gainValues.map(([v]) => v))).toBeGreaterThanOrEqual(0.5);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
  });
});

describe('sendNudge', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('posts { to, context } and reports sent on 202 (a silent drop looks the same)', async () => {
    const f = respond(202, { ok: true });
    vi.stubGlobal('fetch', f);
    await expect(sendNudge('Monero_Mike', 'K7Q2-M9XW')).resolves.toEqual({ result: 'sent' });
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('/v1/nudges');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ to: 'Monero_Mike', context: 'K7Q2-M9XW' });
  });

  it('too-soon carries the wait; no-shared-context is its own result', async () => {
    vi.stubGlobal('fetch', respond(429, { error: 'too-soon', retryAfterSeconds: 360 }));
    await expect(sendNudge('Monero_Mike', 'K7Q2-M9XW')).resolves.toEqual({ result: 'too-soon', retryAfterSeconds: 360 });
    vi.stubGlobal('fetch', respond(403, { error: 'no-shared-context' }));
    await expect(sendNudge('Monero_Mike', 'K7Q2-M9XW')).resolves.toEqual({ result: 'no-shared-context' });
  });

  it('any other failure is thrown', async () => {
    vi.stubGlobal('fetch', respond(500, { error: 'internal' }));
    await expect(sendNudge('Monero_Mike', 'K7Q2-M9XW')).rejects.toMatchObject({ code: 'internal' });
  });
});

describe('useNudge', () => {
  it('shows the alert for a nudge event while visible, and dismisses it', () => {
    let emit: (e: NudgeEvent) => void = () => undefined;
    const unsubscribe = vi.fn();
    const subscribe = (on: (e: NudgeEvent) => void) => {
      emit = on;
      return unsubscribe;
    };
    const env = fakeEnv(false);
    let api: ReturnType<typeof useNudge> | undefined;
    function Probe() {
      api = useNudge(subscribe, env);
      return <p role="alert">{api.alert ?? ''}</p>;
    }
    const { host, unmount } = render(<Probe />);
    act(() => emit(ev));
    expect(host.textContent).toBe('Wake up, Monero_Mike wants to trade');
    expect(env.buzz).toHaveBeenCalledTimes(1);
    act(() => api!.dismiss());
    expect(host.textContent).toBe('');
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
