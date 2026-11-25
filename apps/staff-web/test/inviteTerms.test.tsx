// @vitest-environment happy-dom
// Owner 9 Nov 2026 (p11-14): everyone who gets a login signs the Terms, staff too. The invite's
// Terms step (TermsStep) comes before the names: the trader app's text and version, the tick after
// reading, the signature pad, then `acceptedTerms` and `termsSignature` go with the names; a
// `terms-not-accepted` there shows the Terms again (the trader's refusal handling).
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { KEY_POINTS, TERMS, TERMS_DRAFT_NOTE, TERMS_TEXT_VERSION } from '../src/ui/kit.js';
import { TERMS_CHANGED, TERMS_CONTINUE } from '../src/ui/TermsStep.js';
import { button, click, fakeApi, field, refused, render, settle, tick, typeInto, type Call } from './helpers.js';

vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }));

const view = { role: 'mod', hours: 'any', expiresAt: new Date().toISOString(), resume: null };
const INVITE = { 'GET /staff/v1/invites/accept/:token': { body: view } };
const ACCOUNT_OK = { 'POST /staff/v1/invites/accept/:token/account': { status: 201, body: { ok: true } } };
const terms = (version: string) => ({ 'GET /staff/v1/terms': { body: { version } } });

async function open(path = '/invite/tok_terms') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await settle();
}

const part = (name: string) => document.querySelector(`[data-part="${name}"]`);
const accept = () => part('terms-accept') as HTMLButtonElement;
const tickBox = () => part('terms-tick') as HTMLInputElement;
const hasLabel = (text: string) => [...document.querySelectorAll('label')].some((l) => l.textContent?.trim().startsWith(text));
const accountCalls = (calls: Call[]) => calls.filter((c) => c.path.endsWith('/account'));

/** Signs with a typed name (the pad's fallback for anyone who can't draw; design p11-15). */
async function typeName(name: string) {
  await click(part('signature-type'));
  typeInto(part('signature-name'), name);
  await settle();
}

beforeEach(() => {
  // happy-dom lays nothing out: give the pad a size (as the trader's tests do).
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
  vi.spyOn(HTMLCanvasElement.prototype, 'clientHeight', 'get').mockReturnValue(132);
});
afterEach(() => vi.restoreAllMocks());

