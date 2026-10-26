/** Nudge copy and sound (spec 2.4). */

/** The only text an OS notification or push may show for a nudge: never a name, amount or trade detail. */
export const NUDGE_NOTIFICATION = 'Someone nudged you on X2F';

/** The in-tab alert; the name is the sender's public name, shown exactly as set. */
export function wakeUpText(name: string): string {
  return `Wake up, ${name} wants to trade`;
}

export const BUZZ_SECONDS = 1.2;
const PULSE_SECONDS = 0.15;
const FREQUENCY_HZ = 180;
const LOUD = 0.8;

/** The parts of an AudioContext the buzz uses. */
export interface BuzzAudio {
  readonly currentTime: number;
  readonly destination: unknown;
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(to: unknown): unknown;
    start(when: number): void;
    stop(when: number): void;
  };
  createGain(): { gain: { setValueAtTime(value: number, when: number): unknown }; connect(to: unknown): unknown };
}

/** One loud, short buzz: a low square wave pulsed on and off, like ICQ's Buzz. */
export function buzz(ctx: BuzzAudio): void {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = FREQUENCY_HZ;
  for (let t = 0, on = true; t < BUZZ_SECONDS; t += PULSE_SECONDS, on = !on) {
    gain.gain.setValueAtTime(on ? LOUD : 0, t0 + t);
  }
  gain.gain.setValueAtTime(0, t0 + BUZZ_SECONDS);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + BUZZ_SECONDS);
}
