// Settings → Security, "Trade key backup" (escrow-key sync, Plan 3 Task 42; owner 26 Nov 2026: each
// trade's escrow keys are kept on X2F end to end encrypted, readable only by the account holder and
// the members they assign; unlocked with a passkey or security key, or a PGP key, never the
// authenticator app). No board yet: DESIGNER-REVIEW on the layout. Every string here is
// COPY-UNSIGNED (owner to approve before merge).

/** COPY-UNSIGNED: the Security section, its states and its buttons. */
export const TRADE_KEYS_COPY = {
  title: 'Trade key backup',
  about: 'X2F keeps an encrypted copy of your trade keys. Only you, and team members you choose, can open it. X2F holds no key to it.',
  loading: 'Loading your trade key backup.',
  loadFailed: 'Could not load your trade key backup. Try again later.',
  none: 'You have no trade key backup yet. Set one up so a new device can take over your trades.',
  noneMember: 'You have no trade key backup yet. Set one up to read the trade keys your team lead shares with you.',
  on: 'Your trade key backup is on.',
  setUp: 'Set up',
  pickMethod: 'Pick the key that will unlock your backup.',
  noTotp: 'Your authenticator app does not work here. It makes codes, not keys, so it does not unlock a backup.',
  noKeys: 'Add a passkey, a security key or a PGP key in Login methods first.',
  prfNote: 'Your passkey or security key must support the PRF extension. Most new ones do.',
  unlocksTitle: 'Unlocks your backup',
  addUnlock: 'Add another way to unlock',
  addPick: 'Pick the key to add.',
  addFirst: 'First unlock your backup with a key it already has.',
  remove: 'Remove',
  removeLabel: (name: string): string => `Remove ${name}`,
  lastUnlock: 'Keep at least one way to unlock your backup.',
  cancel: 'Cancel',
  working: 'Waiting for your key.',
  noPrf: 'That key does not support PRF. Pick another one.',
  badUnlock: 'That did not unlock your backup. Check it and try again.',
  saveFailed: 'Could not save your trade key backup. Try again.',
  passkeyLabel: (label: string): string => `Passkey: ${label}`,
  securityKeyLabel: (label: string): string => `Security key: ${label}`,
  pgpLabel: (label: string): string => `PGP key: ${label}`,
  unknownKey: 'A key not on your account now',
  /** The PGP steps. */
  pgpDecrypt: 'Decrypt this message with your PGP key, then paste what it says below.',
  pgpCopy: 'Copy message',
  pgpCopied: 'Copied',
  pgpPaste: 'The decrypted text',
  pgpUnlock: 'Unlock',
  /** Restore. */
  restoreTitle: 'Restore on this device',
  restoreAbout: 'Unlock your backup to bring your open trades to this device.',
  restore: 'Restore my trades',
  restoring: 'Restoring your trades.',
  restored: (n: number): string => (n === 0 ? 'Nothing to restore. This device already has every trade in your backup.' : n === 1 ? 'Restored 1 trade to this device.' : `Restored ${n} trades to this device.`),
  restoreFailed: 'Could not restore your trades. Try again.',
} as const;

/** COPY-UNSIGNED: on the Team screen, for a member holding "Hold trade keys". */
export const TEAM_KEYS_COPY = {
  ready: 'Trade key backup set up',
  waiting: 'No trade key backup yet. They set it up in their own Security settings.',
} as const;
