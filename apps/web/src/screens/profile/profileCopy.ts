// Plan 5 Tasks 5 and 12: the words of the profile, badge settings and record screens. Lines from the
// Profile and BadgeSettings boards (design/x2f-app) are as drawn; every other line is
// COPY-UNSIGNED for the owner. The board's cancel tile ("2% trades cancelled") is NOT shown: the
// cancel figure is moderators' only (owner T-017, P5-A9). The board's "Reviews are examples." is a
// note on the drawing, not app copy.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-03" → "Mar 2025"; anything else as it came. */
export function monthName(yyyyMm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm);
  if (!m) return yyyyMm;
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${MONTHS[i]} ${m[1]}` : yyyyMm;
}

const n = (x: number) => x.toLocaleString('en-US');

export const PROFILE_COPY = {
  // Board: "Trader profile".
  title: 'Trader profile',
  // Board: "Online · member since Mar 2025". COPY-UNSIGNED: the offline form.
  presence: (online: boolean, since: string) => `${online ? 'Online' : 'Offline'} · member since ${monthName(since)}`,
  // Board stat labels.
  completed: 'completed trades',
  positive: (rated: number) => `positive (${n(rated)} ${rated === 1 ? 'review' : 'reviews'})`,
  typical: 'typical payment time',
  typicalValue: (min: number) => `~${n(min)} min`,
  // COPY-UNSIGNED: no rated review yet.
  noPct: 'No ratings yet',
  // Revision 2026-10-29c, COPY-UNSIGNED: "Disputes: 3 won, 1 lost", or "Disputes: none".
  disputes: (d: { won: number; lost: number }) => (d.won + d.lost === 0 ? 'Disputes: none' : `Disputes: ${n(d.won)} won, ${n(d.lost)} lost`),
  // Board.
  badges: 'Badges',
  chooseBadges: 'Choose badges',
  // COPY-UNSIGNED.
  noBadges: 'No badges yet.',
  recentReviews: 'Recent reviews',
  // COPY-UNSIGNED.
  noReviews: 'No reviews yet.',
  neutral: 'Neutral',
  starsLabel: (s: number) => `${s} ${s === 1 ? 'star' : 'stars'}`,
  // Board.
  pgp: 'Account protected with PGP',
  record: 'Signed trade history available ·',
  verify: 'Verify',
  offers: (count: number) => `Offers (${n(count)})`,
  // COPY-UNSIGNED: the owner's own profile links.
  myOffers: (count: number) => `My offers (${n(count)})`,
  recordSettings: 'Signed record',
  // COPY-UNSIGNED: opt-in volume lines, the offer cards' words.
  traded: (xmr: number) => `${n(xmr)}+ XMR traded to date`,
  imported: (l: { site: string; overUsd: number }) => `$${n(l.overUsd)}+ on ${l.site}, verified`,
  // COPY-UNSIGNED.
  notFound: 'No trader has that name.',
  loadFailed: "The profile couldn't be loaded. Try again.",
  retry: 'Try again',
  loading: 'Loading…',
} as const;

export const BADGE_COPY = {
  // Board: "Your badges", "On your offers", "Featured N of 2", "Earned", "Next milestones" and the footer.
  title: 'Your badges',
  preview: 'On your offers',
  featuredCount: (k: number) => `Featured ${k} of 2`,
  earned: 'Earned',
  levels: { featured: 'Featured', hover: 'On hover', hidden: 'Hidden' } as const,
  next: 'Next milestones',
  progress: (have: number, need: number) => `${n(have)} / ${n(need)}`,
  // not-a-refusal: the board's standing footer about New, shown on every visit, not the answer to an action
  newFixed: "The New badge always shows while you have it and can't be hidden.",
  // COPY-UNSIGNED.
  none: 'No badges earned yet. They come from your trades and your account security.',
  failed: "That change didn't save. Try again.",
  loadFailed: "Your badges couldn't be loaded. Try again.",
} as const;

export const RECORD_COPY = {
  // COPY-UNSIGNED: the whole RecordExport and public record screens (no board).
  title: 'Signed record',
  intro:
    'A copy of your X2F reputation signed with X2F’s official PGP key: your completed trades, % positive and one line per review (month, your role, the rating and phrases). It never lists amounts, payment methods, notes or who you traded with.',
  includePgp: 'Include my PGP fingerprint',
  includePgpNote: 'Your fingerprint can link this record to your PGP key and anything published with it. Off unless you tick it.',
  download: 'Download signed record',
  ready: 'Your record is ready.',
  save: 'Save the file',
  slowDown: (s: number) => `You can make a new record in ${s} s.`,
  failed: "The record couldn't be made. Try again.",
  show: 'Show on my profile',
  showNote: 'Anyone signed in to X2F can then read it from your profile. The copy on your profile never lists a PGP fingerprint.',
  pgpHint: 'Using PGP? Add your own signature to the downloaded file with your PGP app (for example gpg --clearsign), so others can check it came from your key too.',
  publicTitle: (name: string) => `${name}’s signed record`,
  publicNote: 'Signed by X2F. Check the signature with X2F’s public key in your PGP app.',
  publicMissing: "This trader hasn't shared a signed record.",
  fileName: (isoDate: string) => `x2f-reputation-${isoDate}.txt`,
} as const;
