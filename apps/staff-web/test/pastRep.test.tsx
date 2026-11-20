// @vitest-environment happy-dom
// Plan 5 Task 11: the moderators' Past reputation page (no board: DESIGN not drawn, COPY-UNSIGNED).
// One claim at a time; the evidence link opens the archive in a new tab with no referrer or opener
// (X2F never fetches it); the fingerprint in large mono groups of 4; Approve (the one primary)
// needs the "exact full fingerprint" tick and the trades the archive shows (P5-A23); Reject needs a
// reason. Senior moderators and the owner also see the approved claims, to revoke one or to enter
// the verified dollar figure (owner 2026-11-02).
import { NAV } from '@x2f/staff';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import type { PastRepClaim } from '../src/api.js';
import { button, click, fakeApi, field, refused, render, settle, tick, typeInto } from './helpers.js';

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => webauthn);

const later = new Date(Date.now() + 3600_000).toISOString();
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: NAV.mod, sessionEndsAt: later };
const SENIOR = { displayName: 'sarah.v', role: 'senior', nav: NAV.senior, sessionEndsAt: later };

const claim = (o: Partial<PastRepClaim> = {}): PastRepClaim => ({
  id: '11111111-1111-4111-8111-111111111111',
  site: 'LocalMonero',
  url: 'https://web.archive.org/web/2023/https://localmonero.co/user/rook',
  claimedTrades: 1300,
  verifiedTrades: null,
  verifiedUsdCents: null,
  status: 'signed',
  fingerprint: 'A1B2 C3D4 E5F6 0718 293A 4B5C 6D7E 8F90 1234 5678',
  keyId: '6D7E8F9012345678',
  signatureValid: true,
  displayName: 'rook88',
  createdAt: '2026-11-01T10:00:00.000Z',
  ...o,
});
const SECOND = claim({ id: '22222222-2222-4222-8222-222222222222', site: 'Bisq', displayName: 'wren', claimedTrades: 40 });

