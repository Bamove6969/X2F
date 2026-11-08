import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brand
from common import *

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../canvas/project/')
SLOGAN = 'You’ll need Fiat to believe it.'

BTN = ("display:flex;align-items:center;justify-content:center;height:56px;box-sizing:border-box;border-radius:12px;"
       "font-size:18px;line-height:24px;font-weight:600;text-decoration:none;")
PRIM = BTN + 'background:var(--monero);color:var(--on-monero);'
SEC = BTN + 'border:1px solid var(--line);color:var(--ink);'
FOOT = (f'<p style="margin:0;font-size:13px;line-height:18px;text-align:center;color:var(--ink-muted)">'
        f'Members only · Monero for cash, {m("2")}-of-{m("3")} escrow</p>')
LINK = ('<a href="Login-Backup.dc.html" style="display:flex;align-items:center;justify-content:center;min-height:44px;'
        'font-size:15px;line-height:20px;font-weight:600">Lost access? Recover your account</a>')

IC = {
    'lock': '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2"/>',
    'eyeoff': '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a15 15 0 0 1-2.6 3.1M6.3 7.6A15 15 0 0 0 2.5 12c1 1.5 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1"/><path d="M9.9 10a3 3 0 0 0 4.1 4.2"/>',
    'members': '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 19.5c.8-3.4 3.5-5 6.5-5 1.6 0 3.1.4 4.3 1.3"/><path d="M15 18l2 2 4-4"/>',
}
PROMISES = [('lock', f'Your coins sit in {m("2")}-of-{m("3")} escrow. X2F can’t move them alone.'),
            ('eyeoff', 'No IP addresses logged. Chats are <span style="white-space:nowrap">end-to-end</span> encrypted.'),
            ('members', 'Members only. Nothing here is public.')]


def icon(k):
    return (f'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:2px;color:var(--ink)">{IC[k]}</svg>')


def promises(wide):
    row = 'display:flex;align-items:flex-start;gap:10px;font-size:15px;line-height:22px;color:var(--ink-muted)'
    li = ''.join(f'<li style="{row}{";width:300px" if wide else ""}">{icon(k)}<span>{t}</span></li>' for k, t in PROMISES)
    if wide:
        return f'<ul aria-label="What X2F promises" style="margin:0;padding:0;list-style:none;display:flex;gap:40px">{li}</ul>'
    return f'<ul aria-label="What X2F promises" style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px;width:300px">{li}</ul>'


def screen_phone():
    return f'''<div style="flex-shrink:0;width:390px;height:844px;box-sizing:border-box;display:flex;flex-direction:column;padding:0 24px 24px">
<main style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:36px;padding-top:24px">
<h1 style="margin:0">{brand.svg(120, label='X2F')}</h1>
<p style="margin:0;font-family:{FAM};font-size:32px;line-height:36px;font-weight:700;letter-spacing:-0.02em;text-align:center">You’ll need Fiat<br>to believe it.</p>
{promises(False)}
</main>
<nav aria-label="Get in" style="display:flex;flex-direction:column;gap:12px">
<a href="SetupTerms.dc.html" style="{PRIM}">Create account</a>
<a href="Login.dc.html" style="{SEC}">Log in</a>
{LINK}
</nav>
<footer style="padding-top:20px">{FOOT}</footer>
</div>'''


def screen_wide():
    return f'''<div style="flex-shrink:0;width:1280px;height:800px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;padding:48px 48px 40px">
<main style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:44px">
<h1 style="margin:0">{brand.svg(180, label='X2F')}</h1>
<p style="margin:0;font-family:{FAM};font-size:40px;line-height:44px;font-weight:700;letter-spacing:-0.02em;text-align:center">{SLOGAN}</p>
{promises(True)}
<nav aria-label="Get in" style="display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:12px">
<div style="display:flex;gap:16px"><a href="SetupTerms.dc.html" style="{PRIM}width:240px">Create account</a><a href="Login.dc.html" style="{SEC}width:240px">Log in</a></div>
{LINK}
</nav>
</main>
<footer>{FOOT}</footer>
</div>'''


def notes(wide):
    other = 'Landing' if wide else 'Landing-Wide'
    n = [
        'Owner, 8 Nov (p8-1): logo D, Wordmark, “nice and big” on the front door with his slogan under it, word for word. Front door rule (8 Nov, comment #9): “There are no free tours for outsiders.”',
        md(f'The logo is the display cut from BrandKit, {"180" if wide else "120"} px tall: drawn paths, not text, with the coin’s inner rim. The coin and Create account are the only orange.'),
        md(f'Slogan in Familjen 700, {"40/44" if wide else "32/36, broken after “Fiat” so the two lines balance"}.'),
        'Three ways in, nothing else: Create account → SetupTerms (Terms, tick box, signature), Log in → Login, Lost access? Recover your account → Login-Backup. No rates, offers, names, counts or news before login.',
        f'Same screen as {other}; night and day through the theme tweak.',
        f'Three promise rows under the slogan (owner comment #10, no bare empty space; head designer, 8 Nov): what a visitor gets, never what is behind login. Icons 18 px in ink, text 15/22 ink-muted, {"one row of three" if wide else "a centred column"}.',
        'COPY-UNSIGNED: “Lost access? Recover your account”, “Members only · Monero for cash, 2-of-3 escrow”, “Your coins sit in 2-of-3 escrow. X2F can’t move them alone.”, “No IP addresses logged. Chats are end-to-end encrypted.” and “Members only. Nothing here is public.”. The slogan is the owner’s; “Create account” and “Log in” are his labels.',
    ]
    return notes_section(n, [], pad='24px 48px 48px' if wide else '24px 16px', maxw=980 if wide else 358)


def build(wide, h):
    scr = screen_wide() if wide else screen_phone()
    body = scr + notes(wide)
    w = 1280 if wide else 390
    return page('Landing' + (' · wide' if wide else ''), body, w, h, ' display: flex; flex-direction: column;')


if __name__ == '__main__':
    hp = int(sys.argv[1]) if len(sys.argv) > 1 else 1200
    hw = int(sys.argv[2]) if len(sys.argv) > 2 else 1100
    open(OUT + 'Landing.dc.html', 'w').write(build(False, hp))
    open(OUT + 'Landing-Wide.dc.html', 'w').write(build(True, hw))
