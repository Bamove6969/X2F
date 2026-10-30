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
/** Every .ts file under `dir`, comments stripped, by path. */
function tsTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = `${dir}${f}`;
    if (statSync(p).isDirectory()) for (const [k, v] of tsTree(`${p}/`)) out.set(k, v);
    else if (f.endsWith('.ts')) out.set(p, tsCode(readFileSync(p, 'utf8')));
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

/** The moderation tables keyed by a trade code (a `trade` column), from its migrations. */
function modTradeTables(): string[] {
  const out: string[] = [];
  for (const m of modMigrations.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    if (/^\s*(trade|trade_code|code)\s/m.test(m[2]!)) out.push(m[1]!);
  }
  return out.sort();
}
const MOD_OWED = ['mod_party_state', 'mod_wallet_secrets', 'signed_terms'];

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

  it('NEEDS_I4_WATCH_DROP: once late funds are acted on, the purge waits for the moderation watch to drop the escrow (review I4a)', () => {
    // The watch (@x2f/trade watch.ts) keeps watching WATCH_CLOSED_DAYS after it SAW the close, and
    // watches a lapsed trade that closed empty as open. When an app wires `late-funds` (to
    // `escalate`), the purge must wait for the watch's drop or keep WATCH_CLOSED_DAYS plus a margin,
    // and a late-funds report for an unknown trade must fail loudly to staff.
    const wired = [...apiSrc, ...modSrc].filter(([p, s]) => !p.endsWith('tradePurge.ts') && /['"`]late-funds['"`]/.test(s)).map(([p]) => p);
    if (wired.length > 0) expect(purge, `late-funds is wired in ${wired.join(', ')}: see tradePurge.ts SEAMS (I4a)`).toMatch(/WATCH_CLOSED_DAYS|watchDropped|watch_dropped/);
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

  it('X2F_TRADE_PURGE stays off by default until every seam above has landed', () => {
    const defaultOn = /X2F_TRADE_PURGE\s*\|\|\s*['"]on['"]/.test(config);
    if (!defaultOn) return;
    expect(migrations).toMatch(/create table (if not exists )?revenue_ledger/i);
    expect(migrations).toMatch(/create table (if not exists )?daily_stats/i);
    expect(migrations).toMatch(/create table (if not exists )?account_totals/i);
    expect(purge).toMatch(/WATCH_CLOSED_DAYS|watchDropped|watch_dropped/);
    const deletes = [...modSrc.values()].join('\n');
    for (const t of MOD_OWED) expect(deletes).toMatch(new RegExp(`delete from ${t}\\b`, 'i'));
  });
});
