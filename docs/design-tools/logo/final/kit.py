import sys, os, html, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import brand
from common import *

OUT = os.path.join(HERE, '../../canvas/project/')
HEXN = dict(ground='#0e1116', ink='#eef1f5', monero='#ff6600', onm='#1a0e05')
RIM_HEX = '#c34f01'  # 74% monero over on-monero, precomputed for files


def themed(th, inner, style=''):
    return f'<div style="{th}"><div style="background:var(--ground);outline:1px solid var(--surface-raised);outline-offset:-1px;{style}">{inner}</div></div>'


def tile_label(t):
    return f'<span style="{LBL}">{t}</span>'


def src_text(svg):
    s = re.sub(r' style="[^"]*"', '', svg)
    s = s.replace('><', '>\n<')
    e = html.escape(s, quote=False)
    return e.replace('#', '&#x23;')


def code(title, svg, note=''):
    nb = f'<span style="font-size:12px;line-height:16px;color:var(--ink-muted)">{note}</span>' if note else ''
    return (f'<div style="display:flex;flex-direction:column;gap:6px;min-width:0"><span style="font-size:14px;line-height:20px;font-weight:600">{title}</span>{nb}'
            f'<pre style="margin:0;padding:12px 14px;border-radius:12px;background:var(--surface-raised);font-family:{MONO};font-size:11px;line-height:16px;'
            f'white-space:pre-wrap;word-break:break-all;color:var(--ink)">{src_text(svg)}</pre></div>')


def section(n, kicker, title, intro, inner, sid):
    return f'''<section aria-labelledby="{sid}" style="display:flex;flex-direction:column;gap:20px">
<div style="display:flex;flex-direction:column;gap:6px"><span style="{LBL}">{m(n)} · {kicker}</span><h2 id="{sid}" style="{H2}">{title}</h2>
<p style="{P};max-width:860px">{intro}</p></div>
{inner}</section>'''


# ------------------------------------------------------------- 1 lockups
def s_lockups():
    cols = ''
    for th, lab in ((NV, 'Night'), (DV, 'Day')):
        big = themed(th, brand.svg(120), 'display:flex;align-items:center;justify-content:center;height:220px;border-radius:16px')
        small = themed(th,
                       f'<div style="display:flex;align-items:center;gap:20px">{brand.svg(32)}<span style="font-size:12px;line-height:16px;color:var(--ink-muted)">{m("32")} px · small cut</span></div>'
                       f'<div style="display:flex;align-items:center;gap:20px">{brand.svg(24)}<span style="font-size:12px;line-height:16px;color:var(--ink-muted)">{m("24")} px · small cut</span></div>',
                       'display:flex;flex-direction:column;justify-content:center;gap:20px;height:132px;padding:0 28px;border-radius:16px')
        cols += f'<div style="display:flex;flex-direction:column;gap:8px;flex:1">{tile_label(lab)}{big}{small}</div>'
    cuts = [
        ('Display · 80 px and up', 'Landing (120 phone, 180 wide), the app icon, print. Tight display spacing; the coin carries a thin inner rim.'),
        ('Medium · 33 to 79 px', 'The master drawing with text spacing and a plain coin.'),
        ('Small · 24 and 32 px', 'Pixel-fitted: the F’s stem, bars and arm sit on whole pixels, the 2’s overshoot is held to the cap line, spacing opens by about half a pixel and the coin grows a little, so it stays a coin and not a full stop.'),
    ]
    spec = ''.join(f'<div style="display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--surface-raised)"><span style="font-size:14px;line-height:20px;font-weight:600">{md(a)}</span>'
                   f'<span style="font-size:13px;line-height:18px;color:var(--ink-muted)">{md(b)}</span></div>' for a, b in cuts)
    geo = [
        ('Letters', 'X and 2 are the Familjen Grotesk 700 outlines, drawn as paths. The F is redrawn: stem and top bar as the font, the middle arm cut to a short stub.'),
        ('Spacing', 'Hand-set: the 2 tucks into the X’s open side (gap 30 of 780), the F closes up on the 2’s flat base (gap 64).'),
        ('Coin', 'Diameter 196 of 780 (a quarter of the height), centred on the arm, 30 past the stub. Its right edge stops 12 short of the top bar, so the F keeps its shape.'),
        ('Size', 'Always given as the logo’s height. X2F has no ascenders or descenders, so height = cap height. Width = 2.43 × height.'),
    ]
    geo_h = ''.join(f'<div style="display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--surface-raised)"><span style="font-size:14px;line-height:20px;font-weight:600">{a}</span>'
                    f'<span style="font-size:13px;line-height:18px;color:var(--ink-muted)">{md(b)}</span></div>' for a, b in geo)
    inner = (f'<div style="display:flex;gap:16px">{cols}</div>'
             f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px"><div style="display:flex;flex-direction:column">{tile_label("Three cuts")}<div style="height:8px"></div>{spec}</div>'
             f'<div style="display:flex;flex-direction:column">{tile_label("Geometry (units of a 780 cap)")}<div style="height:8px"></div>{geo_h}</div></div>')
    return section('1', 'Logo', 'X2F, final drawing', 'Owner, 8 Nov (p8-1): direction D, Wordmark. X2F in Familjen Grotesk 700, hand-spaced, the F’s middle arm ending in one Monero-orange coin; everything else ink. Every version below is drawn paths, so it looks the same in every browser, app and file.', inner, 's1')


