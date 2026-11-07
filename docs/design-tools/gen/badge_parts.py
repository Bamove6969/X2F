# Shared markup + JS for applying the Badges design (Badges.dc.html, gen/badges.py) to real boards.
MONO = "font-family: 'Atkinson Hyperlegible Mono', monospace;"
FAM = "font-family: 'Familjen Grotesk', sans-serif;"

# Stroke icons as single path d strings (circles/rects from badges.py converted to arcs).
D = {
    'trusted': 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4',
    'clean': 'M3 12a9 9 0 1018 0a9 9 0 10-18 0M8 12.5l2.8 2.8L16.5 9',
    'veteran': 'M7 9a5 5 0 1010 0a5 5 0 10-10 0M9 13.5L7.5 21l4.5-2.5 4.5 2.5L15 13.5',
    'fast': 'M13 2L4 14h7l-1 8 9-12h-7z',
    'pgp': 'M4 15a4 4 0 108 0a4 4 0 10-8 0M11 12l9-9M17 6l3 3',
    'hw': 'M9.5 2.5h5A1.5 1.5 0 0116 4v5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 018 9V4a1.5 1.5 0 011.5-1.5zM6.5 10.5h11V15a5.5 5.5 0 01-11 0zM12 14v2.5',
    'fresh': 'M12 21v-8M12 13c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2.5-5-6-5 0 3 2.5 5 6 5z',
}
STORE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 01-5.3 1.9A3 3 0 0112 14a3 3 0 01-2.7-1.1A3 3 0 014 11z"/><path d="M5.5 14v6h13v-6"/></svg>'
CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
# key, name, tone, glyph key or #num, meaning
B = {
    'trusted': ('Trusted', 'escrow', 'trusted', '500+ trades and 98%+ positive.'),
    'clean': ('Clean record', 'escrow', 'clean', 'No lost disputes in 100 trades.'),
    'veteran': ('Veteran', 'escrow', 'veteran', 'Trading on X2F for over a year.'),
    'fast': ('Fast', 'caution', 'fast', 'Usually pays or releases within 10 min.'),
    'pgp': ('PGP verified', 'ink', 'pgp', 'Logs in with a verified PGP key.'),
    'hw': ('Security key', 'ink', 'hw', 'Protects the account with a hardware key.'),
    'm100': ('100 trades', 'ink', '#100', 'Completed 100 trades.'),
    'm500': ('500 trades', 'ink', '#500', 'Completed 500 trades.'),
    'fresh': ('New', 'ink-muted', 'fresh', 'Joined in the last 30 days.'),
}

def seal_style(tone, size):
    r = 12 if size == 40 else (9 if size == 28 else 999)
    ring = 1.5 if size >= 28 else 1
    return (f'display: flex; flex-shrink: 0; width: {size}px; height: {size}px; box-sizing: border-box; align-items: center; justify-content: center; border-radius: {r}px; '
            f'background: color-mix(in srgb, var(--{tone}) 16%, var(--surface-raised)); border: {ring}px solid color-mix(in srgb, var(--{tone}) 55%, transparent); color: var(--{tone});')

def glyph(key, size):
    g = B[key][2]
    if g.startswith('#'):
        fs = {22: 8, 28: 9.5, 40: 12}[size]
        return f'<span style="{MONO} font-size: {fs}px; line-height: 1; font-weight: 500; letter-spacing: -0.02em;">{g[1:]}</span>'
    s = {22: 13, 28: 16, 40: 20}[size]
    return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="{D[g]}"/></svg>'

def seal(key, size=40):
    return f'<span aria-hidden="true" style="{seal_style(B[key][1], size)}">{glyph(key, size)}</span>'

BTNWRAP = 'display: inline-flex; align-items: center; height: 44px; margin: -7px 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer;'

def chip_style(tone):
    return (f'display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px 0 4px; box-sizing: border-box; border-radius: 999px; '
            f'background: var(--surface-raised); border: 1px solid color-mix(in srgb, var(--{tone}) 32%, transparent); font-size: 13px; line-height: 16px; font-weight: 600; color: var(--ink); white-space: nowrap;')

def chip(key):
    n, t, g, m = B[key]
    return (f'<button type="button" aria-haspopup="dialog" aria-label="{n} badge: {m}" style="{BTNWRAP}">'
            f'<span style="{chip_style(t)}">{seal(key, 22)}{n}</span></button>')

def more_style(active=False):
    return ('display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 10px 0 11px; box-sizing: border-box; border-radius: 999px; '
            + ('border: 2px solid var(--ink);' if active else 'border: 1px solid var(--line);')
            + ' background: var(--surface-raised); color: var(--ink); font-size: 13px; line-height: 16px; font-weight: 600;')

