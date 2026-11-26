import sys, html
sys.path.insert(0, '.')
from marks import *
from skel import page

NV, DV = '{{nv}}', '{{dv}}'
MONO = "'Atkinson Hyperlegible Mono', monospace"
LBL = (f"font-family:{MONO};font-size:12px;line-height:16px;font-weight:500;letter-spacing:0.04em;"
       "text-transform:uppercase;color:var(--ink-muted)")
H2 = "margin:0;font-family:'Familjen Grotesk',sans-serif;font-size:28px;line-height:32px;font-weight:700;letter-spacing:-0.01em"
H3 = "margin:0;font-size:18px;line-height:24px;font-weight:600"
P = "margin:0;font-size:14px;line-height:20px;color:var(--ink-muted)"


def m(t):
    return f'<span style="font-family:{MONO}">{t}</span>'


import re
def md(t):
    return re.sub(r'(?<![A-Za-z\d])\d+(?:[.,:]\d+)*%?(?![A-Za-z\d])', lambda x: m(x.group()), t)


def themed(th, inner, style=''):
    return f'<div style="{th}"><div style="background:var(--ground);outline:1px solid var(--surface-raised);outline-offset:-1px;{style}">{inner}</div></div>'


NAMES = {'A': 'Key pair', 'B': 'Exchange', 'C': 'Seal', 'D': 'Wordmark only'}

CHEV_L = ('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>')
BELL = ('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/>'
        '<path d="M10 20.5a2 2 0 0 0 4 0"/></svg>')
KEYS_SMALL = ('<svg width="24" height="6" viewBox="0 0 32 8" aria-hidden="true" style="flex-shrink:0;color:var(--ink-muted)">'
              '<circle cx="4" cy="4" r="4" fill="currentColor"/><circle cx="16" cy="4" r="4" fill="currentColor"/>'
              '<circle cx="28" cy="4" r="3.25" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>')


def tabmock(d, title='Find a trade – X2F'):
    return (f'<div aria-hidden="true" style="display:flex;align-items:center;gap:8px;width:200px;height:32px;box-sizing:border-box;'
            f'padding:0 10px;border-radius:8px 8px 0 0;background:var(--surface-raised)">{favicon(d, 16)}'
            f'<span style="flex:1;min-width:0;font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;'
            f'text-overflow:ellipsis">{title}</span><span style="font-size:12px;color:var(--ink-muted)">✕</span></div>')


# ---------------------------------------------------------------- section 1
RAT = {
 'A': ("The X is drawn by the 2-of-3 key mark crossing a single stroke: three keys on one diagonal, the trade on the other. "
       "It is the idea X2F is built on, escrow that no single person can move, and it is already the motif people see on every trade. "
       "At 16 px it is still two dots, a ring and two stubs, so the favicon is the same drawing, not a simplification.",
       ["Says what X2F is (2-of-3 escrow) without a word.",
        "Grows out of the key mark, so the brand and the app look like one thing.",
        "Holds up at 16 px; no letters to blur.",
        "Nothing borrowed from Monero, exchanges or crypto clichés."],
       ["At a glance it reads as a percent sign (%), which on a site full of markups and fees is the wrong first impression.", "Shares the key mark's dots: the logo must always be ink, never a state tone.",
        "Abstract on its own; the wordmark carries the name until people know the mark."]),
 'B': ("X2F drawn as one monoline: an X, a 2 that is a route, and an F. The 2 starts at a dot and ends in an arrow pointing at the F, "
       "so the name reads the way it sounds: XMR to fiat. The 2 on its own becomes the mark and the favicon.",
       ["Reads as the name and the service at a glance.",
        "One stroke weight everywhere: calm and exact.",
        "The route-2 alone is a strong small mark."],
       ["The arrow says one way; people sell XMR for cash and buy it with cash.",
        "Arrow-in-a-letter is a common fintech move, so less ownable.",
        "Hand-drawn letters must sit beside Familjen text without clashing."]),
 'C': ("A rounded-square seal in the badge language (ink family, a 55% ring, radius in proportion to the 40 px seal), holding an X woven from two bars: "
       "ink passes under escrow teal. Two parties meet and neither can lift the other's bar. "
       "It is the same object as the security seals in the app, and it is already a favicon and an app icon.",
       ["Belongs to the kit: same shape, ring and corner as the security seals.",
        "A ready-made app icon and favicon.",
        "Teal brings warmth and says escrow without spending orange."],
       ["An X in a rounded square is common; the weave is what makes it ours, and it fades below 24 px.",
        "So close to the badge seals that it can read as a badge, not the brand.",
        "Two colours: needs a one-colour version for print."]),
 'D': ("No symbol. X2F set in Familjen Grotesk 700 with hand-set spacing (the X and 2 pulled in, the 2 and F closed up), "
       "and one change: the F's middle arm ends in a Monero-orange coin, the XMR being traded. Everything else stays plain ink.",
       ["Most legible: the name is the brand.",
        "Easy to use anywhere: three letters and one dot.",
        "The coin is small, warm and ours."],
       ["Spends orange outside the primary action (one accent, but a second orange on every screen).",
        "Weak at 16 px: the favicon has to fall back to the coin F alone.",
        "Familjen is an open font anyone can set; only the coin is ours."]),
}


