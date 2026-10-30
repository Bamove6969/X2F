import { describe, expect, it } from 'vitest';
import {
  BADGES,
  BadgeError,
  MIN_REVIEWS_TRUSTED,
  applyChoice,
  earnedBadges,
  levelShown,
  nextMilestones,
  pastRepLabel,
  resolveVisibility,
  type BadgeFacts,
  type BadgeId,
  type BadgePrefs,
} from '../src/index.js';

const NOW = new Date('2026-10-30T12:00:00Z');
const yearsAgo = (y: number, extraMs = 0) => {
  const d = new Date(NOW);
  d.setUTCFullYear(d.getUTCFullYear() - y);
  return new Date(d.getTime() + extraMs);
};

const base: BadgeFacts = {
  stage: 'graduated',
  completedTrades: 0,
  positivePct: null,
  ratedReviews: 50,
  typicalMinutes: null,
  typicalSamples: 0,
  lostDisputes: 0,
  accountCreatedAt: yearsAgo(0, -86_400_000),
  hasPgp: false,
  hasSecurityKey: false,
  pastRep: [],
};
const facts = (f: Partial<BadgeFacts>): BadgeFacts => ({ ...base, ...f });
const sorted = (xs: readonly string[]) => [...xs].sort();
const fresh: BadgePrefs = { chosen: false, levels: {}, order: [] };

function errOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof BadgeError) return e.code;
    throw e;
  }
  return 'no-throw';
}

describe('BADGES catalogue', () => {
  it('uses the board meanings', () => {
    expect(BADGES.trusted.meaning).toBe('100+ trades and 98%+ positive');
    expect(BADGES.fast.meaning).toBe('Usually pays or releases within 10 min');
    expect(BADGES['veteran-1'].meaning).toBe('Trading on X2F for 1+ year');
    expect(BADGES.pgp.meaning).toBe('Signs in with a verified PGP key');
    expect(BADGES['security-key'].meaning).toBe('Protects the account with a hardware key');
    expect(BADGES['trades-100'].meaning).toBe('Completed 100 trades');
    expect(BADGES['trades-1000'].label).toBe('1,000 trades');
    expect(BADGES.pgp.label).toBe('PGP verified');
    expect(BADGES['security-key'].label).toBe('Security key verified');
  });
  it('New is the only caution badge', () => {
    for (const [id, b] of Object.entries(BADGES)) expect(b.tone).toBe(id === 'new' ? 'caution' : 'escrow');
  });
  it('uses the spec icons (lucide names, P5-A16)', () => {
    expect([BADGES.new.icon, BADGES.trusted.icon, BADGES.fast.icon, BADGES['veteran-3'].icon, BADGES.pgp.icon, BADGES['security-key'].icon]).toEqual([
      'Sprout',
      'ShieldCheck',
      'Zap',
      'Star',
      'KeyRound',
      'Usb',
    ]);
    expect([BADGES['trades-10'].icon, BADGES['clean-record'].icon]).toEqual(['Trophy', 'BadgeCheck']);
  });
  it('has no volume badge (spec 5.4)', () => {
    const volume = /\$|usd|xmr|volume|traded/i;
    for (const [id, b] of Object.entries(BADGES)) {
      expect(id).not.toMatch(volume);
      expect(b.label).not.toMatch(volume);
      expect(b.meaning).not.toMatch(volume);
    }
    expect(pastRepLabel('LocalMonero', 1240)).not.toMatch(volume);
  });
});

