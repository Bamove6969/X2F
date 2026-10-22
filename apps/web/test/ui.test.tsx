// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { Amount } from '../src/ui/Amount.js';
import { BadgePill } from '../src/ui/BadgePill.js';
import { BottomNav } from '../src/ui/BottomNav.js';
import { Button } from '../src/ui/Button.js';
import { Countdown, formatRemaining } from '../src/ui/Countdown.js';
import { DesktopShell } from '../src/ui/DesktopShell.js';
import { EscrowDots } from '../src/ui/EscrowDots.js';
import { ExternalLink } from '../src/ui/ExternalLink.js';
import { MethodExplainer } from '../src/ui/MethodExplainer.js';
import { ModeratorBadge } from '../src/ui/ModeratorBadge.js';
import { Sheet } from '../src/ui/Sheet.js';
import { StatusChip } from '../src/ui/StatusChip.js';
import { TradeHeader } from '../src/ui/TradeHeader.js';
import { advance, fire, key, render } from './render.js';

const ZELLE = {
  name: 'Zelle',
  whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.',
};

describe('Button', () => {
  it('primary renders the orange fill and data-primary', () => {
    const { host } = render(<Button variant="primary">I've paid</Button>);
    const b = host.querySelector('button')!;
    expect(b.hasAttribute('data-primary')).toBe(true);
    expect(b.className).toContain('x2f-button--primary');
    expect(b.type).toBe('button');
  });

  it('other variants are never primary', () => {
    for (const variant of ['secondary', 'quiet', 'danger'] as const) {
      const { host } = render(<Button variant={variant}>Cancel trade</Button>);
      const b = host.querySelectorAll('button');
      expect(b[b.length - 1]!.hasAttribute('data-primary')).toBe(false);
    }
  });

  it('with href it renders a link styled the same way', () => {
    const { host } = render(
      <Button variant="primary" href="monero:4abc">
        Open in Cake Wallet
      </Button>,
    );
    const a = host.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('monero:4abc');
    expect(a.hasAttribute('data-primary')).toBe(true);
  });
});

describe('StatusChip', () => {
  it('renders tone, icon and the label', () => {
    const { host } = render(<StatusChip tone="caution" icon="clock" label="Waiting for you to fund" />);
    const chip = host.firstElementChild as HTMLElement;
    expect(chip.dataset.tone).toBe('caution');
    expect(chip.querySelector('svg')).not.toBeNull();
    expect(chip.textContent).toBe('Waiting for you to fund');
  });

  it('is a type error without a label', () => {
    // @ts-expect-error label is required: state colours always come with a word.
    const el = <StatusChip tone="escrow" icon="shield-check" />;
    expect(el).toBeTruthy();
  });

  it('is a type error with an unknown tone', () => {
    // @ts-expect-error only caution, escrow and danger exist.
    const el = <StatusChip tone="monero" icon="clock" label="x" />;
    expect(el).toBeTruthy();
  });
});

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders data-mask=clock and counts down on the server clock, not the device clock', () => {
    // The server is 10 minutes ahead of the phone (Review Focus 3).
    const skew = 10 * 60_000;
    const serverClock = () => new Date(Date.now() + skew);
    const deadline = new Date(Date.now() + skew + (28 * 60 + 42) * 1000);
    const { host } = render(<Countdown deadline={deadline} serverClock={serverClock} />);
    const el = host.querySelector('[data-mask="clock"]')!;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('28:42');
    advance(1000, vi);
    expect(el.textContent).toBe('28:41');
  });

  it('stops at zero', () => {
    const now = () => new Date();
    const { host } = render(<Countdown deadline={new Date(Date.now() + 2000)} serverClock={now} />);
    advance(5000, vi);
    expect(host.textContent).toBe('0:00');
  });

  it('formats', () => {
    expect(formatRemaining(0, 'clock')).toBe('0:00');
    expect(formatRemaining(1722_000, 'clock')).toBe('28:42');
    expect(formatRemaining(3909_000, 'clock')).toBe('1:05:09');
    expect(formatRemaining(90 * 60_000, 'minutes')).toBe('1 h 30 min');
    expect(formatRemaining(62 * 60_000, 'minutes')).toBe('1 h 2 min');
    expect(formatRemaining((60 + 52) * 60_000, 'minutes')).toBe('1 h 52 min');
    expect(formatRemaining(14 * 60_000, 'minutes')).toBe('14 min');
    expect(formatRemaining(13 * 60_000 + 1, 'minutes')).toBe('14 min');
    expect(formatRemaining(60 * 60_000, 'minutes')).toBe('1 h');
    expect(formatRemaining(-5, 'minutes')).toBe('0 min');
  });
});