def dir_card(d):
    big_tiles = ''
    for th, lab in ((NV, 'Night'), (DV, 'Day')):
        big_tiles += (f'<div style="display:flex;flex-direction:column;gap:8px"><span style="{LBL}">{lab}</span>'
                      + themed(th, big(d, 140, f'X2F, direction {d}'),
                               'display:flex;align-items:center;justify-content:center;width:272px;height:236px;border-radius:12px')
                      + '</div>')
    small = ''
    for th, lab in ((NV, 'Night · header and tab'), (DV, 'Day · header and tab')):
        inner = (f'<div style="display:flex;flex-direction:column;gap:14px;padding:16px 16px 0">'
                 f'<div style="display:flex;align-items:center;gap:12px;height:40px"><span style="{LBL};width:28px">{m("32")}</span>{lockup(d, 32)}</div>'
                 f'<div style="display:flex;align-items:center;gap:12px;height:32px"><span style="{LBL};width:28px">{m("24")}</span>{lockup(d, 24)}</div>'
                 f'<div style="display:flex;align-items:center;gap:16px;height:32px"><span style="{LBL};width:28px">Fav</span>{favicon(d, 32)}{favicon(d, 16)}'
                 f'<span style="font-size:12px;line-height:16px;color:var(--ink-muted)">{m("32")} and {m("16")} px</span></div></div>'
                 f'<div style="padding:0 16px">{tabmock(d)}</div>')
        small += (f'<div style="display:flex;flex-direction:column;gap:8px"><span style="{LBL}">{lab}</span>'
                  + themed(th, inner, 'display:flex;flex-direction:column;justify-content:space-between;width:272px;height:236px;box-sizing:border-box;border-radius:12px;overflow:hidden')
                  + '</div>')
    rat, pros, cons = RAT[d]
    li = lambda xs: ''.join(f'<li>{md(x)}</li>' for x in xs)
    rec = ''
    if d == 'D':
        rec = ('<span style="display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:999px;font-size:13px;line-height:16px;font-weight:600;'
               'background:color-mix(in srgb,var(--escrow) 16%,transparent);color:var(--escrow)">Owner\'s pick · 8 Nov</span>')
    return f'''<article aria-labelledby="dir-{d}" style="display:flex;flex-direction:column;gap:20px;padding:24px;border-radius:16px;background:var(--surface)">
<div style="display:flex;align-items:center;gap:12px"><span aria-hidden="true" style="display:flex;width:40px;height:40px;align-items:center;justify-content:center;border-radius:12px;background:var(--surface-raised);font-family:'Familjen Grotesk',sans-serif;font-size:20px;font-weight:700">{d}</span>
<h3 id="dir-{d}" style="{H3}">{d} · {NAMES[d]}</h3>{rec}</div>
<div style="display:flex;gap:16px">{big_tiles}{small}</div>
<div style="display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:24px;font-size:14px;line-height:20px">
<div style="display:flex;flex-direction:column;gap:6px"><span style="{LBL}">Rationale</span><p style="margin:0">{md(rat)}</p></div>
<div style="display:flex;flex-direction:column;gap:6px"><span style="{LBL}">Pros</span><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">{li(pros)}</ul></div>
<div style="display:flex;flex-direction:column;gap:6px"><span style="{LBL}">Cons</span><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">{li(cons)}</ul></div>
</div></article>'''


OPEN_ASIDE = f'''<aside aria-label="Decided: logo direction" style="display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-radius:6px;border:1px solid var(--line);font-size:14px;line-height:20px;color:var(--ink)">
<span style="{LBL}">DECIDED · owner, 8 Nov (page 8)</span>
<span style="font-size:16px;line-height:24px;font-weight:600">The X2F logo is D, Wordmark.</span>
<span>X2F in Familjen Grotesk 700, hand-spaced, the F's middle arm ending in one Monero-orange coin. Browse page name: "Find a trade".</span>
<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:2px">
<li>Next, design draws the final geometry: the lockup at {m('24')} and {m('32')} px, the favicon (the coin F alone at {m('16')} px), the app icon, a one-colour version, and the landing hero.</li>
<li>The coin is the logo's only orange; every other orange stays the one primary action.</li>
<li>A, B and C stay on this board for the record.</li>
</ul>
</aside>'''


