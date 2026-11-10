// @vitest-environment happy-dom
// Plan 4 Task 8: the owner's banner (info teal, warning amber, each with an icon and its kind word),
// the Maintenance screen, GET /v1/site's parsing, and the API client's maintenance signal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setMaintenanceListener } from '../src/api/client.js';
import { SITE_OFF, parseSite } from '../src/api/site.js';
import { MAINTENANCE_COPY, Maintenance } from '../src/screens/Maintenance.js';
import { PlannedMaintenanceBanner, PLANNED_COPY } from '../src/ui/PlannedMaintenanceBanner.js';
import { SiteBanner } from '../src/ui/SiteBanner.js';
import { fire, render } from './render.js';

const T0 = '2026-11-09T12:00:00.000Z';

afterEach(() => {
  vi.unstubAllGlobals();
  setMaintenanceListener(null);
});

describe('SiteBanner', () => {
  it('renders the text and the kind\'s icon, with the kind on the box; no title (design 7 Nov)', () => {
    for (const kind of ['info', 'warning'] as const) {
      const { host, unmount } = render(<SiteBanner banner={{ text: 'Matrix is down until 14:00 UTC.', kind }} />);
      const box = host.querySelector('[data-part="site-banner"]')!;
      expect(box.getAttribute('data-kind')).toBe(kind);
      expect(box.textContent).not.toMatch(/^(Info|Warning)/);
      expect(box.textContent).toContain('Matrix is down until 14:00 UTC.');
      expect(box.querySelector('svg')).not.toBeNull();
      expect(box.querySelector('.x2f-outcome')!.getAttribute('data-tone')).toBe(kind === 'warning' ? 'caution' : 'plain');
      unmount();
    }
  });

  it('renders nothing without a banner', () => {
    const { host } = render(<SiteBanner banner={null} />);
    expect(host.innerHTML).toBe('');
  });
});

