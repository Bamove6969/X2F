// @vitest-environment happy-dom
// Design v2 batch 1 (wip/design-brief 4b355a56, docs/design-visual-system-v2.md): the LoginApprove
// boards' v2 look, applied through the UI kit (ui/*.tsx, ui/ui.css) and the design tokens. These
// check the kit hooks the screens use and the kit rules that carry the board's sizes, radii, type,
// chips and colours. Behaviour is unchanged (devicesBoards.test.tsx, loginApprove.test.tsx).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalView, ApprovalWait } from '@x2f/auth-client';
import { ApproveOnDevice } from '../src/screens/auth/ApproveOnDevice.js';
import { LoginApprove } from '../src/screens/auth/LoginApprove.js';
import { Notice } from '../src/ui/Notice.js';
import { StatusIcon } from '../src/ui/icons.js';
import { fire, render } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, '../src/ui/ui.css'), 'utf8');
const tokens = JSON.parse(readFileSync(join(HERE, '../../../design/design-system/tokens.json'), 'utf8')) as {
  spacing: { tokens: { name: string; value: string }[] };
  radius: { tokens: { name: string; value: string }[] };
  type: { groups: { styles: { name: string; fontSize: string; lineHeight: string; fontWeight: number; letterSpacing?: string }[] }[] };
};