def section1():
    cards = ''.join(dir_card(d) for d in 'ABCD')
    return f'''<section aria-labelledby="s1" style="display:flex;flex-direction:column;gap:24px">
<div style="display:flex;flex-direction:column;gap:6px"><span style="{LBL}">{m("1")} · Logo</span><h2 id="s1" style="{H2}">Four directions for the X2F logo</h2>
<p style="{P};max-width:820px">Owner, 8 Nov: “design to come up with a logo around X2F”. Each direction is drawn by hand in the token colours: the mark large on night and day, the lockup at the two header sizes, and the favicon at {m("32")} and {m("16")} px.</p></div>
{OPEN_ASIDE}
{cards}
</section>'''


# ---------------------------------------------------------------- section 2
def ph_header(d, name, back=False, right='bell', buysell=False, width=390):
    left = ''
    if back:
        left = (f'<a href="#" aria-label="Back" style="display:flex;flex-shrink:0;width:44px;height:44px;margin-left:-12px;align-items:center;'
                f'justify-content:center;color:var(--ink)">{CHEV_L}</a>')
    r = ''
    if right == 'bell':
        r = (f'<a href="#" aria-label="Site news, 2 new" style="position:relative;display:flex;flex-shrink:0;width:44px;height:44px;margin-right:-12px;'
             f'align-items:center;justify-content:center;color:var(--ink)">{BELL}<span aria-hidden="true" style="position:absolute;top:11px;right:11px;'
             f'width:8px;height:8px;border-radius:999px;background:var(--escrow);border:2px solid var(--ground)"></span></a>')
    bs = ''
    if buysell:
        bs = ('<div role="group" aria-label="Buy or sell" style="display:flex;height:48px;padding:4px;box-sizing:border-box;border-radius:999px;background:var(--surface-raised)">'
              '<button style="flex:1;border:0;border-radius:999px;background:transparent;color:var(--ink-muted);font:600 16px/24px \'Atkinson Hyperlegible Next\',sans-serif">Buy</button>'
              '<button aria-pressed="true" style="flex:1;border:2px solid var(--ink);border-radius:999px;background:var(--ground);color:var(--ink);font:600 16px/24px \'Atkinson Hyperlegible Next\',sans-serif">Sell</button></div>')
    return f'''<header style="display:flex;flex-direction:column;gap:8px;width:{width}px;box-sizing:border-box;padding:6px 16px {12 if buysell else 6}px">
<div style="display:flex;align-items:center;height:44px;min-width:0">{left}<a href="#" aria-label="X2F home" style="display:flex;flex-shrink:0;color:var(--ink);text-decoration:none">{lockup(d, 24)}</a>
<span aria-hidden="true" style="flex-shrink:0;margin:0 8px;font-size:18px;line-height:24px;color:var(--ink-muted)">–</span>
<span title="{html.escape(name, quote=True)}" style="flex:1;min-width:0;font-size:18px;line-height:24px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{name}</span>{r}</div>
{bs}</header>'''