describe('Maintenance', () => {
  it("shows the owner's message and one primary button that checks again; it promises nothing about timers (lead review 7 Nov)", () => {
    const retry = vi.fn();
    const { host } = render(<Maintenance maintenance={{ message: 'Upgrading.\nBack by 14:00 UTC.', kind: 'planned', since: T0, backBy: null }} onRetry={retry} />);
    expect(host.querySelector('h1')!.textContent).toBe(MAINTENANCE_COPY.title);
    expect(host.querySelector('[data-part="maintenance-message"]')!.textContent).toBe('Upgrading.\nBack by 14:00 UTC.');
    expect(host.textContent).not.toMatch(/timers? (are )?paused/i);
    const primary = host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    fire(primary[0]!, new MouseEvent('click', { bubbles: true }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("falls back to the kind's text without a message; the chip reads Planned or Unplanned, never emergency (owner G19)", () => {
    for (const kind of ['planned', 'unplanned'] as const) {
      const { host, unmount } = render(<Maintenance maintenance={{ message: null, kind, since: T0, backBy: null }} onRetry={() => undefined} />);
      expect(host.querySelector('[data-part="maintenance-message"]')!.textContent).toBe(MAINTENANCE_COPY[kind]);
      expect(host.textContent).toContain(MAINTENANCE_COPY.chip[kind]);
      expect(host.textContent).not.toMatch(/emergency/i);
      expect(host.querySelector('[data-part="maintenance-back-by"]')).toBeNull();
      unmount();
    }
  });

  it('shows the message in the big bright banner, up to 500 characters (owner G19)', () => {
    const message = 'x'.repeat(500);
    const { host } = render(<Maintenance maintenance={{ message, kind: 'unplanned', since: T0, backBy: null }} onRetry={() => undefined} />);
    const box = host.querySelector('[data-part="maintenance-banner"]')!;
    expect(box.getAttribute('data-size')).toBe('big');
    expect(box.querySelector('[data-part="maintenance-message"]')!.textContent).toBe(message);
  });

  it('shows when it should be back: the best guess (unplanned) or the plan\'s end (planned), in UTC', () => {
    for (const kind of ['planned', 'unplanned'] as const) {
      const { host, unmount } = render(<Maintenance maintenance={{ message: null, kind, since: T0, backBy: '2026-11-09T14:30:00.000Z' }} onRetry={() => undefined} />);
      expect(host.querySelector('[data-part="maintenance-back-by"]')!.textContent).toBe(`${MAINTENANCE_COPY.backBy[kind]} 9 Nov 2026, 14:30 UTC`);
      unmount();
    }
  });
});

describe('PlannedMaintenanceBanner', () => {
  const plan = { startsAt: '2026-11-10T12:00:00.000Z', endsAt: '2026-11-10T14:00:00.000Z', message: 'Database upgrade.' };
  it('announces a planned maintenance ahead: its start, its end and the message, in the big bright banner (owner G19)', () => {
    const { host } = render(<PlannedMaintenanceBanner plan={plan} />);
    const box = host.querySelector('[data-part="planned-maintenance"]')!;
    expect(box.getAttribute('data-size')).toBe('big');
    expect(box.textContent).toContain(PLANNED_COPY.title);
    expect(box.querySelector('[data-part="planned-when"]')!.textContent).toBe(`${PLANNED_COPY.from} 10 Nov 2026, 12:00 UTC ${PLANNED_COPY.to} 10 Nov 2026, 14:00 UTC`);
    expect(box.querySelector('[data-part="planned-message"]')!.textContent).toBe('Database upgrade.');
  });

  it('without a message shows only the times; without a plan nothing', () => {
    const { host, unmount } = render(<PlannedMaintenanceBanner plan={{ ...plan, message: null }} />);
    expect(host.querySelector('[data-part="planned-message"]')).toBeNull();
    unmount();
    expect(render(<PlannedMaintenanceBanner plan={null} />).host.innerHTML).toBe('');
  });
});

describe('parseSite', () => {
  it('keeps well-formed parts only', () => {
    const raw = {
      banner: { text: 'Hi', kind: 'warning' },
      tradingPaused: true,
      maintenance: { message: 'Back soon', kind: 'planned', since: T0, backBy: '2026-11-09T14:00:00.000Z' },
      plannedMaintenance: null,
    };
    expect(parseSite(raw)).toEqual({
      banner: { text: 'Hi', kind: 'warning' }, tradingPaused: true,
      maintenance: { message: 'Back soon', kind: 'planned', since: T0, backBy: '2026-11-09T14:00:00.000Z' },
      plannedMaintenance: null,
    });
    expect(parseSite(null)).toEqual(SITE_OFF);
    expect(parseSite({ banner: { text: 'Hi', kind: 'danger' }, tradingPaused: 'yes', maintenance: null })).toEqual(SITE_OFF);
  });

  it('never reads a maintenance as emergency: an unknown or missing kind is unplanned (owner G19)', () => {
    for (const kind of ['emergency', undefined, 5])
      expect(parseSite({ maintenance: { message: 5, kind, since: 'x', backBy: 'soon' } }).maintenance).toEqual({ message: null, kind: 'unplanned', since: null, backBy: null });
    expect(parseSite({ maintenance: { kind: 'unplanned' } }).maintenance!.kind).toBe('unplanned');
  });

  it('keeps an announced plan only with a valid start and end', () => {
    const plan = { startsAt: '2026-11-10T12:00:00.000Z', endsAt: '2026-11-10T14:00:00.000Z', message: 'Upgrade.' };
    expect(parseSite({ plannedMaintenance: plan }).plannedMaintenance).toEqual(plan);
    expect(parseSite({ plannedMaintenance: { ...plan, message: '' } }).plannedMaintenance).toEqual({ ...plan, message: null });
    expect(parseSite({ plannedMaintenance: { ...plan, startsAt: 'soon' } }).plannedMaintenance).toBeNull();
    expect(parseSite({ plannedMaintenance: { ...plan, endsAt: undefined } }).plannedMaintenance).toBeNull();
  });
});

describe('api() and maintenance', () => {
  it('tells the shell when a call answers 503 maintenance, and still throws', async () => {
    const heard = vi.fn();
    setMaintenanceListener(heard);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'maintenance' }), { status: 503 })));
    await expect(api('/v1/offers')).rejects.toMatchObject({ status: 503, code: 'maintenance' });
    expect(heard).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'internal' }), { status: 500 })));
    await expect(api('/v1/offers')).rejects.toMatchObject({ status: 500 });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
