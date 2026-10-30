// TRIPWIRES for Plan 7 Task 2 (the whole-trade purge, apps/api/src/retention/tradePurge.ts). Each
// looks at this checkout only (files in the tree, never git or a remote) and fails once the named
// work lands without the purge following it. Every NEEDS_* here is MUST-LAND-BEFORE
// X2F_TRADE_PURGE=on (docs/coordination.md Plan 7, docs/dev-setup.md, the tradePurge.ts SEAMS).
// (Tables with a foreign key to trades, such as Plan 5's `reviews` and `trade_proofs` or Task 20's
// `chats`, are caught by tradePurge.test.ts's foreign-key test instead.)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const API = fileURLToPath(new URL('../', import.meta.url));
const MOD = fileURLToPath(new URL('../../moderation/', import.meta.url));
// NEEDS_TASK_38_AWAITING retired 2026-10-30: Task 38 landed and tradePurge sets awaitingAction
// from cancel_confirmed_at (tested in tradePurge.test.ts). The purge stays off by default
// (X2F_TRADE_PURGE) until the checks below are met.

/** SQL without `--` comments (a comment naming a column is not the column). */
const sqlCode = (s: string) => s.replace(/--[^\n]*/g, '');
/** TypeScript without comments (a comment naming a table is not a query on it). */
const tsCode = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const sqlDir = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => sqlCode(readFileSync(`${dir}${f}`, 'utf8'))).join('\n') : '';
/** Every .ts/.tsx file under `dir`, comments stripped, by path. */
function tsTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = `${dir}${f}`;
    if (statSync(p).isDirectory()) for (const [k, v] of tsTree(`${p}/`)) out.set(k, v);
    else if (/\.tsx?$/.test(f)) out.set(p, tsCode(readFileSync(p, 'utf8')));
  }
  return out;
}

const migrations = sqlDir(`${API}migrations/`);
const modMigrations = sqlDir(`${MOD}migrations/`);
const purgeSrc = readFileSync(`${API}src/retention/tradePurge.ts`, 'utf8');
const purge = tsCode(purgeSrc);
const jobs = readFileSync(`${API}src/retentionJobs.ts`, 'utf8');
const apiSrc = tsTree(`${API}src/`);
const modSrc = tsTree(`${MOD}src/`);
const config = tsCode(readFileSync(`${API}src/config.ts`, 'utf8'));
const APPS = fileURLToPath(new URL('../../', import.meta.url));
const TRADE_SRC = fileURLToPath(new URL('../../../packages/trade/src/', import.meta.url));
/** Every app's src (apps/*\/src) and packages/trade/src, comments stripped, by path. */
const allSrc = new Map<string, string>([
  ...readdirSync(APPS).flatMap((a) => [...tsTree(`${APPS}${a}/src/`)]),
  ...tsTree(TRADE_SRC),
]);
/** Every app's migrations, `--` comments stripped. */
const allMigrations = readdirSync(APPS).map((a) => sqlDir(`${APPS}${a}/migrations/`)).join('\n');

/** The moderation tables keyed by a trade code (a `trade` column), from its migrations. */
function modTradeTables(): string[] {
  const out: string[] = [];
  for (const m of modMigrations.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    if (/^\s*(trade|trade_code|code)\s/m.test(m[2]!)) out.push(m[1]!);
  }
  return out.sort();
}
// mod_escrow_state, mod_watch and mod_sweeps come with Plan 3 Task 9 I/O (moderation 003/005, review
// R2-I1): listed now so the tripwire stays green when Task 9 lands.
const MOD_OWED = ['mod_escrow_state', 'mod_party_state', 'mod_sweeps', 'mod_wallet_secrets', 'mod_watch', 'signed_terms'];
/** The moderator's escrow key material and party state: deleted only once the escrow is shown empty and the watch dropped it. */
const MOD_KEYS = ['mod_escrow_state', 'mod_party_state', 'mod_wallet_secrets'];
/** The purge (or a moderation purge) reads the escrow-empty fact (review R2-I2). */
const ESCROW_EMPTY = /escrow_empty|escrowEmpty|mayHoldCoins/;
/** The purge reads the moderation watch's drop of the escrow (review I4a). */
const WATCH_DROP = /watchDropped|watch_dropped|watch-dropped/;
/**
 * The two lines of today's release payout (@x2f/trade payouts.ts) that pay a surplus to the
 * seller's refund address. The owner's surplus rule (the surplus stays in the escrow until the
 * seller disputes) must change them, so they do not count as the surplus feature landing.
 */
