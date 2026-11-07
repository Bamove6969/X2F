// @vitest-environment happy-dom
// Plan 4 Task 8: the owner's banner (info teal, warning amber, each with an icon and its kind word),
// the Maintenance screen, GET /v1/site's parsing, and the API client's maintenance signal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setMaintenanceListener } from '../src/api/client.js';
import { SITE_OFF, parseSite } from '../src/api/site.js';
import { MAINTENANCE_COPY, Maintenance } from '../src/screens/Maintenance.js';
import { SiteBanner } from '../src/ui/SiteBanner.js';
import { fire, render } from './render.js';

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
  it("shows the owner's message, the paused-timers line and one primary button that checks again", () => {
    const retry = vi.fn();
    const { host } = render(<Maintenance maintenance={{ message: 'Upgrading.\nBack by 14:00 UTC.', kind: 'planned' }} onRetry={retry} />);
    expect(host.querySelector('h1')!.textContent).toBe(MAINTENANCE_COPY.title);
    expect(host.querySelector('[data-part="maintenance-message"]')!.textContent).toBe('Upgrading.\nBack by 14:00 UTC.');
    expect(host.textContent).toContain(MAINTENANCE_COPY.timers);
    const primary = host.querySelectorAll('[data-primary]');
    expect(primary).toHaveLength(1);
    fire(primary[0]!, new MouseEvent('click', { bubbles: true }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("falls back to the kind's text without a message", () => {
    for (const kind of ['planned', 'emergency'] as const) {
      const { host, unmount } = render(<Maintenance maintenance={{ message: null, kind }} onRetry={() => undefined} />);
      expect(host.querySelector('[data-part="maintenance-message"]')!.textContent).toBe(MAINTENANCE_COPY[kind]);
      unmount();
    }
  });
});

describe('parseSite', () => {
  it('keeps well-formed parts only', () => {
    expect(parseSite({ banner: { text: 'Hi', kind: 'warning' }, tradingPaused: true, maintenance: { message: 'Back soon', kind: 'planned' } })).toEqual({
      banner: { text: 'Hi', kind: 'warning' }, tradingPaused: true, maintenance: { message: 'Back soon', kind: 'planned' },
    });
    expect(parseSite(null)).toEqual(SITE_OFF);
    expect(parseSite({ banner: { text: 'Hi', kind: 'danger' }, tradingPaused: 'yes', maintenance: null })).toEqual(SITE_OFF);
    expect(parseSite({ maintenance: { message: 5 } }).maintenance).toEqual({ message: null, kind: 'emergency' });
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
