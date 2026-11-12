/**
 * W-006 (owner 28 Oct Q6 final: "phone push + loud alarm sound (default; custom sound file +
 * volume) definitely"; Plan 7 Task 16, P7-A11): the optional loud alarm.
 *
 * - Off until the person turns it on. Default volume 80%; the default sound is a tone made on the
 *   device (Web Audio), so there is no sound file to fetch.
 * - "Choose sound": an audio file of at most `ALARM_MAX_BYTES`, kept on this device only
 *   (IndexedDB), never uploaded: nothing here makes a request.
 * - Which pushes ring it: the kinds sw.js can tell apart (`AlarmEvent`). Lead default (P7-A11 reads
 *   "the final alert and payment marked"; both arrive as the trade push today): trade changes, the
 *   seller's cancel input and the owner's alert ring; nudges do not. The person can change that.
 * - On the web it rings while an X2F tab is open: sw.js posts `{ type: 'x2f-push', kind }` to open
 *   windows and `AlarmListener` plays. With no tab open the push is the normal notification. The
 *   Android app's alarm channel (rings on silent) is Plan 6 Task 20 and not built here.
 *
 * Settings live in this browser's storage (`x2f.alarm`), like the device's own sound: they are
 * per device by design (a phone and a laptop want different alarms). Words are COPY-UNSIGNED
 * (Plan 7 Task 8's Notifications board is not drawn).
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckRow } from '../ui/CheckRow.js';
import { Switch } from '../ui/Switch.js';
import './alarm.css';

export const ALARM_MAX_BYTES = 1024 * 1024;
export const ALARM_EVENTS = ['trade', 'cancel-confirm', 'alert', 'nudge'] as const;
export type AlarmEvent = (typeof ALARM_EVENTS)[number];

export interface AlarmSettings {
  on: boolean;
  /** 0 to 1. */
  volume: number;
  events: AlarmEvent[];
  /** A chosen sound is stored on this device (the sound store); false plays the default tone. */
  customSound: boolean;
}

export const ALARM_DEFAULTS: AlarmSettings = Object.freeze({
  on: false,
  volume: 0.8,
  events: ['trade', 'cancel-confirm', 'alert'],
  customSound: false,
}) as AlarmSettings;

const KEY = 'x2f.alarm';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

const isEvent = (v: unknown): v is AlarmEvent => typeof v === 'string' && (ALARM_EVENTS as readonly string[]).includes(v);

/** The saved settings; any field that is missing or malformed reads as its default. */
export function loadAlarmSettings(storage: Store | null): AlarmSettings {
  let raw: unknown = null;
  try {
    const s = storage?.getItem(KEY) ?? null;
    raw = s === null ? null : JSON.parse(s);
  } catch {
    raw = null;
  }
  const r = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const events = Array.isArray(r.events) ? ALARM_EVENTS.filter((e) => (r.events as unknown[]).includes(e)) : null;
  return {
    on: typeof r.on === 'boolean' ? r.on : ALARM_DEFAULTS.on,
    volume: typeof r.volume === 'number' && Number.isFinite(r.volume) && r.volume >= 0 && r.volume <= 1 ? r.volume : ALARM_DEFAULTS.volume,
    events: events ?? [...ALARM_DEFAULTS.events],
    customSound: typeof r.customSound === 'boolean' ? r.customSound : ALARM_DEFAULTS.customSound,
  };
}

/** Best effort: blocked storage keeps the settings for this page only. */
export function saveAlarmSettings(storage: Store | null, s: AlarmSettings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage blocked (private window): the choice lasts for this page
  }
}

export const shouldRing = (s: AlarmSettings, kind: AlarmEvent): boolean => s.on && s.events.includes(kind);