describe('Invite: the Terms step (owner 9 Nov 2026, p11-14)', () => {
  it('comes before the names, with the trader app\'s text and the server\'s version', async () => {
    const api = fakeApi({ ...INVITE, ...terms(TERMS_TEXT_VERSION) });
    await open();
    expect(part('invite-terms')).not.toBeNull();
    expect(hasLabel('Username')).toBe(false);
    expect(hasLabel('Login name')).toBe(false);
    // The invite's role line stays above the step.
    expect(part('invite-role')?.textContent).toBe("You're invited as Moderator. You can log in at any time.");
    expect(document.querySelector('h2')?.textContent).toBe('1. Terms of Service');
    // The same text as the trader app, never a copy: the key points, the draft note, every section.
    expect([...document.querySelectorAll('[aria-label="Key points"] li')].map((l) => l.textContent)).toEqual(KEY_POINTS);
    const text = part('terms-text')!;
    // Owner demo note #222: the draft placeholder is gone, so no note line shows.
    expect(TERMS_DRAFT_NOTE).toBe('');
    expect(text.querySelector('.x2f-terms__note')).toBeNull();
    expect([...text.querySelectorAll('.x2f-terms__heading')].map((h) => h.textContent)).toEqual(TERMS.map((s) => s.heading));
    expect(text.querySelectorAll('.x2f-terms__p')).toHaveLength(TERMS.reduce((n, s) => n + s.paragraphs.length, 0));
    expect(text.querySelector('.x2f-terms__end')?.textContent).toBe(`End of Terms. Version ${TERMS_TEXT_VERSION}.`);
    expect(api.calls.some((c) => c.method === 'GET' && c.path === '/staff/v1/terms')).toBe(true);
    // The signature pad (design 9 Nov, p11-15, canvas ea2a9ca8) with its typed fallback.
    expect(part('signature-pad')).not.toBeNull();
    expect(part('signature-type')?.textContent).toBe('Type your name to sign');
    expect(accept().textContent).toBe(TERMS_CONTINUE);
  });

  it('Continue needs both the tick and a signature; the version and the signature then go with the names', async () => {
    const api = fakeApi({ ...INVITE, ...terms(TERMS_TEXT_VERSION), ...ACCOUNT_OK });
    await open();
    expect(accept().disabled).toBe(true);
    expect(tickBox().disabled).toBe(false); // happy-dom: the box shows everything, so it counts as read
    await tick(tickBox());
    // The tick alone is not enough (p11-14): a signature too.
    expect(accept().disabled).toBe(true);
    await typeName('Dmitri K');
    expect(accept().disabled).toBe(false);
    // Nothing is sent from the Terms step itself.
    expect(accountCalls(api.calls)).toHaveLength(0);
    await click(accept());
    expect(part('invite-terms')).toBeNull();
    expect(document.querySelector('h2')?.textContent).toBe('2. Your names');
    typeInto(field('Username'), 'dmitri_k');
    typeInto(field('Login name'), 'dk-login');
    await click(button('Continue'));
    expect(accountCalls(api.calls).map((c) => c.body)).toEqual([
      { displayName: 'dmitri_k', loginName: 'dk-login', acceptedTerms: TERMS_TEXT_VERSION, termsSignature: { kind: 'typed', name: 'Dmitri K' } },
    ]);
    expect(document.querySelector('h2')?.textContent).toBe('3. Your login keys');
  });

  it('a signature without the tick does not do either', async () => {
    fakeApi({ ...INVITE, ...terms(TERMS_TEXT_VERSION) });
    await open();
    await typeName('Dmitri K');
    expect(accept().disabled).toBe(true);
  });

  it('terms-not-accepted at the names: the Terms come back empty, say they changed, and the names are kept', async () => {
    let refuse = true;
    const api = fakeApi({
      ...INVITE,
      ...terms(TERMS_TEXT_VERSION),
      'POST /staff/v1/invites/accept/:token/account': () => (refuse ? refused(400, 'terms-not-accepted', { version: TERMS_TEXT_VERSION }) : { status: 201, body: { ok: true } }),
    });
    await open();
    await tick(tickBox());
    await typeName('Dmitri K');
    await click(accept());
    typeInto(field('Username'), 'dmitri_k');
    typeInto(field('Login name'), 'dk-login');
    await click(button('Continue'));
    // Back at the Terms (the trader's review M3), with the version read again and a fresh pad.
    expect(part('invite-terms')).not.toBeNull();
    expect(part('terms-changed')?.textContent).toBe(TERMS_CHANGED);
    expect(api.calls.filter((c) => c.path === '/staff/v1/terms')).toHaveLength(2);
    expect(tickBox().checked).toBe(false);
    expect(part('signature-pad')?.getAttribute('data-empty')).toBe('true');
    expect(accept().disabled).toBe(true);
    // A refusal that sends the person back to the Terms is not a fault and not a CantDoThat.
    expect(part('invite-fault')).toBeNull();
    expect(part('cant-do-that')).toBeNull();
    // Read, tick and sign again: the names typed before are still there.
    refuse = false;
    await tick(tickBox());
    await typeName('Dmitri K');
    await click(accept());
    expect((field('Username') as HTMLInputElement).value).toBe('dmitri_k');
    expect((field('Login name') as HTMLInputElement).value).toBe('dk-login');
    await click(button('Continue'));
    expect(accountCalls(api.calls)).toHaveLength(2);
    expect(accountCalls(api.calls)[1]!.body).toMatchObject({ acceptedTerms: TERMS_TEXT_VERSION, termsSignature: { kind: 'typed', name: 'Dmitri K' } });
    expect(document.querySelector('h2')?.textContent).toBe('3. Your login keys');
  });

  it('a server version this page does not carry is not accepted from here: the stale notice asks for a reload', async () => {
    fakeApi({ ...INVITE, ...terms('2099-01-01') });
    await open();
    expect(part('terms-stale')?.textContent).toBe('The Terms have been updated. Reload the page to read the new version.');
    expect(part('terms-text')?.querySelector('.x2f-terms__end')?.textContent).toBe('End of Terms. Version 2099-01-01.');
    expect(tickBox().disabled).toBe(true);
    await typeName('Dmitri K');
    expect(accept().disabled).toBe(true);
    expect(part('terms-changed')).toBeNull();
  });

  it('a Terms change to a version this page does not carry shows the stale notice, not "read them again"', async () => {
    let version = TERMS_TEXT_VERSION;
    fakeApi({
      ...INVITE,
      'GET /staff/v1/terms': () => ({ body: { version } }),
      'POST /staff/v1/invites/accept/:token/account': refused(400, 'terms-not-accepted', { version: '2099-01-01' }),
    });
    await open();
    await tick(tickBox());
    await typeName('Dmitri K');
    await click(accept());
    version = '2099-01-01';
    typeInto(field('Username'), 'dmitri_k');
    typeInto(field('Login name'), 'dk-login');
    await click(button('Continue'));
    expect(part('invite-terms')).not.toBeNull();
    expect(part('terms-stale')).not.toBeNull();
    expect(part('terms-changed')).toBeNull();
    expect(tickBox().disabled).toBe(true);
  });

  it('a failed version load says so and offers Try again; Continue waits for the version', async () => {
    let down = true;
    fakeApi({ ...INVITE, 'GET /staff/v1/terms': () => (down ? refused(503, 'internal') : { body: { version: TERMS_TEXT_VERSION } }) });
    await open();
    expect(part('terms-load-failed')?.textContent).toContain('Could not load the Terms version.');
    expect(part('terms-text')?.querySelector('.x2f-terms__end')?.textContent).toBe('End of Terms.');
    await tick(tickBox());
    await typeName('Dmitri K');
    expect(accept().disabled).toBe(true);
    down = false;
    await click(button('Try again'));
    expect(part('terms-load-failed')).toBeNull();
    expect(part('terms-text')?.querySelector('.x2f-terms__end')?.textContent).toBe(`End of Terms. Version ${TERMS_TEXT_VERSION}.`);
    expect(accept().disabled).toBe(false);
  });

  it('the tick waits for the end of the text', async () => {
    // A box taller than its frame: not read until it is scrolled to the end.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    fakeApi({ ...INVITE, ...terms(TERMS_TEXT_VERSION) });
    await open();
    expect(part('terms-hint')?.textContent).toContain('Scroll to the end to continue');
    expect(tickBox().disabled).toBe(true);
    const box = part('terms-text') as HTMLElement;
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockReturnValue(800);
    box.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle();
    expect(part('terms-hint')).toBeNull();
    expect(tickBox().disabled).toBe(false);
  });

  it('a return visit (the account is made, so the Terms are signed) carries on at the keys without them', async () => {
    const api = fakeApi({ 'GET /staff/v1/invites/accept/:token': { body: { ...view, resume: { keys: 0, passkeys: 0, pgp: 0, keyCheckCode: null } } } });
    await open();
    expect(part('invite-terms')).toBeNull();
    expect(button('Finish')).toBeDefined();
    expect(api.calls.some((c) => c.path === '/staff/v1/terms')).toBe(false);
  });
});