# ------------------------------------------------------------- 2 clear space, minimum size
def s_space():
    H = 160
    g = brand.geometry(H)
    W = g['W']
    cd = 2 * g['coin'][2]  # coin diameter = clear space
    pad = cd
    box_w, box_h = W + 2 * pad, H + 2 * pad
    zone = (f'<div style="position:relative;width:{box_w:.0f}px;height:{box_h:.0f}px;box-sizing:border-box;border:1px dashed var(--line);border-radius:6px">'
            f'<div style="position:absolute;left:{pad:.1f}px;top:{pad:.1f}px;width:{W:.1f}px;height:{H}px;outline:1px solid color-mix(in srgb,var(--line) 50%,transparent)">{brand.svg(H, label="X2F")}</div>'
            f'<span aria-hidden="true" style="position:absolute;left:0;top:{pad + H/2 - 8:.1f}px;width:{pad:.1f}px;display:flex;justify-content:center">'
            f'<span style="width:{cd:.1f}px;height:{cd:.1f}px;border-radius:999px;border:1.5px solid var(--monero-ink);box-sizing:border-box"></span></span>'
            f'<span aria-hidden="true" style="position:absolute;left:{pad + W/2 - cd/2:.1f}px;top:0;height:{pad:.1f}px;display:flex;align-items:center">'
            f'<span style="width:{cd:.1f}px;height:{cd:.1f}px;border-radius:999px;border:1.5px solid var(--monero-ink);box-sizing:border-box"></span></span></div>')
    left = themed(NV, zone, 'display:flex;align-items:center;justify-content:center;height:340px;border-radius:16px')
    mins = ''
    for px, txt in ((24, 'Smallest full-colour logo on screen'), (32, 'Smallest one-colour logo (the ring needs room)')):
        mins += (f'<div style="display:flex;align-items:center;gap:16px;min-height:56px;padding:0 14px;border-radius:12px;background:var(--surface-raised)">'
                 f'<span style="width:112px;display:flex">{brand.svg(px, "mono" if px == 32 else "color")}</span>'
                 f'<span style="display:flex;flex-direction:column"><span style="font-size:14px;line-height:20px;font-weight:600">{m(str(px))} px tall</span><span style="font-size:13px;line-height:18px;color:var(--ink-muted)">{txt}</span></span></div>')
    rules = [
        ('Clear space', 'One coin (its diameter, a quarter of the logo’s height) on every side. Nothing inside it: no text, edge, icon or line. At 24 px that is 6 px; the header’s en dash sits 8 px away.'),
        ('Minimum size', 'Full colour 24 px tall on screen, one-colour 32 px, print 8 mm. Below 24 px use the favicon, the coin F alone.'),
        ('Scaling', 'Use the cut for the size (24 and 32 small, 33–79 medium, 80 and up display). Never scale the 24 px file up to a hero; never scale the display file down to a header.'),
        ('Background', 'Ground, surface or surface-raised in either theme. On orange or a photo use the reversed version.'),
    ]
    r = ''.join(f'<div style="display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--surface-raised)"><span style="font-size:14px;line-height:20px;font-weight:600">{a}</span>'
                f'<span style="font-size:13px;line-height:18px;color:var(--ink-muted)">{md(b)}</span></div>' for a, b in rules)
    right = f'<div style="display:flex;flex-direction:column;gap:10px;width:470px">{mins}<div style="display:flex;flex-direction:column;margin-top:6px">{r}</div></div>'
    inner = f'<div style="display:flex;gap:24px;align-items:flex-start"><div style="flex:1;display:flex;flex-direction:column;gap:8px">{tile_label("Clear space · night, 160 px")}{left}</div>{right}</div>'
    return section('2', 'Rules', 'Clear space and minimum size', 'The coin is the unit: the clear space is one coin wide, so the rule scales with the logo and anyone can measure it.', inner, 's2')


