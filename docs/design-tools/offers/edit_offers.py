import sys, re
sys.path.insert(0, '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/offers-work')
from kit import *
P = '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/canvas/project/'
ADS = {'BuyOffers': [[330.00, 0.1, 'fiat', 50, 1500], [331.50, 0.5, 'xmr', 0.3, 9], [333.00, 0.9, 'fiat', 20, 400]]}
for b, ads in ADS.items():
    f = P + b + '.dc.html'; s = open(f).read()
    blocks = re.findall(r'      <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 8px;">.*?\n      </div>', s, re.S)
    assert len(blocks) == 3, len(blocks)
    for i, bl in enumerate(blocks):
        t = re.search(r'<span>(.*?)</span></span>\n', bl).group(1)
        s = sub(s, bl, ad_bottom('ads.a%d' % i, t))
    s = sub(s, '<span style="flex-grow: 1; font-size: 15px; line-height: 20px; font-weight: 600;">Market price</span>',
            '<span style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0;"><span style="font-size: 15px; line-height: 20px; font-weight: 600;">Market price</span>' + FRESH + '</span>')
    # checkbox right after the Sort row
    if 'Most trades</span></button>\n    </div>\n' in s:
        s = sub(s, 'Most trades</span></button>\n    </div>\n', 'Most trades</span></button>\n    </div>\n    ' + WM_BOX + '\n')
    else:
        s = sub(s, '      </sc-for>\n    </div>\n', '      </sc-for>\n    </div>\n    ' + WM_BOX + '\n')
    note = ('    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;"><strong>8 Nov, owner #11 (ad amounts).</strong> Each card: the price row (offer price, time), then markup bottom-left ("+0.4%" mono over "Vendor markup"; "0%" / "At market" when none) and two rows right-aligned in mono: the range in XMR and the range in USD. '
            'The poster sets the range in one unit; that row is exact and the other is converted and starts with "≈". The second card shows an XMR-set range. '
            'Above the list, "Display amounts including vendor markup" (<span style="' + MONO + '">withMarkup</span> tweak, showing: {{wm.state}}; default off) recalculates the converted rows: off at the market rate (<span style="' + MONO + '">$329.90</span>), on at each offer\'s own price. Selected box: ink fill, the ink ring family.</p>\n'
            '    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;">' + ANT + 'Follows owner #3: the market price strip carries "Market rate · updated <span style="' + MONO + '">14:05</span> UTC" (no provider named, Q34). The method stays in the title: this board has no method card, so the owner #1 drop-down lives on Main / BuyMain.</p>\n'
            '    <p style="margin: 0; max-width: 980px; font-size: 13px; line-height: 18px;">COPY-UNSIGNED, 8 Nov: "Display amounts including vendor markup" (owner\'s words), "Converted at the market rate, before markup.", "Converted at each offer\'s price, markup included.", "Vendor markup", "At market" (kept), "≈", "Market rate · updated <span style="' + MONO + '">14:05</span> UTC".</p>\n')
    s = sub(s, '  </section>\n</div>\n</x-dc>', note + '  </section>\n</div>\n</x-dc>')
    s = sub(s, '"$preview":{"width":390,', '"withMarkup":{"editor":"enum","options":["off","on"],"default":"off"},"$preview":{"width":390,')
    ret = '    return { rootStyle };' if '    return { rootStyle };' in s else '    return { rootStyle,\n'
    s = sub(s, ret, AD_JS + '    const ADS = ' + repr(ads).replace("'", "'") + ';\n    const ads = { a0: adAmt(ADS[0]), a1: adAmt(ADS[1]), a2: adAmt(ADS[2]) };\n' + ('    return { rootStyle, ads, wm };' if ret.endswith('};') else '    return { rootStyle, ads, wm,\n'))
    open(f, 'w').write(s); print('ok', b)