describe('Amount', () => {
  it('shows XMR with its unit and the fiat beside it', () => {
    const { host } = render(<Amount xmr="1.250000" fiat="$412.50" />);
    expect(host.textContent).toBe('1.250000 XMR$412.50');
    expect(host.querySelector('[data-part="unit"]')!.textContent).toBe('XMR');
    expect(host.querySelector('[data-part="fiat"]')!.textContent).toBe('$412.50');
  });

  it('refuses an XMR amount without 6 decimals', () => {
    expect(() => render(<Amount xmr="1.25" />)).toThrow();
  });
});

describe('TradeHeader and MethodExplainer', () => {
  it('tapping the method name opens the explainer with whatItIs', () => {
    const { host } = render(
      <MemoryRouter>
        <TradeHeader title="Selling to mira.k" code="K7M2-9QXA-4FTR-8WPN" method={ZELLE} backTo="/sell" />
      </MemoryRouter>,
    );
    expect(host.textContent).toContain('Selling to mira.k');
    expect(host.textContent).toContain('Trade K7M2-9QXA-4FTR-8WPN · Zelle');
    expect(document.body.textContent).not.toContain(ZELLE.whatItIs);
    const methodButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Zelle')!;
    expect(methodButton.getAttribute('aria-haspopup')).toBe('dialog');
    fire(methodButton, new MouseEvent('click', { bubbles: true }));
    const dialog = document.querySelector('[role="dialog"], dialog')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain(ZELLE.whatItIs);
    expect(dialog.textContent).toContain('Zelle');
  });

  it('has the back link with its board label', () => {
    const { host } = render(
      <MemoryRouter>
        <TradeHeader title="Buying from satoshi_ghost" code="K7M2-9QXA-4FTR-8WPN" method={ZELLE} backTo="/buy" />
      </MemoryRouter>,
    );
    const back = host.querySelector('a[aria-label="Back to trades"]')!;
    expect(back.getAttribute('href')).toBe('/buy');
  });

  it('the explainer closes', () => {
    const onClose = vi.fn();
    render(<MethodExplainer open name={ZELLE.name} whatItIs={ZELLE.whatItIs} onClose={onClose} />);
    const close = document.querySelector('button[aria-label="Close"]')!;
    fire(close, new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(
      <Sheet open={false} title="Title" onClose={() => undefined}>
        Body
      </Sheet>,
    );
    expect(document.body.textContent).not.toContain('Body');
  });

  it('is a labelled modal dialog that closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="Sheet title" onClose={onClose}>
        Sheet body
      </Sheet>,
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)!.textContent).toBe('Sheet title');
    expect(dialog.textContent).toContain('Sheet body');
    key(dialog, 'keydown', 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is tapped', () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="T" onClose={onClose}>
        B
      </Sheet>,
    );
    const backdrop = document.querySelector('[data-part="backdrop"]')!;
    fire(backdrop, new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the dialog when it opens', () => {
    render(
      <Sheet open title="T" onClose={() => undefined}>
        B
      </Sheet>,
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
  });

  it('keeps Tab inside: last wraps to first, Shift+Tab from the dialog or the first wraps to last', () => {
    render(
      <Sheet open title="T" onClose={() => undefined}>
        <button type="button">A</button>
        <button type="button">B</button>
      </Sheet>,
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = dialog.querySelector<HTMLElement>('button[aria-label="Close"]')!;
    const last = [...dialog.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'B')!;
    const tab = (shift: boolean) =>
      fire(document.activeElement!, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab', shiftKey: shift }));

    expect(document.activeElement).toBe(dialog);
    tab(true);
    expect(document.activeElement).toBe(last);
    tab(false);
    expect(document.activeElement).toBe(close);
    tab(true);
    expect(document.activeElement).toBe(last);
  });

  it('returns focus to the opener when it closes', () => {
    const { host } = render(
      <MemoryRouter>
        <TradeHeader title="Selling to mira.k" code="K7M2-9QXA-4FTR-8WPN" method={ZELLE} backTo="/sell" />
      </MemoryRouter>,
    );
    const methodButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Zelle')!;
    methodButton.focus();
    fire(methodButton, new MouseEvent('click', { bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
    fire(document.querySelector('button[aria-label="Close"]')!, new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(methodButton);
  });
});

describe('BadgePill', () => {
  it('renders an icon and a word in its tone', () => {
    const { host } = render(<BadgePill tone="escrow" icon="shield-check" label="Trusted" />);
    const pill = host.firstElementChild as HTMLElement;
    expect(pill.dataset.tone).toBe('escrow');
    expect(pill.querySelector('svg')).not.toBeNull();
    expect(pill.textContent).toBe('Trusted');
  });
});

describe('EscrowDots', () => {
  it('draws three dots, filling the ones asked for', () => {
    const { host } = render(<EscrowDots filled={[true, true, false]} tone="escrow" />);
    const dots = host.querySelectorAll('[data-dot]');
    expect(dots).toHaveLength(3);
    expect([...dots].map((d) => (d as HTMLElement).dataset.dot)).toEqual(['filled', 'filled', 'empty']);
    expect((host.firstElementChild as HTMLElement).dataset.tone).toBe('escrow');
    expect(host.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ModeratorBadge', () => {
  it('shows the violet shield and "X2F Moderator"', () => {
    const { host } = render(<ModeratorBadge />);
    const badge = host.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe('X2F Moderator');
    expect(badge.className).toContain('x2f-moderator-badge');
    expect(badge.querySelector('svg')).not.toBeNull();
  });
});

describe('ExternalLink', () => {
  it('always sets rel="noreferrer noopener" and target="_blank"', () => {
    const { host } = render(<ExternalLink href="https://example.org/tx/abc">View on explorer</ExternalLink>);
    const a = host.querySelector('a')!;
    expect(a.getAttribute('rel')).toBe('noreferrer noopener');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('href')).toBe('https://example.org/tx/abc');
  });

  it('cannot be given another rel or target', () => {
    // @ts-expect-error rel is fixed.
    const el = <ExternalLink href="https://example.org" rel="opener">x</ExternalLink>;
    expect(el).toBeTruthy();
  });

  it('refuses links that are not https', () => {
    expect(() => render(<ExternalLink href="javascript:alert(1)">x</ExternalLink>)).toThrow();
  });
});

describe('BottomNav', () => {
  it('has the board tabs with Trade current on /sell', () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/sell']}>
        <BottomNav />
      </MemoryRouter>,
    );
    const nav = host.querySelector('nav[aria-label="Main"]')!;
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual(['Trade', 'Post offer', 'Wallets', 'Profile']);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    expect(links.slice(1).every((a) => !a.hasAttribute('aria-current'))).toBe(true);
  });

  it('Trade is current on /buy too; Wallets on /wallets', () => {
    for (const [path, current] of [
      ['/buy', 'Trade'],
      ['/wallets', 'Wallets'],
      ['/post', 'Post offer'],
    ] as const) {
      const { host } = render(
        <MemoryRouter initialEntries={[path]}>
          <BottomNav />
        </MemoryRouter>,
      );
      const cur = host.querySelector('a[aria-current="page"]')!;
      expect(cur.textContent).toBe(current);
    }
  });
});

describe('DesktopShell', () => {
  it('has the board header and nav, and renders its children', () => {
    const { host } = render(
      <MemoryRouter initialEntries={['/trade/K7M29QXA4FTR8WPN']}>
        <DesktopShell>
          <p>room</p>
        </DesktopShell>
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-shell="desktop"]')).not.toBeNull();
    const nav = host.querySelector('nav[aria-label="Main"]')!;
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Buy', 'Sell', 'My trades', 'Wallets']);
    expect(nav.querySelector('a[aria-current="page"]')!.textContent).toBe('My trades');
    expect(host.textContent).toContain('X2F');
    expect(host.textContent).toContain('room');
  });
});