describe('earnedBadges', () => {
  it('New follows the stage, not the count (spec 2.3)', () => {
    expect(earnedBadges(facts({ stage: 'building', completedTrades: 7 }), NOW)).toContain('new');
    expect(earnedBadges(facts({ stage: 'starter', completedTrades: 0 }), NOW)).toContain('new');
    expect(earnedBadges(facts({ stage: 'graduated', completedTrades: 20 }), NOW)).not.toContain('new');
    expect(earnedBadges(facts({ stage: 'graduated', completedTrades: 4 }), NOW)).not.toContain('new');
  });
  it('the plan example', () => {
    const f = facts({ completedTrades: 212, positivePct: 99, typicalMinutes: 6, typicalSamples: 20, lostDisputes: 0, accountCreatedAt: yearsAgo(2), hasPgp: true });
    expect(sorted(earnedBadges(f, NOW))).toEqual(sorted(['trades-100', 'veteran-1', 'trusted', 'fast', 'clean-record', 'pgp']));
  });
  it('only the highest trade milestone', () => {
    const ms = (n: number) => earnedBadges(facts({ completedTrades: n }), NOW).filter((b) => b.startsWith('trades-'));
    expect(ms(9)).toEqual([]);
    expect(ms(10)).toEqual(['trades-10']);
    expect(ms(499)).toEqual(['trades-100']);
    expect(ms(1000)).toEqual(['trades-1000']);
    expect(ms(5000)).toEqual(['trades-1000']);
  });
  it('only the highest Veteran step, by whole years', () => {
    const vet = (d: Date) => earnedBadges(facts({ accountCreatedAt: d }), NOW).filter((b) => b.startsWith('veteran-'));
    expect(vet(yearsAgo(1, 1))).toEqual([]);
    expect(vet(yearsAgo(1))).toEqual(['veteran-1']);
    expect(vet(yearsAgo(3))).toEqual(['veteran-3']);
    expect(vet(yearsAgo(5, 1))).toEqual(['veteran-3']);
    expect(vet(yearsAgo(9))).toEqual(['veteran-5']);
  });
  it('Trusted needs 100 trades and 98%', () => {
    expect(earnedBadges(facts({ completedTrades: 150, positivePct: 97 }), NOW)).not.toContain('trusted');
    expect(earnedBadges(facts({ completedTrades: 150, positivePct: null }), NOW)).not.toContain('trusted');
    expect(earnedBadges(facts({ completedTrades: 99, positivePct: 100 }), NOW)).not.toContain('trusted');
    expect(earnedBadges(facts({ completedTrades: 100, positivePct: 98 }), NOW)).toContain('trusted');
  });
  it('Trusted needs at least 5 rated reviews (review M4, provisional)', () => {
    expect(MIN_REVIEWS_TRUSTED).toBe(5);
    expect(earnedBadges(facts({ completedTrades: 100, positivePct: 100, ratedReviews: 4 }), NOW)).not.toContain('trusted');
    expect(earnedBadges(facts({ completedTrades: 100, positivePct: 100, ratedReviews: 5 }), NOW)).toContain('trusted');
  });
  it('Clean record needs 100 completed trades and no lost dispute ever', () => {
    expect(earnedBadges(facts({ completedTrades: 150, lostDisputes: 1 }), NOW)).not.toContain('clean-record');
    expect(earnedBadges(facts({ completedTrades: 99 }), NOW)).not.toContain('clean-record');
    expect(earnedBadges(facts({ completedTrades: 100 }), NOW)).toContain('clean-record');
  });
  it('a lost dispute still counts toward milestones and Trusted (R38)', () => {
    const f = facts({ completedTrades: 100, positivePct: 99, lostDisputes: 3 });
    const got = earnedBadges(f, NOW);
    expect(got).toContain('trades-100');
    expect(got).toContain('trusted');
    expect(got).not.toContain('clean-record');
  });
  it('Fast needs 10 min or less over at least 5 samples', () => {
    expect(earnedBadges(facts({ typicalMinutes: 6, typicalSamples: 4 }), NOW)).not.toContain('fast');
    expect(earnedBadges(facts({ typicalMinutes: 11, typicalSamples: 20 }), NOW)).not.toContain('fast');
    expect(earnedBadges(facts({ typicalMinutes: 10, typicalSamples: 5 }), NOW)).toContain('fast');
    expect(earnedBadges(facts({ typicalMinutes: null, typicalSamples: 20 }), NOW)).not.toContain('fast');
  });
  it('security honours and past reputation', () => {
    const got = earnedBadges(facts({ hasSecurityKey: true, pastRep: [{ id: 'abc', site: 'LocalMonero', trades: 1240 }] }), NOW);
    expect(got).toContain('security-key');
    expect(got).toContain('past-rep:abc');
    expect(got).not.toContain('pgp');
  });
  it('past reputation never changes milestones, Trusted or Clean record (spec 5.5)', () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const sites = ['LocalMonero', 'AgoraDesk', 'Paxful', 'Other'];
    const core = (ids: BadgeId[]) => ids.filter((b) => !b.startsWith('past-rep:'));
    for (let i = 0; i < 300; i++) {
      const f = facts({
        stage: (['starter', 'building', 'graduated'] as const)[rnd(3)]!,
        completedTrades: rnd(1200),
        positivePct: rnd(5) === 0 ? null : 90 + rnd(11),
        typicalMinutes: rnd(30),
        typicalSamples: rnd(21),
        lostDisputes: rnd(3),
        accountCreatedAt: yearsAgo(rnd(7)),
        hasPgp: rnd(2) === 0,
        hasSecurityKey: rnd(2) === 0,
      });
      const pastRep = Array.from({ length: 1 + rnd(4) }, (_, k) => ({ id: `p${k}`, site: sites[rnd(4)]!, trades: rnd(100_000) }));
      expect(core(earnedBadges({ ...f, pastRep }, NOW))).toEqual(earnedBadges(f, NOW));
    }
  });
});

