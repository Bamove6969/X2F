"""X2F logo, direction D (Wordmark), final geometry.

Every letter is a path: the X and the 2 are Familjen Grotesk 700 outlines (fontsource
latin-700 woff, 1200 upm, cap 780) re-spaced by hand; the F is redrawn so its middle
arm is a short stub that ends in the coin. No live text, so it renders the same everywhere.

Size = the logo's height in px (the cap height; X2F has no ascenders or descenders).
Three cuts:
  small   <= 32 px : pixel-fitted. F stem, bars and arm on whole pixels, the 2's overshoot
                     suppressed and its base snapped, spacing opened by about half a pixel,
                     coin slightly larger, no inner mark.
  medium  33-79 px : master geometry, text spacing, no inner mark.
  display >= 80 px : master geometry, tight display spacing, the coin's inner rim.
"""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

HERE = os.path.dirname(os.path.abspath(__file__))
_f = TTFont(os.path.join(HERE, 'fg700.woff'))
_gs = _f.getGlyphSet()
CAP = 780.0
# master F (font units, y down): stem 0-166, top bar 0-514 x 0-132, arm 309-431 to ARM, coin r CR at (CX, 370)
ARM, CR = 276, 98
CX = ARM + 30 + CR  # 404; coin's right edge 502, the top bar ends at 514

COIN = 'var(--monero)'
RIM = 'color-mix(in srgb,var(--monero) 74%,var(--on-monero))'


def _rec(name):
    p = RecordingPen()
    _gs[name].draw(p)
    out = []
    for op, args in p.value:
        if op == 'addComponent':
            base, (a, b, c, d, e, f) = args
            for op2, a2 in _rec(base):
                out.append((op2, [(x * a + e, y * d + f) for x, y in a2]))
        else:
            out.append((op, list(args)))
    return out


X_REC = _rec('X')      # 16..734
TWO_REC = _rec('two.lf')  # 44..616, top overshoot 794


def _n(v, dp):
    s = f'{v:.{dp}f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def _path(rec, fx, fy, dp):
    """rec in font units (y up) -> SVG d with mapping fx(x), fy(y)."""
    d = []
    for op, pts in rec:
        P = lambda p: f'{_n(fx(p[0]), dp)} {_n(fy(p[1]), dp)}'
        if op == 'moveTo':
            d.append('M' + P(pts[0]))
        elif op == 'lineTo':
            d.append('L' + P(pts[0]))
        elif op == 'qCurveTo':
            # TrueType implied on-curve points between consecutive off-curve points
            offs, end = pts[:-1], pts[-1]
            for i, o in enumerate(offs):
                if i < len(offs) - 1:
                    nx = ((o[0] + offs[i + 1][0]) / 2, (o[1] + offs[i + 1][1]) / 2)
                else:
                    nx = end
                d.append('Q' + P(o) + ' ' + P(nx))
        elif op == 'closePath':
            d.append('Z')
    return ''.join(d)


def _circle(cx, cy, r, dp, ccw=False):
    """Circle as two arcs (so it can join an evenodd compound path)."""
    a, b, c = _n(cx - r, dp), _n(cy, dp), _n(r, dp)
    sweep = '0' if ccw else '1'
    return (f'M{a} {b}a{c} {c} 0 1 {sweep} {_n(2*r, dp)} 0a{c} {c} 0 1 {sweep} {_n(-2*r, dp)} 0Z')


def geometry(px):
    """Return dict with letters path d, coin (cx, cy, r), rim (r_out, r_in) or None,
    width, height (viewBox in px units), all in px for the given cap height."""
    s = px / CAP
    if px <= 32:
        dp = 2
        cut = 'small'
        # --- X: plain scale, left edge at 0
        fx = lambda x: (x - 16) * s
        xd = _path(X_REC, fx, lambda y: (CAP - y) * s, dp)
        xw = 718 * s
        # --- 2: overshoot suppressed (794 -> 780), base snapped to whole pixels
        L2 = round(xw + 30 * s + 0.5)
        W2 = round(572 * s)
        sx = W2 / (572 * s)
        sy = CAP / 794
        fx2 = lambda x: L2 + (x - 44) * s * sx
        fy2 = lambda y: (CAP - y * sy) * s
        td = _path(TWO_REC, fx2, fy2, dp)
        # --- F on the pixel grid
        if px <= 24:
            stem, bar, blen, a0, a1, stub, gap, r = 5, 4, 16, 9, 13, 3, 1, 3
            gap2f = 2
        else:
            stem, bar, blen, a0, a1, stub, gap, r = 7, 5, 21, 13, 18, 4, 1, 4
            gap2f = 3
        F0 = L2 + W2 + gap2f
        H = px
        fd = (f'M{F0} 0H{F0+blen}V{bar}H{F0+stem}V{a0}H{F0+stem+stub}V{a1}H{F0+stem}V{H}H{F0}Z')
        cx, cy = F0 + stem + stub + gap + r, (a0 + a1) / 2
        W = F0 + blen
        rim = None
        top = 0
    else:
        display = px >= 80
        cut = 'display' if display else 'medium'
        dp = 1
        g12, g2f = (30, 64) if display else (40, 72)
        # all in font units first, then scaled
        X0 = -16
        T0 = 718 + g12 - 44
        F0u = T0 + 616 + g2f
        fx = lambda x: (x + X0) * s
        fy = lambda y: (CAP - y) * s
        xd = _path(X_REC, fx, fy, dp)
        td = _path(TWO_REC, lambda x: (x + T0) * s, fy, dp)
        u = lambda v: _n(v * s, dp)
        F = F0u
        fd = (f'M{u(F)} 0H{u(F+514)}V{u(132)}H{u(F+166)}V{u(309)}H{u(F+ARM)}V{u(431)}H{u(F+166)}V{u(780)}H{u(F)}Z')
        cx, cy, r = (F + CX) * s, 370 * s, CR * s
        W = (F + 514) * s
        H = px
        rim = (r * 0.72, r * 0.72 - max(r * 0.075, 0.9)) if display else None
        top = -14 * s  # the 2's overshoot
    return dict(px=px, cut=cut, dp=dp, letters=xd + td + fd, coin=(cx, cy, r), rim=rim,
                W=W, H=H, top=top)


