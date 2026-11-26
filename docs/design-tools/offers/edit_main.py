import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/offers-work')
from kit import FRESH, ANT, MONO, sub

P = '/tmp/claude-0/-home-user-X2F/e5516970-d0c8-5c45-96e2-44b38e46c984/scratchpad/canvas/project/'

for board, href, people, title in [('Main', 'SellOffers.dc.html', 'buyers', 'Buyers paying in USD'),
                                    ('BuyMain', 'BuyOffers.dc.html', 'sellers', 'Sellers taking USD')]:
    f = P + board + '.dc.html'
    s = open(f).read()
    # 1. screen wrapper so the picker's scrim covers the screen, not the notes
    s = sub(s, '<div style="{{rootStyle}}">\n  <header', '<div style="{{rootStyle}}">\n  <div style="position: relative; display: flex; flex-direction: column; flex-grow: 1;">\n  <header')
    s = sub(s, '  </nav>\n  <section aria-label="Design notes"', '  </nav>\n  <sc-if value="{{pickOpen}}" hint-placeholder-val="{{false}}">\n__SHEET__\n  </sc-if>\n  </div>\n  <section aria-label="Design notes"')
    # 2. freshness line under the market price
    s = sub(s, '</span></span></span>\n      <p style="margin: 0; font-size: 14px; line-height: 20px; color: var(--ink-muted);">Offers set their price',
            '</span></span></span>\n      ' + FRESH + '\n      <p style="margin: 0; font-size: 14px; line-height: 20px; color: var(--ink-muted);">Offers set their price')
    # 3. the live section becomes one picker card
    old_list_open = '''        <div style="display: flex; flex-direction: column; border-radius: 16px; background: var(--surface); overflow: hidden;">
          <sc-for list="{{sec.rows}}" as="m" hint-placeholder-count="4">'''
    card = '''        <sc-if value="{{sec.isPick}}" hint-placeholder-val="{{true}}">
        <div data-part="method-pick" style="display: flex; flex-direction: column; border-radius: 16px; background: var(--surface);">
          <button type="button" aria-haspopup="dialog" aria-expanded="{{pickExpanded}}" aria-controls="mp-sheet" onClick="{{openPicker}}" style="display: flex; align-items: center; gap: 14px; min-height: 72px; padding: 12px 10px 12px 16px; box-sizing: border-box; border: 0; border-radius: 16px 16px 0 0; background: transparent; color: var(--ink); font: inherit; text-align: left; cursor: pointer;">
            <span style="{{shown.tileStyle}}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="{{shown.icon}}"/></svg></span>
            <span style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0;">
              <span style="font-size: 13px; line-height: 16px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted);">Payment method</span>
              <span style="font-size: 18px; line-height: 24px; font-weight: 600;">{{shown.name}}</span>
            </span>
            <span aria-hidden="true" style="display: flex; flex-shrink: 0; width: 44px; height: 44px; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="{{pickChevron}}"/></svg></span>
          </button>
          <span aria-hidden="true" style="height: 1px; margin: 0 16px; background: var(--surface-raised);"></span>
          <a href="__HREF__" style="display: flex; align-items: center; gap: 14px; min-height: 64px; padding: 12px 16px 12px 70px; box-sizing: border-box; border-radius: 0 0 16px 16px; color: var(--ink); text-decoration: none;">
            <span style="flex-grow: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600;"><span style="__MONO__">{{shown.n}}</span>{{shown.mid}}</span>
            <span style="display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; gap: 2px;">
              <span style="font-size: 12px; line-height: 16px; color: var(--ink-muted);">{{shown.pre}}</span>
              <span style="__MONO__ font-size: 15px; line-height: 20px; font-weight: 500;">{{shown.rate}}</span>
            </span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--ink-muted); flex-shrink: 0;"><path d="M9 6l6 6-6 6"/></svg>
          </a>
        </div>
        </sc-if>
        <sc-if value="{{sec.isList}}" hint-placeholder-val="{{true}}">
''' + old_list_open
    s = sub(s, old_list_open, card)
    s = sub(s, '''          </sc-for>
        </div>
      </section>
    </sc-for>''', '''          </sc-for>
        </div>
        </sc-if>
      </section>
    </sc-for>''')
    sheet = '''    <div style="position: absolute; inset: 0; z-index: 10; background: var(--scrim);">
      <div style="position: absolute; top: 0; left: 0; right: 0; height: 844px; display: flex; align-items: flex-end;">
        <section id="mp-sheet" role="dialog" aria-modal="true" aria-labelledby="mp-sheet-t" style="width: 100%; max-height: 724px; box-sizing: border-box; padding: 10px 16px 0; border-radius: 16px 16px 0 0; border-top: 1px solid var(--surface-raised); background: var(--surface); display: flex; flex-direction: column; gap: 16px; overflow: hidden;">
          <span aria-hidden="true" style="align-self: center; width: 36px; height: 4px; border-radius: 999px; background: var(--line);"></span>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <h2 id="mp-sheet-t" style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: -0.01em;">__TITLE__</h2>
            <button type="button" aria-label="Close" onClick="{{closePicker}}" style="display: flex; flex-shrink: 0; width: 44px; height: 44px; margin-right: -10px; align-items: center; justify-content: center; border: 0; border-radius: 12px; background: transparent; color: var(--ink); cursor: pointer;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
          <sc-if value="{{pickSearch}}" hint-placeholder-val="{{true}}">
            <label for="mp-q" style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Search methods with __PEOPLE__</label>
            <span style="position: relative; display: block; flex-shrink: 0;">
              <svg style="position: absolute; left: 14px; top: 14px; color: var(--ink-muted);" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
              <input id="mp-q" type="search" value="{{pickQuery}}" onChange="{{onPickQuery}}" placeholder="Search {{pickTotal}} methods" style="box-sizing: border-box; width: 100%; height: 48px; padding: 0 14px 0 44px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface-raised); color: var(--ink); font-family: inherit; font-size: 16px;">
            </span>
          </sc-if>
          <div role="radiogroup" aria-label="__TITLE__" style="display: flex; flex-direction: column; gap: 4px; margin: 0 -8px; padding: 0 8px 24px; overflow-y: auto;">
            <sc-for list="{{pickRows}}" as="o" hint-placeholder-count="8">
              <button type="button" role="radio" aria-checked="{{o.ariaSel}}" onClick="{{o.pick}}" style="{{o.style}}">
                <span style="{{o.tileStyle}}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="{{o.icon}}"/></svg></span>
                <span style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0;">
                  <span style="font-size: 16px; line-height: 22px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{o.name}}</span>
                  <span style="font-size: 13px; line-height: 18px; color: var(--ink-muted);">{{o.pre}} <span style="__MONO__">{{o.rate}}</span></span>
                </span>
                <span style="flex-shrink: 0; font-size: 13px; line-height: 20px; color: var(--ink-muted); white-space: nowrap;"><span style="__MONO__ font-size: 15px; font-weight: 500; color: var(--ink);">{{o.n}}</span>{{o.unit}}</span>
              </button>
            </sc-for>
            <sc-if value="{{pickNone}}" hint-placeholder-val="{{false}}">
              <p style="margin: 0; padding: 12px 4px; font-size: 14px; line-height: 20px; color: var(--ink-muted);">No method with __PEOPLE__ matches "{{pickQuery}}".</p>
            </sc-if>
          </div>
        </section>
      </div>
    </div>'''
    s = s.replace('__SHEET__', sheet)
    s = s.replace('__HREF__', href).replace('__TITLE__', title).replace('__PEOPLE__', people).replace('__MONO__', MONO)

    # 4. notes
    notes_anchor = '  </section>\n</div>\n</x-dc>'
    note = ('    <p style="margin: 0; font-size: 13px; line-height: 18px;"><strong>8 Nov, owner #1 (method drop-down).</strong> "' + title + '" is now one card, not a list: '
            'the top row is a drop-down trigger (the method\'s 40 px icon tile, "Payment method" label, the name 18/24 600, a 44 px chevron box) and the row under it leads to that method\'s offers with the same line as before. '
            'Tapping the trigger opens a bottom sheet (<span style="' + MONO + '">methodPicker</span> tweak, showing: {{pickState}}): sheet title 24/30, a search field only when more than <span style="' + MONO + '">8</span> methods have live offers, '
            'then every method with live offers in the chosen currency, in the chosen sort: icon tile, name, best rate, and the offer count right-aligned in mono. The current one has the 2 px ink ring. Picking one closes the sheet and updates the card in place. '
            'Methods with no live offers stay listed under "All payment methods"; search still lists rows. Drawn at the bottom of the first <span style="' + MONO + '">844</span> px, the phone viewport. Matches wip/lead-method-dropdown (Sheet, radios, tap picks and closes, Escape closes without picking).</p>\n'
            '    <p style="margin: 0; font-size: 13px; line-height: 18px;">' + ANT + 'Follows owner #3 ("Is that the actual current rate?"): the market price carries its source and freshness on a muted line, "Market rate · updated <span style="' + MONO + '">14:05</span> UTC". It names no provider, per Q34 (sources not shown to users). Time is the last fetch, UTC only (p4-2).</p>\n'
            '    <p style="margin: 0; font-size: 13px; line-height: 18px;">COPY-UNSIGNED, 8 Nov: "Payment method", "Search <span style="' + MONO + '">15</span> methods", "<span style="' + MONO + '">34</span> offers" / "<span style="' + MONO + '">1</span> offer", "No method with ' + people + ' matches "…".", "Market rate · updated <span style="' + MONO + '">14:05</span> UTC".</p>\n')
    s = sub(s, notes_anchor, note + notes_anchor)

    # 5. JS
    s = sub(s, '"$preview":{"width":390,', '"methodPicker":{"editor":"enum","options":["closed","open"],"default":"closed"},"$preview":{"width":390,')
    s = sub(s, "this.state = { sort: 'buyers', query: '' };", "this.state = { sort: 'buyers', query: '', picked: null, pickOpen: null, pickQuery: '' };")
    s = sub(s, "        { title: '" + title + "', count: String(live.length), rows: live.map(toRow) },\n        { title: 'All payment methods', count: String(rest.length), rows: rest.map(toRow) }",
            "        { title: '" + title + "', count: String(live.length), rows: [], isPick: live.length > 0, isList: false },\n        { title: 'All payment methods', count: String(rest.length), rows: rest.map(toRow), isPick: false, isList: true }")
    s = sub(s, "rows: hits.map(toRow) }] : [];", "rows: hits.map(toRow), isPick: false, isList: true }] : [];")
    js = '''
    // The live card's method picker (owner #1, 8 Nov): every method with live offers in the chosen currency, in the chosen sort.
    const liveSorted = data.filter((d) => d[2] > 0).sort(cmp);
    const shownD = liveSorted.find((d) => d[0] === this.state.picked) || liveSorted[0];
    const shown = toRow(shownD, 0);
    const pickOpen = this.state.pickOpen == null ? this.props.methodPicker === 'open' : this.state.pickOpen;
    const pq = this.state.pickQuery.trim().toLowerCase();
    const pickRows = liveSorted.filter((d) => !pq || d[0].toLowerCase().indexOf(pq) >= 0).map((d) => {
      const on = d[0] === shownD[0];
      const r = toRow(d, 0);
      return { name: d[0], icon: r.icon, pre: r.pre, rate: r.rate, n: String(d[2]), unit: d[2] === 1 ? ' offer' : ' offers',
        ariaSel: on ? 'true' : 'false',
        tileStyle: 'display: flex; flex-shrink: 0; width: 40px; height: 40px; align-items: center; justify-content: center; border-radius: 12px; color: var(--ink); background: ' + (on ? 'var(--surface);' : 'var(--surface-raised);'),
        style: 'display: flex; align-items: center; gap: 14px; width: 100%; min-height: 64px; padding: 10px 12px; box-sizing: border-box; border-radius: 12px; font-family: inherit; text-align: left; color: var(--ink); cursor: pointer; flex-shrink: 0; ' + (on ? 'border: 2px solid var(--ink); background: var(--surface-raised);' : 'border: 2px solid transparent; background: transparent;'),
        pick: () => this.setState({ picked: d[0], pickOpen: false, pickQuery: '' }) };
    });
'''
    s = sub(s, "    const sortDefs = [", js + "    const sortDefs = [")
    s = sub(s, "      sections, sorts, query,\n", "      sections, sorts, query,\n      shown, pickOpen, pickRows,\n      pickExpanded: pickOpen ? 'true' : 'false',\n      pickChevron: pickOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6',\n      pickState: pickOpen ? 'open' : 'closed',\n      pickSearch: liveSorted.length > 8,\n      pickTotal: String(liveSorted.length),\n      pickQuery: this.state.pickQuery,\n      pickNone: pickRows.length === 0,\n      openPicker: () => this.setState({ pickOpen: true }),\n      closePicker: () => this.setState({ pickOpen: false, pickQuery: '' }),\n      onPickQuery: (e) => this.setState({ pickQuery: e.target.value }),\n")
    open(f, 'w').write(s)
    print('ok', board)