describe('resolveVisibility', () => {
  const earned: BadgeId[] = ['trusted', 'trades-100', 'fast', 'veteran-1', 'pgp'];
  it('defaults with no choices: Trusted, highest milestone, Fast, Veteran (spec 5.4)', () => {
    expect(resolveVisibility(earned, fresh)).toEqual({ featured: ['trusted', 'trades-100'], more: ['fast', 'veteran-1', 'pgp'] });
  });
  it('New takes the first Featured slot (P5-A11)', () => {
    expect(resolveVisibility(['new', ...earned], fresh)).toEqual({ featured: ['new', 'trusted'], more: ['trades-100', 'fast', 'veteran-1', 'pgp'] });
  });
  it('defaults skip what is not earned', () => {
    expect(resolveVisibility(['pgp', 'veteran-3', 'fast'], fresh)).toEqual({ featured: ['fast', 'veteran-3'], more: ['pgp'] });
  });
  it('saved choices apply; newly earned badges start On hover (P5-A15)', () => {
    const prefs: BadgePrefs = { chosen: true, levels: { pgp: 'featured', trusted: 'hover', fast: 'hidden' }, order: ['pgp'] };
    expect(resolveVisibility([...earned, 'clean-record'], prefs)).toEqual({ featured: ['pgp'], more: ['trusted', 'trades-100', 'veteran-1', 'clean-record'] });
  });
  it('a Hidden badge is in neither list', () => {
    const r = resolveVisibility(earned, { chosen: true, levels: { pgp: 'hidden' }, order: [] });
    expect(r.featured).not.toContain('pgp');
    expect(r.more).not.toContain('pgp');
  });
  it('New stays featured whatever the saved levels say', () => {
    const forced = { chosen: true, levels: { new: 'hidden' }, order: [] } as unknown as BadgePrefs;
    expect(resolveVisibility(['new', 'pgp'], forced).featured).toEqual(['new']);
  });
  it('a lost Featured badge frees its slot; nothing is promoted (P5-A15)', () => {
    const prefs: BadgePrefs = { chosen: true, levels: { trusted: 'featured', fast: 'featured', pgp: 'hover' }, order: ['trusted', 'fast'] };
    expect(resolveVisibility(['fast', 'pgp'], prefs)).toEqual({ featured: ['fast'], more: ['pgp'] });
  });
  it('never more than 2 featured, even from a bad saved row', () => {
    const prefs: BadgePrefs = { chosen: true, levels: { trusted: 'featured', fast: 'featured', pgp: 'featured' }, order: ['trusted', 'fast', 'pgp'] };
    expect(resolveVisibility(earned, prefs).featured).toEqual(['trusted', 'fast']);
    expect(resolveVisibility(['new', ...earned], prefs).featured).toEqual(['new', 'trusted']);
    expect(resolveVisibility(['new', ...earned], prefs).more).toContain('fast');
  });
  it('drops ids that are not earned', () => {
    const prefs: BadgePrefs = { chosen: true, levels: { 'past-rep:x': 'featured' }, order: ['past-rep:x'] };
    expect(resolveVisibility(['pgp'], prefs)).toEqual({ featured: [], more: ['pgp'] });
  });
});

describe('applyChoice', () => {
  const earned: BadgeId[] = ['trusted', 'trades-100', 'fast', 'veteran-1', 'pgp'];
  it('featuring a third moves the oldest to On hover with the board notice', () => {
    const { prefs, notice } = applyChoice(earned, fresh, 'pgp', 'featured');
    expect(notice).toBe('Trusted moved to On hover. Only 2 badges can be featured.');
    expect(prefs.chosen).toBe(true);
    expect(resolveVisibility(earned, prefs)).toEqual({ featured: ['trades-100', 'pgp'], more: ['trusted', 'fast', 'veteran-1'] });
  });
  it('the first choice keeps the defaults as saved levels', () => {
    const { prefs, notice } = applyChoice(earned, fresh, 'veteran-1', 'hidden');
    expect(notice).toBeNull();
    expect(resolveVisibility(earned, prefs)).toEqual({ featured: ['trusted', 'trades-100'], more: ['fast', 'pgp'] });
  });
  it('with New, a second featured badge bumps the first', () => {
    const one = applyChoice(['new', ...earned], fresh, 'pgp', 'featured');
    expect(one.notice).toBe('Trusted moved to On hover. Only 2 badges can be featured.');
    expect(resolveVisibility(['new', ...earned], one.prefs).featured).toEqual(['new', 'pgp']);
  });
  it('re-featuring a featured badge changes nothing and gives no notice', () => {
    const { prefs, notice } = applyChoice(earned, fresh, 'trusted', 'featured');
    expect(notice).toBeNull();
    expect(resolveVisibility(earned, prefs).featured).toEqual(['trusted', 'trades-100']);
  });
  it('moving a featured badge to hover frees its slot', () => {
    const { prefs } = applyChoice(earned, fresh, 'trusted', 'hover');
    expect(resolveVisibility(earned, prefs)).toEqual({ featured: ['trades-100'], more: ['trusted', 'fast', 'veteran-1', 'pgp'] });
  });
  it('New is fixed; an unearned badge is refused', () => {
    expect(errOf(() => applyChoice(['new', ...earned], fresh, 'new', 'hidden'))).toBe('new-is-fixed');
    expect(errOf(() => applyChoice(['new', ...earned], fresh, 'new', 'featured'))).toBe('new-is-fixed');
    expect(errOf(() => applyChoice(earned, fresh, 'clean-record', 'featured'))).toBe('not-earned');
  });
  it('does not mutate the given prefs', () => {
    const prefs: BadgePrefs = { chosen: true, levels: { trusted: 'featured' }, order: ['trusted'] };
    const copy = structuredClone(prefs);
    applyChoice(earned, prefs, 'pgp', 'featured');
    expect(prefs).toEqual(copy);
  });
});