def svg(px, mode='color', label='X2F', tone='currentColor', coin=COIN, rim=RIM, extra_style=''):
    """mode: color | mono (coin as a ring) | reversed (one tone, solid coin, rim knocked out).
    tone: letter colour (currentColor by default; set `color` on a parent)."""
    g = geometry(px)
    dp = g['dp']
    cx, cy, r = g['coin']
    top = g['top']
    vb_h = g['H'] - top
    vb = f'0 {_n(top, 2)} {_n(g["W"], 2)} {_n(vb_h, 2)}'
    w, h = g['W'], vb_h
    a = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    body = f'<path fill="{tone}" d="{g["letters"]}"/>'
    if mode == 'color':
        body += f'<circle fill="{coin}" cx="{_n(cx, dp)}" cy="{_n(cy, dp)}" r="{_n(r, dp)}"/>'
        if g['rim']:
            ro, ri = g['rim']
            body += (f'<path fill="{rim}" fill-rule="evenodd" d="{_circle(cx, cy, ro, dp)}{_circle(cx, cy, ri, dp)}"/>')
    elif mode == 'mono':
        ring = max(r * 0.42, 1.5)
        body += (f'<path fill="{tone}" fill-rule="evenodd" d="{_circle(cx, cy, r, dp)}{_circle(cx, cy, r - ring, dp)}"/>')
    elif mode == 'reversed':
        if g['rim']:
            ro, ri = g['rim']
            body += (f'<path fill="{tone}" fill-rule="evenodd" d="{_circle(cx, cy, r, dp)}{_circle(cx, cy, ro, dp)}{_circle(cx, cy, ri, dp)}"/>')
        else:
            body += f'<circle fill="{tone}" cx="{_n(cx, dp)}" cy="{_n(cy, dp)}" r="{_n(r, dp)}"/>'
    st = f'display:block;flex-shrink:0;overflow:visible{";" + extra_style if extra_style else ""}'
    return (f'<svg width="{_n(w, 2)}" height="{_n(h, 2)}" viewBox="{vb}" {a} style="{st}">{body}</svg>')


# ------------------------------------------------------------- icons
def favicon(px, tile='var(--ground)', tone='var(--ink)', coin=COIN, label=None):
    """The coin F alone on a rounded tile. Pixel art at 16 and 32; the 1024 master scales."""
    a = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    if px == 16:
        R = 3
        f = 'M4 2H13V5H7V14H4Z'
        c = (10.5, 8.5, 2.5)
        n = 16
    elif px == 32:
        R = 7
        # stem 7..13, bar 5..10 to 25, stub 13..15 at y 14..18, coin d 8
        f = 'M7 5H25V10H13V14H16V18H13V27H7Z'
        c = (21, 16, 4)
        n = 32
    else:
        raise ValueError(px)
    body = (f'<rect width="{n}" height="{n}" rx="{R}" fill="{tile}"/><path fill="{tone}" d="{f}"/>'
            f'<circle fill="{coin}" cx="{c[0]}" cy="{c[1]}" r="{c[2]}"/>')
    return f'<svg width="{px}" height="{px}" viewBox="0 0 {n} {n}" {a} style="display:block;flex-shrink:0">{body}</svg>'


def appicon(px, tile='var(--ground)', tone='var(--ink)', coin=COIN, rim=RIM, mask=True, label=None):
    """1024 master: full-bleed square (the OS masks it); shown with the iOS-like corner
    (22.4%) when mask=True. The coin F, cap 500 of 1024, centred on its optical middle."""
    a = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    N = 1024
    s = 500 / CAP
    w = 514 * s
    ox = (N - w) / 2 + 10   # nudge right: the F's open side makes the box read left-heavy
    oy = (N - 500) / 2
    u = lambda v: _n(v, 1)
    fd = (f'M{u(ox)} {u(oy)}H{u(ox+514*s)}V{u(oy+132*s)}H{u(ox+166*s)}V{u(oy+309*s)}H{u(ox+ARM*s)}'
          f'V{u(oy+431*s)}H{u(ox+166*s)}V{u(oy+780*s)}H{u(ox)}Z')
    cx, cy, r = ox + CX * s, oy + 370 * s, CR * s
    ro, ri = r * 0.72, r * 0.72 - r * 0.075
    rr = 229 if mask else 0
    body = (f'<rect width="{N}" height="{N}" rx="{rr}" fill="{tile}"/><path fill="{tone}" d="{fd}"/>'
            f'<circle fill="{coin}" cx="{u(cx)}" cy="{u(cy)}" r="{u(r)}"/>'
            f'<path fill="{rim}" fill-rule="evenodd" d="{_circle(cx, cy, ro, 1)}{_circle(cx, cy, ri, 1)}"/>')
    return f'<svg width="{px}" height="{px}" viewBox="0 0 {N} {N}" {a} style="display:block;flex-shrink:0">{body}</svg>'


if __name__ == '__main__':
    for p in (16, 24, 32, 48, 120, 180):
        g = geometry(p)
        print(p, g['cut'], 'W', round(g['W'], 2), 'coin', [round(v, 2) for v in g['coin']])
