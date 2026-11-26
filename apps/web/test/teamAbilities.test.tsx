// @vitest-environment happy-dom
// Job 1c (J-10; owner S-094, p7-8): the permission box picker, driven by the API's own catalogue
// (apps/api/src/team/abilities.ts `catalogueView`, imported here so the test is the API's shape),
// and the Notes panel on another trader, against a stubbed API.
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_ABILITIES, catalogueView } from '../../api/src/team/abilities.js';
import { AbilityPicker } from '../src/screens/settings/AbilityPicker.js';
import { Team } from '../src/screens/settings/Team.js';
import { TraderNotes } from '../src/screens/settings/TraderNotes.js';
import { allAbilities, isTickable, parseCatalogue, presetBoxes, presetMatching, sendable, type Catalogue } from '../src/screens/settings/teamApi.js';
import { notesAccessOf } from '../src/session/member.js';
import type { Session } from '../src/session/useSession.js';
import { fire, render } from './render.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[];
let notes: unknown[];
let noteReply: { status: number; body: unknown } | null;
let members: unknown[];

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const NOTE_A = { id: '11111111-1111-4111-8111-111111111111', text: 'Pays fast, asks for receipts.', by: null, byLead: true, at: '2026-11-20T10:00:00.000Z' };
const NOTE_B = { id: '22222222-2222-4222-8222-222222222222', text: 'Slow on weekends.', by: 'Aurora', byLead: false, at: '2026-11-19T10:00:00.000Z' };

