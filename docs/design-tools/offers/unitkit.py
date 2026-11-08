# Shared unit switch (owner #11) and min-trades chips (owner #12) markup + JS.
import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/offers-work')
from kit import MONO

CAPS = 'font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted);'

def unit_box(b='b', code='{{r.code}}'):
    """A range box with the XMR / <currency> switch inside its right end, and the converted line under it."""
    return ('<div style="display: flex; flex-direction: column; gap: 6px; min-width: 0;">'
            '<label for="{{' + b + '.id}}" style="' + CAPS + '">{{' + b + '.label}}</label>'
            '<span style="position: relative; display: block;">'
            '<input id="{{' + b + '.id}}" type="text" inputmode="decimal" value="{{' + b + '.value}}" aria-describedby="{{' + b + '.id}}-c" style="box-sizing: border-box; width: 100%; height: 48px; padding: 0 108px 0 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); ' + MONO + ' font-size: 16px; font-weight: 400;">'
            '<span role="radiogroup" aria-label="Unit for this offer" style="position: absolute; top: 0; right: 2px; bottom: 0; display: flex; align-items: center;">'
            '<button type="button" role="radio" aria-checked="{{unitX}}" onClick="{{pickXmr}}" style="{{unitXStyle}}">XMR</button>'
            '<span aria-hidden="true" style="width: 1px; height: 20px; background: var(--line);"></span>'
            '<button type="button" role="radio" aria-checked="{{unitF}}" onClick="{{pickFiat}}" style="{{unitFStyle}}">' + code + '</button>'
            '</span></span>'
            '<span id="{{' + b + '.id}}-c" style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">≈ <span style="' + MONO + '">{{' + b + '.convNum}}</span>{{' + b + '.convTail}}</span>'
            '</div>')

UNIT_JS = r'''
    // Offer unit (owner #11, 8 Nov): one unit for the whole offer, min and max switch together. Default XMR.
    const unit = this.state.unit == null ? (this.props.unit === 'fiat' ? 'fiat' : 'xmr') : this.state.unit;
    const UBTN = 'display: inline-flex; align-items: center; justify-content: center; min-width: 44px; height: 46px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; font-family: inherit; cursor: pointer; ';
    const uOn = UBTN + 'font-size: 15px; line-height: 20px; font-weight: 600; color: var(--monero-ink);';
    const uOff = UBTN + 'font-size: 12px; line-height: 16px; font-weight: 400; color: var(--ink-muted);';
    const unitVals = {
      unitState: unit, unitX: unit === 'xmr' ? 'true' : 'false', unitF: unit === 'fiat' ? 'true' : 'false',
      unitXStyle: unit === 'xmr' ? uOn : uOff, unitFStyle: unit === 'fiat' ? uOn : uOff,
      pickXmr: () => this.setState({ unit: 'xmr' }), pickFiat: () => this.setState({ unit: 'fiat' })
    };
    const fmtFiat = (sym, n, cents) => sym + n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
    const pctTxt = (m) => (m > 0 ? '+' : m < 0 ? '−' : '') + Math.abs(m).toFixed(1) + '%';
    // A box: value in the offer's unit; under it the other unit at the poster's price (markup applied).
    const rangeBox = (id, label, sym, xmrVal, fiatVal, rate, m) => ({
      id, label,
      value: unit === 'xmr' ? xmrVal.toFixed(6) : fmtFiat(sym, fiatVal, false),
      convNum: unit === 'xmr' ? fmtFiat(sym, xmrVal * rate, true) : (fiatVal / rate).toFixed(6),
      convTail: (unit === 'xmr' ? '' : ' XMR') + ' at your price (' + pctTxt(m) + ')'
    });
'''

CHIPS = ('<div role="radiogroup" aria-label="Minimum completed trades" style="display: flex; flex-wrap: wrap; gap: 6px;">'
         '<sc-for list="{{mtChips}}" as="t" hint-placeholder-count="5">'
         '<button type="button" role="radio" aria-checked="{{t.on}}" onClick="{{t.pick}}" style="display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer;"><span style="{{t.style}}">{{t.label}}</span></button>'
         '</sc-for></div>')

CHIPS_JS = r'''
    // Minimum completed trades (owner #12, 8 Nov): fixed choices; "Anyone" (no minimum) first and default.
    const MT_OPTS = [['0', 'Anyone'], ['5', '5'], ['10', '10'], ['25', '25'], ['50', '50']];
    const mtChip = (cur, set) => MT_OPTS.map(([v, label]) => ({
      label, on: cur === v ? 'true' : 'false',
      style: 'display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 52px; height: 36px; padding: 0 14px; border-radius: 999px; font-size: 15px; ' + (v === '0' ? 'font-family: inherit; ' : "font-family: 'Atkinson Hyperlegible Mono', monospace; ") + (cur === v
        ? 'border: 2px solid var(--ink); background: var(--surface-raised); color: var(--ink); font-weight: 600;'
        : 'border: 1px solid var(--line); background: transparent; color: var(--ink); font-weight: 400;'),
      pick: () => set(v)
    }));
'''
