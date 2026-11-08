import sys, re
sys.path.insert(0, '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/offers-work')
from kit import *
from unitkit import *
f = '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/canvas/project/PostOffer.dc.html'
s = open(f).read()
# Step 3: range sections become per-currency blocks with unit boxes (stacked: the switch needs the width)
i = s.index('      <div style="display: flex; flex-direction: column; gap: 8px;">\n        <span style="font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted);">Trade size in <span style="font-family: \'Atkinson Hyperlegible Mono\', monospace; color: var(--ink);">USD</span>')
j = s.index('      <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">Whole units only. Each currency has its own range; nothing is converted.</span>\n')
j2 = j + len('      <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">Whole units only. Each currency has its own range; nothing is converted.</span>\n')
new = ('      <sc-for list="{{ranges}}" as="r" hint-placeholder-count="2">\n'
       '      <div style="{{r.wrap}}">\n'
       '        <span style="' + CAPS + '">Trade size in <span style="' + MONO + ' color: var(--ink);">{{r.code}}</span></span>\n'
       '        <sc-for list="{{r.boxes}}" as="b" hint-placeholder-count="2">\n        ' + unit_box() + '\n        </sc-for>\n'
       '      </div>\n      </sc-for>\n'
       '      <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{unitHelp}}</span>\n')
s = s[:i] + new + s[j2:]
# Step 4: chips
s = sub(s, '''      <label for="mintrades" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; font-size: 15px; line-height: 22px;">Minimum completed trades
        <select id="mintrades" style="height: 44px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font-family: inherit; font-size: 15px;">
          <option>Anyone</option><option>5+</option><option>10+</option><option>50+</option>
        </select>
      </label>''', '''      <div style="display: flex; flex-direction: column; gap: 8px;">
        <span style="font-size: 15px; line-height: 22px;">Minimum completed trades</span>
        ''' + CHIPS + '''
        <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{mtHelp}}</span>
      </div>''')
# Preview: price row, then markup bottom-left and both units right
s = sub(s, '''      <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 8px;">
        <span style="display: inline-flex; align-items: baseline; gap: 6px;"><span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 28px; line-height: 32px; font-weight: 500; letter-spacing: -0.01em;">{{priceNum}}</span><span style="font-size: 14px; color: var(--ink-muted);">/ XMR</span></span>
        <span style="display: flex; flex-direction: column; align-items: flex-end; font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 14px; line-height: 20px; color: var(--ink-muted);"><span>$50 – $2,000</span><span>€50 – €1,800</span></span>
      </div>''', '''      <span style="display: inline-flex; align-items: baseline; gap: 6px;"><span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 28px; line-height: 32px; font-weight: 500; letter-spacing: -0.01em;">{{priceNum}}</span><span style="font-size: 14px; color: var(--ink-muted);">/ <span style="font-weight: 600; color: var(--monero-ink);">XMR</span></span></span>
      <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--surface-raised);">
        <span style="display: flex; flex-direction: column; gap: 2px; flex-shrink: 0;"><span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 15px; line-height: 20px; font-weight: 500; color: var(--escrow);">{{marginText}}</span><span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">Vendor markup</span></span>
        <span style="display: grid; grid-template-columns: auto auto; justify-content: end; column-gap: 6px; row-gap: 2px; font-size: 14px; line-height: 20px; white-space: nowrap;"><sc-for list="{{pvRows}}" as="p" hint-placeholder-count="3"><span style="font-family: 'Atkinson Hyperlegible Mono', monospace; text-align: right;">{{p.v}}</span><span style="{{p.uStyle}}">{{p.u}}</span></sc-for></span>
      </div>
      <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{pvTrades}}</span>''')
