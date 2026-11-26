// The Away switch (owner, 26 Nov 2026), on Settings, Account. COPY-UNSIGNED: no board yet
// (DESIGNER-REVIEW). Why an offer stayed off is the My offers row text (ui/cantDoCodes.ts
// `myOffersRowText`), so the reasons read the same in both places.

const offers = (n: number) => `${n} ${n === 1 ? 'offer' : 'offers'}`;

export const AWAY_COPY = {
  title: 'Away',
  label: "I'm away",
  hint: 'Pauses all your live offers and shows Away on your profile. Turning it off puts back on only the offers it paused.',
  since: (when: string) => `Away since ${when}.`,
  paused: (n: number) => (n === 0 ? 'Away is on. You had no live offers to pause.' : `Away is on. ${offers(n)} paused.`),
  resumed: (on: number, off: number) => {
    const parts = [on === 0 ? 'Away is off. No offers went back on.' : `Away is off. ${offers(on)} back on.`];
    if (off > 0) parts.push(`${offers(off)} stayed off; each one says why below. Turn ${off === 1 ? 'it' : 'them'} on from My offers when ready.`);
    return parts.join(' ');
  },
  /** An offer the result names that the My offers list no longer had when the switch ran. */
  unnamed: 'An offer',
  failed: "Something went wrong and Away wasn't changed. Try again.",
  loadFailed: 'Could not load your Away setting. Try again later.',
} as const;
