import html, sys

# ---- geometry -------------------------------------------------------------
W = 1280; PAD = 32; CONTENT = W - 2 * PAD        # 1216
COLS = 3; GAP = 16
COLW = (CONTENT - GAP * (COLS - 1)) // COLS       # 394
CARD_PAD = 16; INNER = COLW - 2 * CARD_PAD         # 362
SUB = 176                                          # sub-column pitch
TILE = 40; PITCH = 68
LABEL_X = 48; LABEL_MAX = SUB - LABEL_X - 6        # 122
CHAR12 = 6.6; CHAR10 = 6.7

TONES = {'state': 'ink-muted', 'build': 'escrow', 'draft': 'caution', 'gone': 'danger', 'staff': 'mod', 'width': 'team'}

ICONS = {
    'key': '<circle cx="9" cy="12" r="4"/><path d="M13 12h8M18 12v3M21 12v2"/>',
    'user': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6"/>',
    'buy': '<path d="M3 5h3l2.5 11h10l2-8H7"/><circle cx="10" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>',
    'sell': '<path d="M3 12l9-9h9v9l-9 9z"/><circle cx="16" cy="8" r="1.5"/>',
    'set': '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" style="fill: var(--surface-raised);"/><circle cx="15" cy="12" r="2" style="fill: var(--surface-raised);"/><circle cx="8" cy="17" r="2" style="fill: var(--surface-raised);"/>',
    'help': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7"/><circle cx="12" cy="17" r="0.8"/>',
    'staff': '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    'fold': '<path d="M4 5h16v14H4z"/><path d="M12 5v14"/>',
    'trade': '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    'note': '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h6M9 16h6"/>',
}

def tw12(s): return len(s) * CHAR12
def tw10(s): return len(s) * CHAR10 + 11

class Node:
    def __init__(self, name, sub, row, icon, chips=(), gone=False):
        self.name, self.sub, self.row, self.icon, self.chips, self.gone = name, sub, row, icon, list(chips), gone
    @property
    def x(self): return self.sub * SUB
    @property
    def y(self): return self.row * PITCH
    @property
    def cx(self): return self.x + TILE / 2
    @property
    def cy(self): return self.y + TILE / 2

def esc(s): return html.escape(s, quote=True)

def render_node(n):
    out = []
    stroke = 'var(--danger)' if n.gone else 'var(--line)'
    out.append(f'<rect x="{n.x}" y="{n.y}" width="{TILE}" height="{TILE}" rx="10" style="fill: var(--surface-raised); stroke: {stroke}; stroke-width: 1;"/>')
    out.append(f'<g transform="translate({n.x + 8},{n.y + 8})" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--ink-muted);">{ICONS[n.icon]}</g>')
    color = 'var(--ink-muted)' if n.gone else 'var(--ink)'
    deco = ' text-decoration: line-through;' if n.gone else ''
    out.append(f'<text x="{n.x + LABEL_X}" y="{n.y + 15}" style="fill: {color}; font-size: 12px; font-weight: 600;{deco}">{esc(n.name)}</text>')
    cx = n.x + LABEL_X
    for tone, text in n.chips:
        w = tw10(text)
        if cx + w > n.x + LABEL_X + LABEL_MAX + 10: break
        col = f'var(--{TONES[tone]})'
        out.append(f'<rect x="{cx}" y="{n.y + 22}" width="{w:.0f}" height="16" rx="4" style="fill: none; stroke: {col}; stroke-width: 1;"/>')
        out.append(f'<text x="{cx + 5}" y="{n.y + 33.5}" style="fill: {col}; font-family: \'Atkinson Hyperlegible Mono\', monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase;">{esc(text)}</text>')
        cx += w + 4
    return '\n'.join(out)

LINE = 'style="fill: none; stroke: var(--line); stroke-width: 1;" marker-end="url(#ah)"'

def edge_v(a, b):
    return f'<path d="M{a.cx} {a.y + TILE} V {b.y - 1}" {LINE}/>'

def edge_elbow(a, b):
    # a in one sub-column, b in another, b.row > a.row
    yk = a.y + TILE + 14
    xk = b.x - 10
    return f'<path d="M{a.cx} {a.y + TILE} V {yk} H {xk} V {b.cy} H {b.x - 1}" {LINE}/>'

