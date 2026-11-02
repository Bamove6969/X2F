// C2-D1: the path, title and helpers of the Devices screen ("Devices and sessions" board, docs/design-boards/Devices.dc.html
// on wip/design-brief). The board is marked Draft copy, so every sentence here is COPY-UNSIGNED
// until the owner signs the board off. The board's sentences about behaviour X2F does not have yet
// (members' "Can log in" switch, "Log out all team members", members not counting toward the
// limit, the session-length choice, the passkey / security key / PGP way in without an approval,
// the recovery code's hold for everyone) are left out; see the C2-D1 report.

export const DEVICES_PATH = '/settings/devices';

// COPY-UNSIGNED. The screen's other words are DEVICES_COPY in Devices.tsx (the "Log out" words
// stay beside the endSession calls, test/logout-tripwire.test.ts).
export const DEVICES_TITLE = 'Devices and sessions';

/** "DA" for desk_ana, "BA" for Basil: the team member's initials avatar. */
export function initials(name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const s = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? name).slice(0, 2);
  return s.toUpperCase();
}

/** The board's phone or computer icon, from the coarse browser-and-system label. */
export function deviceKind(label: string): 'phone' | 'computer' {
  return /android|iphone|ipad|ios|mobile|phone|pixel/i.test(label) ? 'phone' : 'computer';
}
