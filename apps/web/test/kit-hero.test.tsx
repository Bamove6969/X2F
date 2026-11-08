// @vitest-environment happy-dom
// Design kit handoff (8 Nov 2026) §4-6 against §19.2's acceptance lines: Hero, HeroNumber,
// ResultHeadline, TimerRing, SegmentProgress, KeyMark/KeyTile and TradeStepper.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { remainingParts } from '../src/ui/Countdown.js';
import { BUYER_STEPS, Hero, HeroNumber, KeyMark, KeyTile, ResultHeadline, ringDash, SegmentProgress, SELLER_STEPS, TimerRing, TradeStepper } from '../src/ui/Hero.js';
import { render } from './render.js';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/ui/hero.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
  if (m === null) throw new Error(`no rule "${selector}"`);
  return m[1]!.replace(/\s+/g, ' ');
}

describe('Hero (kit 4.1-4.2)', () => {
  it('14% wash to 140 (160 on results), 35% border, radius 16, padding 20', () => {
    expect(rule('.x2f-hero')).toContain('background: linear-gradient(180deg, color-mix(in srgb, var(--x2f-tone) 14%, var(--x2f-surface)) 0%, var(--x2f-surface) 140px);');
    expect(rule('.x2f-hero')).toContain('border: 1px solid color-mix(in srgb, var(--x2f-tone) 35%, transparent);');
    expect(rule('.x2f-hero')).toContain('border-radius: var(--x2f-radius-lg);');
    expect(rule(".x2f-hero[data-kind='result']")).toContain('var(--x2f-surface) 160px);');
  });

  it('a named section with the chip left and the key mark right (trade only)', () => {
    const { host } = render(
      <Hero tone="caution" label="Trade status" chip={<span data-chip>Pay now</span>} keyMark>
        <HeroNumber label="Time to pay" parts={remainingParts(89 * 60_000, 'minutes')} meaning="Pay within 89 min" />
      </Hero>,
    );
    const hero = host.querySelector('section[aria-label="Trade status"]')!;
    expect(hero.getAttribute('data-tone')).toBe('caution');
    const top = hero.querySelector('.x2f-hero__top')!;
    expect(top.firstElementChild!.hasAttribute('data-chip')).toBe(true);
    expect(top.lastElementChild!.getAttribute('class')).toBe('x2f-keymark');
    const { host: other } = render(<Hero tone="escrow" label="Setup" kind="other" chip={<span />} />);
    expect(other.querySelector('.x2f-keymark')).toBeNull();
  });

  it('every tone has a token, never orange', () => {
    for (const t of ['caution', 'escrow', 'danger', 'mod', 'neutral', 'team']) expect(css).toContain(`.x2f-hero[data-tone='${t}']`);
    expect(css).not.toMatch(/monero/);
  });
});

describe('HeroNumber, ResultHeadline (kit 4.3)', () => {
  it('a timer: mono 40/44 digits, body units, role=timer in words', () => {
    const { host } = render(<HeroNumber label="Time to fund" parts={remainingParts(1722_000, 'clock')} />);
    const n = host.querySelector('[role="timer"]')!;
    expect(n.textContent).toBe('28 min 42 s');
    expect(n.getAttribute('aria-label')).toBe('28 minutes 42 seconds');
    expect(rule('.x2f-hero-number .x2f-countdown__n')).toContain('font-size: var(--x2f-hero-number-size);');
    expect(rule('.x2f-hero-number .x2f-countdown__u')).toContain('font-size: 18px; line-height: 24px; font-weight: 600;');
    expect(rule('.x2f-hero-number')).toContain('gap: 6px;');
  });

  it('an amount and its unit; the meaning line has mono digits', () => {
    const { host } = render(<HeroNumber label="You receive" value="1.250000" unit="XMR" meaning="About $412.50 at 10:14" />);
    expect(host.querySelector('.x2f-hero-number')!.textContent).toBe('1.250000XMR');
    expect([...host.querySelectorAll('.x2f-hero__line .x2f-digits')].map((d) => d.textContent)).toEqual(['412.50', '10:14']);
  });

  it('the result headline uses the result-headline token, 40/44 wide', () => {
    const { host } = render(<ResultHeadline title="Refunded" lead="1.250000 XMR is back in your wallet." />);
    expect(host.querySelector('h1')!.textContent).toBe('Refunded');
    expect(host.querySelector('.x2f-hero__lead .x2f-digits')!.textContent).toBe('1.250000');
    expect(rule('.x2f-hero__headline')).toContain('font-size: var(--x2f-result-headline-size);');
  });
});