def more(n):
    return (f'<button type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="{n} more badges" style="{BTNWRAP}">'
            f'<span style="{more_style()}"><span style="{MONO}">+{n}</span>{CHEV}</span></button>')

def chips_row(keys, extra):
    if not keys and not extra:
        return ''
    return (f'<div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">'
            + ''.join(chip(k) for k in keys) + (more(extra) if extra else '') + '</div>')

def earn_html(pre, date):
    return f'<span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">{pre} <span style="{MONO}">{date}</span></span>'

def row(key, pre=None, date=None, tag='li'):
    n, t, g, m = B[key]
    e = earn_html(pre, date) if pre else ''
    return (f'<{tag} style="display: flex; align-items: center; gap: 12px;">{seal(key, 40)}<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">'
            f'<span style="font-size: 15px; line-height: 20px; font-weight: 600;">{n}</span><span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{m}</span>{e}</span></{tag}>')

def avatar_style(size, ring, fs):
    return (f'position: relative; display: flex; flex-shrink: 0; width: {size}px; height: {size}px; box-sizing: border-box; align-items: center; justify-content: center; border-radius: 999px; background: var(--surface-raised); '
            + ('border: 2px solid color-mix(in srgb, var(--escrow) 70%, transparent);' if ring else 'border: 2px solid var(--surface-raised);')
            + f" {FAM} font-size: {fs}px; font-weight: 700; letter-spacing: -0.01em;")

def dot(size=12, bw=2.5, off=-1):
    return f'<span style="position: absolute; right: {off}px; bottom: {off}px; width: {size}px; height: {size}px; border-radius: 999px; background: var(--escrow); border: {bw}px solid var(--surface);"></span>'

def avatar(init, size=40, ring=False, online=True):
    fs = {40: 15, 48: 17, 64: 24}[size]
    return f'<span aria-hidden="true" style="{avatar_style(size, ring, fs)}">{init}{dot() if online else ""}</span>'

VENDOR_TAG = ('<span style="display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 6px; background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink-muted); font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; flex-shrink: 0;">'
              + STORE + 'Vendor</span>')

def mono_digits(s):
    import re
    return re.sub(r'(\d[\d,.]*%?)', lambda m: f'<span style="{MONO}">{m.group(1)}</span>', s)

SR_ONLINE = '<span style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Online · </span>'

def compact_trader(name, init, meta, feat, extra, ring=False, online=True, vendor=True, muted=False, side=''):
    """List-card trader block: 40 avatar + dot, name + Vendor tag, one meta line, chips. `side` = trailing action in the top row."""
    col = 'var(--ink-muted)' if muted else 'var(--ink)'
    return (f'<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0;">'
            f'<div style="display: flex; align-items: center; gap: 12px; min-width: 0;">{avatar(init, 40, ring, online)}'
            f'<span style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0;">'
            f'<span style="display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-width: 0;"><span style="font-size: 16px; line-height: 22px; font-weight: 600; color: {col};">{name}</span>{VENDOR_TAG if vendor else ""}</span>'
            f'<span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{SR_ONLINE if online else ""}{mono_digits(meta)}</span>'
            f'</span>{side}</div>{chips_row(feat, extra)}</div>')

