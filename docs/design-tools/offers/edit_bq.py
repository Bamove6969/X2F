import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/offers-work')
from kit import *
CAPS = 'font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted);'
f = '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/canvas/project/BuyQuote.dc.html'
s = open(f).read()
# header context line and Rate row follow the band
s = sub(s, 'Zelle · USD · <span style="font-family: \'Atkinson Hyperlegible Mono\', monospace;">$330.00</span> / XMR · Example', 'Zelle · USD · <span style="font-family: \'Atkinson Hyperlegible Mono\', monospace;">{{rateText}}</span> / XMR · Example')
s = sub(s, '''<dt style="color: var(--ink-muted);">Rate</dt><dd style="margin: 0;"><span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 15px; font-weight: 500;">$330.00</span> / XMR</dd>''',
        '''<dt style="color: var(--ink-muted);">Rate</dt><dd style="margin: 0;"><span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 15px; font-weight: 500;">{{rateText}}</span> / XMR</dd>''')
# Max button inside the amount box (owner #5)
s = sub(s, '''        <span style="font-size: 16px; font-weight: 600; color: var(--ink-muted);">USD</span>
      </div>''', '''        <button type="button" onClick="{{setMax}}" aria-label="Use the largest amount, {{maxText}}" style="display: inline-flex; align-items: center; justify-content: center; height: 44px; min-width: 44px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--monero-ink); font-family: inherit; font-size: 15px; font-weight: 600; cursor: pointer;">Max</button>
        <span aria-hidden="true" style="width: 1px; height: 20px; background: var(--line);"></span>
        <span style="font-size: 16px; font-weight: 600; color: var(--ink-muted);">USD</span>
      </div>''')