def edge_tree(a, kids):
    yk = a.y + TILE + 14
    xs = a.x - 10
    last = max(k.cy for k in kids)
    out = [f'<path d="M{a.cx} {a.y + TILE} V {yk} H {xs} V {last}" style="fill: none; stroke: var(--line); stroke-width: 1;"/>']
    for k in kids:
        out.append(f'<path d="M{xs} {k.cy} H {k.x - 1}" {LINE}/>')
    return '\n'.join(out)

def edge_side(a, b):
    # a and b on the same row, a left of b: straight horizontal, label space permitting (short names only)
    return f'<path d="M{a.x + TILE} {a.cy} H {b.x - 1}" {LINE}/>'

# ---- sections -------------------------------------------------------------
S = []
def section(num, title, lead, icon):
    s = {'num': num, 'title': title, 'lead': lead, 'icon': icon, 'nodes': {}, 'edges': []}
    S.append(s); return s

def N(s, name, sub, row, chips=(), gone=False, icon=None):
    n = Node(name, sub, row, icon or s['icon'], chips, gone); s['nodes'][name] = n; return n
def V(s, a, b): s['edges'].append(('v', a, b))
def E(s, a, b): s['edges'].append(('e', a, b))
def T(s, a, kids): s['edges'].append(('t', a, kids))
def H(s, a, b): s['edges'].append(('e', a, b))

# 1 Entry and shell
s = section('1', 'Entry and shell', 'Logged out: Landing, Log in, Create account, recovery, nothing else (owner, 8 Nov). Then session and the Trade tab.', 'key')
N(s, 'Landing', 0, 0, [('state', 'in LogoDirections')])
N(s, 'Login', 0, 1, [('state', 'method=pgp'), ('build', 'build')])
N(s, 'LoginApprove', 0, 2, [('state', 'side=new')])
N(s, 'SessionLength', 0, 3, [('state', 'step=ask')])
N(s, 'Main', 0, 4, [('state', 'tab Trade'), ('build', 'build')], icon='trade')
N(s, 'MyTrades', 0, 5, [('state', 'list=some')], icon='trade')
N(s, 'BuyMain', 0, 6, [('state', 'Buy toggle'), ('build', 'build')], icon='trade')
N(s, 'PostOffer', 0, 7, [('state', 'tab Post offer'), ('build', 'build')], icon='sell')
N(s, 'Wallet', 0, 8, [('state', 'tab Wallets'), ('build', 'build')], icon='buy')
N(s, 'Profile', 0, 9, [('state', 'tab Profile'), ('state', '› Settings')], icon='user')
N(s, 'SetupTerms', 1, 1, [('state', 'Create account')], icon='user')
N(s, 'Login-Backup', 1, 2, [('state', 'view=enter'), ('build', 'build')])
N(s, 'RecoveryHold', 1, 3, [('state', 'step=hold')])
N(s, 'RecoveryCode', 1, 4, [('state', 'step=show')])
N(s, 'Compromised', 1, 5, [('state', 'step=form')])
N(s, 'SessionExtend', 1, 8, [('state', 'step=ask'), ('state', '5 min before end')])
n = s['nodes']
V(s, n['Landing'], n['Login']); E(s, n['Landing'], n['SetupTerms'])
V(s, n['Login'], n['LoginApprove']); V(s, n['LoginApprove'], n['SessionLength']); V(s, n['SessionLength'], n['Main'])
T(s, n['Main'], [n['MyTrades'], n['BuyMain'], n['PostOffer'], n['Wallet'], n['Profile']])
E(s, n['Login'], n['Login-Backup']); V(s, n['Login-Backup'], n['RecoveryHold']); V(s, n['RecoveryHold'], n['RecoveryCode']); V(s, n['RecoveryCode'], n['Compromised'])
H(s, n['Wallet'], n['SessionExtend'])

# 2 Signup
s = section('2', 'Signup', 'Terms, tick box and signature first, once (owner, 8 Nov). Then set up the account. Ends on Login (G25).', 'user')
names = ['Landing', 'SetupTerms', 'SignupSecurity', 'SetupUsername', 'SetupLogin', 'SetupPgpKey', 'SetupPgpChallenge', 'SetupBackup', 'SetupWallet', 'SetupWelcome']
chips = {'Landing': [('state', 'Create account')], 'SignupSecurity': [('state', 'variant=strong')], 'SetupTerms': [('draft', 'draft'), ('build', 'build')], 'SetupPgpChallenge': [('state', '3 of 5 · part 2')], 'SetupWelcome': [('state', 'to Login')]}
for i, nm in enumerate(names):
    N(s, nm, 0, i, chips.get(nm, [('build', 'build')]), icon='key' if nm == 'Landing' else None)
