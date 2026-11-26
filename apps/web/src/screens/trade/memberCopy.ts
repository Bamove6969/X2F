/**
 * A team member's trade room steps (owner Jess, 26 Nov 2026: fund, release, proof and I've paid as
 * separate boxes). Short plain sentences. No Claude Design board yet (NEEDS_DESIGN_TEAM in
 * test/team-tripwires.test.ts): kit parts and existing classes only.
 */
export const MEMBER_ROOM_COPY = {
  keysTitle: 'Trade keys on this device', // COPY-UNSIGNED
  keysAbout: "To act on this trade, load the account's trade keys on this device. Unlock them with your own passkey, security key or PGP key.", // COPY-UNSIGNED
  keysLoad: 'Load trade keys', // COPY-UNSIGNED
  keysPick: 'Pick the key to unlock with.', // COPY-UNSIGNED
  keysNoReader: 'You have no trade key backup yet. Set one up in Settings, Security. Then ask the account owner to open X2F.', // COPY-UNSIGNED
  keysNotInCopy: 'This trade is not in your copy of the keys yet. Ask the account owner to open X2F, then try again.', // COPY-UNSIGNED
  keysFailed: 'The trade keys did not load. Try again.', // COPY-UNSIGNED
  keysChecking: 'Checking this device…', // COPY-UNSIGNED
  keysLoading: 'Loading the trade keys…', // COPY-UNSIGNED
  fundTitle: 'Fund this trade', // COPY-UNSIGNED
  fundAbout: "You fund the escrow for the account. First confirm it's you with your passkey, security key or PGP key.", // COPY-UNSIGNED
  fundStart: 'Confirm and fund', // COPY-UNSIGNED
  fundFailed: 'Funding did not start. Try again.', // COPY-UNSIGNED
} as const;
