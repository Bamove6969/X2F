// @vitest-environment happy-dom
// W-006 (owner 28 Oct Q6 final; Plan 7 Task 16): the optional loud alarm. Default sound and volume;
// the person may choose their own sound file (kept on this device, never uploaded) and set the
// volume. On the web it rings while an X2F tab is open, when a push arrives (sw.js posts its kind).
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from './render.js';

const {
  ALARM_DEFAULTS, ALARM_MAX_BYTES, AlarmSettingsCard, checkSoundFile, loadAlarmSettings, memorySoundStore, pushKindOf, ringFor,
  saveAlarmSettings, shouldRing, webAudioOut,
} = await import('../src/alerts/alarm.js');

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

/** A Web Audio stand-in that records what was played and at what gain. */
function fakeAudio() {
  const log: Array<{ what: string; gain?: number }> = [];
  class Ctx {
    currentTime = 0;
    destination = {};
    createGain() {
      const g = { gain: { value: 1, setValueAtTime: (v: number) => void (g.gain.value = v) }, connect: () => undefined };
      return g;
    }
    createOscillator() {
      const o = {
        type: 'sine', frequency: { value: 0, setValueAtTime: () => undefined },
        connect: (g: { gain: { value: number } }) => void log.push({ what: 'tone', gain: g.gain.value }),
        start: () => undefined, stop: () => undefined, onended: null as null | (() => void),
      };
      return o;
    }
    createBufferSource() {
      const s = {
        buffer: null as unknown, connect: (g: { gain: { value: number } }) => void log.push({ what: `sound:${String(s.buffer)}`, gain: g.gain.value }),
        start: () => undefined, stop: () => undefined, onended: null as null | (() => void),
      };
      return s;
    }
    async decodeAudioData(b: ArrayBuffer) {
      if (new Uint8Array(b)[0] === 0) throw new Error('not audio');
      return `decoded-${b.byteLength}`;
    }
    async resume() {}
    async close() {}
  }
  return { log, Ctx: Ctx as unknown as new () => AudioContext };
}

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('settings', () => {
  it('off until turned on, default volume 80%, default sound; the default events ring for trades, not nudges', () => {
    expect(ALARM_DEFAULTS).toEqual({ on: false, volume: 0.8, events: ['trade', 'cancel-confirm', 'alert'], customSound: false });
    expect(loadAlarmSettings(new MemStorage())).toEqual(ALARM_DEFAULTS);
    expect(loadAlarmSettings(null)).toEqual(ALARM_DEFAULTS);
  });

  it('survive a reload; anything malformed falls back to the default for that field', () => {
    const s = new MemStorage();
    saveAlarmSettings(s, { on: true, volume: 0.35, events: ['nudge'], customSound: true });
    expect(loadAlarmSettings(s)).toEqual({ on: true, volume: 0.35, events: ['nudge'], customSound: true });
    s.setItem('x2f.alarm', '{"on":"yes","volume":7,"events":["wallet","nudge","nudge"],"customSound":1}');
    expect(loadAlarmSettings(s)).toEqual({ ...ALARM_DEFAULTS, events: ['nudge'] });
    s.setItem('x2f.alarm', 'not json');
    expect(loadAlarmSettings(s)).toEqual(ALARM_DEFAULTS);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadAlarmSettings(throwing)).toEqual(ALARM_DEFAULTS);
    expect(() => saveAlarmSettings(throwing, ALARM_DEFAULTS)).not.toThrow();
  });

  it('rings only when on and the event is picked', () => {
    expect(shouldRing(ALARM_DEFAULTS, 'trade')).toBe(false);
    const on = { ...ALARM_DEFAULTS, on: true };
    expect(shouldRing(on, 'trade')).toBe(true);
    expect(shouldRing(on, 'cancel-confirm')).toBe(true);
    expect(shouldRing(on, 'nudge')).toBe(false);
    expect(shouldRing({ ...on, events: ['nudge'] }, 'nudge')).toBe(true);
  });

  it("reads only sw.js's own message shape", () => {
    expect(pushKindOf({ type: 'x2f-push', kind: 'trade' })).toBe('trade');
    expect(pushKindOf({ type: 'x2f-push', kind: 'nudge' })).toBe('nudge');
    for (const bad of [null, 'trade', { type: 'other', kind: 'trade' }, { type: 'x2f-push', kind: 'wallet' }, { type: 'x2f-push' }]) expect(pushKindOf(bad)).toBeNull();
  });
});