N(s, 'SetupPassword', 1, 5, [('state', 'alt 3'), ('build', 'build')])
N(s, 'RecoveryCode', 1, 3, [('state', 'step=show')], icon='key')
N(s, 'OwnerSetup', 1, 7, [('staff', 'first run')], icon='staff')
N(s, 'BecomeVendor', 1, 8, [('state', 'state=met')], icon='sell')
N(s, 'MemberApproval', 1, 9, [('state', 'side=member')], icon='user')
n = s['nodes']
for a, b in zip(names, names[1:]): V(s, n[a], n[b])
E(s, n['SetupLogin'], n['SetupPassword']); E(s, n['SignupSecurity'], n['RecoveryCode'])

# 3 Buy flow
s = section('3', 'Buy flow', 'mira.k buys 1.250000 XMR from satoshi_ghost via Zelle. Pay now never shows before the escrow is secured.', 'buy')
chain = [('BuyMain', [('build', 'build')]), ('BuyOffers', [('build', 'build')]), ('BuyQuote', [('build', 'build')]),
         ('TradeFund', [('state', 'escrow securing')]), ('BuyerPay', [('state', 'escrow=secured')]),
         ('ProofBlur', [('state', 'step=review')]), ('BuyerPaidWaiting', [('state', 'window=in-window')]),
         ('SelfDestruct', [('state', 'trade=completed')]), ('Review', [('state', 'Released'), ('draft', 'draft')]), ('Reviews', [('state', 'view=profile')])]
for i, (nm, ch) in enumerate(chain): N(s, nm, 0, i, ch)
N(s, 'OfferAd', 1, 1, [('state', 'side=selling')])
N(s, 'FlexOffer-Quote', 1, 2, [('state', 'variant=greyed')])
N(s, 'CancelRequest', 1, 4, [('state', 'side=buyer')])
N(s, 'Refunded', 1, 5, [('state', 'buyer-cancelled')])
N(s, 'Warn-IvePaid', 1, 6, [('gone', 'superseded')], gone=True)
N(s, 'DisputeOpen', 1, 7, [('build', 'build')])
N(s, 'DisputeRoom', 1, 8, [('state', 'moderator=joined')])
N(s, 'DisputeRuling', 1, 9, [('state', 'variant=release')])
N(s, 'Appeal-Notice', 1, 10, [('state', 'variant=open')])
N(s, 'Lien-Notice', 1, 11, [('state', 'losing side')])
N(s, 'TradeTechIssue', 1, 3, [('state', 'event · funded')])
n = s['nodes']
for (a, _), (b, _) in zip(chain, chain[1:]): V(s, n[a], n[b])
H(s, n['BuyOffers'], n['OfferAd']); E(s, n['OfferAd'], n['FlexOffer-Quote'])
E(s, n['BuyerPay'], n['CancelRequest']); V(s, n['CancelRequest'], n['Refunded'])
E(s, n['BuyerPaidWaiting'], n['DisputeOpen']); V(s, n['DisputeOpen'], n['DisputeRoom']); V(s, n['DisputeRoom'], n['DisputeRuling']); V(s, n['DisputeRuling'], n['Appeal-Notice']); V(s, n['Appeal-Notice'], n['Lien-Notice'])

# 4 Sell flow
s = section('4', 'Sell flow', 'satoshi_ghost posts an offer; mira.k takes it. FlexOffer-Post is the decided form (Q4).', 'sell')
chain = [('Main', [('state', 'tab Post offer')]), ('FlexOffer-Post', [('state', 'example=filled')]), ('MyOffers', [('state', 'hold=off'), ('build', 'build')]),
         ('TradeFund', [('state', 'seller funds')]), ('SellerConfirm', [('state', 'blurCheck=ask')]), ('Warn-Release', [('state', 'sheet')]),
         ('Review', [('state', 'Released')]), ('SelfDestruct', [('state', 'trade=completed')])]