card = '''
    <section data-m="offer-bands" aria-labelledby="ob-title" style="display: flex; flex-direction: column; gap: 12px; padding: 20px; border-radius: 16px; background: var(--surface);">
      <div style="display: flex; align-items: center; gap: 14px;">
        <span aria-hidden="true" style="display: flex; flex-shrink: 0; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: 12px; background: var(--surface-raised); color: var(--ink);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V14M10 20V9M16 20V12M22 20V5"/></svg></span>
        <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
          <h2 id="ob-title" style="margin: 0; font-size: 18px; line-height: 24px; font-weight: 600;">This offer's bands</h2>
          <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">satoshi_ghost's price changes with the amount</span>
        </span>
      </div>
      <div role="radiogroup" aria-label="Amounts in XMR" style="display: flex; gap: 6px;">
        <sc-for list="{{obViews}}" as="v" hint-placeholder-count="2">
          <button type="button" role="radio" aria-checked="{{v.on}}" onClick="{{v.pick}}" style="display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer;"><span style="{{v.style}}">{{v.label}}</span></button>
        </sc-for>
      </div>
      <ul aria-label="Bands" style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px;">
        <sc-for list="{{obBands}}" as="b" hint-placeholder-count="2">
          <li aria-current="{{b.cur}}" style="{{b.style}}">
            <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <span style="display: flex; align-items: center; gap: 8px;"><span style="''' + CAPS + '''">{{b.label}}</span><sc-if value="{{b.mine}}" hint-placeholder-val="{{true}}"><span style="display: inline-flex; align-items: center; height: 20px; padding: 0 6px; border-radius: 6px; background: var(--ink); color: var(--ground); font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">Your amount</span></sc-if></span>
              <span style="font-size: 15px; line-height: 20px; white-space: nowrap;"><span style="''' + MONO + ''' font-weight: 500;">{{b.usd}}</span> <span style="font-size: 13px; font-weight: 600; color: var(--ink-muted);">USD</span></span>
              <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted); white-space: nowrap;"><span style="''' + MONO + '''">≈ {{b.xmr}}</span> <span style="font-weight: 600; color: var(--monero-ink);">XMR</span></span>
            </span>
            <span style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; text-align: right;">
              <span style="font-size: 13px; line-height: 20px; color: var(--ink-muted); white-space: nowrap;"><span style="''' + MONO + ''' font-size: 15px; font-weight: 500; color: var(--ink);">{{b.rate}}</span> / XMR</span>
              <span style="font-size: 12px; line-height: 16px; color: var(--ink-muted); white-space: nowrap;"><span style="''' + MONO + ''' color: var(--escrow);">{{b.mark}}</span> {{b.markWord}}</span>
            </span>
          </li>
        </sc-for>
      </ul>
      <sc-for list="{{obClips}}" as="c" hint-placeholder-count="1">
        <p style="display: flex; gap: 8px; align-items: flex-start; margin: 0; font-size: 14px; line-height: 20px; color: var(--ink);"><svg style="flex-shrink: 0; margin-top: 2px; color: var(--ink-muted);" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="{{c.icon}}"/></svg><span>{{c.pre}}<span style="''' + MONO + '''">{{c.at}}</span>{{c.mid}}<span style="''' + MONO + '''">{{c.rate}}</span>.</span></p>
      </sc-for>
      <sc-if value="{{obWithout}}" hint-placeholder-val="{{false}}">
        ''' + FRESH + '''
      </sc-if>
    </section>
'''
anchor = '''      </dl>
    </section>
'''
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + card)
# notes (before the notes section closes)
note = ('    <p style="margin: 0; font-size: 13px; line-height: 18px;"><strong>8 Nov, owner #4 and #11 (bands on the quote).</strong> Right under the amount and rate: "This offer\'s bands", so the buyer never goes back a screen to see where the price clips. Each band: its range in the offer\'s unit (USD, set by the vendor) and in XMR ("≈"), its rate and markup; the band holding your amount has the 2 px ink ring and a "Your amount" tag. Under the list, where it clips: "Above <span style="' + MONO + '">$500</span> the rate changes to <span style="' + MONO + '">$331.88</span>." (and the reverse once you are in band 2). '
        '"With markup / Without" (<span style="' + MONO + '">bandsView</span> tweak, showing: {{obViewState}}; default with) converts the XMR column at each band\'s price, or at the market rate (<span style="' + MONO + '">$329.90</span>) with the freshness line. Example bands for satoshi_ghost: <span style="' + MONO + '">$50 – $500</span> at <span style="' + MONO + '">$330.00</span> (the cast trade, <span style="' + MONO + '">$412.50</span> → <span style="' + MONO + '">1.250000</span> XMR) and <span style="' + MONO + '">$500.01 – $1,500</span> at <span style="' + MONO + '">$331.88</span>; the brief\'s sample sentence said "Above $1,500", but this offer\'s largest trade is <span style="' + MONO + '">$1,500</span>, so the clip sits at <span style="' + MONO + '">$500</span>. The Rate row, the header line and You receive follow the band.</p>\n'
        '    <p style="margin: 0; font-size: 13px; line-height: 18px;"><strong>Max (owner #5, "I do really like the max button").</strong> Kept from the prototype: a Max text button inside the You pay field fills the offer\'s largest trade (<span style="' + MONO + '">$1,500</span>); the bands card then moves the ring to band 2.</p>\n'
        '    <p style="margin: 0; font-size: 13px; line-height: 18px;">COPY-UNSIGNED, 8 Nov: "This offer\'s bands", "satoshi_ghost\'s price changes with the amount", "With markup", "Without", "Band 1" / "Band 2", "Your amount", "+0.03% markup" / "market rate, no markup", "Above $500 the rate changes to $331.88." / "Below $500.01 the rate changes to $330.00.", "Max", "Use the largest amount, $1,500" (label), the freshness line.</p>\n')