# ------------------------------------------------------------- 3 one colour, reversed
def photo_bg():
    return ('background:radial-gradient(circle at 25% 30%,color-mix(in srgb,var(--escrow) 55%,var(--ground)) 0,transparent 55%),'
            'radial-gradient(circle at 80% 75%,color-mix(in srgb,var(--caution) 45%,var(--ground)) 0,transparent 50%),'
            'linear-gradient(135deg,var(--surface-raised),color-mix(in srgb,var(--ink) 30%,var(--ground)))')


def s_variants():
    t = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;height:240px;border-radius:16px'
    mono_n = themed(NV, brand.svg(96, 'mono') + brand.svg(32, 'mono'), t)
    mono_d = themed(DV, brand.svg(96, 'mono') + brand.svg(32, 'mono'), t)
    rev_o = (f'<div style="{NV}"><div style="{t};background:var(--monero);color:var(--on-monero)">'
             f'{brand.svg(96, "reversed")}{brand.svg(32, "reversed")}</div></div>')
    rev_p = (f'<div style="{NV}"><div style="{t};{photo_bg()};color:var(--ink)">'
             f'{brand.svg(96, "reversed")}{brand.svg(32, "reversed")}</div></div>')
    tiles = ''
    for lab, tl, txt in (('One-colour · night', mono_n, 'Ink only. The coin becomes a ring, so it still reads as a coin with no orange.'),
                         ('One-colour · day', mono_d, 'Use where only one colour prints or embosses: stamps, receipts, engraving, a fax.'),
                         ('Reversed · on orange', rev_o, 'All one tone (on-monero, near black). The coin is solid with its rim cut out; orange is the ground, so the coin can’t be.'),
                         ('Reversed · on a photo', rev_p, 'The same drawing in night ink (near white) over busy images. Photo is a stand-in.')):
        tiles += (f'<div style="display:flex;flex-direction:column;gap:8px;min-width:0">{tile_label(lab)}{tl}'
                  f'<span style="font-size:13px;line-height:18px;color:var(--ink-muted)">{txt}</span></div>')
    inner = f'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">{tiles}</div>'
    return section('3', 'Versions', 'One-colour and reversed', 'Same geometry, same coin position and size; only the fill changes. Shown at 96 and 32 px.', inner, 's3')


# ------------------------------------------------------------- 4 icons
def grid_zoom(svg16, n, k):
    size = n * k
    line = 'color-mix(in srgb,var(--line) 45%,transparent)'
    return (f'<div style="position:relative;width:{size}px;height:{size}px">'
            f'<div style="position:absolute;inset:0;transform:scale({k});transform-origin:0 0;width:{n}px;height:{n}px">{svg16}</div>'
            f'<div aria-hidden="true" style="position:absolute;inset:0;background-image:linear-gradient(to right,{line} 1px,transparent 1px),linear-gradient(to bottom,{line} 1px,transparent 1px);'
            f'background-size:{k}px {k}px"></div></div>')