beforeEach(() => {
  calls = [];
  notes = [NOTE_A, NOTE_B];
  noteReply = null;
  members = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: input, method, body });
    if (input === '/v1/account/me') return json(200, { kind: 'trader', level: 'full', displayName: 'Calcium', methods: ['pgp'], member: null });
    if (input === '/v1/team/permissions') return json(200, catalogueView());
    if (input === '/v1/team' && method === 'GET') return json(200, { members, max: 3 });
    if (input === '/v1/team/audit') return json(200, []);
    if (input.startsWith('/v1/team/members/') && method === 'PATCH') return json(200, { ...(members[0] as object), abilities: body?.abilities });
    if (input === '/v1/account/notes/nightowl_44' && method === 'GET') return json(200, notes);
    if (input === '/v1/account/notes' && method === 'POST') {
      if (noteReply !== null) return json(noteReply.status, noteReply.body);
      return json(201, { id: '33333333-3333-4333-8333-333333333333', text: body.text, by: null, byLead: true, at: '2026-11-26T10:00:00.000Z' });
    }
    if (input.startsWith('/v1/account/notes/') && method === 'DELETE') return json(204, null);
    return json(500, { error: 'internal' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

const click = (el: Element) => fire(el, new MouseEvent('click', { bubbles: true }));
const byPart = (host: ParentNode, part: string) => host.querySelector(`[data-part="${part}"]`);

function typeText(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
  fire(el, new Event('input', { bubbles: true }));
}

const real = (): Catalogue => parseCatalogue(catalogueView());

function openAll(host: ParentNode) {
  for (const g of host.querySelectorAll('[data-part^="group-"]')) click(g);
}

describe('the catalogue helpers', () => {
  it('reads the API catalogue: every group and box, in the API\'s order', () => {
    const c = real();
    const api = catalogueView();
    expect(c.groups.map((g) => g.id)).toEqual(api.groups.map((g) => g.id));
    expect(allAbilities(c).map((a) => a.id)).toEqual(api.groups.flatMap((g) => g.abilities).sort((a, b) => a.no - b.no).map((a) => a.id));
    expect(c.presets.map((p) => p.id)).toEqual(api.presets.map((p) => p.id));
  });

  it('refuses a catalogue with a renamed field or an unknown kind of box', () => {
    expect(() => parseCatalogue({ groups: [{ id: 'g', label: 'G', abilities: [{ no: 1, id: 'x', label: 'X', does: 'd', availability: 'maybe' }] }], presets: [] })).toThrow();
    expect(() => parseCatalogue({ group: [], presets: [] })).toThrow();
  });

  it('sendable keeps only grantable boxes the catalogue knows, once each, in catalogue order; never a greyed one', () => {
    const c = real();
    const all = allAbilities(c);
    const greyed = all.filter((a) => !isTickable(a)).map((a) => a.id);
    expect(greyed).toEqual(expect.arrayContaining(['offers-edit-prices', 'trades-accept', 'chat-read', 'trades-release', 'own-login-methods']));
    const out = sendable(c, ['notes-add', ...greyed, 'offers-see', 'made-up-box', 'offers-see']);
    expect(out).toEqual(['offers-see', 'notes-add']);
  });

  it('a preset fills only its tickable boxes, and a set matching them reads as that preset', () => {
    const c = real();
    for (const p of c.presets) {
      const boxes = presetBoxes(c, p.id);
      expect(boxes.every((id) => isTickable(allAbilities(c).find((a) => a.id === id)!))).toBe(true);
      expect(boxes.length).toBeLessThanOrEqual(p.abilities.length);
    }
    expect(presetMatching(c, presetBoxes(c, 'trades'))?.id).toBe('trades');
    // The preset's greyed boxes alongside change nothing (they are never sent).
    expect(presetMatching(c, c.presets.find((p) => p.id === 'trades')!.abilities)?.id).toBe('trades');
    expect(presetMatching(c, ['offers-see'])).toBeNull();
    expect(presetMatching(c, [])).toBeNull();
  });
});

describe('AbilityPicker', () => {
  function Harness({ catalogue, start, onChange }: { catalogue: Catalogue; start: string[]; onChange: (v: string[]) => void }) {
    return <AbilityPicker catalogue={catalogue} value={start} onChange={onChange} idPrefix="t" />;
  }

  it('is drawn from the catalogue it is given, never a copy: an invented group and box show up', () => {
    const made: Catalogue = {
      groups: [{ id: 'zz', label: 'Invented group', abilities: [{ no: 1, id: 'zz-one', group: 'zz', label: 'Invented box', does: 'Does a thing', availability: 'grantable' }] }],
      presets: [{ id: 'p', label: 'Invented preset', note: 'n', abilities: ['zz-one'] }],
      rules: [],
    };
    const seen: string[][] = [];
    const { host } = render(<Harness catalogue={made} start={[]} onChange={(v) => seen.push(v)} />);
    expect(byPart(host, 'group-zz')?.textContent).toContain('Invented group');
    expect(host.querySelector('[data-preset="p"]')?.textContent).toBe('Invented preset');
    click(host.querySelector('[data-preset="p"]')!);
    expect(seen.at(-1)).toEqual(['zz-one']);
  });

  it('groups the boxes as the catalogue does, and greys the not-yet-built ones with "Coming later", untickable', async () => {
    const c = real();
    const { host } = render(<Harness catalogue={c} start={[]} onChange={() => undefined} />);
    expect([...host.querySelectorAll('[data-part^="group-"]')].map((g) => g.getAttribute('data-part'))).toEqual(c.groups.map((g) => `group-${g.id}`));
    openAll(host);
    await settle();
    expect(host.querySelectorAll('input[data-box]').length).toBe(allAbilities(c).length);
    for (const a of allAbilities(c)) {
      const input = host.querySelector<HTMLInputElement>(`input[data-box="${a.id}"]`)!;
      expect(input.disabled, a.id).toBe(a.availability !== 'grantable');
      if (['not-built', 'waits-member-keys', 'waits-member-chat-key'].includes(a.availability)) {
        expect(host.querySelector(`[data-ability="${a.id}"]`)?.textContent, a.id).toContain('Coming later');
      }
    }
  });

  it('ticking a box adds it and keeps catalogue order; a preset button replaces the set', async () => {
    const c = real();
    const seen: string[][] = [];
    const { host } = render(<Harness catalogue={c} start={['notes-add']} onChange={(v) => seen.push(v)} />);
    openAll(host);
    await settle();
    click(host.querySelector('input[data-box="offers-see"]')!);
    expect(seen.at(-1)).toEqual(['offers-see', 'notes-add']);
    click(host.querySelector('[data-preset="offers"]')!);
    expect(seen.at(-1)).toEqual(presetBoxes(c, 'offers'));
    expect(seen.at(-1)).not.toContain('offers-edit-prices');
  });
});

describe('Team: editing a member', () => {
  it('a member moved from the old Offers role shows its boxes; saving never sends the greyed ones', async () => {
    const legacy = [...ROLE_ABILITIES.offers];
    expect(legacy).toContain('offers-edit-prices');
    members = [{ id: 'm1', displayName: 'Aurora', roles: ['offers'], abilities: legacy, preset: null, custom: false, status: 'active', inviteExpiresAt: null, joinedAt: '2026-10-29T10:00:00.000Z', createdAt: '2026-10-29T09:00:00.000Z' }];
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(host.querySelector('[data-member="Aurora"]')?.textContent).toContain('Offers · Active');
    click(byPart(host, 'edit-boxes')!);
    await settle();
    const row = host.querySelector('[data-member="Aurora"]')!;
    openAll(row);
    await settle();
    expect(row.querySelector<HTMLInputElement>('input[data-box="offers-see"]')!.checked).toBe(true);
    expect(row.querySelector<HTMLInputElement>('input[data-box="offers-post"]')!.checked).toBe(true);
    expect(row.querySelector<HTMLInputElement>('input[data-box="offers-edit-prices"]')!.disabled).toBe(true);
    click(row.querySelector('input[data-box="notes-view"]')!);
    await settle();
    click(byPart(host, 'save-boxes')!);
    await settle();
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/v1/team/members/m1');
    expect(patch.body).toEqual({ abilities: ['offers-see', 'offers-pause', 'offers-post', 'offers-delete', 'notes-view', 'feedback-send'] });
    expect(host.querySelector('[data-part="team-said"]')?.textContent).toBe('Boxes saved for Aurora.');
  });

  it('no members reads the empty line; the owner\'s rules come from the catalogue', async () => {
    const { host } = render(<MemoryRouter><Team /></MemoryRouter>);
    await settle();
    expect(byPart(host, 'team-empty')?.textContent).toBe('No team members yet — invite up to 3');
    expect(byPart(host, 'ability-rules')?.textContent).toContain('Members never confirm payment received');
  });
});

const owner: Session = { status: 'signed-in', me: { kind: 'trader', member: null } as never };
const memberWith = (abilities: string[]): Session => ({ status: 'signed-in', me: { kind: 'trader', member: { name: 'Aurora', roles: [], abilities } } as never });

describe('notesAccessOf', () => {
  it('the owner reads, adds and deletes; a member by their boxes, never deleting; others nothing', () => {
    expect(notesAccessOf(owner)).toEqual({ view: true, add: true, remove: true });
    expect(notesAccessOf(memberWith(['notes-view']))).toEqual({ view: true, add: false, remove: false });
    expect(notesAccessOf(memberWith(['notes-view', 'notes-add']))).toEqual({ view: true, add: true, remove: false });
    expect(notesAccessOf(memberWith(['trades-see-active']))).toEqual({ view: false, add: false, remove: false });
    expect(notesAccessOf({ status: 'signed-out' })).toEqual({ view: false, add: false, remove: false });
    expect(notesAccessOf({ status: 'signed-in', me: { kind: 'staff', member: null } as never })).toEqual({ view: false, add: false, remove: false });
  });
});

describe('TraderNotes', () => {
  it('asks nothing until opened; then lists the notes, signed, newest first', async () => {
    const { host } = render(<TraderNotes displayName="nightowl_44" access={{ view: true, add: true, remove: true }} />);
    await settle();
    expect(calls.length).toBe(0);
    click(byPart(host, 'notes-open')!);
    await settle();
    const rows = host.querySelectorAll('[data-part="notes-list"] li');
    expect([...rows].map((r) => r.querySelector('[data-part="note-text"]')?.textContent)).toEqual([NOTE_A.text, NOTE_B.text]);
    expect(rows[0]!.textContent).toContain('Account owner');
    expect(rows[1]!.textContent).toContain('Aurora');
    expect(host.textContent).toContain('Only you and your team see these notes');
  });

  it('adds a note for that trader and shows it first', async () => {
    const { host } = render(<TraderNotes displayName="nightowl_44" access={{ view: true, add: true, remove: true }} />);
    click(byPart(host, 'notes-open')!);
    await settle();
    typeText(host.querySelector<HTMLTextAreaElement>('[data-part="note-input"]')!, '  Asked to move off-site.  ');
    click(byPart(host, 'note-save')!);
    await settle();
    expect(calls.find((c) => c.method === 'POST')).toEqual({ url: '/v1/account/notes', method: 'POST', body: { about: 'nightowl_44', text: 'Asked to move off-site.' } });
    expect(host.querySelector('[data-part="notes-list"] li [data-part="note-text"]')?.textContent).toBe('Asked to move off-site.');
    expect(byPart(host, 'notes-said')?.textContent).toBe('Note saved.');
  });

  it('a blank note sends nothing', async () => {
    const { host } = render(<TraderNotes displayName="nightowl_44" access={{ view: true, add: true, remove: true }} />);
    click(byPart(host, 'notes-open')!);
    await settle();
    typeText(host.querySelector<HTMLTextAreaElement>('[data-part="note-input"]')!, '   ');
    click(byPart(host, 'note-save')!);
    await settle();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(byPart(host, 'notes-error')?.textContent).toBe('Write something first.');
  });

  it('the owner deletes a note after a second tap', async () => {
    const { host } = render(<TraderNotes displayName="nightowl_44" access={{ view: true, add: true, remove: true }} />);
    click(byPart(host, 'notes-open')!);
    await settle();
    click(host.querySelector(`[data-note="${NOTE_B.id}"] [data-part="note-delete"]`)!);
    await settle();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    click(host.querySelector(`[data-note="${NOTE_B.id}"] [data-part="note-delete-yes"]`)!);
    await settle();
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe(`/v1/account/notes/${NOTE_B.id}`);
    expect(host.querySelector(`[data-note="${NOTE_B.id}"]`)).toBeNull();
  });

  it('a member with View only reads, with no add box and no Delete', async () => {
    const { host } = render(<TraderNotes displayName="nightowl_44" access={{ view: true, add: false, remove: false }} />);
    click(byPart(host, 'notes-open')!);
    await settle();
    expect(host.querySelectorAll('[data-part="notes-list"] li').length).toBe(2);
    expect(byPart(host, 'note-add')).toBeNull();
    expect(byPart(host, 'note-delete')).toBeNull();
  });

  it('a member with Add only adds without reading the list; with neither box there is no panel', async () => {
    const { host } = render(<TraderNotes displayName="nightowl_44" access={{ view: false, add: true, remove: false }} />);
    click(byPart(host, 'notes-open')!);
    await settle();
    expect(calls.some((c) => c.method === 'GET')).toBe(false);
    expect(byPart(host, 'notes-list')).toBeNull();
    expect(byPart(host, 'note-add')).not.toBeNull();
    const none = render(<TraderNotes displayName="nightowl_44" access={{ view: false, add: false, remove: false }} />);
    expect(none.host.querySelector('[data-part="trader-notes"]')).toBeNull();
  });

  it('the note cap opens CantDoThat with the number', async () => {
    noteReply = { status: 409, body: { error: 'too-many-notes', max: 500 } };
    const { host } = render(
      <MemoryRouter>
        <TraderNotes displayName="nightowl_44" access={{ view: true, add: true, remove: true }} />
      </MemoryRouter>,
    );
    click(byPart(host, 'notes-open')!);
    await settle();
    typeText(host.querySelector<HTMLTextAreaElement>('[data-part="note-input"]')!, 'One more.');
    click(byPart(host, 'note-save')!);
    await settle();
    const popup = document.querySelector('[data-part="cant-do-that"]');
    expect(popup?.getAttribute('data-from')).toBe('too-many-notes');
    expect(popup?.textContent).toContain('500 notes');
  });
});
