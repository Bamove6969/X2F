// @vitest-environment happy-dom
// The staff tours (src/tour/steps.ts, design's tour-stops.md §3): every live step's target renders on
// its route as that role sees it, each role's tour visits only its own menu's pages, and design's
// stops for screens not built yet stay out of every tour.
import { type GrantablePerm, NAV, STAFF_ROLES, type StaffRole, navFor } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { H1, PENDING_STAFF_STOPS, STAFF_TOURS, staffTour, type TourStep } from '../src/tour/steps.js';
import { NAV_PATHS } from '../src/ui/StaffShell.js';
import { fakeApi, render, settle } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const MEMBERS = [
  { accountId: 's-1', inviteId: null, displayName: 'iris.m', role: 'senior', status: 'active', grants: [], hours: 'any', joinedAt: '2026-10-02T00:00:00Z', lastActiveAt: null, openCases: 1, expiresAt: null, missingMethods: [] },
  { accountId: 'm-1', inviteId: null, displayName: 'nightowl_44', role: 'mod', status: 'active', grants: [], hours: 'any', joinedAt: '2026-10-03T00:00:00Z', lastActiveAt: null, openCases: 2, expiresAt: null, missingMethods: [] },
];
const HEALTH = {
  xmr: [{ name: 'Kraken', lastGoodAt: '2026-11-10T09:58:00.000Z', consecutiveFailures: 0, inUse: true }],
  fx: [{ name: 'ECB', rank: 1, lastGoodAt: '2026-11-10T06:00:00.000Z', consecutiveFailures: 0, stale: false, inUse: true, usedFor: ['EUR'] }],
  rejected: [],
  paused: [],
  settings: { staleAfterMinutes: 1440, sanityPercent: 5 },
};

function api(role: StaffRole, grants: GrantablePerm[] = []) {
  fakeApi({
    'GET /staff/v1/me': { body: { displayName: 'lumen.k', role, nav: navFor(role, grants), sessionEndsAt: new Date(Date.now() + 3600_000).toISOString() } },
    'GET /staff/v1/members': { body: { members: MEMBERS } },
    'GET /staff/v1/price-health': { body: HEALTH },
    'GET /staff/v1/feedback': { body: { items: [], counts: { great: 1, ok: 0, needsWork: 0 }, next: null } },
    'GET /staff/v1/feedback/form': { body: { items: [], next: null } },
    'GET /staff/v1/news': { body: { items: [] } },
  });
}

async function missingTargets(steps: readonly TourStep[], role: StaffRole, grants: GrantablePerm[] = []): Promise<string[]> {
  const missing: string[] = [];
  for (const s of steps) {
    document.body.innerHTML = '';
    api(role, grants);
    render(
      <MemoryRouter initialEntries={[s.route]}>
        <App />
      </MemoryRouter>,
    );
    await settle();
    if (document.querySelector(s.target) === null) missing.push(`${s.route} ${s.target}`);
  }
  return missing;
}

describe('staff tours (design tour-stops.md §3)', () => {
  it('every tour opens on the X2F Staff brand, then the shell, then the pages', () => {
    for (const role of STAFF_ROLES) {
      const t = STAFF_TOURS[role];
      expect(t[0]!.title, role).toBe('Welcome to X2F Staff');
      expect(t.map((s) => s.title)).toContain('Logging out');
    }
    expect(STAFF_TOURS.mod.slice(0, 4).map((s) => s.title)).toEqual(['Welcome to X2F Staff', 'Your pages', "That's you", 'Logging out']);
  });

  it("a helper with an empty menu skips 'Your pages' and gets 'More on the way'; granted Feedback, the Feedback stops instead", () => {
    expect(STAFF_TOURS.helper.map((s) => s.title)).toEqual(['Welcome to X2F Staff', "That's you", 'More on the way', 'Logging out']);
    const granted = staffTour('helper', ['feedback.read']);
    expect(granted).not.toContain(H1);
    expect(granted.slice(-2).map((s) => s.title)).toEqual(["How's X2F doing?", 'What traders said']);
    expect(staffTour('mod', ['feedback.read']).slice(-2).map((s) => s.title)).toEqual(["How's X2F doing?", 'What traders said']);
  });

  it('the owner gets the writer\'s Training library line, every other role the reader\'s', () => {
    const t1 = (role: StaffRole) => STAFF_TOURS[role].find((s) => s.title === 'Training library')!.explanation;
    expect(t1('owner')).toBe('Write and update the guides your staff learn from.');
    for (const role of ['mod', 'senior'] as const) expect(t1(role)).toBe('Guides for handling cases. Start here when a case is new to you.');
  });

  it("each role's tour visits only its own menu's pages", () => {
    for (const role of STAFF_ROLES) {
      const allowed = new Set(['/', ...NAV[role].map((i) => NAV_PATHS[i])]);
      for (const s of STAFF_TOURS[role]) expect(allowed.has(s.route), `${role}: ${s.route}`).toBe(true);
    }
  });

  it("design's stops for screens not built yet are in no tour, each names its board and what it waits for", () => {
    const live = new Set(STAFF_ROLES.flatMap((r) => [...STAFF_TOURS[r], ...staffTour(r, ['feedback.read', 'tickets.handle'])].map((s) => s.title + s.explanation)));
    for (const p of PENDING_STAFF_STOPS) {
      expect(live.has(p.title + p.explanation), p.id).toBe(false);
      expect(p.board.length, p.id).toBeGreaterThan(3);
      expect(p.waitsFor.length, p.id).toBeGreaterThan(3);
      expect(p.roles.length, p.id).toBeGreaterThan(0);
    }
    expect(new Set(PENDING_STAFF_STOPS.map((p) => p.id)).size).toBe(PENDING_STAFF_STOPS.length);
  });

  it('no 3D or isometric wording anywhere (owner 12 Nov)', () => {
    const all = JSON.stringify([STAFF_ROLES.map((r) => STAFF_TOURS[r]), PENDING_STAFF_STOPS]);
    expect(all).not.toMatch(/\b3d\b|isometric|\biso\b/i);
  });

  for (const role of STAFF_ROLES) {
    it(`${role}: every target renders on its route`, async () => {
      expect(await missingTargets(STAFF_TOURS[role], role)).toEqual([]);
    });
  }

  it('a helper granted Feedback: every target renders on its route', async () => {
    expect(await missingTargets(staffTour('helper', ['feedback.read']), 'helper', ['feedback.read'])).toEqual([]);
  });
});
