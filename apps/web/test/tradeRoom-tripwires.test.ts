// Tripwires for the trade room's seams (src/screens/trade/seams.ts, src/api/trade.ts). Each fails
// the day the piece it waits for lands, and says what to change.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const web = new URL('../src/', import.meta.url);
const api = new URL('../../api/src/', import.meta.url);

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
      'Task 19 merged: call setLiveSource((on) => connectEvents((e) => e.type === "trade" && on(e))) once in the app shell (src/App.tsx)',
    ).toBe(false);
  });

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
