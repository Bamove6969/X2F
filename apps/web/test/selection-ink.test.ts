// Design review 1 Nov 2026, X1 / top-10 item 5, and the design conventions (2 Nov): selection is
// never orange. Selected tiles, chips, radio cards and segments take a 2 px ink border on the
// raised surface; checkboxes and radios take ink. Orange (--x2f-monero, --x2f-monero-ink) is kept
// for the one primary action per screen, links, the XMR unit label and the release hold.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? cssFiles(p) : n.endsWith('.css') ? [p] : [];
  });
}

interface Rule {
  file: string;
  selector: string;
  body: string;
}

/** Innermost rules (a selector and a body with no braces), so rules inside @media are found too. */
function rules(): Rule[] {
  const out: Rule[] = [];
  for (const f of cssFiles(SRC)) {
    const file = relative(SRC, f);
    if (file === 'theme/tokens.css') continue;
    const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      out.push({ file, selector: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! });
    }
  }
  return out;
}

/** A selector for a chosen, checked, pressed or current state. */
const SELECTED = /\[aria-(checked|selected|pressed|current)|:checked|\[data-on|__on\b|--on\b/;
const ACCENT = /var\(--x2f-monero(-ink|-ink-hover)?\)/;

/**
 * Selected states that stay orange for now because the screen is owned by another branch
 * (C2-D2 brief: the dispute screens are claude3's; the tab bar went ink on main with My offers.)
 */
// Design build review 7 Nov: the dispute reason radio is ink now; nothing is owned elsewhere.
const OWNED_ELSEWHERE: string[] = [];

/**
 * Selected states the owner asked to be orange. Owner, 8 Nov 2026 (Post an offer, the range boxes'
 * XMR / currency switch): "selected unit bold bright orange, the other smaller and muted".
 */
const OWNER_RULED: string[] = ["screens/post/PostOffer.css .post-unit button[aria-checked='true']"];

/** Every orange use that is not a selected state: one primary action, links, the XMR unit, the hold. */
const ORANGE_ALLOWED = [
  // The one primary action per screen and the press-and-hold release button.
  'ui/ui.css .x2f-button--primary',
  'ui/ui.css .x2f-hold',
  'ui/ui.css .x2f-hold:not(:disabled):hover',
  // Links and text buttons (boards: a { color: var(--monero-ink) }).
  'ui/ui.css .x2f-link',
  'ui/ui.css .x2f-link:hover',
  'screens/browse/browse.css .x2f-text-button',
  'screens/browse/browse.css .x2f-text-button:hover',
  'screens/setup/setup.css .x2f-start__textbutton',
  'screens/setup/setup.css .x2f-start__textbutton:hover',
  // Sign-up v2: the PGP code step's "X2F's signing key" download is a link.
  'screens/setup/setup.css .x2f-start__signing-link',
  'screens/quote/quote.css .x2f-quote__switch, .x2f-quote__max',
  'screens/quote/quote.css .x2f-quote__add',
  'screens/dispute/dispute.css .dispute-retry',
  // "Show all N" / "Show less" on "What applies to you" (j31a, BuyQuote / SellQuote boards: --monero-ink).
  'screens/quote/quote.css .x2f-wa__toggle',
  // The XMR unit label (tokens.json monero-ink usage; BuyQuote board).
  'ui/ui.css .x2f-amount__unit',
  'ui/ui.css .x2f-xmr__unit',
  'ui/kit.css .x2f-recipient__unit',
  'screens/quote/quote.css .x2f-quote__xmr-unit',
  'screens/trade/warn.css .x2f-warn__xmr',
  // Logo D's dot (docs/brand/svg on wip/design-brief: the dot is #ff6600 in every colour variant).
  'ui/ui.css .x2f-logo__dot',
  // The ad card's range rows (BuyOffers / SellOffers boards v142).
  "screens/browse/browse.css .x2f-offer__unit[data-unit='xmr']",
  'screens/quote/quote.css .x2f-quote__band-xmr-unit',
  // The welcome letter intro's ring round Logo D's dot (design 12 Nov, tour-motion.md).
  'screens/welcome/welcome.css .x2f-mark__ring',
  // The first-trade tour's pretend screens (design 12 Nov, tour-stops.md): each screen's one primary
  // action and the release hold, as on the real screens, and the QR scan line of the intro prototype.
  'tour/stage.css .x2f-ex__button, .x2f-ex__hold',
  'tour/stage.css .x2f-ex__scan',
];

describe('selection is ink, never orange', () => {
  it('no selected-state rule uses the orange accent', () => {
    const orange = rules()
      .filter((r) => SELECTED.test(r.selector) && ACCENT.test(r.body))
      .map((r) => `${r.file} ${r.selector}`);
    expect(orange.sort()).toEqual([...OWNED_ELSEWHERE, ...OWNER_RULED].sort());
  });

  it('every checkbox and radio accent is ink', () => {
    const accents = rules().flatMap((r) =>
      [...r.body.matchAll(/accent-color:\s*([^;]+)/g)].map((m) => `${r.file} ${r.selector}: ${m[1]!.trim()}`),
    );
    expect(accents.filter((a) => !a.endsWith(': var(--x2f-ink)'))).toEqual([]);
    expect(accents).toContain("theme/base.css input[type='checkbox'], input[type='radio']: var(--x2f-ink)");
  });

  it('orange is only on the primary action, links, the XMR unit and the release hold', () => {
    const uses = rules()
      .filter((r) => ACCENT.test(r.body) && !OWNED_ELSEWHERE.includes(`${r.file} ${r.selector}`) && !OWNER_RULED.includes(`${r.file} ${r.selector}`))
      .map((r) => `${r.file} ${r.selector}`);
    expect([...new Set(uses)].sort()).toEqual([...ORANGE_ALLOWED].sort());
  });

  it('the input focus ring is ink, like every other focus ring', () => {
    const rings = rules()
      .filter((r) => r.selector.includes(':focus') && /outline:/.test(r.body) && ACCENT.test(r.body));
    expect(rings.map((r) => `${r.file} ${r.selector}`)).toEqual([]);
  });
});