# ---------- JS (for sc-for driven boards) ----------
JS_BADGES = r"""
    // Badge set, as on the Badges board (7 Nov): family tone, stroke glyph or milestone number, meaning. Draft copy.
    const BADGES = {
      trusted: { name: 'Trusted', tone: 'escrow', d: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4', meaning: '500+ trades and 98%+ positive.' },
      clean: { name: 'Clean record', tone: 'escrow', d: 'M3 12a9 9 0 1018 0a9 9 0 10-18 0M8 12.5l2.8 2.8L16.5 9', meaning: 'No lost disputes in 100 trades.' },
      veteran: { name: 'Veteran', tone: 'escrow', d: 'M7 9a5 5 0 1010 0a5 5 0 10-10 0M9 13.5L7.5 21l4.5-2.5 4.5 2.5L15 13.5', meaning: 'Trading on X2F for over a year.' },
      fast: { name: 'Fast', tone: 'caution', d: 'M13 2L4 14h7l-1 8 9-12h-7z', meaning: 'Usually pays or releases within 10 min.' },
      pgp: { name: 'PGP verified', tone: 'ink', d: 'M4 15a4 4 0 108 0a4 4 0 10-8 0M11 12l9-9M17 6l3 3', meaning: 'Logs in with a verified PGP key.' },
      hw: { name: 'Security key', tone: 'ink', d: 'M9.5 2.5h5A1.5 1.5 0 0116 4v5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 018 9V4a1.5 1.5 0 011.5-1.5zM6.5 10.5h11V15a5.5 5.5 0 01-11 0zM12 14v2.5', meaning: 'Protects the account with a hardware key.' },
      m100: { name: '100 trades', tone: 'ink', num: '100', meaning: 'Completed 100 trades.' },
      m500: { name: '500 trades', tone: 'ink', num: '500', meaning: 'Completed 500 trades.' },
      fresh: { name: 'New', tone: 'ink-muted', d: 'M12 21v-8M12 13c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2.5-5-6-5 0 3 2.5 5 6 5z', meaning: 'Joined in the last 30 days.' }
    };
    const sealStyle = (tone, size) => 'display: flex; flex-shrink: 0; width: ' + size + 'px; height: ' + size + 'px; box-sizing: border-box; align-items: center; justify-content: center; border-radius: ' + (size === 40 ? 12 : 999) + 'px; background: color-mix(in srgb, var(--' + tone + ') 16%, var(--surface-raised)); border: ' + (size === 40 ? 1.5 : 1) + 'px solid color-mix(in srgb, var(--' + tone + ') 55%, transparent); color: var(--' + tone + ');';
    const badge = (key, earned, tap) => {
      const b = BADGES[key];
      return {
        key, name: b.name, meaning: b.meaning, d: b.d || '', num: b.num || '', isIcon: !b.num, isNum: !!b.num,
        seal22: sealStyle(b.tone, 22), seal40: sealStyle(b.tone, 40),
        chipStyle: 'display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px 0 4px; box-sizing: border-box; border-radius: 999px; background: var(--surface-raised); border: 1px solid color-mix(in srgb, var(--' + b.tone + ') 32%, transparent); font-size: 13px; line-height: 16px; font-weight: 600; color: var(--ink); white-space: nowrap;',
        label: b.name + ' badge: ' + b.meaning,
        earnPre: earned ? earned[0] : '', earnDate: earned ? earned[1] : '',
        tap: tap || (() => {})
      };
    };
    const avatarStyle = (size, ring) => 'position: relative; display: flex; flex-shrink: 0; width: ' + size + 'px; height: ' + size + 'px; box-sizing: border-box; align-items: center; justify-content: center; border-radius: 999px; background: var(--surface-raised); border: 2px solid ' + (ring ? 'color-mix(in srgb, var(--escrow) 70%, transparent)' : 'var(--surface-raised)') + "; font-family: 'Familjen Grotesk', sans-serif; font-size: " + (size === 48 ? 17 : 15) + 'px; font-weight: 700; letter-spacing: -0.01em;';
    const moreStyle = (active) => 'display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 10px 0 11px; box-sizing: border-box; border-radius: 999px; border: ' + (active ? '2px solid var(--ink)' : '1px solid var(--line)') + '; background: var(--surface-raised); color: var(--ink); font-size: 13px; line-height: 16px; font-weight: 600;';
"""

def chip_markup(item='b', tap=True, popup='dialog'):
    """sc-for body for a chip; item fields from badge()."""
    on = f' onClick="{{{{{item}.tap}}}}"' if tap else ''
    return (f'<button type="button" aria-haspopup="{popup}" aria-label="{{{{{item}.label}}}}"{on} style="{BTNWRAP}"><span style="{{{{{item}.chipStyle}}}}">'
            f'<span aria-hidden="true" style="{{{{{item}.seal22}}}}"><sc-if value="{{{{{item}.isIcon}}}}" hint-placeholder-val="{{{{true}}}}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="{{{{{item}.d}}}}"/></svg></sc-if>'
            f'<sc-if value="{{{{{item}.isNum}}}}" hint-placeholder-val="{{{{false}}}}"><span style="{MONO} font-size: 8px; line-height: 1; font-weight: 500; letter-spacing: -0.02em;">{{{{{item}.num}}}}</span></sc-if></span>{{{{{item}.name}}}}</span></button>')

def row_markup(item='b', earned=True):
    e = (f'<span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">{{{{{item}.earnPre}}}} <span style="{MONO}">{{{{{item}.earnDate}}}}</span></span>' if earned else '')
    return (f'<li style="display: flex; align-items: center; gap: 12px;"><span aria-hidden="true" style="{{{{{item}.seal40}}}}"><sc-if value="{{{{{item}.isIcon}}}}" hint-placeholder-val="{{{{true}}}}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="{{{{{item}.d}}}}"/></svg></sc-if>'
            f'<sc-if value="{{{{{item}.isNum}}}}" hint-placeholder-val="{{{{false}}}}"><span style="{MONO} font-size: 12px; line-height: 1; font-weight: 500; letter-spacing: -0.02em;">{{{{{item}.num}}}}</span></sc-if></span>'
            f'<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;"><span style="font-size: 15px; line-height: 20px; font-weight: 600;">{{{{{item}.name}}}}</span><span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{{{{item}.meaning}}}}</span>{e}</span></li>')

DOT_MARKUP = dot()
