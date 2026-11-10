// @vitest-environment happy-dom
// D-016 (build spec j33a section 6): the AccountFrozen notice, new. Its words, its one primary, and
// the route that waits for the API's frozen state (NEEDS_API_FROZEN_STATE).
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountFrozen, AccountFrozenRoute, FROZEN_PATH, setFrozenSource, type FrozenState } from '../src/screens/account/AccountFrozen.js';
import { fire, render } from './render.js';

const STATE: FrozenState = {
  since: '2026-11-09T10:12:00.000Z',
  dispute: { code: '7F3A-9C21-4FTR-8WPN', incidentId: 'K7QM4T2X9', side: 'selling', amountAtomic: '500000000000', counterparty: 'nightowl_44' },
};

function Where() {
  return <output data-where={useLocation().pathname} />;
}

function mount(node: React.ReactNode, at = '/x') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/x" element={node} />
        <Route path={FROZEN_PATH} element={<AccountFrozenRoute />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => setFrozenSource(null));

describe('AccountFrozen (D-016)', () => {
  it("the caution hero: chip, title, lead and the facts, in the board's words", () => {
    const { host } = mount(<AccountFrozen state={STATE} />);
    const hero = host.querySelector('section.x2f-hero')!;
    expect(hero.getAttribute('data-tone')).toBe('caution');
    expect(hero.querySelector('.x2f-chip')?.textContent).toBe('Trading frozen');
    expect(host.querySelector('h1')?.textContent).toBe('A moderator froze trading on your account');
    expect(hero.textContent).toContain('Open your dispute to see what you need to do to get it back.');
    const facts = [...hero.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt')?.textContent, d.querySelector('dd')?.textContent]);
    expect(facts).toEqual([
      ['Frozen since', '9 Nov 2026, 10:12 UTC'],
      ['Ends', 'When a moderator lifts it'],
      ['Dispute', '#K7QM4T2X9 · Selling 0.500000 XMR to nightowl_44'],
    ]);
    expect(hero.querySelector('[data-username]')?.textContent).toBe('nightowl_44');
  });

  it('what still works, and what is paused until it is lifted', () => {
    const { host } = mount(<AccountFrozen state={STATE} />);
    const list = (h: string) => [...[...host.querySelectorAll('h2')].find((x) => x.textContent === h)!.parentElement!.querySelectorAll('li')].map((l) => l.textContent);
    expect(list('What still works')).toEqual([
      'You can log in and use your wallets.',
      "You can chat in your dispute. When you've done what the moderator asks, tell them there and they'll check and lift the freeze.",
      'Trades you already started carry on.',
      "Your XMR isn't affected. Your wallet keys are on your device, so no one can freeze your coins.",
    ]);
    expect(list("Paused until it's lifted")).toEqual(['Starting or joining new trades.', 'Posting offers. Your offers are hidden for now.']);
  });

  it('"Go to your dispute" is the one primary and opens the dispute; Not now and Close go home', () => {
    const { host } = mount(<AccountFrozen state={STATE} />);
    const primary = host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    expect(primary[0]!.textContent).toBe('Go to your dispute');
    expect(primary[0]!.getAttribute('href')).toBe('/trade/7F3A-9C21-4FTR-8WPN/dispute');
    expect(host.querySelector('a[aria-label="Close"]')?.getAttribute('href')).toBe('/');
    fire([...host.querySelectorAll('a, button')].find((b) => b.textContent === 'Not now')!, new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(host.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/');
  });

  it("the incident ID is the dispute's, as the API gives it (G37), never derived from the trade code; none given, none shown", () => {
    const { host } = mount(<AccountFrozen state={STATE} />);
    const dd = () => [...host.querySelectorAll('dl > div')].find((d) => d.querySelector('dt')?.textContent === 'Dispute')!.querySelector('dd')!;
    expect(dd().querySelector('.x2f-frozen__mono')?.textContent).toBe('#K7QM4T2X9');
    expect(dd().textContent).not.toContain('7F3A');
    const none = mount(<AccountFrozen state={{ ...STATE, dispute: { ...STATE.dispute, incidentId: null } }} />);
    const noneDd = [...none.host.querySelectorAll('dl > div')].find((d) => d.querySelector('dt')?.textContent === 'Dispute')!.querySelector('dd')!;
    expect(noneDd.textContent).toBe('Selling 0.500000 XMR to nightowl_44');
    expect(noneDd.textContent).not.toContain('#');
  });

  it('the route shows the frozen state its source gives, and goes home while there is none (NEEDS_API_FROZEN_STATE)', () => {
    const none = mount(<Where />, FROZEN_PATH);
    expect(none.host.querySelector('[data-where]')?.getAttribute('data-where')).toBe('/');
    none.unmount();
    setFrozenSource(() => STATE);
    const { host } = mount(<Where />, FROZEN_PATH);
    expect(host.querySelector('h1')?.textContent).toBe('A moderator froze trading on your account');
  });
});