def tabmock(title):
    return (f'<div aria-hidden="true" style="display:flex;align-items:center;gap:8px;width:220px;height:32px;box-sizing:border-box;'
            f'padding:0 10px;border-radius:8px 8px 0 0;background:var(--surface-raised)"><span style="{NV}">{brand.favicon(16)}</span>'
            f'<span style="flex:1;min-width:0;font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;'
            f'text-overflow:ellipsis">{title}</span><span style="font-size:12px;color:var(--ink-muted)">✕</span></div>')


def homescreen(th, lab):
    icons = ''
    for px, cap in ((180, 'iOS 180 · @3x'), (120, 'iOS 120 · @2x'), (48, 'Android 48 · mdpi')):
        name = f'<span style="font-size:{13 if px > 48 else 11}px;line-height:16px">X2F</span>'
        icons += (f'<div style="display:flex;flex-direction:column;align-items:center;gap:6px"><span style="{NV}">{brand.appicon(px)}</span>{name}'
                  f'<span style="font-size:11px;line-height:14px;color:var(--ink-muted)">{md(cap)}</span></div>')
    return (f'<div style="display:flex;flex-direction:column;gap:8px">{tile_label(lab)}'
            + themed(th, icons, 'display:flex;align-items:flex-end;justify-content:space-around;height:260px;padding:0 16px 20px;box-sizing:border-box;border-radius:16px;'
                     'background:color-mix(in srgb,var(--surface-raised) 70%,var(--escrow))') + '</div>')


def s_icons():
    fav = ''
    for th, lab in ((NV, 'Night'), (DV, 'Day')):
        inner = (f'<div style="display:flex;align-items:center;gap:20px"><span style="{NV}">{brand.favicon(32)}</span><span style="{NV}">{brand.favicon(16)}</span>'
                 f'<span style="font-size:12px;line-height:16px;color:var(--ink-muted)">{m("32")} and {m("16")} px, actual size</span></div>'
                 f'{tabmock("Find a trade – X2F")}')
        fav += f'<div style="display:flex;flex-direction:column;gap:8px">{tile_label(lab + " · browser tab")}' + themed(th, inner, 'display:flex;flex-direction:column;gap:18px;padding:20px 20px 0;border-radius:16px;overflow:hidden') + '</div>'
    zooms = (f'<div style="display:flex;gap:24px;align-items:flex-end"><div style="display:flex;flex-direction:column;gap:8px">{tile_label("16 px, pixel grid × 10")}<span style="{NV}">{grid_zoom(brand.favicon(16), 16, 10)}</span></div>'
             f'<div style="display:flex;flex-direction:column;gap:8px">{tile_label("32 px, pixel grid × 5")}<span style="{NV}">{grid_zoom(brand.favicon(32), 32, 5)}</span></div></div>')
    fav_notes = [
        ('16 px', 'Stem and top bar 3 px on whole pixels, the coin 5 px across with 1 px of tile between it and both the stem and the bar. No arm stub at this size: the coin is the arm. Checked at 16 px and zoomed: an F and an orange coin, nothing blurs together.'),
        ('32 px', 'Stem 6, top bar 5, a 3 px arm stub, a 1 px gap and an 8 px coin, all on the grid.'),
        ('Tile', 'Night ground, the F in night ink, the coin in Monero orange, in both themes: a favicon can’t follow the page theme in every browser, and the dark tile holds on light and dark tab bars.'),
    ]
    fn = ''.join(f'<div style="display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--surface-raised)"><span style="font-size:14px;line-height:20px;font-weight:600">{md(a)}</span>'
                 f'<span style="font-size:13px;line-height:18px;color:var(--ink-muted)">{md(b)}</span></div>' for a, b in fav_notes)
    row1 = (f'<div style="display:grid;grid-template-columns:300px 300px 1fr;gap:16px;align-items:start">{fav}'
            f'<div style="display:flex;flex-direction:column;gap:16px">{zooms}<div style="display:flex;flex-direction:column">{fn}</div></div></div>')
    master = (f'<div style="display:flex;flex-direction:column;gap:8px">{tile_label("1024 master, shown at 224")}'
              f'<span style="{NV}"><span style="display:flex;padding:16px;border-radius:16px;background:var(--surface-raised)">{brand.appicon(224)}</span></span>'
              f'<span style="font-size:12px;line-height:16px;color:var(--ink-muted);max-width:256px">{md("Delivered full-bleed and square; the system cuts the corner. The F sits inside the Android 66% safe circle.")}</span></div>')
    why = ('<div style="display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:12px;background:var(--surface-raised);font-size:14px;line-height:20px">'
           f'<span style="{LBL}">Design’s call · the coin F, not the wordmark</span>'
           '<span>The home screen already prints “X2F” under every icon, so a wordmark icon says the name twice and has to shrink to a third of the tile to fit. '
           + md('At 48 px the full wordmark would be 15 px tall with a 4 px coin; the coin F alone fills the tile, keeps the coin at 9 px and matches the favicon, so the tab, the bookmark and the home screen are one picture.') + '</span></div>')
    row2 = (f'<div style="display:grid;grid-template-columns:256px 1fr 1fr;gap:24px;align-items:start">{master}'
            f'{homescreen(NV, "Home screen · night")}{homescreen(DV, "Home screen · day")}</div>{why}')
    inner = row1 + f'<h3 style="{H3};margin-top:12px">App icon</h3>' + row2
    return section('4', 'Icons', 'Favicon and app icon', 'Below 24 px the wordmark stops being legible, so the small places use the coin F alone, drawn on the pixel grid.', inner, 's4')


