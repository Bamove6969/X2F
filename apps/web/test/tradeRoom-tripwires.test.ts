// Tripwires for the trade room's seams (src/screens/trade/seams.ts, src/api/trade.ts). Each fails
// the day the piece it waits for lands, and says what to change.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const web = new URL('../src/', import.meta.url);
const api = new URL('../../api/src/', import.meta.url);

/** Every .ts/.tsx file under a directory. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Every navigation to a literal /trade/ path that carries no `confirmed` in its history state:
 * `navigate('/trade/…')` / `navigate(`/trade/${code}`)` without `state: { confirmed … }`, and
 * `<Navigate to="/trade/…" />` / `to={`/trade/${code}`}` without `state={{ confirmed … }}`.
 * NOT caught: a path computed elsewhere and passed in a variable (`navigate(href)`), or a
 * `<Link to>`; review those by hand.
 */
export function tradeNavigationsWithoutConfirmed(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bnavigate\(([\s\S]*?)\);/g)) {
    const args = m[1]!;
    if (args.includes('/trade/') && !/state:\s*\{[^}]*\bconfirmed\b/.test(args)) out.push(m[0].replace(/\s+/g, ' '));
  }
  for (const m of src.matchAll(/<Navigate\b([\s\S]*?)\/?>/g)) {
    const attrs = m[1]!;
    if (/\bto=\{?\s*["'`][^"'`]*\/trade\//.test(attrs) && !/state=\{\{[^}]*\bconfirmed\b/.test(attrs)) out.push(m[0].replace(/\s+/g, ' '));
  }
  return out;
}

/** The top-level field names of `export interface <name> { ... }` in a source file. */
function fields(file: URL, name: string): string[] {
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`no interface ${name} in ${file.pathname}`);
  const out: string[] = [];
  let depth = 0;
  let line = '';
  let lineDepth = 0;
  for (const ch of src.slice(src.indexOf('{', start) + 1)) {
    if (ch === '{') depth++;
    if (ch === '}') {
      if (depth === 0) break;
      depth--;
    }
    if (ch === '\n') {
      const m = lineDepth === 0 ? /^\s*([a-zA-Z]+)\??:/.exec(line) : null;
      if (m) out.push(m[1]!);
      line = '';
      lineDepth = depth;
    } else {
      line += ch;
    }
  }
  return out.sort();
}

describe('TRIPWIRES: trade room', () => {
  // Task 12's tripwire retired 2026-10-27 (Task 22 landing): EscrowStatus/UseEscrow carry
  // escrowAddress, deal, receivedAtomic and confirmedAtomic, and seams.ts's useTradeEscrow is
  // useEscrow(code, confirmed) with Task 12's own types.

  // Task 19's tripwire retired 2026-10-28 (Task 22 landing): App.tsx's LiveAccepted (traders
  // only) sets seams.ts liveFanOut as the room's live source and forwards each trade event to it.
  it("the room's live events come from Task 19's single connection (no second EventSource)", () => {
    const app = readFileSync(new URL('App.tsx', web), 'utf8');
    expect(app).toContain('setLiveSource(liveFanOut.source)');
    expect(app).toContain('liveFanOut.emit(e)');
    const root = fileURLToPath(web);
    const opens = sourceFiles(root).filter((f) => /new\s+(Source|EventSource)\(|connectEvents\(/.test(readFileSync(f, 'utf8')));
    expect(opens.map((f) => relative(root, f)).sort()).toEqual(['api/events.ts']);
    // useLiveEvents opens a connection of its own: App.tsx's LiveAccepted is its only caller.
    const hooks = sourceFiles(root).filter((f) => /useLiveEvents\(/.test(readFileSync(f, 'utf8')) && !f.endsWith(join('api', 'events.ts')));
    expect(hooks.map((f) => relative(root, f))).toEqual(['App.tsx']);
  });

  // Review 2026-10-27, I4: Task 12 fails the first start of a trade with `not-confirmed` unless the
  // room gets `location.state.confirmed` (seams.ts ConfirmedTrade). This scans THIS tree only and
  // fails the moment a file navigating to /trade/ without it lands (Task 18's take, Task 19's
  // accepted sheet, or anything else). Computed paths (`navigate(href)`) and `<Link to>` are not
  // caught. The state of the other branches is in docs/coordination.md, not here.
  it('nothing in apps/web/src navigates to /trade/ without state: { confirmed }', () => {
    const root = fileURLToPath(web);
    const offenders = sourceFiles(root).flatMap((f) => tradeNavigationsWithoutConfirmed(readFileSync(f, 'utf8')).map((call) => `${relative(root, f)}: ${call}`));
    expect(
      offenders,
      'navigate with { state: { confirmed } } (ConfirmedTrade: { role, ownAddress, deal }); and because history state does not survive opening the trade from a push, start the escrow (or persist confirmed through Task 12’s store) before navigating',
    ).toEqual([]);
  });

  // FU-A's tripwire retired 2026-10-28 (Task 22 landing, after FU-A merged): TraderSummary has
  // only displayName, and publicName reads only it.
  it("the web TraderSummary has the API's fields (displayName, no username)", () => {
    // Task 4 moved the API's TraderSummary to traders/summary.ts (trades/view.ts re-exports it).
    expect(fields(new URL('api/trade.ts', web), 'TraderSummary')).toEqual(fields(new URL('traders/summary.ts', api), 'TraderSummary'));
  });

  it('Task 3 (method profiles) is merged but not wired into the trade view: methodOf still falls back to the method id', () => {
    // Retired 2026-10-27 after checking Task 3's shapes: `name` and `giftCard` live on CatalogMethod,
    // `whatItIs` on MethodProfile (apps/api/src/methods/profiles.ts), the three fields methodOf reads.
    const catalog = fields(new URL('methods/profiles.ts', api), 'CatalogMethod');
    const profile = fields(new URL('methods/profiles.ts', api), 'MethodProfile');
    expect(catalog).toContain('name');
    expect(catalog).toContain('giftCard');
    expect(profile).toContain('whatItIs');
    // The trade routes still take `profile?: ProfileLookup` and nothing passes one (routes.ts:9).
    const wired = ['app.ts', 'main.ts'].some((f) => /tradeRoutes\([^)]*profile/s.test(readFileSync(new URL(f, api), 'utf8')));
    expect(
      wired,
      'the trade view now carries a profile: it must be the catalog entry merged with the profile ({ ...getMethod(id), ...getProfile(id) }) so methodOf in src/api/trade.ts finds name, giftCard and whatItIs; then retire this test',
    ).toBe(false);
  });
});

describe('the /trade/ navigation check itself', () => {
  it('catches navigate() and <Navigate to> without confirmed, and passes them with it', () => {
    // Task 19's LiveAccepted as it stands on wip/lead-p3-task19 (App.tsx:84).
    expect(tradeNavigationsWithoutConfirmed('void navigate(`/trade/${encodeURIComponent(code)}`);')).toHaveLength(1);
    expect(tradeNavigationsWithoutConfirmed("navigate('/trade/ABC', { replace: true });")).toHaveLength(1);
    expect(tradeNavigationsWithoutConfirmed('<Navigate to={`/trade/${code}`} replace />')).toHaveLength(1);
    expect(tradeNavigationsWithoutConfirmed('<Navigate to="/trade/ABC" />')).toHaveLength(1);
    // Task 18's take as it stands on wip/lead-p3-task18 (useTake.tsx:71).
    expect(tradeNavigationsWithoutConfirmed('void navigate(`/trade/${encodeURIComponent(code)}`, { state: { confirmed } });')).toEqual([]);
    expect(tradeNavigationsWithoutConfirmed('<Navigate to={`/trade/${code}`} state={{ confirmed }} replace />')).toEqual([]);
    expect(tradeNavigationsWithoutConfirmed("navigate('/sell');")).toEqual([]);
  });
});

describe("the web TradeView matches the API's", () => {
  it('has the same fields as apps/api/src/trades/view.ts TradeView', () => {
    const theirs = fields(new URL('trades/view.ts', api), 'TradeView');
    expect(theirs.length).toBeGreaterThan(30);
    expect(fields(new URL('api/trade.ts', web), 'TradeView')).toEqual(theirs);
  });
});
