import sys, re
sys.path.insert(0, '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/offers-work')
from kit import *
from unitkit import *
P = '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/canvas/project/'
SW = ('<span role="radiogroup" aria-label="Unit for this offer" style="position: absolute; top: 0; right: 2px; bottom: 0; display: flex; align-items: center;">'
      '<button type="button" role="radio" aria-checked="{{unitX}}" onClick="{{pickXmr}}" style="{{unitXStyle}}">XMR</button>'
      '<span aria-hidden="true" style="width: 1px; height: 20px; background: var(--line);"></span>'
      '<button type="button" role="radio" aria-checked="{{unitF}}" onClick="{{pickFiat}}" style="{{unitFStyle}}">{{curCode}}</button></span>')

def box(which, Label, ind):
    k = which  # 'from' | 'to'
    return (ind + '<div style="display: flex; flex-direction: column; gap: 6px; min-width: 0;">\n'
            + ind + '  <label for="{{t.' + k + 'Id}}" style="' + CAPS + '">' + Label + '</label>\n'
            + ind + '  <span style="position: relative; display: block;">\n'
            + ind + '    <span aria-hidden="true" style="position: absolute; left: 14px; top: 13px; ' + MONO + ' font-size: 16px; font-weight: 400; color: var(--ink-muted);">{{symShown}}</span>\n'
            + ind + '    <input id="{{t.' + k + 'Id}}" type="text" inputmode="decimal" value="{{t.' + k + '}}" onChange="{{t.on' + k.capitalize() + '}}" aria-invalid="{{t.bad' + k.capitalize() + '}}" aria-describedby="{{t.errId}}" style="{{t.' + k + 'Style}}">\n'
            + ind + '    ' + SW + '\n'
            + ind + '  </span>\n'
            + ind + '  <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{t.convPre}}<span style="' + MONO + '">{{t.' + k + 'Conv}}</span>{{t.convTail}}</span>\n'
            + ind + '</div>\n')

BAND_CHIPS = ('<div role="radiogroup" aria-label="{{t.minLabel}}" style="display: flex; flex-wrap: wrap; gap: 6px;">'
              '<sc-for list="{{t.chips}}" as="c" hint-placeholder-count="5">'
              '<button type="button" role="radio" aria-checked="{{c.on}}" onClick="{{c.pick}}" style="display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer;"><span style="{{c.style}}">{{c.label}}</span></button>'
              '</sc-for></div>')