for i, (nm, ch) in enumerate(chain): N(s, nm, 0, i, ch)
N(s, 'PostOffer', 1, 1, [('state', 'older form'), ('build', 'build')])
N(s, 'GiftCardBrand', 1, 2, [('state', 'picked=amazon')])
N(s, 'SellOffers', 1, 3, [('state', 'take a buy offer')])
N(s, 'SellerRefund', 1, 4, [('state', 'cancel=available')])
N(s, 'Refunded', 1, 5, [('state', 'time-ran-out')])
N(s, 'TeamChat', 1, 6, [('state', 'viewer=lead')])
N(s, 'Block', 1, 7, [('state', 'view=chat'), ('build', 'build')])
n = s['nodes']
for (a, _), (b, _) in zip(chain, chain[1:]): V(s, n[a], n[b])
E(s, n['Main'], n['PostOffer']); V(s, n['PostOffer'], n['GiftCardBrand'])
E(s, n['TradeFund'], n['SellerRefund']); V(s, n['SellerRefund'], n['Refunded'])
H(s, n['SellerConfirm'], n['TeamChat'])

# 5 Settings and account
s = section('5', 'Settings and account', 'Settings is the hub (Profile › More, the rail). Held changes open HoldChange (24 h, g65).', 'set')
N(s, 'Settings', 0, 0, [('state', 'Profile › More'), ('draft', 'draft')])
kids = [('Devices', [('state', 'session=strong'), ('build', 'build')]), ('HoldChange', [('state', 'step=review')]), ('Alerts', [('state', 'jabber=off')]),
        ('JabberSetup', [('state', 'step=address')]), ('Wallet', [('build', 'build')]), ('ProfileVisibility', [('state', 'total=41.738201')]),
        ('BadgeSettings', [('state', 'per badge')]), ('BecomeVendor', [('state', 'state=met')]), ('Block', [('state', 'view=settings')]),
        ('DeleteAccount', [('state', 'variant=allowed')]), ('Compromised', [('state', 'step=form')])]
for i, (nm, ch) in enumerate(kids): N(s, nm, 0, i + 1, ch)
N(s, 'Team', 1, 2, [('build', 'build'), ('draft', 'draft')], icon='user')
N(s, 'MemberPermissions', 1, 3, [('state', 'offers-and-chat')], icon='user')
N(s, 'MemberApproval', 1, 4, [('state', 'side=lead')], icon='user')
N(s, 'TeamRefusal', 1, 5, [('state', 'variant=invite')], icon='user')
N(s, 'InviteInvalid', 1, 6, [('state', 'session=out')], icon='user')
N(s, 'TeamChat', 1, 7, [('state', 'viewer=lead')], icon='user')
N(s, 'BlockQueued', 1, 9, [('gone', 'superseded')], gone=True)
n = s['nodes']
T(s, n['Settings'], [n[nm] for nm, _ in kids if nm not in ('HoldChange', 'JabberSetup')])
E(s, n['Settings'], n['Team'])
V(s, n['Team'], n['MemberPermissions']); V(s, n['MemberPermissions'], n['MemberApproval']); V(s, n['MemberApproval'], n['TeamRefusal']); V(s, n['TeamRefusal'], n['InviteInvalid'])

# 6 Help and notices
s = section('6', 'Help and notices', 'Help rail item opens FAQ. CantDoThat is one shared popup; Maintenance and Ban-Notice are events.', 'help')
N(s, 'FAQ', 0, 0, [('state', 'open=escrow'), ('draft', 'draft')])
N(s, 'Support', 0, 1, [('state', 'view=new')])
N(s, 'Feedback', 0, 2, [('state', 'view=form'), ('build', 'build')])
N(s, 'News', 0, 3, [('state', 'variant=plain'), ('build', 'build')])
N(s, 'Maintenance', 1, 0, [('state', 'event'), ('build', 'build')])
N(s, 'CantDoThat', 1, 1, [('state', 'popup → Feedback')])
N(s, 'Ban-Notice', 1, 2, [('state', 'site-ban · event')])
n = s['nodes']
V(s, n['FAQ'], n['Support']); V(s, n['Support'], n['Feedback']); V(s, n['Feedback'], n['News'])

