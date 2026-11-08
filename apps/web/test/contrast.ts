// WCAG 2.x contrast for the token tests: relative luminance of sRGB colours, and `color-mix(in srgb,
// T p%, transparent)` composited over a background (what the browser paints).
import { readFileSync } from 'node:fs';
import { TOKENS_JSON, type Tokens } from '../../../tools/tokens-to-css.js';

export type Rgb = readonly [number, number, number];
export type Theme = 'night' | 'day';

export function hex(s: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (!m) throw new Error(`not a hex colour: ${s}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, fg p, bg)`: p of fg over bg (also a p% tint over transparent, painted on bg). */
export function mix(fg: Rgb, p: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => fg[i]! * p + bg[i]! * (1 - p)) as unknown as Rgb;
}

const json = JSON.parse(readFileSync(TOKENS_JSON, 'utf8')) as Tokens;

/** A colour token's value in a theme, from tokens.json. */
export function token(name: string, theme: Theme): Rgb {
  const t = json.color.tokens.find((c) => c.name === name);
  if (!t) throw new Error(`no colour token ${name}`);
  return hex(t.value[theme]);
}

export function usage(name: string): string {
  return (json.color.tokens.find((c) => c.name === name) as { usage?: string } | undefined)?.usage ?? '';
}