# ------------------------------------------------------------- 5 header
CHEV_L = ('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>')
BELL = ('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/>'
        '<path d="M10 20.5a2 2 0 0 0 4 0"/></svg>')


def ph_header(name, back=False, bell=True):
    left = (f'<a href="#" aria-label="Back" style="display:flex;flex-shrink:0;width:44px;height:44px;margin-left:-12px;align-items:center;'
            f'justify-content:center;color:var(--ink)">{CHEV_L}</a>') if back else ''
    r = (f'<a href="#" aria-label="Site news" style="display:flex;flex-shrink:0;width:44px;height:44px;margin-right:-12px;'
         f'align-items:center;justify-content:center;color:var(--ink)">{BELL}</a>') if bell else ''
    return (f'<header style="display:flex;align-items:center;height:56px;width:390px;box-sizing:border-box;padding:0 16px">{left}'
            f'<a href="#" aria-label="X2F home" style="display:flex;flex-shrink:0;color:var(--ink)">{brand.svg(24, label=None)}</a>'
            f'<span aria-hidden="true" style="flex-shrink:0;margin:0 8px;font-size:18px;line-height:24px;color:var(--ink-muted)">–</span>'
            f'<span style="flex:1;min-width:0;font-size:18px;line-height:24px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{name}</span>{r}</header>')


def wide_header(name):
    return (f'<header style="display:flex;align-items:center;height:64px;width:1280px;box-sizing:border-box;padding:0 32px;border-bottom:1px solid var(--surface-raised)">'
            f'<a href="#" aria-label="X2F home" style="display:flex;flex-shrink:0;color:var(--ink)">{brand.svg(24, label=None)}</a>'
            f'<span aria-hidden="true" style="margin:0 10px;font-size:18px;line-height:24px;color:var(--ink-muted)">–</span>'
            f'<span style="font-size:18px;line-height:24px;font-weight:600;white-space:nowrap">{name}</span><span style="flex:1"></span>'
            f'<span style="display:flex;align-items:baseline;gap:8px;font-size:13px;line-height:18px;color:var(--ink-muted)"><span style="font-family:{MONO};font-size:15px;font-weight:500;color:var(--ink)">$329.90</span>'
            f'<span style="color:var(--monero-ink);font-weight:600">/ XMR</span>Market rate · updated {m("14:05")} UTC</span>'
            f'<a href="#" aria-label="Site news" style="display:flex;width:44px;height:44px;margin:0 -10px 0 16px;align-items:center;justify-content:center;color:var(--ink)">{BELL}</a></header>')


