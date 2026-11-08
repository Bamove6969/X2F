// Trader identity atoms from the design kit handoff (8 Nov 2026) §2.1-2.3, with the head
// designer's rulings 2, 10 and 15: Avatar, RoleTag and ModTile. Sizes and tones live in kit.css.
import type { ReactNode } from 'react';
import { KitGlyph, type KitGlyphName } from './kitGlyphs.js';
import './kit.css';

export type AvatarSize = 32 | 40 | 48;

/** Two initials from a public name: "satoshi_ghost" → "SG", "mira.k" → "MK", "lowtide" → "LO". */
export function initialsOf(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  if (words.length === 0) return '?';
  const two = words.length > 1 ? [...words[0]!].slice(0, 1).concat([...words[1]!].slice(0, 1)) : [...words[0]!].slice(0, 2);
  return two.join('').toUpperCase();
}

/**
 * A circle with initials (kit 2.1). Decorative (`aria-hidden`): the name sits next to it, and
 * "Online" is said in text by the caller. `trusted` draws the 70% escrow ring (Trusted badge only);
 * `online` the escrow dot, whose ring takes the colour of what the avatar sits on (`on`). Offline is
 * no dot (ruling 10); `muted` is an unblocked or removed person; `blocked` puts the danger marker
 * where the dot goes. `kind="team"` is a team member's avatar, `kind="x2f"` the X2F team's.
 */
export function Avatar({
  name,
  initials,
  size = 40,
  trusted = false,
  online = false,
  on = 'surface',
  kind = 'standard',
  muted = false,
  blocked = false,
}: {
  name: string;
  initials?: string;
  size?: AvatarSize;
  trusted?: boolean;
  online?: boolean;
  on?: 'surface' | 'raised';
  kind?: 'standard' | 'team' | 'x2f';
  muted?: boolean;
  blocked?: boolean;
}) {
  const text = kind === 'x2f' ? 'X2F' : (initials ?? initialsOf(name));
  return (
    <span
      className="x2f-avatar"
      data-size={size}
      data-on={on}
      data-kind={kind}
      data-trusted={trusted && !blocked && kind === 'standard' ? 'true' : undefined}
      data-muted={muted ? 'true' : undefined}
      aria-hidden="true"
    >
      {text}
      {blocked ? (
        <span className="x2f-avatar__blocked" data-part="avatar-blocked">
          <KitGlyph name="ban" size={10} stroke={3.5} />
        </span>
      ) : online ? (
        <span className="x2f-avatar__dot" data-part="avatar-dot" />
      ) : null}
    </span>
  );
}

export type Role = 'vendor' | 'team' | 'mod' | 'x2f' | 'neutral';

const ROLE: Record<Exclude<Role, 'neutral'>, { label: string; glyph: KitGlyphName | null }> = {
  vendor: { label: 'Vendor', glyph: 'store' },
  team: { label: 'Team member', glyph: 'users' },
  mod: { label: 'X2F Moderator', glyph: 'shield-outline' },
  x2f: { label: 'X2F team', glyph: null },
};

/**
 * A small role label (kit 2.2, ruling 15: one family, 20 h, radius 6, 11/14 600 caps .04em,
 * padding 0 6, optional 12 px icon). The moderator tag appears inside disputes and the staff app
 * only. `role="neutral"` carries its own words ("You · buyer", "Not joined").
 */
export function RoleTag({ role, tone, children }: { role: Role; tone?: 'escrow'; children?: ReactNode }) {
  const def = role === 'neutral' ? null : ROLE[role];
  return (
    <span className="x2f-tag" data-role={role} data-tone={tone}>
      {def?.glyph ? <KitGlyph name={def.glyph} size={12} stroke={2} /> : null}
      {def ? def.label : children}
    </span>
  );
}

const MOD_TILE: Record<AvatarSize, number> = { 48: 22, 40: 20, 32: 16 };

/**
 * A moderator's tile, used instead of an avatar (kit 2.3): the shield outline on a 16% mod wash, or,
 * when the moderator has not joined (`pending`), a line border with a muted shield and no fill.
 */
export function ModTile({ size = 40, pending = false }: { size?: AvatarSize; pending?: boolean }) {
  return (
    <span className="x2f-modtile" data-size={size} data-pending={pending ? 'true' : undefined} aria-hidden="true">
      <KitGlyph name="shield-outline" size={MOD_TILE[size]} />
    </span>
  );
}