describe('nextMilestones', () => {
  it('the next trade milestone and Clean record while no dispute is lost', () => {
    expect(nextMilestones(facts({ completedTrades: 88 }))).toEqual([
      { label: '100 trades', have: 88, need: 100 },
      { label: 'Clean record', have: 88, need: 100 },
    ]);
    expect(nextMilestones(facts({ completedTrades: 212 }))).toEqual([{ label: '500 trades', have: 212, need: 500 }]);
  });
  it('no Clean record once a dispute is lost; nothing after 1,000', () => {
    expect(nextMilestones(facts({ completedTrades: 5, lostDisputes: 1 }))).toEqual([{ label: '10 trades', have: 5, need: 10 }]);
    expect(nextMilestones(facts({ completedTrades: 1000 }))).toEqual([]);
  });
});

describe('pastRepLabel (spec 5.5)', () => {
  it('formats with thousands separators', () => {
    expect(pastRepLabel('LocalMonero', 1240)).toBe('Verified: 1,240 trades on LocalMonero (PGP proof)');
    expect(pastRepLabel('Bisq', 7)).toBe('Verified: 7 trades on Bisq (PGP proof)');
    expect(pastRepLabel('Paxful', 1_234_567)).toBe('Verified: 1,234,567 trades on Paxful (PGP proof)');
  });
});

describe('no automatic promotion (review M2, P5-A15)', () => {
  it('a lost, re-earned badge does not jump back to Featured', () => {
    let prefs = applyChoice(['trusted', 'fast', 'pgp'], fresh, 'trusted', 'featured').prefs;
    // Trusted is lost; the trader features PGP.
    prefs = applyChoice(['fast', 'pgp'], prefs, 'pgp', 'featured').prefs;
    expect(prefs.levels.trusted).toBe('hover');
    // Trusted is re-earned.
    const back: BadgeId[] = ['trusted', 'fast', 'pgp'];
    expect(resolveVisibility(back, prefs)).toEqual({ featured: ['fast', 'pgp'], more: ['trusted'] });
    expect(levelShown(back, prefs, 'trusted')).toBe('hover');
    // PGP to On hover: Trusted must stay On hover.
    prefs = applyChoice(back, prefs, 'pgp', 'hover').prefs;
    expect(resolveVisibility(back, prefs)).toEqual({ featured: ['fast'], more: ['trusted', 'pgp'] });
  });
  it('a featured level outside the saved order is not shown as Featured', () => {
    const prefs: BadgePrefs = { chosen: true, levels: { trusted: 'featured', fast: 'featured' }, order: ['fast'] };
    expect(resolveVisibility(['trusted', 'fast'], prefs)).toEqual({ featured: ['fast'], more: ['trusted'] });
    expect(levelShown(['trusted', 'fast'], prefs, 'trusted')).toBe('hover');
  });
  it('levelShown agrees with the lists', () => {
    const earned: BadgeId[] = ['new', 'trusted', 'trades-100', 'fast', 'pgp'];
    const prefs: BadgePrefs = { chosen: true, levels: { pgp: 'hidden', fast: 'featured', new: 'hidden' } as BadgePrefs['levels'], order: ['fast'] };
    const r = resolveVisibility(earned, prefs);
    for (const id of earned) {
      const l = levelShown(earned, prefs, id);
      expect(l === 'featured').toBe(r.featured.includes(id));
      expect(l === 'hover').toBe(r.more.includes(id));
    }
    expect(levelShown(earned, prefs, 'new')).toBe('featured');
    expect(levelShown(earned, prefs, 'pgp')).toBe('hidden');
    expect(levelShown(earned, prefs, 'clean-record')).toBeNull();
    expect(levelShown(['trusted'], fresh, 'trusted')).toBe('featured');
  });
});