def prelogin(wide):
    w = 1280 if wide else 390
    return (f'<header style="display:flex;align-items:center;justify-content:center;height:{72 if wide else 64}px;width:{w}px">'
            f'{brand.svg(32 if wide else 24, label="X2F")}</header>')


def s_header():
    cases = [('Find a trade', dict()), ('Your quote', dict(back=True)), (f'Trade · {m("K7M2")}', dict(back=True, bell=False))]
    cols = ''
    for th, lab in ((NV, 'Phone 390 · night'), (DV, 'Phone 390 · day')):
        strips = ''.join(themed(th, ph_header(n, **kw), 'border-radius:12px;overflow:hidden;width:390px') for n, kw in cases)
        strips += f'<span style="font-size:12px;line-height:16px;color:var(--ink-muted)">Pre-login (Login, signup): the logo alone, centred</span>' + themed(th, prelogin(False), 'border-radius:12px;overflow:hidden;width:390px')
        cols += f'<div style="display:flex;flex-direction:column;gap:10px">{tile_label(lab)}{strips}</div>'
    spec = [
        ('Order', 'Back (sub-pages only) · logo · en dash · page name; actions on the right.'),
        ('Logo', 'The 24 px small cut on phone and wide. It links home and is labelled “X2F home”; the drawing inside is hidden from screen readers.'),
        ('Dash and name', 'En dash, Atkinson 18/24 ink-muted, 8 px each side (10 on wide). Page name Atkinson 18/24 600 ink, one line; only the name truncates.'),
        ('Pre-login', 'The logo alone, centred: 24 px on phone, 32 px on wide. No page name; the name lives in the browser tab.'),
        ('Tab', '“Find a trade – X2F”, page name first, with the favicon.'),
    ]
    sp = ''.join(f'<div style="display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--surface-raised)"><span style="font-size:14px;line-height:20px;font-weight:600">{a}</span>'
                 f'<span style="font-size:13px;line-height:18px;color:var(--ink-muted)">{md(b)}</span></div>' for a, b in spec)
    spc = f'<div style="display:flex;flex-direction:column;flex:1;min-width:0">{tile_label("Rules")}<div style="height:8px"></div>{sp}</div>'
    wides = ''
    for th, lab in ((NV, 'Wide 1280 · night (shown at 92.5%)'), (DV, 'Wide 1280 · day (shown at 92.5%)')):
        inner = f'<div style="background:var(--ground);color:var(--ink)">{wide_header("Find a trade")}{prelogin(True)}</div>'
        wides += (f'<div style="display:flex;flex-direction:column;gap:8px">{tile_label(lab)}<div style="{th}"><div style="width:1184px;height:126px;overflow:hidden;border-radius:12px">'
                  f'<div style="width:1280px;outline:2px solid var(--surface-raised);outline-offset:-2px;transform:scale(0.925);transform-origin:0 0">{inner}</div></div></div></div>')
    inner = f'<div style="display:flex;gap:24px;align-items:flex-start">{cols}{spc}</div>{wides}'
    return section('5', 'Header', 'Logo – page name', 'Owner comment #2: the logo top left of every page, a dash, then the page name. Page names from LogoDirections: “Find a trade” (p8-2), “Your quote”, “Trade · K7M2”. The wide header shows the logo above the pre-login bar for comparison.', inner, 's5')