def js_edit(s):
    s = sub(s, "{ id: 1, from: '50', to: '500',", "{ id: 1, from: '50', to: '500', xFrom: '0.500000', xTo: '1.500000',")
    s = sub(s, "{ id: 2, from: ex === 'overlap' ? '400' : '501', to: '2000',", "{ id: 2, from: ex === 'overlap' ? '400' : '501', to: '2000', xFrom: ex === 'overlap' ? '1.200000' : '1.500001', xTo: '25.000000',")
    s = sub(s, "{ id: 3, from: '50', to: '450',", "{ id: 3, from: '50', to: '450', xFrom: '0.500000', xTo: '1.400000',")
    s = sub(s, "{ id: 4, from: '451', to: '1800',", "{ id: 4, from: '451', to: '1800', xFrom: '1.400001', xTo: '25.000000',")
    s = sub(s, "side: 'sell', cur: 'USD', nextId: 5,", "side: 'sell', cur: 'USD', nextId: 5, mt: '0',")
    s = sub(s, "    const sym = SYM[s.cur];\n", "    const sym = SYM[s.cur];\n" + UNIT_JS + CHIPS_JS +
            "    const xm = unit === 'xmr';\n    const RATE = { USD: 329.90, EUR: 304.10 }[s.cur]; // EUR: example rate\n    const decs = (v) => { const m = String(v).match(/\\.(\\d*)/); return m ? m[1].length : 0; };\n    const x6 = (n) => n.toFixed(6);\n")
    s = sub(s, "const parsed = curTiers.map((t) => ({ f: num(t.from), to: num(t.to) }));",
            "const parsed = curTiers.map((t) => ({ f: num(xm ? t.xFrom : t.from), to: num(xm ? t.xTo : t.to) }));")
    s = sub(s, "      } else if (p.f !== Math.floor(p.f) || p.to !== Math.floor(p.to)) {\n        err = 'Whole units only, no cents.'; badFrom = p.f !== Math.floor(p.f); badTo = p.to !== Math.floor(p.to);\n      } else if (i > 0 && !isNaN(parsed[i - 1].to) && p.f !== parsed[i - 1].to + 1) {\n        const want = parsed[i - 1].to + 1;",
            "      } else if (xm ? (decs(t.xFrom) > 6 || decs(t.xTo) > 6) : (p.f !== Math.floor(p.f) || p.to !== Math.floor(p.to))) {\n        err = xm ? 'XMR takes up to 6 decimals.' : 'Whole units only, no cents.'; badFrom = xm ? decs(t.xFrom) > 6 : p.f !== Math.floor(p.f); badTo = xm ? decs(t.xTo) > 6 : p.to !== Math.floor(p.to);\n      } else if (i > 0 && !isNaN(parsed[i - 1].to) && Math.abs(p.f - (parsed[i - 1].to + (xm ? 0.000001 : 1))) > 1e-9) {\n        const want = parsed[i - 1].to + (xm ? 0.000001 : 1);")
    s = sub(s, "'Bands must be contiguous: the next band starts at ' + money(want) + '.';", "'Bands must be contiguous: the next band starts at ' + (xm ? x6(want) + ' XMR' : money(want)) + '.';")
    s = sub(s, "        from: t.from, to: t.to,\n", "        from: xm ? t.xFrom : t.from, to: xm ? t.xTo : t.to,\n"
            "        convPre: (isNaN(p.f) || isNaN(p.to) || pctErr) ? '' : '≈ ',\n"
            "        fromConv: (isNaN(p.f) || pctErr) ? '' : (xm ? fmtFiat(sym, p.f * RATE * (1 + margin / 100), true) : x6(p.f / (RATE * (1 + margin / 100)))),\n"
            "        toConv: (isNaN(p.to) || pctErr) ? '' : (xm ? fmtFiat(sym, p.to * RATE * (1 + margin / 100), true) : x6(p.to / (RATE * (1 + margin / 100)))),\n"
            "        convTail: (isNaN(p.f) || isNaN(p.to) || pctErr) ? '' : (xm ? '' : ' XMR') + ' at this band\\'s price (' + pctTxt(margin) + ')',\n"
            "        chips: mtChip(t.req ? (t.min || '0') : '0', (v) => setTier(t.id, v === '0' ? { req: false } : { req: true, min: v })),\n"
            "        previewUnit: xm ? 'XMR' : s.cur, previewUnitStyle: 'font-size: 13px; font-weight: 600; color: ' + (xm ? 'var(--monero-ink);' : 'var(--ink-muted);'),\n"
            "        previewConv: (isNaN(p.f) || isNaN(p.to) || pctErr) ? '' : '≈ ' + (xm ? fmtFiat(sym, p.f * RATE * (1 + margin / 100), true) + ' – ' + fmtFiat(sym, p.to * RATE * (1 + margin / 100), true) : x6(p.f / (RATE * (1 + margin / 100))) + ' – ' + x6(p.to / (RATE * (1 + margin / 100)))),\n"
            "        previewConvUnit: xm ? s.cur : 'XMR', previewConvUnitStyle: 'font-size: 13px; font-weight: 600; color: ' + (xm ? 'var(--ink-muted);' : 'var(--monero-ink);'),\n"
            "        previewMark: pctErr ? '' : pctTxt(margin),\n")
    s = sub(s, "        onFrom: (e) => setTier(t.id, { from: e.target.value }),\n        onTo: (e) => setTier(t.id, { to: e.target.value }),",
            "        onFrom: (e) => setTier(t.id, xm ? { xFrom: e.target.value } : { from: e.target.value }),\n        onTo: (e) => setTier(t.id, xm ? { xTo: e.target.value } : { to: e.target.value }),")
    s = sub(s, "previewRange: (isNaN(p.f) || isNaN(p.to)) ? 'Band ' + n : money(p.f) + ' – ' + money(p.to),",
            "previewRange: (isNaN(p.f) || isNaN(p.to)) ? 'Band ' + n : (xm ? x6(p.f) + ' – ' + x6(p.to) : money(p.f) + ' – ' + money(p.to)),")
    s = sub(s, "previewWho: t.req ? (t.min || '0') + '+ completed trades' : 'Anyone'", "previewWho: t.req ? (t.min || '0') + '+ completed trades' : 'Anyone can trade'")
    # field padding: room for the switch; sym only in fiat
    s = sub(s, "padding: 0 14px 0 30px; border-radius: 6px; border: \" + (bad ?", "padding: 0 108px 0 \" + (xm ? '14px' : '30px') + \"; border-radius: 6px; border: \" + (bad ?")
    # add tier: carry XMR bounds too
    s = sub(s, "ts.concat([{ id: this.state.nextId, from: isNaN(lt) ? '' : String(lt + 1), to: isNaN(lt) ? '' : String(lt * 2),",
            "ts.concat([{ id: this.state.nextId, from: isNaN(lt) ? '' : String(lt + 1), to: isNaN(lt) ? '' : String(lt * 2), xFrom: isNaN(num(last.xTo)) ? '' : x6(num(last.xTo) + 0.000001), xTo: isNaN(num(last.xTo)) ? '' : x6(num(last.xTo) * 2),")
    s = sub(s, "      curTabs, curCode: s.cur, sym,\n", "      curTabs, curCode: s.cur, sym, symShown: xm ? '' : sym, ...unitVals,\n"
            "      mtChips: mtChip(s.mt, (v) => this.setState({ mt: v })),\n"
            "      mtHelp: s.mt === '0' ? 'Anyone can take this offer. A band can ask for more.' : 'At least ' + s.mt + ' completed trades for the whole offer. A band can ask for more.',\n"
            "      bandsIntro: xm ? 'Set a different price for different trade sizes. Bands are in XMR, up to 6 decimals, in order, with no gaps: one ends at 1.500000, the next starts at 1.500001. Traders also see each band in ' + s.cur + ', converted at its price.' : 'Set a different price for different trade sizes. Bands are whole units, in order, with no gaps: one ends at 500, the next starts at 501. Traders also see each band in XMR, converted at its price.',\n")
    s = sub(s, '"margin":{"editor":"enum","options":["ok","too-high"],"default":"ok"},', '"margin":{"editor":"enum","options":["ok","too-high"],"default":"ok"},"unit":{"editor":"enum","options":["xmr","fiat"],"default":"xmr"},')
    return s

