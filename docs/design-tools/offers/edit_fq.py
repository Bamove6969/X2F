import sys
sys.path.insert(0,'/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/offers-work')
from kit import *
P='/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/canvas/project/'
ROWS = lambda: ('<span style="display: grid; grid-template-columns: auto auto; justify-content: {J}; column-gap: 6px; row-gap: 2px; font-size: 14px; line-height: 20px; color: var(--ink); white-space: nowrap;">'
    '<span style="' + MONO + ' text-align: right;">{{c.amt.xmr}}</span><span style="font-size: 13px; font-weight: 600; color: var(--monero-ink);">XMR</span>'
    '<span style="' + MONO + ' text-align: right;">{{c.amt.fiat}}</span><span style="font-size: 13px; font-weight: 600; color: var(--ink-muted);">USD</span></span>')
MARK = ('<span style="display: flex; flex-direction: column; gap: 2px; flex-shrink: 0;"><span style="{{c.amt.markStyle}}">{{c.amt.mark}}</span>'
        '<span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">{{c.amt.markLabel}}</span></span>')
JS_CARD = ("        amt: (() => { const band = q.tier || { from: o.tiers[0].from, to: o.tiers[o.tiers.length - 1].to }; const a = adAmt([q.price, Math.round(q.total * 10) / 10, 'fiat', band.from, band.to]);"
           " a.markLabel = q.meth.adj ? 'incl. ' + methodTag(q.meth) : (Math.abs(q.total) < 0.001 ? 'At market' : 'Vendor markup'); if (!ok) a.markStyle = a.markStyle.replace('var(--escrow)', 'var(--ink-muted)'); return a; })(),\n")
for b in ['FlexOffer-Quote', 'FlexOffer-Quote-Wide']:
    f = P + b + '.dc.html'; s = open(f).read()
    wide = b.endswith('Wide')
    if not wide:
        # price row: price left, You get right (vsText moves to markup bottom-left)
        s = sub(s, '''              <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{c.vsText}}</span>
''', '')
        s = sub(s, '<div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 8px;">\n            <div style="display: flex; flex-direction: column; gap: 2px;">',
                '<div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 8px;">\n            <div style="display: flex; flex-direction: column; gap: 2px; align-self: center;">')
        # amounts row after the price row
        s = sub(s, '''          </div>
          <span style="display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 18px; color: var(--ink-muted);"><span><sc-if value="{{c.tierHas}}"''',
                '''          </div>
          <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--surface-raised);">''' + MARK + '<span style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 0;"><span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">{{c.bandCap}}</span>' + ROWS().replace('{J}', 'end') + '''</span></div>
          <span style="display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 18px; color: var(--ink-muted);"><span><sc-if value="{{c.tierNone}}"''')
        # meta line: band words go (the rows carry it); keep "No band" and releases
        s = sub(s, '''<sc-if value="{{c.tierNone}}" hint-placeholder-val="{{true}}">Band <span style="font-family: 'Atkinson Hyperlegible Mono', monospace;">{{c.tierFrom}}</span> – <span style="font-family: 'Atkinson Hyperlegible Mono', monospace;">{{c.tierTo}}</span></sc-if><sc-if value="{{c.tierNone}}" hint-placeholder-val="{{false}}">No band for this amount</sc-if> · Releases''',
                '''<sc-if value="{{c.tierNone}}" hint-placeholder-val="{{false}}">No band for this amount · </sc-if>Releases''')
        s = sub(s, '      <h2 style="margin: 8px 0 -4px; font-size: 18px; line-height: 24px; font-weight: 600;">{{count}} · best price first</h2>',
                '      ' + WM_BOX + '\n      <h2 style="margin: 0 0 -4px; font-size: 18px; line-height: 24px; font-weight: 600;">{{count}} · best price first</h2>')
        s = sub(s, 'Buy XMR</h1>\n', 'Buy XMR</h1>\n    <span style="margin-top: 6px;">' + FRESH + '</span>\n')
    else:
        s = sub(s, '''                <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{c.vsText}}</span>
''', '''                <span style="margin-top: 6px;">''' + MARK + '''</span>
''')
        s = sub(s, '''<span><sc-if value="{{c.tierHas}}" hint-placeholder-val="{{true}}">Band <span style="font-family: 'Atkinson Hyperlegible Mono', monospace;">{{c.tierFrom}}</span> – <span style="font-family: 'Atkinson Hyperlegible Mono', monospace;">{{c.tierTo}}</span></sc-if>''',
                '''<span style="font-size: 12px; line-height: 16px;">{{c.bandCap}}</span>''' + ROWS().replace('{J}', 'start') + '''<span><sc-if value="{{c.tierHas}}" hint-placeholder-val="{{true}}"></sc-if>''')
        s = sub(s, '''    <sc-if value="{{valid}}" hint-placeholder-val="{{true}}">
      <div role="table" aria-label="Offers"''', '''    <sc-if value="{{valid}}" hint-placeholder-val="{{true}}">
      ''' + WM_BOX + '''
      <div role="table" aria-label="Offers"''')
        s = sub(s, 'Buy XMR</h1>\n', 'Buy XMR</h1>\n      ' + FRESH + '\n')
    s = sub(s, '    const cards = OFFERS.filter(', AD_JS.replace('const MKT = 329.90;', 'const MKT = MARKET;') + '    const cards = OFFERS.filter(')
    s = sub(s, "        xmrText: q.xmr.toFixed(6),\n", "        xmrText: q.xmr.toFixed(6),\n" + JS_CARD + "        bandCap: q.tier ? (o.tiers.length > 1 ? 'Your band' : 'Limits') : 'Trades only',\n")
    s = sub(s, '      cards: shown,\n', '      cards: shown, wm,\n')
    s = sub(s, '"$preview":{"width":', '"withMarkup":{"editor":"enum","options":["off","on"],"default":"off"},"$preview":{"width":')
    W = 'max-width: 980px; ' if True else ''
    note = ('    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;"><strong>8 Nov, owner #11 (ad amounts).</strong> ' + ('Each row' if wide else 'Each card') + ': markup bottom-left of the price (the total for your band and method: "+0.6%" mono over "Vendor markup", or "incl. Zelle +0.3%" when the method adds to it) and the band that fits your amount on two rows in mono, figures right-aligned: the range in XMR and the range in USD. The vendor set these bands in USD, so the XMR row is converted ("≈"). '
            '"Display amounts including vendor markup" sits above the list (<span style="' + MONO + '">withMarkup</span> tweak, showing: {{wm.state}}; default off): off converts at the market rate, on at each offer\'s price for your band. Caption over the rows: "Your band" (tiered), "Limits" (one band), "Trades only" (no band for your amount, whole range shown).</p>\n'
            '    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;">' + ANT + 'Follows owner #3: "Market rate · updated <span style="' + MONO + '">14:05</span> UTC" under the title, where the market price shows (no provider named, Q34).</p>\n'
            '    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;">COPY-UNSIGNED, 8 Nov: "Display amounts including vendor markup" (owner\'s words), "Converted at the market rate, before markup.", "Converted at each offer\'s price, markup included.", "Vendor markup", "incl. Zelle +0.3%" (was "… above market · incl. Zelle +0.3%"), "Your band", "Limits", "Trades only", "Market rate · updated <span style="' + MONO + '">14:05</span> UTC".</p>\n')
    i = s.rindex('  </section>\n</div>\n</x-dc>')
    s = s[:i] + note + s[i:]
    open(f, 'w').write(s); print('ok', b)