const TODAY_SURPLUS = [/const surplus = balance - f\.sellerFundsAtomic;/g, /\{ address: f\.sellerRefund, amountAtomic: surplus \}/g];
/**
 * The release case of @x2f/trade payouts.ts (from `case 'release'` to the next case or `default:`),
 * or null when there is none (a renamed kind or a moved payout fires the tripwire too).
 */
function releaseCase(): string | null {
  const f = `${TRADE_SRC}payouts.ts`;
  if (!existsSync(f)) return null;
  return /case\s+'release'\s*:([\s\S]*?)(?=\n\s*(?:case\s+'|default\s*:))/.exec(tsCode(readFileSync(f, 'utf8')))?.[1] ?? null;
}
/**
 * Review R3-m1: every kind the moderation watcher reports to the API, classified. A new kind (in
 * the API's `/internal/v1/reports` switch, or a `kind: '...'` / `kind === '...'` in moderation src)
 * fails NEEDS_I4_WATCH_DROP until it is classified here: `watch-drop` if it tells the API the watch
 * stopped watching an escrow (or anything the purge must wait for), `not-purge` otherwise. A
 * `watch-drop` kind makes the purge read the drop (WATCH_DROP).
 */
const WATCHER_KINDS: Record<string, 'not-purge' | 'watch-drop'> = {
  attestation: 'not-purge', // Task 8: the moderator's attestation of a trade's terms
  refused: 'not-purge', // the moderator's terminal refusal of a trade (before any escrow)
  'setup-done': 'not-purge',
  chain: 'not-purge',
  settled: 'not-purge',
  'spend-unshown': 'not-purge',
  'release-claimed': 'not-purge',
  'late-funds': 'not-purge', // the "stays off" gate's late-funds conditions cover it (I4a, R3-m4)
};
/**
 * Review R3-m1: columns of the moderation watch or of `trades` named for watching or a drop, as of
 * today. A new one (say `trades.watch_ended_at`) fails NEEDS_I4_WATCH_DROP until it is listed here
 * and the purge reads the drop.
 */
const WATCH_COLUMNS = ['mod_watch', 'watching'];
/** TRADE_PURGE_READY (config.ts) lets X2F_TRADE_PURGE=on through outside tests (review R2-m1). */
const ready = /\bTRADE_PURGE_READY\s*(?::\s*boolean\s*)?=\s*true\b/.test(config);


describe('Plan 7 Task 2 seams (MUST LAND BEFORE X2F_TRADE_PURGE=on)', () => {
  it('NEEDS_PLAN_4_TASK_32_LEDGER: the revenue ledger holds a trade before it is purged (a real query, review M5)', () => {
    if (/create table (if not exists )?revenue_ledger/i.test(migrations)) {
      // A comment naming the table does not count: the purge must query it (or its per-trade mark).
      expect(purge).toMatch(/\b(from|join|into|update)\s+revenue_ledger\b/i);
    }
  });

  it('NEEDS_PLAN_7_TASK_14_STATS: daily statistics are collected before every purge', () => {
    if (/create table daily_stats/i.test(migrations)) {
      expect(jobs.indexOf('collectDailyStats')).toBeGreaterThan(-1);
      expect(jobs.indexOf('collectDailyStats')).toBeLessThan(jobs.indexOf('purgeTradesJob,'));
    }
  });

  it('NEEDS_PLAN_5_RUNNING_TOTALS: the running totals (and the lost-dispute record) outlive the trade (review M5)', () => {
    // Plan 5 Task 20's `account_totals` (completed, lost_disputes, won_disputes, ...) replaces
    // `completed_trades_purged`: the purge must add the trade to it (or check it was added) first.
    if (/create table (if not exists )?account_totals/i.test(migrations)) expect(purge).toMatch(/\baccount_totals\b|\baddToTotals\b/);
    // Who lost a dispute must survive the purge (108's header). `lostDisputeCount` reads `disputes`,
    // which the purge deletes: once it exists, the lost-dispute count must live in a running total.
    const lost = [...apiSrc].some(([p, s]) => !p.endsWith('tradePurge.ts') && /function lostDisputeCount\b/.test(s));
    if (lost) {
      expect(migrations, 'lostDisputeCount exists: keep lost disputes in a running total that survives the purge').toMatch(/lost_disputes/);
      expect(purge).toMatch(/\baccount_totals\b|\baddToTotals\b|\blost_disputes\b/);
    }
  });

  it('NEEDS_I4_WATCH_DROP: once the moderation watch reports dropping an escrow, the purge waits for that drop (review I4a, R2-I1)', () => {
    // The watch (@x2f/trade watch.ts) keeps watching WATCH_CLOSED_DAYS after it SAW the close, and
    // watches a lapsed trade that closed empty as open. Late funds are wired today (Task 9 I/O,
    // `'late-funds'`), so that condition is in the "stays off" gate below. This one fires on a FUTURE
    // drop report: a `'watch-dropped'` kind, a `watching` value reported to the API, or a
    // `watch_dropped` column in a migration. The purge must then read it before it deletes.
    const report = [...allSrc]
      .filter(([p, s]) => !p.endsWith('tradePurge.ts') && (/['"`]watch-dropped['"`]/.test(s) || /\breport\(\s*\{[^}]*\bwatching\s*:/.test(s) || (p.startsWith(API) && /['"`]watching['"`]/.test(s))))
      .map(([p]) => p);
    if (/\bwatch_dropped/i.test(allMigrations)) report.push('a migration (watch_dropped)');
    // Review R3-m1: every watcher report kind is classified (WATCHER_KINDS), whatever its name.
    const kinds = new Set<string>();
    const routes = apiSrc.get(`${API}src/internal/routes.ts`) ?? '';
    for (const m of routes.matchAll(/\bcase\s+'([a-z][a-z0-9-]*)'\s*:/g)) kinds.add(m[1]!);
    for (const src of [routes, ...modSrc.values()]) {
      for (const m of src.matchAll(/(?<!typeof\s+[\w.]*)\bkind\s*(?::|[!=]==)\s*['"`]([a-z][a-z0-9-]*)['"`]/g)) kinds.add(m[1]!);
    }
    const unclassified = [...kinds].filter((k) => !(k in WATCHER_KINDS)).sort();
    expect(unclassified, 'a new watcher report kind: classify it in WATCHER_KINDS (does the purge have to wait for it? tradePurge.ts SEAMS, I4a)').toEqual([]);
    report.push(...[...kinds].filter((k) => WATCHER_KINDS[k] === 'watch-drop').map((k) => `the '${k}' report kind`));
    // ... and every migration column named for watching or a drop.
    const cols = new Set([...allMigrations.matchAll(/\b\w*(?:watch|drop)\w*\b/gi)].map((m) => m[0].toLowerCase()).filter((c) => c !== 'drop'));
    const newCols = [...cols].filter((c) => !WATCH_COLUMNS.includes(c)).sort();
    expect(newCols, 'a new watch or drop column in a migration: list it in WATCH_COLUMNS once the purge reads the drop (WATCH_DROP)').toEqual([]);
    if (report.length > 0) expect(purge, `a watch-drop report exists in ${report.join(', ')}: the purge must read it (tradePurge.ts SEAMS, I4a)`).toMatch(WATCH_DROP);
  });

  it('NEEDS_I4_LIENS: the purge keeps a trade while a lien or a trading hold names it (review I4b)', () => {
    const liens = /create table (if not exists )?liens\b/i.test(migrations);
    const holdDispute =
      /alter table (if exists )?trading_holds[^;]*\bdispute_code\b/i.test(migrations) ||
      /create table (if not exists )?trading_holds\s*\([^;]*\bdispute_code\b/i.test(migrations);
    if (liens) expect(purge).toMatch(/\bliens\b/);
    if (holdDispute) expect(purge).toMatch(/\btrading_holds\b/);
  });

  it('NEEDS_I5_MOD_ROWS: every per-trade moderation table is on the Owed list, and a moderation purge deletes all of them (review I5)', () => {
    // Owed: x2f_moderation's per-trade rows outlive the API's purge. signed_terms holds the payout and
    // refund addresses, amounts and currency. A new per-trade table must join the list.
    const tables = modTradeTables();
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(MOD_OWED, `${t} keys a trade in x2f_moderation: add it to the Owed item (tradePurge.ts SEAMS, coordination.md)`).toContain(t);
    for (const t of MOD_OWED) expect(purgeSrc, `${t} must be named in tradePurge.ts SEAMS`).toContain(t);
    const deletes = [...modSrc.values()].join('\n');
    if (MOD_OWED.some((t) => new RegExp(`delete from ${t}\\b`, 'i').test(deletes))) {
      for (const t of tables) expect(deletes, `the moderation purge must delete ${t} too`).toMatch(new RegExp(`delete from ${t}\\b`, 'i'));
    }
  });

  it('NEEDS_ESCROW_EMPTY_GATE: once the surplus rule lands, the purge keeps a trade unless its escrow is shown empty (review R2-I2)', () => {
    // Owner rule: a surplus stays in the escrow until the seller disputes. Never purge unless the
    // escrow is shown empty; unknown = may hold coins (fail closed). Fires on `surplus` in any app's
    // src, packages/trade/src or a migration (today's payout lines excepted), or on a watcher report
    // kind such as `'escrow-empty'`.
    const hits = [...allSrc]
      .filter(([p, s]) => {
        if (p.endsWith('tradePurge.ts')) return false;
        const code = TODAY_SURPLUS.reduce((c, re) => c.replace(re, ''), s);
        return /surplus/i.test(code) || /['"`]escrow-empty['"`]/.test(code);
      })
      .map(([p]) => p);
    if (/surplus/i.test(allMigrations)) hits.push('a migration (surplus)');
    // Review R3-m1: the surplus rule most likely lands as a DELETION in payouts.ts's release case.
    // Today's two surplus lines must still be there, unchanged; if either is gone or changed, fire.
    const release = releaseCase();
    if (release === null || TODAY_SURPLUS.some((re) => !new RegExp(re.source).test(release))) {
      hits.push(`packages/trade/src/payouts.ts (the release case ${release === null ? 'is gone' : 'no longer pays today\'s surplus lines'})`);
    }
    if (hits.length > 0) expect(purge, `the surplus rule or an escrow-empty report exists in ${hits.join(', ')}: the purge must keep a trade unless its escrow is shown empty (tradePurge.ts SEAMS)`).toMatch(ESCROW_EMPTY);
    // The moderation purge deletes the escrow key material only after the same fact and the watch drop.
    const deletes = [...modSrc.values()].join('\n');
    if (MOD_KEYS.some((t) => new RegExp(`delete from ${t}\\b`, 'i').test(deletes))) {
      expect(deletes, 'the moderation purge deletes escrow key material: it must wait until the escrow is shown empty').toMatch(ESCROW_EMPTY);
      expect(deletes, 'the moderation purge deletes escrow key material: it must wait for the watch drop').toMatch(/watching\s*=\s*false|not\s+watching|watchDropped|watch_dropped/);
    }
  });

  /** Every seam above has landed (the "stays off" gate and TRADE_PURGE_READY). */
  function expectSeamsLanded(why: string) {
    expect(migrations, why).toMatch(/create table (if not exists )?revenue_ledger/i);
    expect(migrations, why).toMatch(/create table (if not exists )?daily_stats/i);
    expect(migrations, why).toMatch(/create table (if not exists )?account_totals/i);
    // Late funds are wired (Task 9 I/O): the purge waits for the watch drop or WATCH_CLOSED_DAYS plus a margin (I4a).
    expect(purge, why).toMatch(/WATCH_CLOSED_DAYS|watchDropped|watch_dropped/);
    expect(purge, why).toMatch(ESCROW_EMPTY);
    const deletes = [...modSrc.values()].join('\n');
    for (const t of MOD_OWED) expect(deletes, why).toMatch(new RegExp(`delete from ${t}\\b`, 'i'));
    // Review R3-m4: a `late-funds` report for an unknown (purged) trade code fails LOUDLY to staff,
    // never a quiet 404: the API file that takes `late-funds` raises an owner/staff alert.
    const lateFunds = [...apiSrc].filter(([p, s]) => !p.endsWith('tradePurge.ts') && /['"`]late-funds['"`]/.test(s));
    expect(lateFunds.length, `${why}: no API src takes a 'late-funds' report`).toBeGreaterThan(0);
    expect(
      lateFunds.some(([, s]) => /\b(addOwnerAlert|pushOwnerAlert|ownerAlertSink)\b/.test(s)),
      `${why}: a 'late-funds' report for an unknown trade must alert staff (an owner alert), not answer a quiet 404`,
    ).toBe(true);
  }

  it('X2F_TRADE_PURGE stays off by default until every seam above has landed', () => {
    // The default lives in tradePurgeFlag (`value || 'off'`) since R2-m1; an `|| 'on'` there, or at
    // the X2F_TRADE_PURGE read, is a default of on.
    const flagFn = /function tradePurgeFlag\b[\s\S]*?\n\}/.exec(config)?.[0] ?? '';
    expect(flagFn, 'tradePurgeFlag (config.ts) reads X2F_TRADE_PURGE').not.toBe('');
    const defaultOn = /X2F_TRADE_PURGE\s*\|\|\s*['"]on['"]/.test(config) || /\|\|\s*['"]on['"]/.test(flagFn) || !/\|\|\s*['"]off['"]/.test(flagFn);
    if (defaultOn) expectSeamsLanded('X2F_TRADE_PURGE defaults to on');
  });

  it('TRADE_PURGE_READY (config.ts) stays false until every seam above has landed (review R2-m1)', () => {
    expect(config).toMatch(/\bTRADE_PURGE_READY\b/);
    if (ready) expectSeamsLanded('TRADE_PURGE_READY is true');
  });
});