INTRO = 'Set a different price for different trade sizes. Bands are whole units, in order, with no gaps: one ends at 500, the next starts at 501. Each currency has its own bands; nothing is converted.'
MT_OLD = '''Minimum completed trades
{I}  <select id="{ID}" style="height: 44px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font-family: inherit; font-size: 15px;">
{I}    <option>Anyone</option><option>5+</option><option>10+</option><option>50+</option>
{I}  </select>
{I}</label>
{I}<span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">This counts for the whole offer. A band can ask for more.</span>'''

def note(wide):
    return ('    <p style="margin: 0; ' + ('max-width: 980px; ' if not wide else '') + 'font-size: 13px; line-height: 18px;"><strong>8 Nov, owner #11 (band unit).</strong> Every From / To box has an XMR / currency switch inside its right end (<span style="' + MONO + '">unit</span> tweak, showing: {{unitState}}; default XMR, the left one). Selected unit 15/20 600 in --monero-ink, the other 12/16 ink-muted. One unit per offer: tapping any switch moves every band\'s From and To together (lead default; the owner may override). '
            'Examples: XMR <span style="' + MONO + '">0.500000 – 1.500000</span>, <span style="' + MONO + '">1.500001 – 25.000000</span>; USD <span style="' + MONO + '">$50 – $500</span>, <span style="' + MONO + '">$501 – $2,000</span>. Under each box the other unit at that band\'s own price (market ± its percent). XMR bands are contiguous at 6 decimals (the next starts <span style="' + MONO + '">0.000001</span> higher). The preview shows each band in both units with its markup. '
            'This supersedes "nothing is converted" (owner, 2 Nov) for display: the vendor still types one unit; the other is shown, converted.' + (' Boxes stack one per row on phone: the switch needs the width.' if not wide else '') + '</p>\n'
            '    <p style="margin: 0; ' + ('max-width: 980px; ' if not wide else '') + 'font-size: 13px; line-height: 18px;"><strong>8 Nov, owner #12.</strong> Minimum completed trades, for the offer and for each band, is fixed chips: Anyone (kept first, default), <span style="' + MONO + '">5</span>, <span style="' + MONO + '">10</span>, <span style="' + MONO + '">25</span>, <span style="' + MONO + '">50</span> (Q27); selected has the 2 px ink ring. Replaces the drop-down and the per-band tick box with a free number.</p>\n'
            '    <p style="margin: 0; ' + ('max-width: 980px; ' if not wide else '') + 'font-size: 13px; line-height: 18px;">COPY-UNSIGNED, 8 Nov: the bands sub-line in both units ("…Bands are in XMR, up to 6 decimals, in order, with no gaps: one ends at 1.500000, the next starts at 1.500001. Traders also see each band in USD, converted at its price." / "…Traders also see each band in XMR, converted at its price.", replacing "Each currency has its own bands; nothing is converted."); "≈ $165.77 at this band\'s price (+0.8%)"-style lines; "XMR takes up to 6 decimals."; the contiguity error in XMR ("…starts at 1.500001 XMR."); "Anyone can take this offer. A band can ask for more." / "At least 10 completed trades for the whole offer. A band can ask for more."; "Anyone can trade" (preview, was "Anyone"); "Minimum completed trades for this band".</p>\n')