i = s.rindex('  </section>', 0, s.index('</x-dc>')); i = s.rindex('\n', 0, i) + 1
s = s[:i] + note + s[i:]
# JS
s = sub(s, "this.state = { amount: '412.50', wallet: 'cake' };", "this.state = { amount: '412.50', wallet: 'cake', obView: null };")
s = sub(s, '"role":{"editor":"enum"', '"bandsView":{"editor":"enum","options":["with","without"],"default":"with"},"role":{"editor":"enum"')
s = sub(s, "    const RATE = 330.00, MIN = 50, MAX = 1500;\n    const raw = String(this.state.amount).replace(/[^0-9.]/g, '');\n    const usd = parseFloat(raw);\n    const valid = !isNaN(usd) && usd >= MIN && usd <= MAX;\n",
        """    const MIN = 50, MAX = 1500, MKT = 329.90;
    const raw = String(this.state.amount).replace(/[^0-9.]/g, '');
    const usd = parseFloat(raw);
    const valid = !isNaN(usd) && usd >= MIN && usd <= MAX;
    // This offer's bands (owner #4 + #11, 8 Nov): set in USD by the vendor; the rate depends on the band.
    const BANDS = [{ from: 50, to: 500, rate: 330.00 }, { from: 500.01, to: 1500, rate: 331.88 }];
    const bi = valid ? BANDS.findIndex((b) => usd >= b.from && usd <= b.to) : -1;
    const RATE = bi >= 0 ? BANDS[bi].rate : BANDS[0].rate;
    const d$ = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
    const obView = this.state.obView || (this.props.bandsView === 'without' ? 'without' : 'with');
    const withMk = obView === 'with';
    const obBands = BANDS.map((b, i) => {
      const r = withMk ? b.rate : MKT, mine = i === bi;
      const mk = (b.rate / MKT - 1) * 100;
      return { label: 'Band ' + (i + 1), mine, cur: mine ? 'true' : 'false',
        usd: d$(b.from) + ' – ' + d$(b.to), xmr: (b.from / r).toFixed(6) + ' – ' + (b.to / r).toFixed(6),
        rate: '$' + r.toFixed(2), mark: withMk ? '+' + mk.toFixed(2) + '%' : '', markWord: withMk ? 'markup' : 'market rate, no markup',
        style: 'display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; box-sizing: border-box; border-radius: 12px; background: var(--surface-raised); border: 2px solid ' + (mine ? 'var(--ink);' : 'transparent;') };
    });
    const UP = 'M7 17L17 7M9 7h8v8', DOWN = 'M7 7l10 10M17 9v8H9';
    const obClips = [];
    if (bi >= 0 && bi < BANDS.length - 1) obClips.push({ icon: UP, pre: 'Above ', at: d$(BANDS[bi].to), mid: ' the rate changes to ', rate: '$' + BANDS[bi + 1].rate.toFixed(2) });
    if (bi > 0) obClips.push({ icon: DOWN, pre: 'Below ', at: d$(BANDS[bi].from), mid: ' the rate changes to ', rate: '$' + BANDS[bi - 1].rate.toFixed(2) });
    const VIEW = (on) => 'display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; height: 36px; padding: 0 14px; border-radius: 999px; font-family: inherit; font-size: 14px; ' + (on ? 'border: 2px solid var(--ink); background: var(--surface-raised); color: var(--ink); font-weight: 600;' : 'border: 1px solid var(--line); background: transparent; color: var(--ink);');
    const obViews = [['with', 'With markup'], ['without', 'Without']].map(([id, label]) => ({ label, on: obView === id ? 'true' : 'false', style: VIEW(obView === id), pick: () => this.setState({ obView: id }) }));
""")
s = sub(s, "    return { rootStyle,\n      amount: this.state.amount,", "    return { rootStyle,\n      obBands, obClips, obViews, obWithout: !withMk, obViewState: obView, rateText: '$' + RATE.toFixed(2),\n      maxText: d$(MAX), setMax: () => this.setState({ amount: String(MAX) }),\n      amount: this.state.amount,")
open(f, 'w').write(s); print('ok')