# ------------------------------------------------------------- 6 do and don't
def s_dont():
    t = 'display:flex;align-items:center;justify-content:center;height:140px;border-radius:12px'
    g = brand.geometry(64)
    W = g['W']
    recol = brand.svg(64, tone='var(--escrow)')
    stretch = brand.svg(64).replace(f'width="{brand._n(W,2)}"', f'width="{brand._n(W*1.3,2)}"', 1).replace('<svg ', '<svg preserveAspectRatio="none" ', 1)
    cx, cy, r = g['coin']
    moved = brand.svg(64).replace(f'cx="{brand._n(cx,1)}" cy="{brand._n(cy,1)}"', f'cx="{brand._n(cx,1)}" cy="{brand._n(-r-4,1)}"')
    orange = brand.svg(64, tone='var(--monero)')
    items = [('Do', brand.svg(64), 'Ink letters, one orange coin, the cut for the size.', True),
             ('Don’t recolour the letters', recol, 'Letters are ink only, never a state tone.', False),
             ('Don’t stretch or squash', stretch, 'Scale by height only; width follows (2.43 × height).', False),
             ('Don’t move the coin', moved, 'The coin ends the F’s middle arm. Nowhere else.', False),
             ('Orange only on the coin', orange, 'An orange letter takes the one accent away from the coin and the primary action.', False)]
    tiles = ''
    for lab, s, txt, ok in items:
        tone = 'var(--escrow)' if ok else 'var(--danger)'
        mark = ('<path d="M5 12.5l4.5 4.5L19 7.5"/>' if ok else '<path d="M7 7l10 10M17 7L7 17"/>')
        tiles += (f'<div style="display:flex;flex-direction:column;gap:8px;min-width:0">'
                  f'<span style="display:flex;align-items:center;gap:6px;font-size:14px;line-height:20px;font-weight:600;color:{tone}">'
                  f'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{mark}</svg>{lab}</span>'
                  + themed(NV, f'<div style="color:var(--ink)">{s}</div>', t + ';overflow:hidden')
                  + f'<span style="font-size:13px;line-height:18px;color:var(--ink-muted)">{txt}</span></div>')
    inner = f'<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:16px">{tiles}</div>'
    return section('6', 'Use', 'Do and don’t', 'One rule under all of them: the drawing is fixed. Pick a version and a cut; never edit the paths.', inner, 's6')


# ------------------------------------------------------------- 7 source
def s_source():
    lit = dict(tone=HEXN['ink'])
    blocks = [
        ('Header · 24 px (small cut)', brand.svg(24), 'Letters take currentColor (set color: var(--ink)); the coin is var(--monero).'),
        ('Wide pre-login · 32 px (small cut)', brand.svg(32), ''),
        ('Display · 120 px (scale by height for 80 px and up)', brand.svg(120), f'For 180 px, set width {brand._n(brand.geometry(180)["W"],2)} and height {brand._n(180*794/780,2)}; the viewBox stays.'),
        ('One-colour · 120 px', brand.svg(120, 'mono'), 'Every fill is currentColor.'),
        ('Reversed · 120 px', brand.svg(120, 'reversed'), 'color: var(--on-monero) on orange; night ink on photos.'),
        ('Favicon · 16 px', brand.favicon(16, tile=HEXN['ground'], tone=HEXN['ink'], coin=HEXN['monero']), 'Fixed colours (night ground, night ink, Monero orange): a favicon can’t read CSS tokens.'),
        ('Favicon · 32 px', brand.favicon(32, tile=HEXN['ground'], tone=HEXN['ink'], coin=HEXN['monero']), ''),
        ('App icon · 1024 master', brand.appicon(1024, tile=HEXN['ground'], tone=HEXN['ink'], coin=HEXN['monero'], rim=RIM_HEX, mask=False), 'Square, full-bleed; export PNG at 1024, 180, 120 and 48.'),
    ]
    a = ''.join(code(t, s, n) for t, s, n in blocks)
    inner = f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px 24px;align-items:start">{a}</div>'
    return section('7', 'Builders', 'SVG source', 'Copy these as they are. Inline SVG in the header and landing; files for the favicon and app icon (in logo-work/final/svg).', inner, 's7')