for b in ['FlexOffer-Post', 'FlexOffer-Post-Wide']:
    wide = b.endswith('Wide')
    f = P + b + '.dc.html'; s = open(f).read()
    s = js_edit(s)
    s = sub(s, "minLabel: 'Fewest completed trades for band ' + n,", "minLabel: 'Minimum completed trades for band ' + n,")
    s = sub(s, INTRO, '{{bandsIntro}}')
    # From / To boxes
    i = s.index('<label for="{{t.fromId}}"'); i = s.rindex('\n', 0, i) + 1
    j = s.index('</label>', s.index('<label for="{{t.toId}}"')) + len('</label>\n')
    ind = s[i:s.index('<', i)]
    if wide:
        s = s[:i] + box('from', 'From', ind) + box('to', 'To', ind) + s[j:]
        s = sub(s, 'grid-template-columns: 52px minmax(0, 1fr) minmax(0, 1fr) 44px; gap: 12px; align-items: end;', 'grid-template-columns: 52px minmax(0, 1fr) minmax(0, 1fr) 44px; gap: 12px; align-items: start;')
        s = sub(s, '<span aria-hidden="true" style="height: 48px; display: flex; align-items: center; font-size: 16px; font-weight: 600;">{{t.label}}</span>', '<span aria-hidden="true" style="height: 48px; margin-top: 22px; display: flex; align-items: center; font-size: 16px; font-weight: 600;">{{t.label}}</span>')
        s = sub(s, '<span style="display: flex; height: 48px; align-items: center;">\n                  <sc-if value="{{t.canRemove}}"', '<span style="display: flex; height: 48px; margin-top: 22px; align-items: center;">\n                  <sc-if value="{{t.canRemove}}"')
        # per-band chips
        k = s.index('<div style="display: flex; align-items: center; flex-wrap: wrap; column-gap: 8px; min-height: 44px; padding-left: 64px; font-size: 15px; line-height: 22px;">')
        k2 = s.index('</div>', k) + len('</div>')
        s = s[:k] + '<div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; padding-left: 64px; font-size: 15px; line-height: 22px;"><span>{{who}} must have completed at least</span>' + BAND_CHIPS + '</div>' + s[k2:]
        mt_old = MT_OLD.replace('{I}', '            ').replace('{ID}', 'mintrades-w')
        s = sub(s, '<label for="mintrades-w" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; font-size: 15px; line-height: 22px;">' + mt_old,
                '<span style="font-size: 15px; line-height: 22px;">Minimum completed trades</span>\n            ' + CHIPS + '\n            <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{mtHelp}}</span>')
        # preview row
        s = sub(s, '''<span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 14px; color: var(--ink-muted); white-space: nowrap;">{{t.previewRange}}</span>''',
                '''<span style="display: flex; flex-direction: column; gap: 2px; font-size: 14px; line-height: 20px; white-space: nowrap;"><span><span style="''' + MONO + '''">{{t.previewRange}}</span> <span style="{{t.previewUnitStyle}}">{{t.previewUnit}}</span></span><span><span style="''' + MONO + ''' color: var(--ink-muted);">{{t.previewConv}}</span> <span style="{{t.previewConvUnitStyle}}">{{t.previewConvUnit}}</span></span></span>''')
        s = sub(s, '<span style="font-size: 12px; line-height: 16px; color: var(--ink-muted); text-align: right;">{{t.previewWho}}</span>',
                '<span style="font-size: 12px; line-height: 16px; color: var(--ink-muted); text-align: right;"><span style="' + MONO + ' color: var(--escrow);">{{t.previewMark}}</span> markup · {{t.previewWho}}</span>')
    else:
        s = s[:i] + ind + '<div style="display: flex; flex-direction: column; gap: 12px;">\n' + box('from', 'From', ind + '  ') + box('to', 'To', ind + '  ') + ind + '</div>\n' + s[j:]
        # remove the now-empty grid wrapper: the grid div opened before From; replace its style
        s = sub(s, '          <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;">\n' + ind + '<div style="display: flex; flex-direction: column; gap: 12px;">', '          <div style="display: flex; flex-direction: column; gap: 12px;">\n' + ind + '<div style="display: contents;">')
        k = s.index('<div style="display: flex; flex-direction: column; gap: 4px; margin: -4px 0; font-size: 15px; line-height: 22px;">')
        k2 = s.index('</div>\n          </div>', k) + len('</div>\n          </div>')
        s = s[:k] + '<div style="display: flex; flex-direction: column; gap: 8px; font-size: 15px; line-height: 22px;">\n            <span>{{who}} must have completed at least</span>\n            ' + BAND_CHIPS + '\n          </div>' + s[k2:]
        mt_old = MT_OLD.replace('{I}', '        ').replace('{ID}', 'mintrades')
        s = sub(s, '<label for="mintrades" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; font-size: 15px; line-height: 22px;">' + mt_old,
                '<span style="font-size: 15px; line-height: 22px;">Minimum completed trades</span>\n        ' + CHIPS + '\n        <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{mtHelp}}</span>')
        s = sub(s, '''            <span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 14px; color: var(--ink-muted);">{{t.previewRange}}</span>''',
                '''            <span style="display: flex; flex-direction: column; gap: 2px; font-size: 14px; line-height: 20px; white-space: nowrap;"><span><span style="''' + MONO + '''">{{t.previewRange}}</span> <span style="{{t.previewUnitStyle}}">{{t.previewUnit}}</span></span><span><span style="''' + MONO + ''' color: var(--ink-muted);">{{t.previewConv}}</span> <span style="{{t.previewConvUnitStyle}}">{{t.previewConvUnit}}</span></span></span>''')
        s = sub(s, '<span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">{{t.previewWho}}</span>',
                '<span style="font-size: 12px; line-height: 16px; color: var(--ink-muted); text-align: right;"><span style="' + MONO + ' color: var(--escrow);">{{t.previewMark}}</span> markup<br>{{t.previewWho}}</span>')
    END = '  </section>\n</div>\n</x-dc>'
    i = s.rindex('  </section>', 0, s.index('</x-dc>')); i = s.rindex('\n', 0, i) + 1
    s = s[:i] + note(wide) + s[i:]
    open(f, 'w').write(s); print('ok', b, i is not None)