/**
 * The declarations of the ui.css rule whose selector list is exactly `selector`, or else of the
 * first rule that lists it with others (the shared selection rule: ChoiceGroup, PickButton, SelectCard).
 */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m =
    css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`)) ??
    css.match(new RegExp(`(?:^|\\n)(?:[^{}\\n]*,\\n)*${esc}(?:,\\n[^{}\\n]*)* \\{([^}]*)\\}`));
  if (m === null) throw new Error(`no rule "${selector}" in ui.css`);
  return m[1]!.replace(/\s+/g, ' ');
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => json(404, { error: 'not-found' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const part = (host: ParentNode, p: string) => host.querySelector(`[data-part="${p}"]`);
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));

const VIEW: ApprovalView = {
  id: '22222222-2222-4222-8222-222222222222', deviceLabel: 'Chrome on Windows', choices: [31, 47, 86],
  createdAt: '2026-10-29T14:05:00.000Z', expiresAt: new Date(Date.now() + 299_000).toISOString(), atLimit: false, oneDevice: false, keysOffered: false,
};
const WAIT: ApprovalWait = {
  status: 'approve-on-device', approvalId: '11111111-1111-4111-8111-111111111111', number: 47,
  expiresAt: new Date(Date.now() + 299_000).toISOString(),
};

describe('design tokens: the v2 scale', () => {
  it('has the 16 px card radius, the 12/20/32 spacing steps, and the v2 title styles', () => {
    expect(tokens.radius.tokens).toContainEqual(expect.objectContaining({ name: 'radius-lg', value: '16px' }));
    for (const [name, value] of [['space-3', '12px'], ['space-5', '20px'], ['space-8', '32px']]) {
      expect(tokens.spacing.tokens).toContainEqual(expect.objectContaining({ name, value }));
    }
    const styles = tokens.type.groups.flatMap((g) => g.styles);
    // Owner #43 (12 Nov): the type scale one step up, so the v2 titles moved from 24/30 and 28/32 to
    // 26/32 and 30/34 (tokens.test.ts pins the same bump). Weight and tracking are unchanged.
    expect(styles).toContainEqual(expect.objectContaining({ name: 'sheet-title', fontSize: '26px', lineHeight: '32px', fontWeight: 700, letterSpacing: '-0.01em' }));
    expect(styles).toContainEqual(expect.objectContaining({ name: 'screen-title', fontSize: '30px', lineHeight: '34px', fontWeight: 700, letterSpacing: '-0.01em' }));
  });
});

describe('UI kit: v2 rules the LoginApprove boards use', () => {
  it('sheets: 16 px top corners, a 1px surface-raised top border, the 700 sheet title', () => {
    expect(rule('.x2f-sheet')).toContain('border-radius: var(--x2f-radius-lg) var(--x2f-radius-lg) 0 0;');
    expect(rule('.x2f-sheet')).toContain('border-top: 1px solid var(--x2f-surface-raised);');
    expect(rule('.x2f-sheet__title')).toContain('font-weight: var(--x2f-sheet-title-weight);');
    expect(rule('.x2f-sheet__title')).toContain('letter-spacing: var(--x2f-sheet-title-tracking);');
  });

  it('the sheet label is a caution status chip: 28 px pill, 14% caution wash', () => {
    const r = rule('.x2f-sheet__kicker');
    expect(r).toContain('height: 28px;');
    expect(r).toContain('border-radius: var(--x2f-radius-pill);');
    expect(r).toContain('background: color-mix(in srgb, var(--x2f-caution) 14%, transparent);');
    expect(r).toContain('color: var(--x2f-caution);');
  });

  it('danger confirm: 1px danger border on a 14% danger wash; disabled: a surface-raised fill', () => {
    expect(rule('.x2f-button--danger-outline')).toContain('border: 1px solid var(--x2f-danger);');
    expect(rule('.x2f-button--danger-outline')).toContain('background: color-mix(in srgb, var(--x2f-danger) 14%, transparent);');
    const d = rule(".x2f-button:disabled,\n.x2f-button[aria-disabled='true']");
    expect(d).toContain('border-color: transparent;');
    expect(d).toContain('background: var(--x2f-surface-raised);');
  });

  it('tertiary button: 44 px, muted, 15/600', () => {
    const r = rule('.x2f-button--tertiary');
    expect(r).toContain('height: 44px;');
    expect(r).toContain('color: var(--x2f-ink-muted);');
    expect(r).toContain('font-size: 15px;');
  });

  it('number tiles sit on surface-raised with no outline until picked (picked stays ink)', () => {
    const r = rule(".x2f-choice[data-look='tile']");
    expect(r).toContain('border-color: transparent;');
    expect(r).toContain('background: var(--x2f-surface-raised);');
    expect(rule(".x2f-choice[data-on='true']")).toContain('border-color: var(--x2f-ink);');
  });

  it('callouts: a 10% tone wash and a 30% tone border (the notice and the change-method box)', () => {
    // The kit's one Notice (main 5bfb450) carries the v2 callout on its caution tone.
    const n = rule(".x2f-outcome[data-tone='caution']");
    expect(n).toContain('background: color-mix(in srgb, var(--x2f-caution) 10%, var(--x2f-surface));');
    expect(n).toContain('border-color: color-mix(in srgb, var(--x2f-caution) 30%, transparent);');
    expect(n).toContain('padding: var(--x2f-space-3) 14px;');
    const r = rule(".x2f-panel[data-tone='caution']");
    expect(r).toContain('background: color-mix(in srgb, var(--x2f-caution) 10%, var(--x2f-surface));');
    expect(r).toContain('border: 1px solid color-mix(in srgb, var(--x2f-caution) 30%, transparent);');
    expect(r).toContain('padding: var(--x2f-space-3) 14px;');
  });

  it('state icons are 56 px tiles with a 14% tone wash', () => {
    const r = rule('.x2f-status-icon');
    expect(r).toContain('width: 56px;');
    expect(r).toContain('border-radius: var(--x2f-radius-lg);');
    expect(rule(".x2f-status-icon[data-icon-tone='escrow']")).toContain('background: color-mix(in srgb, var(--x2f-escrow) 14%, transparent);');
    expect(rule(".x2f-status-icon[data-icon-tone='danger']")).toContain('background: color-mix(in srgb, var(--x2f-danger) 14%, transparent);');
  });

  it('the facts block: rows 12 px tall-padded with surface dividers, 14 px inset', () => {
    expect(rule('.x2f-facts')).toContain('padding: 0 14px;');
    expect(rule('.x2f-facts > div + div')).toContain('border-top: 1px solid var(--x2f-surface);');
  });

  it('the number hero: a caution wash, a 35% caution border, 16 px corners', () => {
    const r = rule('.x2f-number-card');
    expect(r).toContain('border-radius: var(--x2f-radius-lg);');
    expect(r).toContain('linear-gradient(180deg, color-mix(in srgb, var(--x2f-caution) 14%, var(--x2f-surface)) 0%, var(--x2f-surface) 140px)');
    expect(r).toContain('border: 1px solid color-mix(in srgb, var(--x2f-caution) 35%, transparent);');
  });

  it('the outline card: transparent, 1px line, 16 px corners, 20 px padding', () => {
    const r = rule(".x2f-panel[data-tone='outline']");
    expect(r).toContain('border: 1px solid var(--x2f-line);');
    expect(r).toContain('border-radius: var(--x2f-radius-lg);');
    expect(r).toContain('padding: var(--x2f-space-5);');
  });

  it('the compact flow header has no bottom border and a 15/20 muted title; the footer sits on ground', () => {
    expect(rule(".x2f-flow[data-header='compact'] .x2f-flow__header")).toContain('border-bottom: 0;');
    expect(rule(".x2f-flow[data-header='compact'] .x2f-flow__title")).toContain('color: var(--x2f-ink-muted);');
    expect(rule('.x2f-flow__footer')).toContain('background: var(--x2f-ground);');
    expect(rule('.x2f-flow__footer')).toContain('padding: var(--x2f-space-4) var(--x2f-space-4) var(--x2f-space-2);');
  });

  it('colour, background and border changes ease over 150 ms, and not at all with reduced motion', () => {
    expect(css).toContain('transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.x2f-button,/);
  });
});

describe('kit parts', () => {
  it('Notice is a caution callout with the triangle icon', () => {
    const { host } = render(<Notice live="off" data-part="n">Careful.</Notice>);
    const p = part(host, 'n')!;
    expect(p.classList.contains('x2f-outcome')).toBe(true);
    expect(p.getAttribute('data-tone')).toBe('caution');
    expect(p.querySelector('svg path')?.getAttribute('d')).toBe('M12 3l9 16H3z');
    expect(p.querySelector('svg')?.getAttribute('stroke-width')).toBe('1.75');
  });

  it('StatusIcon draws a 28 px icon at stroke 1.75 in its tile', () => {
    const { host } = render(<StatusIcon name="check-circle" tone="escrow" />);
    const svg = host.querySelector('.x2f-status-icon svg')!;
    expect(svg.getAttribute('width')).toBe('28');
    expect(svg.getAttribute('stroke-width')).toBe('1.75');
  });
});

describe('LoginApprove screens use the v2 kit hooks', () => {
  it('new device: compact header, the 28/32 screen title, the caution chip over the number, the caution clock, the outline card', () => {
    const { host } = render(
      <MemoryRouter>
        <ApproveOnDevice wait={WAIT} returnTo="/buy" onLoggedIn={() => undefined} onRestart={() => undefined} pollMs={60_000} />
      </MemoryRouter>,
    );
    expect(host.querySelector('.x2f-flow')?.getAttribute('data-header')).toBe('compact');
    expect(part(host, 'approve-wait')?.classList.contains('x2f-screen-title')).toBe(true);
    const chip = host.querySelector('.x2f-number-card .x2f-chip');
    expect(chip?.textContent).toBe('Your number');
    expect(chip?.getAttribute('data-tone')).toBe('caution');
    expect(chip?.getAttribute('data-look')).toBe('tint');
    expect(part(host, 'approve-countdown')?.getAttribute('data-tone')).toBe('caution');
    expect(part(host, 'approve-no-device')?.getAttribute('data-tone')).toBe('outline');
  });

  it('logged-in device: the Devices link is the strong link, Not now the tertiary button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? json(200, { outcome: 'approved' }) : json(404, {}))),
    );
    render(
      <MemoryRouter>
        <LoginApprove approval={VIEW} onDone={() => undefined} />
      </MemoryRouter>,
    );
    const dialog = () => document.querySelector('[role="dialog"]')!;
    click(dialog().querySelectorAll('input[type="radio"]')[1]!);
    click(part(dialog(), 'approve-yes'));
    await settle();
    expect(dialog().querySelector('a[href="/settings/devices"]')?.classList.contains('x2f-link--strong')).toBe(true);
  });

  it('logged-in device, blocked: Not now is the tertiary button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? json(200, { outcome: 'blocked' }) : json(404, {}))),
    );
    render(
      <MemoryRouter>
        <LoginApprove approval={VIEW} onDone={() => undefined} />
      </MemoryRouter>,
    );
    click(part(document.querySelector('[role="dialog"]')!, 'approve-block'));
    await settle();
    expect(part(document, 'approve-not-now')?.classList.contains('x2f-button--tertiary')).toBe(true);
  });
});