# 7 Staff app
s = section('7', 'Staff app', 'Separate site, own rail: Overview, Disputes, Staff, Performance, Training library, Activity log, Settings.', 'staff')
N(s, 'OwnerSetup', 0, 0, [('staff', 'first run')])
N(s, 'StaffOverview', 0, 1, [('staff', 'rail: Overview')])
N(s, 'ModQueue', 0, 2, [('staff', 'rail: Disputes')])
N(s, 'ModCase', 0, 3, [('staff', 'ruling → trader')])
N(s, 'StaffList', 1, 2, [('staff', 'rail: Staff')])
N(s, 'StaffLog', 1, 3, [('staff', 'rail: Activity log')])
N(s, 'StaffPerformance', 1, 4, [('staff', 'rail: Performance')])
N(s, 'StaffSettings', 1, 5, [('staff', 'rail: Settings')])
n = s['nodes']
V(s, n['OwnerSetup'], n['StaffOverview']); V(s, n['StaffOverview'], n['ModQueue']); V(s, n['ModQueue'], n['ModCase'])
E(s, n['StaffOverview'], n['StaffList']); V(s, n['StaffList'], n['StaffLog']); V(s, n['StaffLog'], n['StaffPerformance']); V(s, n['StaffPerformance'], n['StaffSettings'])

# 8 Fold and desktop
s = section('8', 'Fold and desktop', 'The same screens at other widths (Fold-Notes): under 600 phone, 600 to 999 two panes, 1000 and up three panes or the rail.', 'fold')
N(s, 'Fold-Notes', 0, 0, [('width', 'rules board')], icon='note')
N(s, 'Desktop', 0, 1, [('width', '= BuyerPay · 1280')])
N(s, 'Fold-Trade', 0, 2, [('width', '= BuyerPay · 840')])
N(s, 'Fold-Tabletop', 0, 3, [('width', '= BuyerPay · half')])
N(s, 'Fold-Cover', 0, 4, [('width', 'glance · flip')])
N(s, 'Fold-Offers', 1, 1, [('width', '= BuyOffers+Quote')])
N(s, 'Fold-TriFold', 1, 2, [('width', '= Offers · 3 pane')])
N(s, 'Fold-MyOffers', 1, 3, [('width', '= MyOffers · 840')])
N(s, 'Badges', 1, 4, [('width', 'proposal')], icon='note')
n = s['nodes']
T(s, n['Fold-Notes'], [n['Desktop'], n['Fold-Trade'], n['Fold-Tabletop'], n['Fold-Cover']])
E(s, n['Fold-Notes'], n['Fold-Offers']); V(s, n['Fold-Offers'], n['Fold-TriFold']); V(s, n['Fold-TriFold'], n['Fold-MyOffers']); V(s, n['Fold-MyOffers'], n['Badges'])

# ---- render ---------------------------------------------------------------
def render_section(s):
    nodes = list(s['nodes'].values())
    rows = max(nd.row for nd in nodes) + 1
    svg_h = rows * PITCH - (PITCH - TILE) + 8
    svg_w = INNER
    parts = []
    for kind, *args in s['edges']:
        if kind == 'v': parts.append(edge_v(*args))
        elif kind == 'e': parts.append(edge_elbow(*args))
        elif kind == 't': parts.append(edge_tree(*args))
        elif kind == 'h': parts.append(edge_side(*args))
        elif kind == 'raw': parts.append(args[0])
    for nd in nodes: parts.append(render_node(nd))
    count = len(nodes)
    body = '\n'.join(parts)
    return f'''<section aria-labelledby="fm-s{s['num']}" style="display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: {COLW}px; padding: {CARD_PAD}px; border-radius: 16px; background: var(--surface);">
      <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px;">
        <h2 id="fm-s{s['num']}" style="margin: 0; font-size: 16px; line-height: 22px; font-weight: 600;"><span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-weight: 500; color: var(--ink-muted);">{s['num']}</span>&nbsp; {esc(s['title'])}</h2>
        <span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 12px; line-height: 16px; color: var(--ink-muted); white-space: nowrap;">{count} boards</span>
      </div>
      <p style="margin: 0; min-height: 36px; font-size: 12px; line-height: 18px; color: var(--ink-muted);">{esc(s['lead'])}</p>
      <svg width="{svg_w}" height="{svg_h}" viewBox="0 0 {svg_w} {svg_h}" role="img" aria-label="Flow {s['num']}: {esc(s['title'])}" style="display: block; overflow: visible; font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif;">
{body}
      </svg>
    </section>'''

sections_html = '\n'.join(render_section(s) for s in S)

def legend_node(icon, name, chips):
    nd = Node(name, 0, 0, icon, chips)
    return f'<svg width="176" height="40" viewBox="0 0 176 40" aria-hidden="true" style="display: block; overflow: visible; font-family: \'Atkinson Hyperlegible Next\', system-ui, sans-serif;">{render_node(nd)}</svg>'

