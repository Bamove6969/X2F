// @vitest-environment happy-dom
// Plan 7 Task 4: Settings → Privacy states the one retention rule from the shared constants.
import { BACKUP_KEEP_DAYS, DISPUTE_KEEP_DAYS, TRADE_KEEP_DAYS } from '@x2f/trade';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRIVACY_COPY, Privacy } from '../src/screens/settings/Privacy.js';
import { render } from './render.js';

describe('Privacy', () => {
  it('shows the numbers from the shared constants, and no choices', () => {
    const { host } = render(<Privacy />);
    const text = host.textContent ?? '';
    expect(text).toContain(`self-destructs ${TRADE_KEEP_DAYS} days after it ends`);
    expect(text).toContain(`kept ${DISPUTE_KEEP_DAYS} days from that moment`);
    expect(text).toContain(`within ${BACKUP_KEEP_DAYS} days`);
    expect(text).toContain('Nobody can delete a trade early or keep it longer, not even X2F.');
    expect(host.querySelectorAll('input, select, button, textarea')).toHaveLength(0);
    expect(host.querySelector('h1')!.textContent).toBe(PRIVACY_COPY.title);
  });

  it('types no number of days itself and never mentions a 6-month copy (Revision 2026-10-29b)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/screens/settings/Privacy.tsx', import.meta.url)), 'utf8');
    const copy = src.slice(src.indexOf('export const PRIVACY_COPY'));
    expect(copy).not.toMatch(/\b(14|30|90)\b/);
    expect(JSON.stringify(PRIVACY_COPY)).not.toMatch(/month/i);
  });
});
