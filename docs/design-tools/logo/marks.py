"""X2F logo directions: hand-made SVG marks, token colours only."""

INK = 'var(--ink)'
FAM = "'Familjen Grotesk', sans-serif"


def _svg(vb, w, h, body, label=None):
    a = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    return (f'<svg width="{w:g}" height="{h:g}" viewBox="{vb}" {a} '
            f'style="display:block;flex-shrink:0;overflow:visible">{body}</svg>')


# ---------- A: Key pair ----------
def mark_a(px, tone=INK, label=None):
    if px <= 20:
        body = (f'<path d="M2.3 13.7L5 11M11 5L13.7 2.3" fill="none" style="stroke:{tone}" stroke-width="2.3" stroke-linecap="round"/>'
                f'<circle cx="4.4" cy="4.4" r="2.15" style="fill:{tone}"/>'
                f'<circle cx="8" cy="8" r="2.15" style="fill:{tone}"/>'
                f'<circle cx="11.6" cy="11.6" r="1.6" fill="none" style="stroke:{tone}" stroke-width="1.15"/>')
        return _svg('0 0 16 16', px, px, body, label)
    body = (f'<path d="M6.5 41.5L16.3 31.7M31.7 16.3L41.5 6.5" fill="none" style="stroke:{tone}" stroke-width="6.5" stroke-linecap="round"/>'
            f'<circle cx="13" cy="13" r="5.6" style="fill:{tone}"/>'
            f'<circle cx="24" cy="24" r="5.6" style="fill:{tone}"/>'
            f'<circle cx="35" cy="35" r="4.4" fill="none" style="stroke:{tone}" stroke-width="2.8"/>')
    return _svg('0 0 48 48', px, px, body, label)


# ---------- B: Exchange (the 2 is a route: dot to arrow) ----------
def _two(dx, sw, tone, ah=5.5):
    return (f'<path d="M{dx+12} 16.5C{dx+12} 10.5 {dx+17} 6 {dx+24} 6S{dx+36} 10.5 {dx+36} 16.5'
            f'C{dx+36} 22 {dx+32.5} 25 {dx+27.5} 28.5L{dx+12} 40H{dx+37}" fill="none" style="stroke:{tone}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="M{dx+37-ah} {40-ah}L{dx+37} 40L{dx+37-ah} {40+ah}" fill="none" style="stroke:{tone}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{dx+12}" cy="16.5" r="{sw*0.82:.2f}" style="fill:{tone}"/>')


def mark_b(px, tone=INK, label=None):
    sw = 7 if px <= 20 else 5.5
    return _svg('3 0 42 48', px * 42 / 48, px, _two(0, sw, tone), label)


def logo_b(cap_px, tone=INK, label=None):
    """Monoline logotype X-2-F. cap_px = desired cap height in px (cap = 34 units)."""
    sw = 6.2
    x = (f'<path d="M5 6L28 40M28 6L5 40" fill="none" style="stroke:{tone}" stroke-width="{sw}" '
         f'stroke-linecap="round"/>')
    f = (f'<path d="M84 40V6H105M84 23H100" fill="none" style="stroke:{tone}" stroke-width="{sw}" '
         f'stroke-linecap="round" stroke-linejoin="round"/>')
    h = cap_px * 48 / 34
    return _svg('2 0 106 48', h * 106 / 48, h, x + _two(31, sw, tone, 4.5) + f, label)