/** The kind in sw.js's message, or null for anything else. */
export function pushKindOf(msg: unknown): AlarmEvent | null {
  if (msg === null || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  return m.type === 'x2f-push' && isEvent(m.kind) ? m.kind : null;
}

export function checkSoundFile(f: { size: number; type: string }): 'ok' | 'too-big' | 'not-audio' {
  if (!f.type.startsWith('audio/') || f.size === 0) return 'not-audio';
  if (f.size > ALARM_MAX_BYTES) return 'too-big';
  return 'ok';
}

/** Where the chosen sound is kept: on this device only. */
export interface SoundStore {
  get(): Promise<ArrayBuffer | null>;
  put(b: ArrayBuffer): Promise<void>;
  clear(): Promise<void>;
}

export function memorySoundStore(): SoundStore {
  let b: ArrayBuffer | null = null;
  return {
    get: async () => b,
    put: async (x) => void (b = x),
    clear: async () => void (b = null),
  };
}

/** IndexedDB `x2f-alarm`, one object store, one key. Falls back to memory when IndexedDB is missing or blocked. */
export function indexedDbSoundStore(): SoundStore {
  const idb = typeof indexedDB === 'undefined' ? undefined : indexedDB;
  if (!idb) return memorySoundStore();
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open('x2f-alarm', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sound');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction('sound', mode).objectStore('sound'));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: async () => {
      try {
        const v = await run<unknown>('readonly', (s) => s.get('sound'));
        return v instanceof ArrayBuffer ? v : null;
      } catch {
        return null;
      }
    },
    put: (b) => run<unknown>('readwrite', (s) => s.put(b, 'sound')).then(() => undefined),
    clear: () => run<unknown>('readwrite', (s) => s.delete('sound')).then(() => undefined),
  };
}

export interface AudioOut {
  /** Plays `sound` (or the default tone when null or undecodable) at `volume` (0 to 1). */
  play(sound: ArrayBuffer | null, volume: number): Promise<void>;
}

/** How long the default tone rings, and its two pitches. */
const TONE_S = 3;

export function webAudioOut(makeContext: () => AudioContext = () => new AudioContext()): AudioOut {
  return {
    async play(sound, volume) {
      const ctx = makeContext();
      await ctx.resume?.().catch(() => undefined);
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      let decoded: AudioBuffer | null = null;
      if (sound !== null) {
        try {
          decoded = await ctx.decodeAudioData(sound.slice(0));
        } catch {
          decoded = null;
        }
      }
      const done = () => void ctx.close?.().catch(() => undefined);
      if (decoded !== null) {
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(gain);
        src.onended = done;
        src.start();
        return;
      }
      const osc = ctx.createOscillator();
      osc.type = 'square';
      const t = ctx.currentTime;
      for (let i = 0; i < TONE_S * 4; i++) osc.frequency.setValueAtTime(i % 2 === 0 ? 880 : 660, t + i / 4);
      osc.connect(gain);
      osc.onended = done;
      osc.start(t);
      osc.stop(t + TONE_S);
    },
  };
}

/** Rings for `kind` if the settings say so, with the stored sound when one was chosen. */
export async function ringFor(s: AlarmSettings, kind: AlarmEvent, store: SoundStore, out: AudioOut): Promise<void> {
  if (!shouldRing(s, kind)) return;
  const sound = s.customSound ? await store.get().catch(() => null) : null;
  await out.play(sound, s.volume);
}

const browserStorage = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Mounted once in the app: rings when sw.js reports a push while this tab is open. */
export function AlarmListener({ storage, store, out }: { storage?: Store | null; store?: SoundStore; out?: AudioOut } = {}) {
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const st = storage === undefined ? browserStorage() : storage;
    const ss = store ?? indexedDbSoundStore();
    const o = out ?? webAudioOut();
    const onMessage = (e: MessageEvent) => {
      const kind = pushKindOf(e.data);
      if (kind !== null) void ringFor(loadAlarmSettings(st), kind, ss, o).catch(() => undefined);
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [storage, store, out]);
  return null;
}