async function open() {
  render(
    <MemoryRouter initialEntries={['/past-reputation']}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}
const part = (p: string) => document.querySelector(`[data-part="${p}"]`);
const approveButton = () => button('Approve')!;

describe('Past reputation (Plan 5 Task 11)', () => {
  it("is in a moderator's menu; shows one claim at a time, the archive link in a new tab with no referrer, the fingerprint in groups of 4", async () => {
    const api = fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/past-rep': { body: [claim(), SECOND] } });
    await open();
    expect([...document.querySelectorAll('nav[aria-label="Staff"] a')].map((a) => a.textContent)).toContain('Past reputation');
    expect(document.querySelector('[data-screen="past-rep"]')).not.toBeNull();
    expect(api.calls.map((c) => c.path)).toContain('/staff/v1/past-rep?status=signed');
    // A moderator cannot revoke or enter the figure: the approved list is never asked for.
    expect(api.calls.some((c) => c.path.includes('status=approved'))).toBe(false);
    expect(part('claim-count')?.textContent).toBe('Claim 1 of 2');
    expect(part('claim')?.textContent).toContain('rook88');
    expect(part('claim')?.textContent).toContain('LocalMonero');
    expect(part('claim')?.textContent).toContain('1,300');
    const link = part('evidence-link')?.querySelector('a');
    expect(link?.getAttribute('href')).toBe(claim().url);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noreferrer', 'noopener']));
    expect(part('evidence-note')?.textContent).toBe('Opens the archive in your browser. X2F never fetches it.');
    expect(part('fingerprint')?.textContent).toBe('A1B2 C3D4 E5F6 0718 293A 4B5C 6D7E 8F90 1234 5678');
    expect(part('fingerprint')?.className).toContain('x2f-mono');
    expect(part('verified-usd')).toBeNull();
    expect(part('approved-claims')).toBeNull();
    // Exactly one primary on the page, the page's own: Approve.
    expect([...document.querySelectorAll('[data-primary]')].map((e) => e.textContent)).toEqual(['Approve']);
  });

  it('P5-A23: Approve waits for the fingerprint tick and the trades shown; it sends both, then the next claim shows', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/past-rep': { body: [claim(), SECOND] },
      'POST /staff/v1/past-rep/:id/approve': { body: { id: claim().id, status: 'approved', verifiedTrades: 1240 } },
    });
    await open();
    expect(approveButton().disabled).toBe(true);
    await tick(field('The archived page shows this exact full fingerprint'));
    expect(approveButton().disabled).toBe(true);
    typeInto(field('Trades shown on the archived page'), '0');
    await settle();
    expect(approveButton().disabled).toBe(true);
    typeInto(field('Trades shown on the archived page'), '1240');
    await settle();
    expect(approveButton().disabled).toBe(false);
    api.set('GET /staff/v1/past-rep', { body: [SECOND] });
    await click(approveButton());
    const sent = api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/approve'));
    expect(sent?.path).toBe(`/staff/v1/past-rep/${claim().id}/approve`);
    expect(sent?.body).toEqual({ fingerprintSeen: true, tradesSeen: 1240 });
    expect(part('claim')?.textContent).toContain('wren');
    expect(part('claim-count')?.textContent).toBe('Claim 1 of 1');
    // The next claim starts unticked and empty.
    expect((field('The archived page shows this exact full fingerprint') as HTMLInputElement).checked).toBe(false);
    expect(approveButton().disabled).toBe(true);
  });

  it('Reject needs a reason of 10 characters or more, and sends it; Skip shows the next claim without deciding', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/past-rep': { body: [claim(), SECOND] },
      'POST /staff/v1/past-rep/:id/reject': { body: { id: claim().id, status: 'rejected' } },
    });
    await open();
    await click(button('Skip for now'));
    expect(part('claim')?.textContent).toContain('wren');
    expect(part('claim-count')?.textContent).toBe('Claim 2 of 2');
    await click(button('Skip for now'));
    expect(part('claim')?.textContent).toContain('rook88');
    expect(button('Reject')!.disabled).toBe(true);
    typeInto(field('Reason for rejecting'), 'too short');
    await settle();
    expect(button('Reject')!.disabled).toBe(true);
    typeInto(field('Reason for rejecting'), 'The archive shows another key.');
    await settle();
    api.set('GET /staff/v1/past-rep', { body: [SECOND] });
    await click(button('Reject'));
    const sent = api.calls.find((c) => c.method === 'POST' && c.path.endsWith('/reject'));
    expect(sent?.body).toEqual({ reason: 'The archive shows another key.' });
    expect(part('claim')?.textContent).toContain('wren');
    expect(api.calls.some((c) => c.path.endsWith('/approve'))).toBe(false);
  });

  it('a claim another moderator decided first: the fault shows and the list reloads', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: MOD },
      'GET /staff/v1/past-rep': { body: [claim()] },
      'POST /staff/v1/past-rep/:id/approve': refused(409, 'wrong-state'),
    });
    await open();
    await tick(field('The archived page shows this exact full fingerprint'));
    typeInto(field('Trades shown on the archived page'), '1240');
    await settle();
    api.set('GET /staff/v1/past-rep', { body: [] });
    await click(approveButton());
    expect(document.querySelector('[data-part="past-rep-fault"]')?.textContent).toContain('already decided');
    expect(part('claim')).toBeNull();
    expect(part('no-claims')?.textContent).toContain('No claims are waiting');
  });

  it('an empty queue says so, with no primary action', async () => {
    fakeApi({ 'GET /staff/v1/me': { body: MOD }, 'GET /staff/v1/past-rep': { body: [] } });
    await open();
    expect(part('no-claims')?.textContent).toContain('No claims are waiting');
    expect(document.querySelectorAll('[data-primary]')).toHaveLength(0);
  });

  it('a senior moderator also sees the approved claims, revokes one with a reason, and enters the verified dollar figure', async () => {
    const approved = claim({ id: '33333333-3333-4333-8333-333333333333', status: 'approved', verifiedTrades: 900, displayName: 'kestrel', verifiedUsdCents: 1_250_000 });
    const api = fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      'GET /staff/v1/past-rep': (_b, path) => ({ body: path.includes('status=approved') ? [approved] : [claim()] }),
      'POST /staff/v1/past-rep/:id/revoke': { body: { id: approved.id, status: 'revoked' } },
      'PUT /staff/v1/past-rep/:id/verified-usd': { body: { ok: true } },
    });
    await open();
    expect(api.calls.map((c) => c.path)).toContain('/staff/v1/past-rep?status=approved');
    const rows = [...document.querySelectorAll('table[aria-label="Approved claims"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows[0]!.slice(0, 4)).toEqual(['kestrel', 'LocalMonero', '900', '$12,500']);
    // The figure on the waiting claim (entered before approval counts nothing until approved).
    const usd = field('Verified dollar figure (US$)', part('claim')!);
    typeInto(usd, '4,000.50');
    await settle();
    await click(button('Save figure', part('claim')!));
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ usdCents: 400_050 });
    expect(api.calls.find((c) => c.method === 'PUT')?.path).toBe(`/staff/v1/past-rep/${claim().id}/verified-usd`);
    // Revoke: open the row, give a reason.
    await click(button('Review', document.querySelector('table[aria-label="Approved claims"]')!));
    const panel = part('approved-claim')!;
    expect(panel.textContent).toContain('A1B2 C3D4');
    expect(button('Revoke', panel)!.disabled).toBe(true);
    typeInto(field('Reason for revoking', panel), 'The archive was edited later.');
    await settle();
    api.set('GET /staff/v1/past-rep', (_b, path) => ({ body: path.includes('status=approved') ? [] : [claim()] }));
    await click(button('Revoke', panel));
    expect(api.calls.find((c) => c.path.endsWith('/revoke'))?.body).toEqual({ reason: 'The archive was edited later.' });
    expect(part('approved-claim')).toBeNull();
    // Still one primary: the waiting claim's Approve (Revoke is the danger outline).
    expect([...document.querySelectorAll('[data-primary]')].map((e) => e.textContent)).toEqual(['Approve']);
  });

  it('a figure that is not a dollar amount is never sent; a cleared field clears the figure', async () => {
    const api = fakeApi({
      'GET /staff/v1/me': { body: SENIOR },
      'GET /staff/v1/past-rep': (_b, path) => ({ body: path.includes('status=approved') ? [] : [claim({ verifiedUsdCents: 500 })] }),
      'PUT /staff/v1/past-rep/:id/verified-usd': { body: { ok: true } },
    });
    await open();
    const usd = field('Verified dollar figure (US$)', part('claim')!);
    expect(usd.value).toBe('5.00');
    for (const bad of ['abc', '-5', '1.234', '100000.01']) {
      typeInto(usd, bad);
      await settle();
      expect(button('Save figure', part('claim')!)!.disabled, bad).toBe(true);
    }
    typeInto(usd, '');
    await settle();
    await click(button('Save figure', part('claim')!));
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ usdCents: null });
  });
});