describe('the sound file', () => {
  it('at most 1 MiB and audio only', () => {
    expect(ALARM_MAX_BYTES).toBe(1024 * 1024);
    expect(checkSoundFile({ size: 1000, type: 'audio/ogg' })).toBe('ok');
    expect(checkSoundFile({ size: ALARM_MAX_BYTES, type: 'audio/mpeg' })).toBe('ok');
    expect(checkSoundFile({ size: ALARM_MAX_BYTES + 1, type: 'audio/mpeg' })).toBe('too-big');
    expect(checkSoundFile({ size: 10, type: 'image/png' })).toBe('not-audio');
    expect(checkSoundFile({ size: 10, type: '' })).toBe('not-audio');
    expect(checkSoundFile({ size: 0, type: 'audio/ogg' })).toBe('not-audio');
  });
});

describe('playing', () => {
  it('the default tone at the set volume; a chosen sound decoded and played at the set volume', async () => {
    const a = fakeAudio();
    const out = webAudioOut(() => new a.Ctx());
    await out.play(null, 0.5);
    expect(a.log).toEqual([{ what: 'tone', gain: 0.5 }]);
    a.log.length = 0;
    await out.play(new Uint8Array([1, 2, 3]).buffer, 0.25);
    expect(a.log).toEqual([{ what: 'sound:decoded-3', gain: 0.25 }]);
  });

  it('a chosen sound that does not decode falls back to the default tone', async () => {
    const a = fakeAudio();
    await webAudioOut(() => new a.Ctx()).play(new Uint8Array([0]).buffer, 0.9);
    expect(a.log).toEqual([{ what: 'tone', gain: 0.9 }]);
  });

  it('ringFor plays only for a picked event, with the stored sound', async () => {
    const store = memorySoundStore();
    await store.put(new Uint8Array([7, 7]).buffer);
    const play = vi.fn(async () => undefined);
    const on = { ...ALARM_DEFAULTS, on: true, customSound: true, volume: 0.6 };
    await ringFor(on, 'nudge', store, { play });
    expect(play).not.toHaveBeenCalled();
    await ringFor(on, 'trade', store, { play });
    expect(play).toHaveBeenCalledWith(expect.any(ArrayBuffer), 0.6);
    await ringFor({ ...on, customSound: false }, 'trade', store, { play });
    expect(play).toHaveBeenLastCalledWith(null, 0.6);
  });
});

describe('AlarmSettingsCard', () => {
  const flush = () => act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  const part = (host: HTMLElement, p: string) => host.querySelector(`[data-part="${p}"]`) as HTMLElement;
  function pick(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
  }

  it('turn on, test at the set volume, refuse a big or non-audio file, keep a good one on the device only', async () => {
    const storage = new MemStorage();
    const store = memorySoundStore();
    const play = vi.fn(async () => undefined);
    const { host } = render(<AlarmSettingsCard storage={storage} store={store} out={{ play }} />);
    await flush();
    const sw = part(host, 'alarm-switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    act(() => sw.click());
    expect(loadAlarmSettings(storage).on).toBe(true);

    act(() => part(host, 'alarm-test').click());
    await flush();
    expect(play).toHaveBeenLastCalledWith(null, 0.8);

    const file = part(host, 'alarm-file') as HTMLInputElement;
    pick(file, new File([new Uint8Array(ALARM_MAX_BYTES + 1)], 'big.ogg', { type: 'audio/ogg' }));
    await flush();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/1 MB/);
    pick(file, new File(['x'], 'pic.png', { type: 'image/png' }));
    await flush();
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/sound file/);
    expect(await store.get()).toBeNull();

    pick(file, new File([new Uint8Array([5, 6, 7])], 'mine.ogg', { type: 'audio/ogg' }));
    await flush();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(new Uint8Array((await store.get())!)).toEqual(new Uint8Array([5, 6, 7]));
    expect(loadAlarmSettings(storage).customSound).toBe(true);
    act(() => part(host, 'alarm-test').click());
    await flush();
    expect(play).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), 0.8);

    act(() => part(host, 'alarm-default-sound').click());
    await flush();
    expect(await store.get()).toBeNull();
    expect(loadAlarmSettings(storage).customSound).toBe(false);
    // The sound never left the device.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