legend = f'''<section aria-labelledby="fm-legend" style="display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; padding: {CARD_PAD}px; border-radius: 16px; background: var(--surface);">
      <h2 id="fm-legend" style="margin: 0; font-size: 16px; line-height: 22px; font-weight: 600;">Legend</h2>
      <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px 24px; font-size: 13px; line-height: 18px; color: var(--ink-muted);">
        <div style="display: flex; flex-direction: column; gap: 8px;">{legend_node('buy', 'BoardName', [('state', 'tweak=value')])}<span>A screen: the board file name, and under it the tweak (state) to show at that step.</span></div>
        <div style="display: flex; flex-direction: column; gap: 8px;"><svg width="176" height="40" viewBox="0 0 176 40" aria-hidden="true" style="display: block; overflow: visible;"><path d="M4 20 H 60" {LINE}/><path d="M80 8 V 20 H 120 V 31" {LINE}/></svg><span>Arrow: the move the primary button, link or event makes. Down the column is the main path; the elbow is a branch.</span></div>
        <div style="display: flex; flex-direction: column; gap: 8px;"><svg width="176" height="40" viewBox="0 0 176 40" aria-hidden="true" style="display: block; overflow: visible;"><path d="M20 4 V 10 H 6 V 34" style="fill: none; stroke: var(--line); stroke-width: 1;"/><path d="M6 20 H 40" {LINE}/><path d="M6 34 H 40" {LINE}/></svg><span>Spine: a hub (Main tabs, Settings rows, Fold-Notes) and the screens its rows open.</span></div>
        <div style="display: flex; flex-direction: column; gap: 8px;">{legend_node('buy', 'OldBoard', [('gone', 'superseded')]).replace('OldBoard', 'OldBoard')}<span>Red ring and strike-through: kept for reference, not wired (Warn-IvePaid, BlockQueued).</span></div>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 13px; line-height: 18px; color: var(--ink-muted);">
        <span style="font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 12px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted);">Chip tones</span>
        {chip_html('state', 'tweak') if False else ''}
        <span style="display: inline-flex; align-items: center; gap: 6px;"><span style="display: inline-block; box-sizing: border-box; height: 16px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--ink-muted); font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 10px; line-height: 14px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted);">state</span> the tweak, tab or event to show</span>
        <span style="display: inline-flex; align-items: center; gap: 6px;"><span style="display: inline-block; box-sizing: border-box; height: 16px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--escrow); font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 10px; line-height: 14px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--escrow);">build</span> a route for it exists on main (App.tsx)</span>
        <span style="display: inline-flex; align-items: center; gap: 6px;"><span style="display: inline-block; box-sizing: border-box; height: 16px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--caution); font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 10px; line-height: 14px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--caution);">draft</span> draft copy, words not yet signed</span>
        <span style="display: inline-flex; align-items: center; gap: 6px;"><span style="display: inline-block; box-sizing: border-box; height: 16px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--danger); font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 10px; line-height: 14px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--danger);">superseded</span> do not build</span>
        <span style="display: inline-flex; align-items: center; gap: 6px;"><span style="display: inline-block; box-sizing: border-box; height: 16px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--mod); font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 10px; line-height: 14px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--mod);">staff</span> staff site, moderator and owner tools</span>
        <span style="display: inline-flex; align-items: center; gap: 6px;"><span style="display: inline-block; box-sizing: border-box; height: 16px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--team); font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 10px; line-height: 14px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--team);">width</span> the same screen at another width</span>
      </div>
    </section>'''

def chip_html(*a): return ''

total_nodes = sum(len(s['nodes']) for s in S)