NOTES = [
    'Owner, 8 Nov (p8-1): logo D, Wordmark, X2F in Familjen Grotesk 700 with one Monero-orange coin on the F. Comment #2: “logo – page name” top left of every page; p8-2: browse is “Find a trade”.',
    md('Drawn, not typed: the X and 2 are Familjen 700 outlines turned into paths, re-spaced by hand; the F is redrawn so its middle arm is a stub that ends in the coin. The coin is 196 of 780 across (a quarter of the height) at every size; the small cut rounds it to 6 px at 24 and 8 px at 32.'),
    'Colours are tokens only: letters currentColor (ink), coin --monero, the display rim a 74% mix of --monero over --on-monero. Favicon and app icon files carry fixed night colours because they can’t read CSS.',
    'Checked at actual size and zoomed (16 px favicon, 24 and 32 px headers, night and day): stems and bars on whole pixels, the coin round with clear space to the arm and the bar.',
    'COPY-UNSIGNED: every sentence on this board (headings, rules, captions and these notes). Page names come from LogoDirections and are already listed there.',
]
ANTICIPATED = [
    'The market rate with source and time in the wide header (“Market rate · updated 14:05 UTC”), carried from LogoDirections; follows owner comment #3.',
    'A reversed version on a photo stand-in and a home-screen preview of the app icon with its “X2F” label, so the icon choice can be judged where it lives (follows p8-1).',
]


def build(h):
    body = f'''<div style="display:flex;flex-direction:column;gap:64px;padding:40px 48px 48px"><header style="display:flex;justify-content:space-between;align-items:flex-start"><div style="display:flex;flex-direction:column;gap:6px"><h1 style="margin:0;font-family:{FAM};font-size:40px;line-height:44px;font-weight:700;letter-spacing:-0.02em">Brand kit</h1><p style="margin:0;max-width:760px;font-size:16px;line-height:24px;color:var(--ink-muted)">The X2F logo as drawn for every size, the rules that keep it whole, the icons, and the source the builders copy.</p></div><span style="font-family:{MONO};font-size:12px;color:var(--ink-muted)">Draft copy</span></header>
<aside aria-label="Decided: logo" style="display:flex;flex-direction:column;gap:6px;padding:14px 16px;border-radius:6px;border:1px solid var(--line);font-size:14px;line-height:20px">
<span style="{LBL}">DECIDED · owner, 8 Nov (p8-1)</span><span style="font-size:16px;line-height:24px;font-weight:600">The X2F logo is D, Wordmark.</span>
<span>This board is its final drawing. LogoDirections keeps the four directions for the record.</span></aside>
{s_lockups()}
{s_space()}
{s_variants()}
{s_icons()}
{s_header()}
{s_dont()}
{s_source()}
</div>
{notes_section(NOTES, ANTICIPATED)}'''
    return page('Brand kit', body, 1280, h)


def write_files():
    d = os.path.join(HERE, 'svg')
    os.makedirs(d, exist_ok=True)
    clean = lambda s: re.sub(r' style="[^"]*"', '', s).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ', 1)
    lit = lambda s, ink: (s.replace('currentColor', ink).replace('var(--monero)', HEXN['monero'])
                          .replace('color-mix(in srgb,var(--monero) 74%,var(--on-monero))', RIM_HEX))
    for px in (24, 32, 120):
        for mode in ('color', 'mono', 'reversed'):
            for nm, ink in (('night', HEXN['ink']), ('day', '#12161c'), ('dark', HEXN['onm'])):
                if mode == 'reversed' and nm == 'day':
                    continue
                if mode == 'color' and nm == 'dark':
                    continue
                open(f'{d}/x2f-{mode}-{px}-{nm}.svg', 'w').write(clean(lit(brand.svg(px, mode), ink)))
    for px in (16, 32):
        open(f'{d}/favicon-{px}.svg', 'w').write(clean(brand.favicon(px, tile=HEXN['ground'], tone=HEXN['ink'], coin=HEXN['monero'])))
    open(f'{d}/app-icon-1024.svg', 'w').write(clean(brand.appicon(1024, tile=HEXN['ground'], tone=HEXN['ink'], coin=HEXN['monero'], rim=RIM_HEX, mask=False)))


if __name__ == '__main__':
    h = int(sys.argv[1]) if len(sys.argv) > 1 else 6000
    open(OUT + 'BrandKit.dc.html', 'w').write(build(h))
    write_files()