RAIL = [('Trade', '<path d="M4 8h13l-3-3M20 16H7l3 3"/>'), ('Post offer', '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
        ('Wallets', '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12.5h2"/>'),
        ('Profile', '<circle cx="12" cy="8" r="4"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>'),
        ('Settings', '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>'),
        ('Help', '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01"/>')]


def wide_header(d, name, cur='Trade', h1='How do you want to get paid?'):
    items = ''
    for lab, ic in RAIL:
        on = lab == cur
        items += (f'<a href="#" {"aria-current=\"page\" " if on else ""}style="display:flex;align-items:center;gap:12px;height:44px;padding:0 12px;border-radius:6px;'
                  f'text-decoration:none;font-size:16px;line-height:24px;{"background:var(--surface-raised);color:var(--ink);box-shadow:inset 2px 0 0 var(--ink);font-weight:600" if on else "color:var(--ink-muted)"}">'
                  f'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ic}</svg>{lab}</a>')
    return f'''<div style="width:1280px;height:300px;overflow:hidden;display:flex;flex-direction:column">
<header style="display:flex;align-items:center;height:64px;flex-shrink:0;padding:0 32px 0 28px;border-bottom:1px solid var(--surface-raised)">
<a href="#" aria-label="X2F home" style="display:flex;flex-shrink:0;color:var(--ink);text-decoration:none">{lockup(d, 24)}</a>
<span aria-hidden="true" style="margin:0 10px;font-size:18px;line-height:24px;color:var(--ink-muted)">–</span>
<span style="font-size:18px;line-height:24px;font-weight:600;white-space:nowrap">{name}</span>
<span style="flex:1"></span>
<span style="display:flex;align-items:baseline;gap:8px;font-size:13px;line-height:18px;color:var(--ink-muted)"><span style="font-family:{MONO};font-size:15px;font-weight:500;color:var(--ink)">$329.90</span><span style="color:var(--monero-ink);font-weight:600">/ XMR</span>Market rate · updated {m("14:05")} UTC</span>
<a href="#" aria-label="Site news, 2 new" style="position:relative;display:flex;width:44px;height:44px;margin:0 -10px 0 16px;align-items:center;justify-content:center;color:var(--ink)">{BELL}<span aria-hidden="true" style="position:absolute;top:11px;right:11px;width:8px;height:8px;border-radius:999px;background:var(--escrow);border:2px solid var(--ground)"></span></a>
</header>
<div style="display:flex;flex:1;min-height:0">
<nav aria-label="Main" style="width:240px;flex-shrink:0;box-sizing:border-box;padding:16px;border-right:1px solid var(--surface-raised);display:flex;flex-direction:column;gap:4px">{items}</nav>
<div style="flex:1;padding:32px 48px"><h1 style="margin:0;font-family:'Familjen Grotesk',sans-serif;font-size:28px;line-height:32px;font-weight:700;letter-spacing:-0.01em">{h1}</h1>
<div style="display:flex;gap:16px;margin-top:24px"><div style="width:360px;height:120px;border-radius:16px;background:var(--surface)"></div><div style="width:360px;height:120px;border-radius:16px;background:var(--surface)"></div></div></div>
</div></div>'''


def scaled(inner, w, h, s, extra=''):
    return (f'<div style="width:{w*s:g}px;height:{h*s:g}px;overflow:hidden;border-radius:12px;{extra}">'
            f'<div style="width:{w}px;height:{h}px;outline:2px solid var(--surface-raised);outline-offset:-2px;transform:scale({s});transform-origin:0 0">{inner}</div></div>')


PHONE_CASES = [
    ('Main · Sell · direction A', 'Find a trade', dict(buysell=True)),
    ('Settings', 'Settings', dict()),
    ('BuyerPay', f'Trade · {m("K7M2")}', dict(back=True, right='none')),
    ('Truncation · long method name', 'Interac e-Transfer buyers', dict(back=True)),
]

SPEC = [
    ('Order', 'Back (sub-pages only) · logo · en dash · page name. Actions sit on the right.'),
    ('Logo', f'The lockup at {m("24")} px on phone and wide. Pre-login pages keep the centred logo at {m("24")} / {m("32")} px with no page name.'),
    ('Separator', f'An en dash, Atkinson {m("18")}/{m("24")} ink-muted, {m("8")} px each side ({m("10")} on wide), hidden from screen readers.'),
    ('Page name', f'Atkinson {m("18")}/{m("24")} 600 ink, one line, at most {m("18")} characters.'),
    ('Truncation', 'The logo and dash never shrink. Only the page name gives way, with an ellipsis; the full name is in its title and in the browser tab.'),
    ('Trade pages', f'“Trade · {m("K7M2")}”: the first block of the trade code in mono. The same name on every step of one trade.'),
    ('Headings', 'The page name says where you are; the screen title (h1) says what to do. Where they would repeat (Settings), the screen title is dropped and the page name becomes the h1.'),
    ('Browser tab', f'“Find a trade – X2F”: page name first, so tabs stay tellable apart.'),
    ('Main', 'Buy / Sell moves from the header to a full-width row under it, so the logo and page name fit on a 390 px phone.'),
]

PAGE_NAMES = [
    ('Entry and shell', [
        ('Landing (new)', '—', 'Front door: logo large'), ('Login', 'Log in', 'Pre-login'), ('Login-Backup', 'Use a backup', 'Pre-login'),
        ('RecoveryHold', 'Recovery hold', 'Pre-login'), ('RecoveryCode', 'Recovery code', 'Pre-login'),
        ('LoginApprove', 'Approve login', 'Pre-login'), ('SessionLength', 'Session length', 'Pre-login'),
        ('SessionExtend', 'keeps the page', 'Overlay'), ('Compromised', 'Freeze account', 'Pre-login / app'),
        ('Main · BuyMain', 'Find a trade', 'App'), ('Wallet', 'Wallets', 'App'), ('Profile', 'Profile', 'App')]),
    ('Signup', [
        ('SignupSecurity', 'Create account', 'Pre-login'), ('SetupTerms', 'Terms', 'Pre-login'), ('SetupUsername', 'Username', 'Pre-login'),
        ('SetupLogin', 'Login method', 'Pre-login'), ('SetupPgpKey', 'PGP key', 'Pre-login'), ('SetupPgpChallenge', 'PGP check', 'Pre-login'),
        ('SetupPassword', 'Password', 'Pre-login'), ('SetupBackup', 'Backup login', 'Pre-login'), ('SetupWallet', 'Your wallet', 'Pre-login'),
        ('SetupWelcome', 'Welcome', 'Pre-login'), ('BecomeVendor', 'Become a vendor', 'App')]),
    ('Settings and account', [
        ('Settings', 'Settings', 'App'), ('Devices', 'Devices', 'App'), ('HoldChange', 'Waiting changes', 'App'),
        ('Alerts', 'Alerts and sounds', 'App'), ('JabberSetup', 'Jabber alerts', 'App'), ('ProfileVisibility', 'Profile visibility', 'App'),
        ('BadgeSettings', 'Badges', 'App'), ('Block', 'Blocked users', 'App'), ('DeleteAccount', 'Delete account', 'App'),
        ('Team', 'Team', 'App'), ('MemberPermissions', 'Member permissions', 'App'), ('MemberApproval', 'Approve member', 'App (lead)'),
        ('TeamRefusal', 'keeps the page', 'Popup'), ('InviteInvalid', 'Team invite', 'Pre-login')]),
    ('Help and notices', [
        ('FAQ', 'Help', 'App'), ('Support', 'Ask X2F staff', 'App'), ('Feedback', 'Feedback', 'App'), ('News', 'Site news', 'App'),
        ('Maintenance', 'Maintenance', 'Pre-login'), ('CantDoThat', 'keeps the page', 'Popup'), ('Ban-Notice', 'Account notice', 'App')]),
    ('Buy flow', [
        ('BuyOffers · FlexOffer-Quote', 'Zelle offers', 'App (method name)'), ('OfferAd', 'Offer details', 'App'), ('BuyQuote', 'Your quote', 'App'),
        ('TradeFund', 'Trade · K7M2', 'App'), ('BuyerPay', 'Trade · K7M2', 'App'), ('CancelRequest', 'keeps Trade · K7M2', 'Sheet'),
        ('ProofBlur', 'Payment proof', 'App'), ('BuyerPaidWaiting', 'Trade · K7M2', 'App'), ('Refunded', 'Trade · K7M2', 'App'),
        ('TradeTechIssue', 'Trade · K7M2', 'App'), ('SelfDestruct', 'Trade · K7M2', 'App'), ('TeamChat', 'Trade · K7M2', 'App'),
        ('DisputeOpen', 'Open a dispute', 'App'), ('DisputeRoom', 'Dispute · K7M2', 'App'), ('DisputeRuling', 'Ruling · K7M2', 'App'),
        ('Appeal-Notice', 'Appeal · K7M2', 'App'), ('Lien-Notice', 'Lien notice', 'App'), ('Review', 'Leave a review', 'App'),
        ('Reviews', 'Reviews', 'App')]),
    ('Sell flow', [
        ('FlexOffer-Post · PostOffer', 'Post an offer', 'App'), ('GiftCardBrand', 'keeps Post an offer', 'Sheet'), ('MyOffers', 'My offers', 'App'),
        ('SellOffers', 'Zelle buyers', 'App (method name)'), ('SellerRefund', 'Trade · K7M2', 'App'), ('SellerConfirm', 'Trade · K7M2', 'App'),
        ('Warn-Release', 'keeps Trade · K7M2', 'Sheet')]),
    ('Staff app (logo + Staff tag)', [
        ('OwnerSetup', 'Owner setup', 'Pre-login'), ('StaffOverview', 'Overview', 'Staff'), ('ModQueue', 'Disputes', 'Staff'),
        ('ModCase', 'Dispute case', 'Staff'), ('StaffList', 'Staff', 'Staff'), ('StaffLog', 'Activity log', 'Staff'),
        ('StaffPerformance', 'Performance', 'Staff'), ('StaffSettings', 'Staff settings', 'Staff')]),
]


def name_cell(n):
    if n.startswith('keeps') or n == '—':
        return f'<span style="color:var(--ink-muted)">{n}</span>'
    n2 = n.replace('K7M2', m('K7M2'))
    return f'<span style="font-weight:600">{n2}</span>'


def table(groups):
    rows = ''
    for g, items in groups:
        rows += (f'<tr><th colspan="4" scope="colgroup" style="text-align:left;padding:16px 12px 6px;{LBL}">{g}</th></tr>')
        for scr, n, kind in items:
            plain = n if not (n.startswith('keeps') or n == '—') else ''
            c = m(str(len(plain))) if plain else ''
            alt = ''
            if n == 'Find a trade':
                alt = '<div style="font-size:13px;line-height:18px;color:var(--ink-muted)">or “Trade search” · “Trade match-up”</div>'
            rows += (f'<tr style="border-top:1px solid var(--surface-raised)"><td style="padding:7px 12px;font-size:14px;line-height:20px;color:var(--ink-muted)">{scr}</td>'
                     f'<td style="padding:7px 12px;font-size:15px;line-height:20px">{name_cell(n)}{alt}</td>'
                     f'<td style="padding:7px 12px;font-size:13px;line-height:18px;color:var(--ink-muted)">{kind}</td>'
                     f'<td style="padding:7px 12px;font-size:13px;line-height:18px;text-align:right;color:var(--ink-muted)">{c}</td></tr>')
    return (f'<table style="width:100%;border-collapse:collapse;align-self:start">'
            f'<thead><tr><th scope="col" style="text-align:left;padding:0 12px 4px;{LBL}">Board</th><th scope="col" style="text-align:left;padding:0 12px 4px;{LBL}">Page name</th>'
            f'<th scope="col" style="text-align:left;padding:0 12px 4px;{LBL}">Header</th><th scope="col" style="text-align:right;padding:0 12px 4px;{LBL}">Chars</th></tr></thead>'
            f'<tbody>{rows}</tbody></table>')


def section2():
    cols = ''
    for th, lab in ((NV, 'Phone 390 · night'), (DV, 'Phone 390 · day')):
        strips = ''
        for cap, name, kw in PHONE_CASES:
            strips += (f'<div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:12px;line-height:16px;color:var(--ink-muted)">{cap}</span>'
                       + themed(th, ph_header('A', name, **kw), 'border-radius:12px;overflow:hidden;width:390px') + '</div>')
        for d in 'BCD':
            strips += (f'<div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:12px;line-height:16px;color:var(--ink-muted)">BuyQuote · direction {d}, {NAMES[d]}</span>'
                       + themed(th, ph_header(d, 'Your quote', back=True), 'border-radius:12px;overflow:hidden;width:390px') + '</div>')
        cols += f'<div style="display:flex;flex-direction:column;gap:12px"><span style="{LBL}">{lab}</span>{strips}</div>'
    spec = ''.join(f'<div style="display:flex;flex-direction:column;gap:2px;padding:10px 0;border-top:1px solid var(--surface-raised)">'
                   f'<span style="font-size:14px;line-height:20px;font-weight:600">{k}</span><span style="font-size:13px;line-height:18px;color:var(--ink-muted)">{v}</span></div>'
                   for k, v in SPEC)
    spec_col = f'<div style="display:flex;flex-direction:column;width:356px"><span style="{LBL};padding-bottom:12px">Sizes and rules</span>{spec}</div>'
    wides = ''
    for th, lab in ((NV, 'Wide 1280 with the rail · night (shown at 92.5%)'), (DV, 'Wide 1280 · day')):
        wides += (f'<div style="display:flex;flex-direction:column;gap:8px"><span style="{LBL}">{lab}</span>'
                  + f'<div style="{th}">' + scaled(f'<div style="background:var(--ground);color:var(--ink)">{wide_header("A", "Find a trade")}</div>', 1280, 300, 0.925) + '</div></div>')
    each = ''
    for d in 'ABCD':
        each += (f'<div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:12px;line-height:16px;color:var(--ink-muted)">{d} · {NAMES[d]}</span>'
                 + themed(NV, ph_header(d, 'Your quote', back=True), 'border-radius:12px;overflow:hidden;width:390px') + '</div>')
    half = 4
    return f'''<section aria-labelledby="s2" style="display:flex;flex-direction:column;gap:24px">
<div style="display:flex;flex-direction:column;gap:6px"><span style="{LBL}">{m("2")} · Header</span><h2 id="s2" style="{H2}">Logo – page name, top left of every page</h2>
<p style="{P};max-width:820px">Owner comment #{m("2")}: “at the top left of every page … the site logo and then maybe a - and then the name of the page they are on”. Shown with direction A; every direction drops into the same slot.</p></div>
<div style="display:flex;gap:24px;align-items:flex-start">{cols}{spec_col}</div>
{wides}
<div style="display:flex;flex-direction:column;gap:8px"><h3 style="{H3}">Page names for every screen</h3>
<p style="{P};max-width:820px">Short (at most {m("18")} characters), plain, and the same on phone, wide and fold. “App” pages show logo – name; pre-login pages keep the centred logo and use the name only for the browser tab; sheets and popups keep the name of the page under them. Method names fill in: “Zelle offers”, “Gift card buyers”.</p>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;padding:8px 0;border-radius:16px">{table([PAGE_NAMES[i] for i in (0,1,2)])}{table([PAGE_NAMES[i] for i in (4,5,3,6)])}</div></div>
</section>'''


# ---------------------------------------------------------------- section 3
SLOGAN = 'You’ll need Fiat to believe it.'
SLOGAN_PHONE = 'You’ll need Fiat<br>to believe it.'
LAND = {
    'A': 'The mark at 120 px on phone and 180 on wide, with the wordmark under it at 40 and 56: the keys first, then the name.',
    'B': 'The logotype is the logo, cap height 64 px on phone and 100 on wide; there is no separate mark above the name.',
    'C': 'The seal at 120 px on phone and 180 on wide over the wordmark; the same seal is the app icon on a home screen.',
    'D': 'The wordmark alone, 120 px on phone and 190 on wide. The coin and the Create account button are the only orange.',
}


def landing_logo(d, wide):
    if d in 'AC':
        mk = mark_a if d == 'A' else mark_c
        s = 180 if wide else 120
        return (f'<div role="img" aria-label="X2F" style="display:flex;flex-direction:column;align-items:center;gap:{20 if wide else 14}px">'
                f'{mk(s)}{wordmark(56 if wide else 40)}</div>')
    if d == 'B':
        return logo_b(100 if wide else 64, label='X2F')
    return logo_d(190 if wide else 120, label='X2F')


def landing(d, wide):
    btn = ('display:flex;align-items:center;justify-content:center;height:52px;box-sizing:border-box;border-radius:12px;'
           "font:600 16px/24px 'Atkinson Hyperlegible Next',sans-serif;text-decoration:none;")
    prim = f'<a href="#" style="{btn}background:var(--monero);color:var(--on-monero);{"width:220px" if wide else ""}">Create account</a>'
    sec = f'<a href="#" style="{btn}border:1px solid var(--line);color:var(--ink);{"width:220px" if wide else ""}">Log in</a>'
    slog = (f'<p style="margin:0;font-family:\'Familjen Grotesk\',sans-serif;font-weight:700;letter-spacing:-0.02em;text-align:center;'
            f'{"font-size:40px;line-height:44px" if wide else "font-size:32px;line-height:36px"}">{SLOGAN if wide else SLOGAN_PHONE}</p>')
    foot = (f'<p style="margin:0;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;line-height:18px;color:var(--ink-muted)">'
            f'{KEYS_SMALL}<span>Members only · Monero for cash, {m('2')}-of-{m('3')} escrow</span></p>')
    link = '<a href="#" style="font-size:14px;line-height:20px;text-align:center">Lost access? Recover your account</a>'
    if wide:
        return f'''<div style="width:1280px;height:800px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;padding:40px 48px 40px;background:var(--ground);color:var(--ink)">
<main style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:40px">{landing_logo(d, True)}{slog}
<div style="display:flex;flex-direction:column;align-items:center;gap:20px;margin-top:8px"><div style="display:flex;gap:16px">{prim}{sec}</div>{link}</div></main>{foot}</div>'''
    return f'''<div style="width:390px;height:844px;box-sizing:border-box;display:flex;flex-direction:column;padding:0 24px 28px;background:var(--ground);color:var(--ink)">
<main style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:32px;padding-top:40px">{landing_logo(d, False)}{slog}</main>
<div style="display:flex;flex-direction:column;gap:12px">{prim}{sec}<div style="display:flex;justify-content:center;padding:8px 0 20px">{link}</div>{foot}</div></div>'''


def section3():
    blocks = ''
    for d in 'ABCD':
        phones = ''.join(f'<div style="{th}">' + scaled(landing(d, False), 390, 844, 0.66) + '</div>' for th in (NV, DV))
        wides = ''.join(f'<div style="{th}">' + scaled(landing(d, True), 1280, 800, 0.45) + '</div>' for th in (NV, DV))
        blocks += f'''<div style="display:flex;flex-direction:column;gap:12px;padding:24px;border-radius:16px;background:var(--surface)">
<h3 style="{H3}">{d} · {NAMES[d]}</h3>
<div style="display:flex;gap:16px;align-items:flex-start"><div style="display:flex;flex-direction:column;gap:20px;width:530px"><div style="display:flex;gap:16px">{phones}</div>
<div style="display:flex;flex-direction:column;gap:8px;font-size:14px;line-height:20px"><span style="{LBL}">What to look at</span><p style="margin:0">{md(LAND[d])}</p>
<span style="font-size:12px;line-height:16px;color:var(--ink-muted)">Phone {m("390")} × {m("844")} at {m("66%")}, night and day. Wide {m("1280")} × {m("800")} at {m("45%")}, night over day.</span></div></div>
<div style="display:flex;flex-direction:column;gap:16px">{wides}</div></div></div>'''
    return f'''<section aria-labelledby="s3" style="display:flex;flex-direction:column;gap:24px">
<div style="display:flex;flex-direction:column;gap:6px"><span style="{LBL}">{m("3")} · Front door</span><h2 id="s3" style="{H2}">The landing page, for each direction</h2>
<p style="{P};max-width:820px">Owner, 8 Nov: “our logo nice and big” with his slogan under it. This is the only page a logged-out visitor gets (front door rule, 8 Nov): Create account, Log in, and a way back in for someone who lost access. Mark {m("120")} px on phone, {m("180")} on wide.</p></div>
<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;background:var(--surface)"><span style="display:inline-flex;align-items:center;height:20px;padding:0 6px;border-radius:6px;font-size:11px;line-height:14px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;background:var(--surface-raised);color:var(--ink)">Owner’s slogan, 8 Nov</span>
<span style="font-family:'Familjen Grotesk',sans-serif;font-size:20px;line-height:24px;font-weight:700">{SLOGAN}</span><span style="font-size:13px;line-height:18px;color:var(--ink-muted)">His wording exactly; Familjen display, {m("32")}/{m("36")} phone, {m("40")}/{m("44")} wide.</span></div>
{blocks}
</section>'''


NOTES = [
    'Owner, 8 Nov (comment #2): a logo around X2F, at the top left of every page as “logo – page name”. Owner, 8 Nov (addition): the logo big on the landing page with “You’ll need Fiat to believe it.” and “most importantly, get that logo designed”.',
    'All four marks are hand-drawn inline SVG in token colours only (ink, escrow teal, surface steps; Monero orange only as D’s coin and the landing’s one primary button). No font is used as a logo except the wordmark text.',
    'Key mark rule stands: in the app the key mark is horizontal and toned by state. Direction A’s logo is always ink and diagonal, so the two never read as each other.',
    'Header: lockup 24 px, en dash, page name 18/24 600, ellipsis on the name only. Pre-login pages keep the centred logo (24 phone / 32 wide) with no name.',
    'Front door rule (owner, 8 Nov): the landing shows nothing from behind login, no prices, offers or traders. Only Create account, Log in and the recovery link.',
    'COPY-UNSIGNED: every sentence on this board except the owner’s slogan and the button labels he named. Page names are proposals for his sign-off; “Find a trade” is design’s pick, with “Trade search” and “Trade match-up” as his alternates.',
]

ANTICIPATED = [
    'Market rate with its source and time (“Market rate · updated 14:05 UTC”) in the wide header, following owner comment #3 (“Is that the actual current rate?”).',
    'Buy / Sell moves under the header on Main so “logo – page name” fits a 390 px phone (follows comment #2).',
    'The browser tab title “Page name – X2F” and the favicon in a tab mock (follows comment #2).',
    'A one-line footer on the landing, “Members only · Monero for cash, 2-of-3 escrow”, so a visitor knows why there is nothing else to see (follows the front door rule, comment #9).',
]


def notes():
    a = ''.join(f'<li>{md(x)}</li>' for x in NOTES)
    b = ''.join(f'<li>{md(x)}</li>' for x in ANTICIPATED)
    return f'''<section aria-label="Design notes" style="display:flex;flex-direction:column;gap:12px;padding:24px 48px 48px;border-top:1px solid var(--line)"><h2 style="margin:0;font-family:{MONO};font-size:12px;line-height:16px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-muted)">Design notes</h2>
<ul style="margin:0;padding-left:18px;max-width:980px;display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:18px">{a}</ul>
<aside aria-label="Anticipated by design" style="display:flex;flex-direction:column;gap:6px;max-width:980px;padding:10px 12px;border-radius:6px;border:1px solid var(--surface-raised);font-size:13px;line-height:18px">
<span style="font-family:{MONO};font-size:12px;line-height:16px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-muted)">Anticipated · design, 8 Nov</span>
<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">{b}</ul></aside></section>'''


def build(height):
    body = f'''<div style="display:flex;flex-direction:column;gap:64px;padding:40px 48px 48px"><header style="display:flex;justify-content:space-between;align-items:flex-start"><div style="display:flex;flex-direction:column;gap:6px"><h1 style="margin:0;font-family:'Familjen Grotesk',sans-serif;font-size:40px;line-height:44px;font-weight:700;letter-spacing:-0.02em">Logo directions</h1><p style="margin:0;max-width:720px;font-size:16px;line-height:24px;color:var(--ink-muted)">Four ways to draw X2F, the header that carries it on every page, and the front door it opens.</p></div><span style="font-family:{MONO};font-size:12px;color:var(--ink-muted)">Draft copy</span></header>
{section1()}
{section2()}
{section3()}
</div>
{notes()}'''
    return page('Logo directions', body, height)


if __name__ == '__main__':
    h = int(sys.argv[1]) if len(sys.argv) > 1 else 9000
    open('../canvas/project/LogoDirections.dc.html', 'w').write(build(h))