# market line in step 2 gets freshness: find "right now." paragraph? add after the margin explanation paragraph
anchor = " / XMR at today's rate.</span>\n"
s = sub(s, anchor, anchor + '      ' + FRESH + '\n')
# notes
note = ('    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;"><strong>8 Nov, owner #11 (offer unit).</strong> Each range box has an XMR / currency switch inside its right end (<span style="' + MONO + '">unit</span> tweak, showing: {{unitState}}; default XMR, the left one). Selected unit: 15/20 600 in --monero-ink; the other 12/16 ink-muted. One unit per offer: tapping either switch moves every box (min and max, every currency) together (lead default; the owner may override). '
        'Examples: XMR <span style="' + MONO + '">0.500000 – 25.000000</span>; USD <span style="' + MONO + '">$500 – $3,000</span>, EUR <span style="' + MONO + '">€500 – €2,800</span>. Under each box the other unit, converted at the poster\'s own price (market ± their margin), so the margin stepper changes it. A fiat range still sells XMR. Boxes stack one per row: the switch needs the width. The preview shows what traders see: markup bottom-left, the range in XMR and in each currency right-aligned in mono (converted rows start with "≈").</p>\n'
        '    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;"><strong>8 Nov, owner #12.</strong> "Minimum completed trades" is five fixed chips: Anyone (kept first, the default, lead default "No minimum"), <span style="' + MONO + '">5</span>, <span style="' + MONO + '">10</span>, <span style="' + MONO + '">25</span>, <span style="' + MONO + '">50</span>; the picked chip has the 2 px ink ring. Replaces the drop-down (which had 5+ / 10+ / 50+, no 25).</p>\n'
        '    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;">' + ANT + 'Follows owner #3: the market price in step 2 carries "Market rate · updated <span style="' + MONO + '">14:05</span> UTC" (no provider, Q34). EUR market <span style="' + MONO + '">€304.10</span> / XMR is an example rate.</p>\n'
        '    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;">COPY-UNSIGNED, 8 Nov: "≈ $165.78 at your price (+0.5%)" / "≈ 1.508068 XMR at your price (+0.5%)"; the helper "One unit for the whole offer. Traders see both, converted at your price." (replaces "Whole units only. Each currency has its own range; nothing is converted.", which the owner\'s conversion now contradicts); "Anyone"; "Anyone can take this offer." / "Only traders with at least 10 completed trades can take it."; preview "Vendor markup", "Anyone can trade" / "10+ completed trades"; the freshness line.</p>\n')
i = s.rindex('  </section>\n</div>\n</x-dc>')
s = s[:i] + note + s[i:]
# JS
s = sub(s, "this.state = { side: 'sell', margin: 0.5 };", "this.state = { side: 'sell', margin: 0.5, unit: null, mt: '0' };")
s = sub(s, '"$preview":{"width":390,', '"unit":{"editor":"enum","options":["xmr","fiat"],"default":"xmr"},"$preview":{"width":390,')
js = UNIT_JS + CHIPS_JS + r'''
    const CUR = [{ code: 'USD', sym: '$', mkt: 329.90, lo: 500, hi: 3000 }, { code: 'EUR', sym: '€', mkt: 304.10, lo: 500, hi: 2800 }];
    const XLO = 0.5, XHI = 25;
    const ranges = CUR.map((c, i) => {
      const rate = c.mkt * (1 + margin / 100);
      return { code: c.code,
        wrap: 'display: flex; flex-direction: column; gap: 12px;' + (i ? ' padding-top: 12px; border-top: 1px solid var(--surface-raised);' : ''),
        boxes: [rangeBox('min-' + c.code.toLowerCase(), 'Smallest', c.sym, XLO, c.lo, rate, margin), rangeBox('max-' + c.code.toLowerCase(), 'Largest', c.sym, XHI, c.hi, rate, margin)] };
    });
    const XU = 'font-size: 13px; font-weight: 600; color: var(--monero-ink);', FU = 'font-size: 13px; font-weight: 600; color: var(--ink-muted);';
    const pvRows = [];
    if (unit === 'xmr') {
      pvRows.push({ v: XLO.toFixed(6) + ' – ' + XHI.toFixed(6), u: 'XMR', uStyle: XU });
      CUR.forEach((c) => { const r = c.mkt * (1 + margin / 100); pvRows.push({ v: '≈ ' + fmtFiat(c.sym, XLO * r, true) + ' – ' + fmtFiat(c.sym, XHI * r, true), u: c.code, uStyle: FU }); });
    } else {
      CUR.forEach((c) => { const r = c.mkt * (1 + margin / 100); pvRows.push({ v: fmtFiat(c.sym, c.lo, false) + ' – ' + fmtFiat(c.sym, c.hi, false), u: c.code, uStyle: FU }); pvRows.push({ v: '≈ ' + (c.lo / r).toFixed(6) + ' – ' + (c.hi / r).toFixed(6), u: 'XMR', uStyle: XU }); });
    }
    const mt = this.state.mt;
'''
s = sub(s, "    return { rootStyle,\n      sellOn:", js + "    return { rootStyle, ranges, pvRows,\n      unitHelp: 'One unit for the whole offer. Traders see both, converted at your price.',\n      mtChips: mtChip(mt, (v) => this.setState({ mt: v })),\n      mtHelp: mt === '0' ? 'Anyone can take this offer.' : 'Only traders with at least ' + mt + ' completed trades can take it.',\n      pvTrades: mt === '0' ? 'Anyone can trade' : mt + '+ completed trades',\n      ...unitVals,\n      sellOn:")
open(f, 'w').write(s); print('ok')