# ---------- C: Seal (woven X in the badge-seal language) ----------
def mark_c(px, label=None, solid=False):
    fill = 'color-mix(in srgb,var(--ink) 9%,var(--surface-raised))'
    ring = 'color-mix(in srgb,var(--ink) 55%,transparent)'
    small = px <= 20
    bw = 7.5 if small else 6
    rs = 3 if small else (1.75 if px <= 64 else 1.25)
    k = bw + (3.5 if small else 4)
    body = (f'<rect x="3" y="3" width="42" height="42" rx="12" style="fill:{fill};stroke:{ring}" stroke-width="{rs}"/>'
            f'<path d="M15.5 15.5L32.5 32.5" style="stroke:var(--ink)" stroke-width="{bw}" stroke-linecap="round"/>'
            f'<path d="M32.5 15.5L15.5 32.5" style="stroke:{fill}" stroke-width="{k}" stroke-linecap="round"/>'
            f'<path d="M32.5 15.5L15.5 32.5" style="stroke:var(--escrow)" stroke-width="{bw}" stroke-linecap="round"/>')
    return _svg('2 2 44 44', px, px, body, label)


# ---------- D: Wordmark only (the F's middle arm is a coin) ----------
def logo_d(font_px, label=None, coin='var(--monero)', tone=INK):
    x0 = 113.5
    body = (f'<text x="0" y="65" style="font-family:{FAM};font-size:100px;font-weight:700;letter-spacing:-3px;fill:{tone}">X2</text>'
            f'<path d="M{x0+6.5} 65V0H{x0+48.5}V11H{x0+20}V65Z" style="fill:{tone}"/>'
            f'<path d="M{x0+19} 26H{x0+27.5}V35.5H{x0+19}Z" style="fill:{tone}"/>'
            f'<circle cx="{x0+36}" cy="30.75" r="6.75" style="fill:{coin}"/>')
    vb_w = x0 + 50
    s = font_px / 100
    return _svg(f'-1 -2 {vb_w+1:g} 68', (vb_w + 1) * s, 68 * s, body, label)


def mark_d(px, tone=INK, coin='var(--monero)', label=None):
    """Favicon / tile glyph for D: the coin F alone."""
    body = (f'<path d="M9 44V4H39V12.5H19.5V44Z" style="fill:{tone}"/>'
            f'<path d="M18 21H25V29H18Z" style="fill:{tone}"/>'
            f'<circle cx="31.5" cy="25" r="6" style="fill:{coin}"/>')
    return _svg('0 0 48 48', px, px, body, label)


def wordmark(px, tone=INK):
    return (f'<span aria-hidden="true" style="font-family:{FAM};font-size:{px}px;line-height:{px}px;'
            f'font-weight:700;letter-spacing:-0.02em;color:{tone};white-space:nowrap">X2F</span>')


def lockup(d, size, label='X2F'):
    """Horizontal lockup at header size `size` (the wordmark font size)."""
    if d == 'A':
        return (f'<span role="img" aria-label="{label}" style="display:inline-flex;align-items:center;gap:{round(size*0.3)}px">'
                f'{mark_a(size)}{wordmark(size)}</span>')
    if d == 'C':
        return (f'<span role="img" aria-label="{label}" style="display:inline-flex;align-items:center;gap:{round(size*0.3)}px">'
                f'{mark_c(round(size*1.08))}{wordmark(size)}</span>')
    if d == 'B':
        return logo_b(size * 0.65, label=label)
    return logo_d(size, label=label)


def big(d, px, label='X2F'):
    """The mark large (for D, the wordmark large at roughly the same height)."""
    if d == 'A':
        return mark_a(px, label=label)
    if d == 'B':
        return mark_b(px, label=label)
    if d == 'C':
        return mark_c(px, label=label)
    return logo_d(px * 0.95, label=label)


def favicon(d, px):
    r = max(3, round(px * 0.22))
    if d == 'C':
        return mark_c(px)
    inner = round(px * 0.8)
    g = {'A': mark_a(inner, 'var(--ground)'), 'B': mark_b(inner, 'var(--ground)'),
         'D': mark_d(inner, 'var(--ground)')}[d]
    return (f'<span aria-hidden="true" style="display:flex;flex-shrink:0;width:{px}px;height:{px}px;align-items:center;'
            f'justify-content:center;border-radius:{r}px;background:var(--ink)">{g}</span>')
