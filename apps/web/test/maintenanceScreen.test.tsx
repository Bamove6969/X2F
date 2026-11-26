// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MAINTENANCE_COPY, Maintenance } from '../src/screens/Maintenance.js';
import { fire, render } from './render.js';

describe('Maintenance screen', () => {
  it('renders planned maintenance with default message and no backBy date', () => {
    const onRetry = vi.fn();
    const { host } = render(
      <Maintenance
        maintenance={{
          kind: 'planned',
          since: null,
          message: null,
          backBy: null,
        }}
        onRetry={onRetry}
      />,
    );

    const main = host.querySelector('main[data-screen="maintenance"]');
    expect(main).not.toBeNull();

    // Chip
    const chip = host.querySelector('.x2f-chip');
    expect(chip?.textContent).toBe(MAINTENANCE_COPY.chip.planned);

    // Title
    expect(host.querySelector('h1')?.textContent).toBe(MAINTENANCE_COPY.title);

    // Banner role status and default planned message
    const banner = host.querySelector('[data-part="maintenance-banner"]');
    expect(banner?.getAttribute('role')).toBe('status');

    const msg = host.querySelector('[data-part="maintenance-message"]');
    expect(msg?.textContent).toBe(MAINTENANCE_COPY.planned);

    // Back by should not be rendered
    expect(host.querySelector('[data-part="maintenance-back-by"]')).toBeNull();

    // From line
    expect(host.querySelector('[data-part="maintenance-from"]')?.textContent).toBe(MAINTENANCE_COPY.from);

    // Button
    const button = host.querySelector('button');
    expect(button?.textContent).toBe(MAINTENANCE_COPY.retry);
  });

  it('renders planned maintenance with custom message and backBy date', () => {
    const onRetry = vi.fn();
    const backBy = '2026-11-20T14:30:00.000Z';
    const { host } = render(
      <Maintenance
        maintenance={{
          kind: 'planned',
          since: null,
          message: 'Database upgrade in progress. Escrow timers are paused.',
          backBy,
        }}
        onRetry={onRetry}
      />,
    );

    const msg = host.querySelector('[data-part="maintenance-message"]');
    expect(msg?.textContent).toBe('Database upgrade in progress. Escrow timers are paused.');

    const backByEl = host.querySelector('[data-part="maintenance-back-by"]');
    expect(backByEl?.textContent).toContain('Back by 20 Nov 2026, 14:30 UTC');
  });

  it('renders unplanned maintenance with default message and best guess backBy', () => {
    const onRetry = vi.fn();
    const backBy = '2026-11-17T18:00:00.000Z';
    const { host } = render(
      <Maintenance
        maintenance={{
          kind: 'unplanned',
          since: null,
          message: null,
          backBy,
        }}
        onRetry={onRetry}
      />,
    );

    const chip = host.querySelector('.x2f-chip');
    expect(chip?.textContent).toBe(MAINTENANCE_COPY.chip.unplanned);

    const msg = host.querySelector('[data-part="maintenance-message"]');
    expect(msg?.textContent).toBe(MAINTENANCE_COPY.unplanned);

    const backByEl = host.querySelector('[data-part="maintenance-back-by"]');
    expect(backByEl?.textContent).toContain('Our best guess: back by 17 Nov 2026, 18:00 UTC');
  });

  it('calls onRetry callback when Check again button is clicked', () => {
    const onRetry = vi.fn();
    const { host } = render(
      <Maintenance
        maintenance={{
          kind: 'planned',
          since: null,
          message: null,
          backBy: null,
        }}
        onRetry={onRetry}
      />,
    );

    const button = host.querySelector('button')!;
    act(() => {
      fire(button, new MouseEvent('click', { bubbles: true }));
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
