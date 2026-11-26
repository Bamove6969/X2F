# Shared pieces for the 8 Nov offers pass (bak-offers job).
MONO = "font-family: 'Atkinson Hyperlegible Mono', monospace;"

# Freshness line under any market price (owner #3, anticipated). 13/18 muted, 14 px clock.
FRESH = ('<span style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; line-height: 18px; color: var(--ink-muted);">'
         '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
         'Market rate · updated <span style="' + MONO + '">14:05</span> UTC</span>')

ANT = ('<span style="display: inline-flex; align-items: center; height: 20px; padding: 0 6px; margin-right: 6px; border-radius: 6px; '
       'background: color-mix(in srgb, var(--caution) 14%, transparent); color: var(--caution); font-size: 11px; line-height: 14px; font-weight: 600; '
       'letter-spacing: 0.04em; text-transform: uppercase; vertical-align: 1px;">Anticipated · design, 8 Nov</span>')


def sub(src, old, new, count=1):
    n = src.count(old)
    if n != count:
        raise SystemExit('expected %d match(es), found %d for: %s' % (count, n, old[:120]))
    return src.replace(old, new)

# ---- Ad amounts (owner #11): markup bottom-left, range in XMR and in fiat on two rows, right-aligned mono.
# JS helper inserted into renderVals; needs `this` and a market rate. Each ad: [price, pct, unit, lo, hi].
AD_JS = r'''
    // Ad amounts (owner #11, 8 Nov). A range is set in one unit by the poster; the other is converted:
    // at the market rate, or at the offer's own price when "Display amounts including vendor markup" is on.
    const withMarkup = this.state.wm == null ? this.props.withMarkup === 'on' : this.state.wm;
    const MKT = 329.90;
    const amtUsd = (n, cents) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
    const adAmt = (a) => {
      const [price, pct, unit, lo, hi] = a;
      const rate = withMarkup ? price : MKT;
      const xmr = unit === 'xmr' ? lo.toFixed(6) + ' – ' + hi.toFixed(6) : '≈ ' + (lo / rate).toFixed(6) + ' – ' + (hi / rate).toFixed(6);
      const fiat = unit === 'xmr' ? '≈ ' + amtUsd(lo * rate, true) + ' – ' + amtUsd(hi * rate, true) : amtUsd(lo, lo % 1 !== 0) + ' – ' + amtUsd(hi, hi % 1 !== 0);
      return { price: amtUsd(price, true), xmr, fiat,
        mark: pct === 0 ? '0%' : (pct > 0 ? '+' : '−') + Math.abs(pct).toFixed(1) + '%',
        markLabel: pct === 0 ? 'At market' : 'Vendor markup',
        markStyle: "font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 15px; line-height: 20px; font-weight: 500; color: " + (pct === 0 ? 'var(--ink-muted);' : 'var(--escrow);') };
    };
    const wm = {
      on: withMarkup, state: withMarkup ? 'on' : 'off',
      box: 'display: flex; flex-shrink: 0; width: 22px; height: 22px; box-sizing: border-box; align-items: center; justify-content: center; border-radius: 6px; ' + (withMarkup ? 'border: 2px solid var(--ink); background: var(--ink); color: var(--ground);' : 'border: 1px solid var(--line); background: var(--surface-raised); color: transparent;'),
      hint: withMarkup ? "Converted at each offer's price, markup included." : 'Converted at the market rate, before markup.',
      toggle: () => this.setState({ wm: !withMarkup })
    };
'''

WM_BOX = ('<label style="position: relative; display: flex; align-items: center; gap: 12px; min-height: 44px; cursor: pointer;">'
          '<input type="checkbox" checked="{{wm.on}}" onChange="{{wm.toggle}}" style="position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0;">'
          '<span aria-hidden="true" style="{{wm.box}}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></span>'
          '<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;"><span style="font-size: 15px; line-height: 20px; font-weight: 600;">Display amounts including vendor markup</span>'
          '<span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{wm.hint}}</span></span></label>')


def ad_bottom(var, time_html, cur='USD', ind='      '):
    """Price row, then the amounts row: markup bottom-left, XMR and fiat ranges right."""
    return (ind + '<div style="display: flex; flex-direction: column; gap: 12px;">\n'
            + ind + '  <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px;">'
            '<span style="display: inline-flex; align-items: baseline; gap: 6px;"><span style="' + MONO + ' font-size: 28px; line-height: 32px; font-weight: 500; letter-spacing: -0.01em;">{{' + var + '.price}}</span>'
            '<span style="font-size: 14px; color: var(--ink-muted);">/ <span style="font-weight: 600; color: var(--monero-ink);">XMR</span></span></span>'
            '<span style="font-size: 13px; line-height: 18px; color: var(--ink-muted); text-align: right;">' + time_html + '</span></div>\n'
            + ind + '  <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--surface-raised);">'
            '<span style="display: flex; flex-direction: column; gap: 2px; flex-shrink: 0;"><span style="{{' + var + '.markStyle}}">{{' + var + '.mark}}</span><span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">{{' + var + '.markLabel}}</span></span>'
            '<span style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 0;">'
            '<span style="font-size: 14px; line-height: 20px; white-space: nowrap;"><span style="' + MONO + '">{{' + var + '.xmr}}</span> <span style="font-size: 13px; font-weight: 600; color: var(--monero-ink);">XMR</span></span>'
            '<span style="font-size: 14px; line-height: 20px; white-space: nowrap;"><span style="' + MONO + '">{{' + var + '.fiat}}</span> <span style="font-size: 13px; font-weight: 600; color: var(--ink-muted);">' + cur + '</span></span>'
            '</span></div>\n' + ind + '</div>')
