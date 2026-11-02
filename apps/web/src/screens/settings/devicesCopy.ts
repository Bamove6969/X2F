// C2-D1: the words of the Devices screen ("Devices and sessions" board, docs/design-boards/Devices.dc.html
// on wip/design-brief). The board is marked Draft copy, so every sentence here is COPY-UNSIGNED
// until the owner signs the board off. The board's sentences about behaviour X2F does not have yet
// (members' "Can log in" switch, "Log out all team members", members not counting toward the
// limit, the session-length choice, the passkey / security key / PGP way in without an approval,
// the recovery code's hold for everyone) are left out; see the C2-D1 report.

export const DEVICES_PATH = '/settings/devices';

// COPY-UNSIGNED (all of DEVICES_COPY).
export const DEVICES_COPY = {
  title: 'Devices and sessions',
  back: 'Back to settings',
  devicesTitle: 'Devices',
  count: (used: number, max: number) => `${used} of ${max} devices logged in`,
  atLimit: "You're at the limit. To let a new device in, you'll pick one to log out.",
  oneMore: 'One more device can log in.',
  more: (n: number) => `${n} more devices can log in.`,
  mineTitle: 'Your devices',
  thisDevice: 'This device',
  logOut: 'Log out',
  logOutLabel: (name: string) => `Log out ${name}`,
  logOutAll: 'Log out all other devices',
  teamTitle: 'Team members logged in',
  teamNotYours: "These are your team members' logins, not yours.",
  teamMember: 'Team member',
  teamLogOutLabel: (member: string, device: string) => `Log out ${member} on ${device}`,
  manageTeam: 'Manage roles and invites in Team',
  optionsTitle: 'Options',
  oneDevice: 'One device at a time',
  oneDeviceHint: 'When on, approving a new device logs out the one you were using.',
  oneDeviceOn: 'One device at a time is on.',
  oneDeviceOff: 'One device at a time is off.',
  howTitle: 'How a new device gets in',
  howApproveTitle: 'Approve it on a logged-in device',
  howApprove: 'Your other devices ask "Is this you?". Tap the 2-digit number the new device shows. Say no and the login is blocked.',
  noIp: "X2F doesn't log IP addresses, so devices are named only by browser and system.",
  recovery: 'Recovery login',
  ask: {
    oneTitle: (name: string) => `Log out ${name}?`,
    oneText: "It's logged out right away. To use it again, approve it from a device you're still logged in on.",
    memberTitle: (member: string) => `Log out ${member}?`,
    memberText: (member: string, device: string) => `${member}'s session on ${device} ends right away.`,
    allTitle: (n: number) => (n === 1 ? 'Log out 1 other device?' : `Log out ${n} other devices?`),
    allText: (names: string[]) => `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} logged out right away. Only this device stays logged in.`,
    cancel: 'Cancel',
  },
  done: {
    one: (name: string) => `${name} was logged out.`,
    member: (member: string, device: string) => `${member} was logged out of ${device}.`,
    all: 'All other devices were logged out.',
  },
} as const;

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