describe('TimerRing and SegmentProgress (kit 4.4)', () => {
  it('ring: 169.6 × remaining / total, labelled in words', () => {
    expect(ringDash(89, 90)).toBe(167.7);
    expect(ringDash(0, 90)).toBe(0);
    expect(ringDash(120, 90)).toBe(169.6);
    expect(ringDash(5, 0)).toBe(0);
    const { host } = render(<TimerRing remaining={89} total={90} label="89 of 90 minutes left to pay" />);
    const svg = host.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute('aria-label')).toBe('89 of 90 minutes left to pay');
    expect(svg.querySelectorAll('circle')[1]!.getAttribute('stroke-dasharray')).toBe('167.7 169.6');
  });

  it('ring not started: dotted, with clock hands', () => {
    const { host } = render(<TimerRing remaining={90} total={90} label="90 of 90 minutes left, not started" notStarted />);
    expect(host.querySelectorAll('circle')[1]!.getAttribute('stroke-dasharray')).toBe('2 6.48');
    expect(host.querySelector('path')!.getAttribute('d')).toBe('M32 22v10l6 4');
  });

  it('segments: a progressbar of ten pills, done in the tone', () => {
    const { host } = render(<SegmentProgress done={3} label="Confirmations" />);
    const bar = host.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(bar.querySelectorAll('[data-done="true"]')).toHaveLength(3);
    expect(bar.children).toHaveLength(10);
    expect(rule('.x2f-segments')).toContain('gap: 3px; height: 8px;');
    const { host: over } = render(<SegmentProgress done={14} label="Confirmations" />);
    expect(over.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('10');
  });
});

describe('KeyMark (kit 5)', () => {
  it('hero 62×14 or small 32×8, in the state tone, aria-hidden', () => {
    const { host } = render(
      <>
        <KeyMark tone="caution" />
        <KeyTile tone="escrow" />
      </>,
    );
    const [hero, small] = [...host.querySelectorAll('svg')];
    expect([hero!.getAttribute('width'), hero!.getAttribute('height')]).toEqual(['62', '14']);
    expect([small!.getAttribute('width'), small!.getAttribute('height')]).toEqual(['32', '8']);
    expect(hero!.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.x2f-keytile')!.getAttribute('aria-hidden')).toBe('true');
    expect(rule('.x2f-keytile')).toContain('width: 40px; height: 40px;');
    expect(hero!.querySelectorAll('circle[fill="currentColor"]')).toHaveLength(2);
  });
});

describe('TradeStepper (kit 6)', () => {
  it('done escrow, current a partial fill in the tone with a 600 ink label and aria-current, upcoming empty', () => {
    const { host } = render(<TradeStepper steps={BUYER_STEPS} current={1} progress={2} />);
    const steps = [...host.querySelectorAll('ol[aria-label="Trade progress"] > li')];
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(steps.map((s) => s.getAttribute('aria-current'))).toEqual([null, 'step', null, null]);
    const fills = steps.map((s) => (s.querySelector('.x2f-stepper__fill') as HTMLElement).style.width);
    expect(fills).toEqual(['100%', '2%', '0%', '0%']);
    expect(steps[1]!.querySelector('.x2f-stepper__fill')!.getAttribute('data-tone')).toBe('caution');
    expect(steps.map((s) => s.textContent)).toEqual(['Escrow, done', 'You pay', 'Seller checks, upcoming', 'Released, upcoming']);
    expect(rule(".x2f-stepper__step[data-state='current'] .x2f-stepper__label")).toBe(' color: var(--x2f-ink); font-weight: 600; ');
    expect(rule('.x2f-stepper__fill')).toContain('background: var(--x2f-escrow);');
  });

  it('a dispute is danger; the seller has its own labels; progress is clamped', () => {
    const { host } = render(<TradeStepper steps={SELLER_STEPS} current={0} progress={130} tone="danger" />);
    const fill = host.querySelector('.x2f-stepper__fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(fill.getAttribute('data-tone')).toBe('danger');
    expect(host.textContent).toContain('Buyer pays');
  });
});
