// Tripwires for the trade room's seams (src/screens/trade/seams.ts, src/api/trade.ts). Each fails
// the day the piece it waits for lands, and says what to change.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const web = new URL('../src/', import.meta.url);
const api = new URL('../../api/src/', import.meta.url);
const repo = new URL('../../../', import.meta.url);

/** The file as `origin/<branch>` has it (when that ref is fetched here) and as this tree has it (once merged). */
function sourcesOf(branch: string, path: string): [string, string][] {
  const out: [string, string][] = [];
  try {
    out.push([`origin/${branch}:${path}`, execFileSync('git', ['show', `origin/${branch}:${path}`], { cwd: fileURLToPath(repo), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })]);
  } catch {
    // The branch is not fetched here (or has no such file): only the local copy can be checked.
  }
  const local = new URL(path, repo);
  if (existsSync(local)) out.push([path, readFileSync(local, 'utf8')]);
  return out;
}

/** Every `navigate(...)` call to a /trade/ path whose options carry no `state: { confirmed ... }`. */
function tradeNavigationsWithoutConfirmed(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/navigate\(([\s\S]*?)\);/g)) {
    const args = m[1]!;
    if (args.includes('/trade/') && !/state:\s*\{[^}]*\bconfirmed\b/.test(args)) out.push(m[0].replace(/\s+/g, ' '));
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
  it('Task 12 (browser escrow runtime) is not merged: useTradeEscrow is still the stand-in', () => {
    expect(
      existsSync(new URL('escrow/useEscrow.ts', web)),
      'Task 12 merged: Task 12 must expose escrowAddress (the address party.ready() derived), deal (its stored confirmed Deal: poster, takeAmountAtomic) and receivedAtomic (the balance its tick reads with party.funds()) in EscrowStatus/UseEscrow; then in src/screens/trade/seams.ts make useTradeEscrow call useEscrow(code, confirmed) and re-export its types instead of the copies',
    ).toBe(false);
  });

  it('Task 19 (live events) is not merged: the room only polls', () => {
    expect(
      existsSync(new URL('api/events.ts', web)),
      'Task 19 merged: fan the room out from Task 19\'s single /v1/events connection (LiveAccepted), gated by isTrader: setLiveSource((on) => <subscribe to that connection, trade events only>); never open a second EventSource',
    ).toBe(false);
  });

  // Review 2026-10-27, I4: Task 12 fails the first start of a trade with `not-confirmed` unless the
  // room gets `location.state.confirmed` (seams.ts ConfirmedTrade). These FAIL while the callers
  // (Task 18's take, Task 19's accepted sheet) navigate to /trade/ without it: a merge of 12, 18,
  // 19 and 22 as they stand would stop every new trade at "Open this trade from the device you
  // started it on". Each reads the branch copy (git show) and the local copy once merged.
  for (const [task, branch, path] of [
    ['Task 18 (take)', 'wip/lead-p3-task18', 'apps/web/src/screens/quote/useTake.tsx'],
    ['Task 19 (accepted sheet, LiveAccepted)', 'wip/lead-p3-task19', 'apps/web/src/App.tsx'],
    ['Task 19 (accepted sheet)', 'wip/lead-p3-task19', 'apps/web/src/screens/AcceptedSheet.tsx'],
  ] as const) {
    it(`${task} navigates to /trade/ only with state: { confirmed }`, (ctx) => {
      const copies = sourcesOf(branch, path);
      if (copies.length === 0) ctx.skip();
      const offenders = copies.flatMap(([where, src]) => tradeNavigationsWithoutConfirmed(src).map((call) => `${where}: ${call}`));
      expect(
        offenders,
        `${task} must navigate with { state: { confirmed } } (ConfirmedTrade: { role, ownAddress, deal }), and because history state does not survive opening the trade from a push, start the escrow (or persist confirmed through Task 12's store) before navigating`,
      ).toEqual([]);
    });
  }

  it('FU-A (display names) is not merged: the API still calls the public name `username`', () => {
    const summary = fields(new URL('trades/view.ts', api), 'TraderSummary');
    expect(
      summary.includes('username') && !summary.includes('displayName'),
      'FU-A merged: drop `username` from TraderSummary in src/api/trade.ts so publicName reads only displayName',
    ).toBe(true);
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

describe("the web TradeView matches the API's", () => {
  it('has the same fields as apps/api/src/trades/view.ts TradeView', () => {
    const theirs = fields(new URL('trades/view.ts', api), 'TradeView');
    expect(theirs.length).toBeGreaterThan(30);
    expect(fields(new URL('api/trade.ts', web), 'TradeView')).toEqual(theirs);
  });
});
