import html, re
THEMES_NIGHT = '--ground:#0e1116;--surface:#171b22;--surface-raised:#20262f;--line:#6b7584;--ink:#eef1f5;--ink-muted:#9aa4b2;--monero:#ff6600;--monero-ink:#ff6600;--on-monero:#1a0e05;--escrow:#4cc3d9;--caution:#f2c14e;--danger:#ff6b8a;--scrim:rgba(0,0,0,0.6);--mod:#b69cff;--team:#7aa2ff;'
THEMES_DAY = '--ground:#f5f6f8;--surface:#ffffff;--surface-raised:#eceef2;--line:#7a8494;--ink:#12161c;--ink-muted:#566070;--monero:#ff6600;--monero-ink:#b84a00;--on-monero:#1a0e05;--escrow:#0b7285;--caution:#8a5a00;--danger:#c2255c;--scrim:rgba(18,22,28,0.45);--mod:#6741d9;--team:#2f5bd3;'

NV, DV = '{{nv}}', '{{dv}}'
MONO = "'Atkinson Hyperlegible Mono', monospace"
FAM = "'Familjen Grotesk', sans-serif"
LBL = (f"font-family:{MONO};font-size:12px;line-height:16px;font-weight:500;letter-spacing:0.04em;"
       "text-transform:uppercase;color:var(--ink-muted)")
H2 = f"margin:0;font-family:{FAM};font-size:28px;line-height:32px;font-weight:700;letter-spacing:-0.01em"
H3 = "margin:0;font-size:18px;line-height:24px;font-weight:600"
P = "margin:0;font-size:14px;line-height:20px;color:var(--ink-muted)"


def m(t):
    return f'<span style="font-family:{MONO}">{t}</span>'


def md(t):
    return re.sub(r'(?<![A-Za-z\d#;])\d+(?:[.,:×]\d+)*%?(?![A-Za-z\d])', lambda x: m(x.group()), t)


def notes_section(notes, anticipated, pad='24px 48px 48px', maxw=980):
    a = ''.join(f'<li>{x}</li>' for x in notes)
    b = ''.join(f'<li>{x}</li>' for x in anticipated)
    ant = ''
    if anticipated:
        ant = (f'<aside aria-label="Anticipated by design" style="display:flex;flex-direction:column;gap:6px;max-width:{maxw}px;padding:10px 12px;border-radius:6px;border:1px solid var(--surface-raised);font-size:13px;line-height:18px">'
               f'<span style="{LBL}">Anticipated · design, 8 Nov</span>'
               f'<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">{b}</ul></aside>')
    return (f'<section aria-label="Design notes" style="flex-shrink:0;display:flex;flex-direction:column;gap:12px;padding:{pad};border-top:1px solid var(--line)">'
            f'<h2 style="margin:0;{LBL}">Design notes</h2>'
            f'<ul style="margin:0;padding-left:18px;max-width:{maxw}px;display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:18px">{a}</ul>{ant}</section>')


def page(title, body, width, height, root_extra=''):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@600;700&amp;family=Atkinson+Hyperlegible+Next:wght@400;600&amp;family=Atkinson+Hyperlegible+Mono:wght@400;500&amp;display=swap">
<style>
body{{margin:0}}
a{{color:var(--monero-ink)}}a:hover{{color:var(--ink)}}
button:focus-visible,a:focus-visible,[tabindex]:focus-visible{{outline:2px solid var(--ink);outline-offset:2px}}
button,a,label{{transition:background-color 150ms ease-out,border-color 150ms ease-out,color 150ms ease-out}}
@media (prefers-reduced-motion: reduce){{*{{transition:none !important;animation:none !important}}}}
</style>
</helmet>
<div style="{{{{rootStyle}}}}">
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"theme":{{"editor":"enum","options":["night","day"],"default":"night"}},"$preview":{{"width":{width},"height":{height}}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    const THEMES = {{
      night: '{THEMES_NIGHT}',
      day: '{THEMES_DAY}'
    }};
    const theme = this.props.theme === 'day' ? 'day' : 'night';
    const rootStyle = THEMES[theme] + "position: relative; width: {width}px; height: {height}px; box-sizing: border-box; overflow: hidden; background: var(--ground); color: var(--ink); font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif;{root_extra}";
    const nv = THEMES.night + 'color: var(--ink);';
    const dv = THEMES.day + 'color: var(--ink);';
    return {{ rootStyle, nv, dv }};
  }}
}}
</script>
</body>
</html>
'''
