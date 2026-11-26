// Job 1c (J-10; spec 6.7; owner S-094, p7-8): the team's permission catalogue and the account's
// notes on traders, as the web calls them. The catalogue (`GET /v1/team/permissions`,
// apps/api/src/team/abilities.ts `catalogueView`) is the only list of boxes the web knows: nothing
// here copies it. Notes: `GET /v1/account/notes/:displayName`, `POST /v1/account/notes`,
// `DELETE /v1/account/notes/:id` (apps/api/src/team/notes.ts). Both are parsed strictly, so a
// renamed field fails loudly instead of showing a wrong box.
import { api } from '../../api/client.js';

/** What a box does today (abilities.ts `Availability`). */
// not-a-refusal: 'owner-only' here names a kind of box in the catalogue, not a refusal code.
export type Availability = 'grantable' | 'not-built' | 'waits-member-keys' | 'waits-member-chat-key' | 'always' | 'owner-only';

export interface CatalogueAbility {
  no: number;
  id: string;
  group: string;
  label: string;
  does: string;
  availability: Availability;
}

export interface CatalogueGroup {
  id: string;
  label: string;
  abilities: CatalogueAbility[];
}

export interface CataloguePreset {
  id: string;
  label: string;
  note: string;
  abilities: string[];
}

export interface Catalogue {
  groups: CatalogueGroup[];
  presets: CataloguePreset[];
  rules: string[];
}

// not-a-refusal: the catalogue's box kinds ('owner-only' among them), not refusal codes.
const AVAILABILITIES: ReadonlySet<string> = new Set(['grantable', 'not-built', 'waits-member-keys', 'waits-member-chat-key', 'always', 'owner-only']);

const isStr = (v: unknown): v is string => typeof v === 'string';
const rec = (v: unknown, what: string): Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`permissions: bad ${what}`);
  return v as Record<string, unknown>;
};

export function parseCatalogue(raw: unknown): Catalogue {
  const r = rec(raw, 'answer');
  if (!Array.isArray(r.groups) || !Array.isArray(r.presets)) throw new Error('permissions: no groups or presets');
  const groups = r.groups.map((g0): CatalogueGroup => {
    const g = rec(g0, 'group');
    if (!isStr(g.id) || !isStr(g.label) || !Array.isArray(g.abilities)) throw new Error('permissions: bad group');
    return {
      id: g.id,
      label: g.label,
      abilities: g.abilities.map((a0): CatalogueAbility => {
        const a = rec(a0, 'ability');
        if (typeof a.no !== 'number' || !isStr(a.id) || !isStr(a.label) || !isStr(a.does) || !isStr(a.availability) || !AVAILABILITIES.has(a.availability)) {
          throw new Error('permissions: bad ability');
        }
        return { no: a.no, id: a.id, group: g.id as string, label: a.label, does: a.does, availability: a.availability as Availability };
      }),
    };
  });
  const presets = r.presets.map((p0): CataloguePreset => {
    const p = rec(p0, 'preset');
    if (!isStr(p.id) || !isStr(p.label) || !isStr(p.note) || !Array.isArray(p.abilities) || !p.abilities.every(isStr)) throw new Error('permissions: bad preset');
    return { id: p.id, label: p.label, note: p.note, abilities: [...p.abilities] };
  });
  const rules = Array.isArray(r.rules) ? r.rules.filter(isStr) : [];
  return { groups, presets, rules };
}

export async function fetchCatalogue(signal?: AbortSignal): Promise<Catalogue> {
  return parseCatalogue(await api<unknown>('/v1/team/permissions', signal ? { signal } : {}));
}

/**
 * What kind of box this is, for the picker:
 * - `now`: a box whose member routes check it today (`grantable`).
 * - `later`: a box the API stores but nothing uses yet (`not-built`, `waits-member-keys`,
 *   `waits-member-chat-key`): tickable, marked "Coming later". It is a box like any other in the
 *   API's model (abilities.ts `GRANTABLE`), the presets tick it, and migration 360 stored it for
 *   members moved from the old roles, so dropping it on a save would quietly take it away.
 * - `yours`: the account owner's alone; never a box, shown unticked and disabled.
 * - `always`: every member has it; not a box, shown ticked and disabled.
 */
export type BoxKind = 'now' | 'later' | 'yours' | 'always';

export function boxKind(a: Pick<CatalogueAbility, 'availability'>): BoxKind {
  switch (a.availability) {
    case 'grantable':
      return 'now';
    case 'not-built':
    case 'waits-member-keys':
    case 'waits-member-chat-key':
      return 'later';
    case 'always':
      return 'always';
    default:
      // The owner's alone (the catalogue's other kind).
      return 'yours';
  }
}

/** A box the lead can tick: one the API stores (`now` or `later`); never an owner-only or always-on one. */
export function isTickable(a: Pick<CatalogueAbility, 'availability'>): boolean {
  const k = boxKind(a);
  return k === 'now' || k === 'later';
}

/** Every box of the catalogue, in its own order (the row number). */
export function allAbilities(c: Catalogue): CatalogueAbility[] {
  return c.groups.flatMap((g) => g.abilities).sort((a, b) => a.no - b.no);
}

/**
 * What is sent for `picked`: only the tickable boxes the catalogue knows, once each, in catalogue
 * order (the API binds the confirm to that exact list). An owner-only or always-on one, or one the
 * catalogue does not name, is dropped, never sent.
 */
export function sendable(c: Catalogue, picked: readonly string[]): string[] {
  const want = new Set(picked);
  return allAbilities(c)
    .filter((a) => isTickable(a) && want.has(a.id))
    .map((a) => a.id);
}

/** The boxes a preset ticks (the catalogue's own list, in catalogue order). */
export function presetBoxes(c: Catalogue, presetId: string): string[] {
  const p = c.presets.find((x) => x.id === presetId);
  return p === undefined ? [] : sendable(c, p.abilities);
}

/** The preset whose boxes are exactly `picked` (null: none, a custom set), as the API's `presetOf` reads it. */
export function presetMatching(c: Catalogue, picked: readonly string[]): CataloguePreset | null {
  const mine = sendable(c, picked);
  if (mine.length === 0) return null;
  return c.presets.find((p) => {
    const boxes = presetBoxes(c, p.id);
    return boxes.length === mine.length && boxes.every((id, i) => id === mine[i]);
  }) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Notes on traders

export interface TraderNote {
  id: string;
  text: string;
  /** The member who wrote it, or null for the account owner. */
  by: string | null;
  byLead: boolean;
  at: string;
}

/** A note's longest text, as the API allows (notes.ts NOTE_MAX). */
export const NOTE_MAX = 1000;

export function parseNote(raw: unknown): TraderNote {
  const r = rec(raw, 'note');
  if (!isStr(r.id) || !isStr(r.text) || !isStr(r.at) || typeof r.byLead !== 'boolean' || (r.by !== null && !isStr(r.by))) throw new Error('notes: bad note');
  return { id: r.id, text: r.text, by: r.by, byLead: r.byLead, at: r.at };
}

export async function fetchNotes(displayName: string, signal?: AbortSignal): Promise<TraderNote[]> {
  const raw = await api<unknown>(`/v1/account/notes/${encodeURIComponent(displayName)}`, signal ? { signal } : {});
  if (!Array.isArray(raw)) throw new Error('notes: not a list');
  return raw.map(parseNote);
}

export async function addNote(about: string, text: string): Promise<TraderNote> {
  return parseNote(await api<unknown>('/v1/account/notes', { method: 'POST', body: { about, text } }));
}

export async function deleteNote(id: string): Promise<void> {
  await api(`/v1/account/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