doc = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Flow map</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@600;700&amp;family=Atkinson+Hyperlegible+Next:wght@400;600&amp;family=Atkinson+Hyperlegible+Mono:wght@400;500&amp;display=swap">
<style>
body{{margin:0}}
button:focus-visible,a:focus-visible{{outline:2px solid var(--ink);outline-offset:2px}}
button,a,label{{transition:background-color 150ms ease-out,border-color 150ms ease-out,color 150ms ease-out}}
@media (prefers-reduced-motion: reduce){{*{{transition:none !important;animation:none !important}}}}
p,li{{text-wrap:pretty}}
h1,h2,h3{{text-wrap:balance}}
</style>
</helmet>
<div style="{{{{rootStyle}}}}">
  <svg width="0" height="0" aria-hidden="true" style="position: absolute;"><defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1 L7 4 L1 7" style="fill: none; stroke: var(--line); stroke-width: 1;"/></marker></defs></svg>
  <header style="display: flex; flex-direction: column; gap: 4px;">
    <h1 style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 28px; line-height: 32px; font-weight: 700; letter-spacing: -0.01em;">Flow map</h1>
    <p style="margin: 0; font-size: 16px; line-height: 24px; color: var(--ink-muted);">Which screen leads to which, so the build team can wire a demo from the finished boards. Eight flows, one column each; down a column is the main path. The written version with routes and demo paths is docs/design-flow-map-2026-11-08.md.</p>
  </header>

  <div style="display: grid; grid-template-columns: repeat(3, {COLW}px); gap: {GAP}px; align-items: start;">
{sections_html}
  </div>

  {legend}

  <section aria-label="Design notes" style="display: flex; flex-direction: column; gap: 12px; padding-top: 24px; border-top: 1px solid var(--line);">
    <h2 style="margin: 0; font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 12px; line-height: 16px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted);">Design notes</h2>
    <p style="margin: 0; font-size: 13px; line-height: 18px; color: var(--ink-muted);">Every phone board with a -Wide twin is the same screen at 1000 px and up with the six-item rail (Trade, Post offer, Wallets, Profile, Settings, Help); the twins are not drawn as separate nodes. A board that belongs to two flows (Block, TeamChat, BecomeVendor, Refunded, Review, SelfDestruct, TradeFund, Main) is drawn in each. Landing is the landing page drawn on the LogoDirections board, not a board file of its own. Names, amounts and times on the boards are examples: buyer mira.k, seller satoshi_ghost, trade K7M2-9QXA-4FTR-8WPN, 1.250000 XMR for $412.50 via Zelle.</p>
    <p style="margin: 0; font-size: 13px; line-height: 18px; color: var(--ink-muted);">Owner rules the arrows follow: Pay now and I've paid only after the escrow is secured (Q12); the buyer may cancel until I've paid, then only a dispute (g67); 90 minutes before a dispute on instant methods (F9); logged out, a visitor reaches only Landing, Login, recovery (Login-Backup) and signup, which starts with the Terms, tick box and signature on SetupTerms; no arrow reaches the marketplace before Login and SessionLength (owner, 8 Nov, comment #9); after signup the person logs in and then picks a session length (G25); held changes wait 24 hours and are listed on one view (g65); FlexOffer-Post is the offer form (Q4).</p>
  </section>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"theme":{{"editor":"enum","options":["night","day"],"default":"night"}},"$preview":{{"width":1280,"height":HEIGHT}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    const THEMES = {{
      night: '--ground:#0e1116;--surface:#171b22;--surface-raised:#20262f;--line:#6b7584;--ink:#eef1f5;--ink-muted:#9aa4b2;--monero:#ff6600;--monero-ink:#ff6600;--on-monero:#1a0e05;--escrow:#4cc3d9;--caution:#f2c14e;--danger:#ff6b8a;--scrim:rgba(0,0,0,0.6);--mod:#b69cff;--team:#7aa2ff;',
      day: '--ground:#f5f6f8;--surface:#ffffff;--surface-raised:#eceef2;--line:#7a8494;--ink:#12161c;--ink-muted:#566070;--monero:#ff6600;--monero-ink:#b84a00;--on-monero:#1a0e05;--escrow:#0b7285;--caution:#8a5a00;--danger:#c2255c;--scrim:rgba(18,22,28,0.45);--mod:#6741d9;--team:#2f5bd3;'
    }};
    const theme = this.props.theme === 'day' ? 'day' : 'night';
    const rootStyle = THEMES[theme] + "position: relative; width: 1280px; min-height: HEIGHTpx; box-sizing: border-box; padding: 32px; background: var(--ground); color: var(--ink); font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; display: flex; flex-direction: column; gap: 24px;";
    return {{ rootStyle }};
  }}
}}
</script>
</body>
</html>
'''
height = sys.argv[1] if len(sys.argv) > 1 else '2600'
doc = doc.replace('HEIGHT', height)
out = sys.argv[2] if len(sys.argv) > 2 else 'canvas/project/FlowMap.dc.html'
open(out, 'w').write(doc)
print('nodes', total_nodes, 'written', out)