/** COPY-UNSIGNED: builder's words; Plan 7 Task 8's Notifications board is not drawn. */
export const ALARM_COPY = {
  title: 'Loud alarm',
  note: 'Rings on this device when a trade needs you, while X2F is open. Your sound stays on this device.',
  volume: 'Volume',
  eventsTitle: 'Ring for',
  events: {
    trade: 'Trade changes',
    'cancel-confirm': 'A cancel that needs your input',
    alert: 'Alerts that need your attention',
    nudge: 'Nudges',
  } satisfies Record<AlarmEvent, string>,
  chooseSound: 'Choose sound',
  soundDefault: 'Default sound',
  soundCustom: 'Your sound',
  useDefault: 'Use the default sound',
  test: 'Test alarm',
  tooBig: 'That file is too big. Choose a sound file of 1 MB or less.',
  notAudio: "That isn't a sound file. Choose an audio file.",
  failed: "That didn't work. Try again.",
} as const;

/** The alarm's settings card (Settings → Alerts). Everything stays on this device. */
export function AlarmSettingsCard({ storage, store, out }: { storage?: Store | null; store?: SoundStore; out?: AudioOut }) {
  const st = useMemo(() => (storage === undefined ? browserStorage() : storage), [storage]);
  const ss = useMemo(() => store ?? indexedDbSoundStore(), [store]);
  const o = useMemo(() => out ?? webAudioOut(), [out]);
  const [s, setS] = useState<AlarmSettings>(() => loadAlarmSettings(st));
  const [error, setError] = useState<string | null>(null);
  const C = ALARM_COPY;

  const update = (next: AlarmSettings) => {
    setS(next);
    saveAlarmSettings(st, next);
  };

  const choose = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const check = checkSoundFile(file);
    if (check !== 'ok') {
      setError(check === 'too-big' ? C.tooBig : C.notAudio);
      return;
    }
    try {
      await ss.put(await file.arrayBuffer());
      update({ ...s, customSound: true });
    } catch {
      setError(C.failed);
    }
  };

  const useDefault = async () => {
    setError(null);
    await ss.clear().catch(() => undefined);
    update({ ...s, customSound: false });
  };

  const test = async () => {
    setError(null);
    const sound = s.customSound ? await ss.get().catch(() => null) : null;
    await o.play(sound, s.volume).catch(() => setError(C.failed));
  };

  return (
    <section className="x2f-card" data-part="alarm" aria-labelledby="alarm-h">
      <h2 className="x2f-card__title" id="alarm-h">
        {C.title}
      </h2>
      <p className="x2f-note" id="alarm-n">
        {C.note}
      </p>
      <Switch
        checked={s.on} aria-labelledby="alarm-h" aria-describedby="alarm-n" data-part="alarm-switch"
        onClick={() => update({ ...s, on: !s.on })}
      />
      <label className="x2f-label" htmlFor="alarm-volume">
        {C.volume} {Math.round(s.volume * 100)}%
      </label>
      <input
        id="alarm-volume" className="x2f-alarm__volume" type="range" min={0} max={100} step={5} value={Math.round(s.volume * 100)} data-part="alarm-volume"
        onChange={(e) => update({ ...s, volume: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
      />
      <fieldset className="x2f-fieldset x2f-alarm__fieldset">
        <legend className="x2f-label">{C.eventsTitle}</legend>
        {ALARM_EVENTS.map((ev) => (
          <CheckRow
            key={ev} part={`alarm-event-${ev}`} title={C.events[ev]} checked={s.events.includes(ev)}
            onChange={(on) => update({ ...s, events: ALARM_EVENTS.filter((x) => (x === ev ? on : s.events.includes(x))) })}
          />
        ))}
      </fieldset>
      <p className="x2f-note" data-part="alarm-sound">
        {s.customSound ? C.soundCustom : C.soundDefault}
      </p>
      <label className="x2f-button x2f-button--secondary x2f-alarm__file" htmlFor="alarm-file">
        {C.chooseSound}
        <input
          id="alarm-file" className="x2f-alarm__file-input" type="file" accept="audio/*" data-part="alarm-file"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </label>
      {s.customSound ? (
        <button type="button" className="x2f-button x2f-button--quiet" data-part="alarm-default-sound" onClick={() => void useDefault()}>
          {C.useDefault}
        </button>
      ) : null}
      <button type="button" className="x2f-button x2f-button--secondary" data-part="alarm-test" onClick={() => void test()}>
        {C.test}
      </button>
      {error !== null ? (
        <p className="x2f-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
