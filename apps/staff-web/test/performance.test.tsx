// @vitest-environment happy-dom
// Plan 4 Task 20: the owner's Moderator performance page (board StaffPerformance). The figures are
// the API's (apps/api/src/staff/performance.ts, its maths in @x2f/staff metrics.test.ts); this
// checks what the page shows: the period choice, the table with "Overturned on appeal" amber when
// any, the empty figures as a dash (never 0 min or 0%), Show chart / Hide chart, the line breaking
// at a week with no first reply, and Show as table's 8 rows.
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { fmtMinutes, lineRuns } from '../src/ui/WeekLine.js';
import { button, click, fakeApi, refused, render, settle } from './helpers.js';

vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));

const OWNER = { tradeTag: 'lumen.k', role: 'owner', nav: NAV.owner, sessionEndsAt: new Date(Date.now() + 3600_000).toISOString() };
const FIG = {
  cases: 0, firstReplyMin: null, rulingMin: null, overturned: 0, withinDeadlinePct: null, open: 0, payableCases: 0,
  settledWithinGoalPct: null, settledWithinDeadlinePct: null, appeals: 0, appealsWithinGoalPct: null,
};
const SARAH = { ...FIG, id: '11111111-1111-4111-8111-111111111111', name: 'sarah.v', role: 'senior', cases: 41, firstReplyMin: 38, rulingMin: 190, withinDeadlinePct: 96, open: 1, payableCases: 41 };
const DMITRI = { ...FIG, id: '22222222-2222-4222-8222-222222222222', name: 'dmitri_k', role: 'mod', cases: 17, firstReplyMin: 112, rulingMin: 400, overturned: 3, withinDeadlinePct: 82, open: 1, payableCases: 14 };
const NEWBIE = { ...FIG, id: '33333333-3333-4333-8333-333333333333', name: 'new.mod', role: 'mod' };
const LABELS = ['Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21', 'Sep 28', 'Oct 5', 'Oct 12'];
const WEEKS = {
  id: DMITRI.id, name: 'dmitri_k', role: 'mod', firstResponseH: 4, from: '2026-08-24T00:00:00.000Z',
  summary: { ...DMITRI, cases: 17, overturned: 3, withinDeadlinePct: 82 },
  weeks: LABELS.map((weekOf, i) => ({ weekOf, start: `w${i}`, cases: [1, 2, 2, 3, 2, 3, 2, 2][i]!, firstReplyMin: i === 3 ? null : 90 + i })),
};

async function open() {
  render(
    <MemoryRouter initialEntries={['/performance']}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const rows = () =>
  [...document.querySelectorAll('table[aria-label="Moderator performance"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

describe('StaffPerformance', () => {
  it('shows each person\'s figures in the board\'s columns; empty figures read as a dash; Overturned is amber only when any', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/performance': { body: { period: '30d', firstResponseH: 4, people: [SARAH, DMITRI, NEWBIE] } } });
    await open();
    expect(api.calls.map((c) => c.path)).toContain('/staff/v1/performance?period=30d');
    expect(document.querySelector('h1')?.textContent).toBe('Moderator performance');
    expect(rows()).toEqual([
      ['sarah.v', 'Senior moderator', '41', '38 min', '3 h 10 min', '0 of 41', '96%', '1', 'Show chart'],
      ['dmitri_k', 'Moderator', '17', '1 h 52 min', '6 h 40 min', '3 of 17', '82%', '1', 'Show chart'],
      ['new.mod', 'Moderator', '0', '—', '—', '0 of 0', '—', '0', 'Show chart'],
    ]);
    const tones = [...document.querySelectorAll('[data-part="overturned"]')].map((td) => td.getAttribute('data-tone'));
    expect(tones).toEqual([null, 'caution', null]);
    expect(document.body.textContent).toContain("Typical means the middle value, so one slow case doesn't skew it.");
    // The board's coaching paragraph is example copy (Task 20): never rendered.
    expect(document.body.textContent).not.toContain('coaching chat');
  });

  it('the period select asks the API again for that period', async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/performance': { body: { period: '30d', firstResponseH: 4, people: [] } } });
    await open();
    expect(rows()).toEqual([['No one handles disputes yet.']]);
    const select = document.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Last 30 days', 'Last 90 days', 'All time']);
    select.value = 'all';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(api.calls.map((c) => c.path)).toContain('/staff/v1/performance?period=all');
  });

  it('Show chart opens the person\'s 8 weeks; Show as table lists 8 rows; Hide chart closes it', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: OWNER },
      'GET /staff/v1/performance': { body: { period: '30d', firstResponseH: 4, people: [SARAH, DMITRI] } },
      'GET /staff/v1/performance/:id/weeks': { body: WEEKS },
    });
    await open();
    const toggles = [...document.querySelectorAll('[data-part="performance-row"] button')];
    await click(toggles[1]);
    expect(api.calls.map((c) => c.path)).toContain(`/staff/v1/performance/${DMITRI.id}/weeks`);
    const panel = document.querySelector('[data-part="performance-panel"]')!;
    expect(panel.querySelector('h2')?.textContent).toBe('dmitri_k, last 8 weeks');
    expect(toggles[1]!.textContent).toBe('Hide chart');
    expect(toggles[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(panel.querySelectorAll('[data-part="week-bar"]')).toHaveLength(8);
    // Week 4 has no first reply: two line pieces, 7 dots, never a 0.
    expect(panel.querySelectorAll('[data-part="reply-line"]')).toHaveLength(2);
    expect(panel.querySelectorAll('circle')).toHaveLength(7);
    expect(panel.textContent).toContain('3 of 17');

    await click(button('Show as table'));
    const weekRows = [...document.querySelectorAll('[data-part="weeks-table"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(weekRows).toHaveLength(8);
    expect(weekRows[0]).toEqual(['Aug 24', '1', '1 h 30 min']);
    expect(weekRows[3]).toEqual(['Sep 14', '3', '—']);
    await click(button('Show as charts'));
    expect(document.querySelector('[data-part="weeks-table"]')).toBeNull();

    await click(toggles[1]);
    expect(document.querySelector('[data-part="performance-panel"]')).toBeNull();
  });

  it('a refusal shows the fault, not an empty table of zeroes', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: OWNER }, 'GET /staff/v1/performance': refused(503, 'internal') });
    await open();
    expect(document.querySelector('[data-part="performance-fault"]')).not.toBeNull();
    expect(rows()).toEqual([]);
  });
});

describe('the chart helpers', () => {
  it('minutes as the board writes them', () => {
    expect(fmtMinutes(38)).toBe('38 min');
    expect(fmtMinutes(65)).toBe('1 h 05 min');
    expect(fmtMinutes(112)).toBe('1 h 52 min');
    expect(fmtMinutes(null)).toBe('—');
  });

  it('the line breaks at a missing week rather than dropping to 0', () => {
    expect(lineRuns([[1, 1], [2, 2], null, [4, 4], null, null])).toEqual([[[1, 1], [2, 2]], [[4, 4]]]);
    expect(lineRuns([null, null])).toEqual([]);
  });
});
