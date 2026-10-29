# Generates the owner and staff tool artboards (desktop pages) for the X2F App canvas.
import sys, os, json
OUT = sys.argv[1]
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@600;700&amp;family=Atkinson+Hyperlegible+Next:wght@400;600&amp;family=Atkinson+Hyperlegible+Mono:wght@400;500&amp;display=swap">'
MONO = "font-family: 'Atkinson Hyperlegible Mono', monospace;"
MUTED = "color: #9aa4b2;"
VIOLET = "#b69cff"
INPUT = "height: 44px; padding: 0 12px; border-radius: 6px; border: 1px solid #6b7584; background: #20262f; color: #eef1f5; font-family: inherit; font-size: 15px;"
PRIMARY = "display: inline-flex; align-items: center; justify-content: center; height: 48px; padding: 0 22px; border: 0; border-radius: 12px; background: #ff7a1a; color: #1a0e05; font-family: inherit; font-size: 16px; font-weight: 600; cursor: pointer; text-decoration: none;"
SECONDARY = "display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 16px; border: 1px solid #6b7584; border-radius: 12px; background: transparent; color: #eef1f5; font-family: inherit; font-size: 15px; font-weight: 600; cursor: pointer;"
CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="flex-shrink: 0;"><path d="M5 12l4 4 10-10"/></svg>'
SHIELD = '<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true" style="flex-shrink: 0;"><path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/></svg>'

def page(title, body, script, h):
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
{FONTS}
<style>
body{{margin:0}}
a{{color:#ff7a1a}}a:hover{{color:#ffa060}}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{{outline:2px solid #eef1f5;outline-offset:2px}}
input::placeholder{{color:#9aa4b2}}
</style>
</helmet>
<div style="min-height: {h}px; box-sizing: border-box; background: #0e1116; color: #eef1f5; font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; display: flex; flex-wrap: wrap;">
{body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":1280,"height":{h}}}}}'>
{script}
</script>
</body>
</html>
'''

STATIC = "class Component extends DCLogic {\n  renderVals() { return {}; }\n}"

def sidebar(current):
    items = [("Overview", "StaffOverview.dc.html"), ("Disputes", "#"), ("Staff", "StaffList.dc.html"), ("Performance", "StaffPerformance.dc.html"), ("Training library", "#"), ("Activity log", "StaffLog.dc.html"), ("Settings", "StaffSettings.dc.html")]
    links = "\n".join(
        f'      <a href="{href}"{" aria-current=\"page\"" if name == current else ""} style="display: flex; align-items: center; height: 44px; padding: 0 12px; border-radius: 8px; text-decoration: none; font-size: 15px; {"background: #20262f; color: #eef1f5; font-weight: 600;" if name == current else "color: #9aa4b2;"}">{name}</a>'
        for name, href in items)
    return f'''  <nav aria-label="Staff tools" style="flex: 0 0 240px; box-sizing: border-box; padding: 24px 16px; border-right: 1px solid #20262f; display: flex; flex-direction: column; gap: 4px;">
    <span style="display: flex; align-items: center; gap: 8px; padding: 0 12px 20px; font-family: 'Familjen Grotesk', sans-serif; font-size: 22px; font-weight: 700;">X2F <span style="font-family: 'Atkinson Hyperlegible Next', sans-serif; font-size: 13px; font-weight: 600; color: {VIOLET};">Staff</span></span>
{links}
    <span style="margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 12px; font-size: 14px;"><span style="color: {VIOLET};">{SHIELD.format(s=18)}</span>lumen.k <span style="{MUTED}">· Owner</span></span>
  </nav>'''

files = {}

# 1. First-run owner setup
files["OwnerSetup.dc.html"] = page("Create the owner account", f'''  <main style="flex: 1 1 100%; display: flex; justify-content: center; padding: 64px 24px;">
    <div style="width: 100%; max-width: 560px; display: flex; flex-direction: column; gap: 28px;">
      <section style="display: flex; flex-direction: column; gap: 8px;">
        <span style="display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: {VIOLET};">{SHIELD.format(s=18)}First-time setup</span>
        <h1 style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 34px; line-height: 40px; font-weight: 700;">Create the owner account</h1>
        <p style="margin: 0; font-size: 16px; line-height: 24px; {MUTED}">The owner adds and removes staff, sets the rules for large trades and sees every action taken. This page works once. After you finish, it locks for good.</p>
      </section>

      <section aria-label="Setup code" style="display: flex; flex-direction: column; gap: 10px; padding: 20px; border-radius: 12px; background: #171b22;">
        <h2 style="margin: 0; font-size: 17px; font-weight: 600;">1. Setup code</h2>
        <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">The server printed a one-time code in its log when it first started. Only someone with access to the server can see it, which stops anyone else from claiming this page.</p>
        <label for="code" style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Setup code</label>
        <input id="code" type="text" value="7QX4-MP2D-91KA" spellcheck="false" style="{INPUT} {MONO}">
        <span style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #4cc3d9;">{CHECK}Code accepted</span>
      </section>

      <section aria-label="Owner username" style="display: flex; flex-direction: column; gap: 10px; padding: 20px; border-radius: 12px; background: #171b22;">
        <h2 style="margin: 0; font-size: 17px; font-weight: 600;">2. Your username</h2>
        <label for="ou" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">Shown to staff, never to traders
          <input id="ou" type="text" value="lumen.k" spellcheck="false" style="{INPUT} {MONO}">
        </label>
      </section>

      <section aria-label="Security keys" style="display: flex; flex-direction: column; gap: 12px; padding: 20px; border-radius: 12px; background: #171b22;">
        <h2 style="margin: 0; font-size: 17px; font-weight: 600;">3. Two security keys</h2>
        <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">The owner account logs in only with a hardware security key, such as a YubiKey. Register two: one you use, and a spare you keep somewhere safe. There is no password and no reset by message.</p>
        <sc-for list="{{{{keys}}}}" as="k" hint-placeholder-count="2">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; border-top: 1px solid #20262f;">
            <span style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 15px; font-weight: 600;">{{{{k.name}}}}</span><span style="font-size: 13px; {MUTED}">{{{{k.note}}}}</span></span>
            <sc-if value="{{{{k.done}}}}" hint-placeholder-val="{{{{false}}}}"><span style="display: flex; align-items: center; gap: 6px; font-size: 14px; color: #4cc3d9;">{CHECK}Registered</span></sc-if>
            <sc-if value="{{{{k.todo}}}}" hint-placeholder-val="{{{{true}}}}"><button type="button" onClick="{{{{k.add}}}}" style="{SECONDARY}">Tap key to register</button></sc-if>
          </div>
        </sc-for>
      </section>

      <section aria-label="PGP key" style="display: flex; flex-direction: column; gap: 6px; padding: 20px; border-radius: 12px; border: 1px solid #20262f;">
        <h2 style="margin: 0; font-size: 17px; font-weight: 600;">4. PGP key <span style="font-size: 14px; font-weight: 400; {MUTED}">(optional)</span></h2>
        <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">Add your PGP public key to receive encrypted staff alerts and to sign important rulings.</p>
        <a href="#" style="display: inline-flex; align-items: center; height: 40px; font-size: 15px;">Add PGP key</a>
      </section>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" disabled="{{{{locked}}}}" style="{{{{ctaStyle}}}}">Create owner account</button>
        <span style="font-size: 13px; {MUTED}">{{{{ctaNote}}}}</span>
      </div>
    </div>
  </main>''',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { keys: 1 }; }
  renderVals() {
    const n = this.state.keys;
    const keys = [
      { name: 'Main key', note: 'The one you carry' },
      { name: 'Spare key', note: 'Keep it somewhere safe, apart from the main key' }
    ].map((k, i) => ({ ...k, done: i < n, todo: i >= n, add: () => this.setState({ keys: i + 1 }) }));
    const ready = n >= 2;
    const base = 'display: inline-flex; align-items: center; justify-content: center; height: 52px; padding: 0 24px; border: 0; border-radius: 12px; font-family: inherit; font-size: 17px; font-weight: 600; ';
    return {
      keys, locked: ready ? undefined : 'true',
      ctaStyle: base + (ready ? 'background: #ff7a1a; color: #1a0e05; cursor: pointer;' : 'background: #20262f; color: #9aa4b2; cursor: not-allowed;'),
      ctaNote: ready ? 'This page locks after this step.' : 'Register both keys to continue.'
    };
  }
}''', 1180)

# 2. Staff list + add staff
files["StaffList.dc.html"] = page("Staff", sidebar("Staff") + f'''
  <main style="flex: 1 1 0; min-width: 0; padding: 32px; display: flex; flex-direction: column; gap: 24px;">
    <div style="max-width: 1000px; width: 100%; display: flex; flex-direction: column; gap: 24px;">
      <header style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px;">
        <section style="display: flex; flex-direction: column; gap: 6px;">
          <h1 style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 32px; line-height: 38px; font-weight: 700;">Staff</h1>
          <p style="margin: 0; font-size: 15px; {MUTED}">Everyone who helps run X2F. Only you can add or remove people.</p>
        </section>
        <button type="button" onClick="{{{{openAdd}}}}" style="{PRIMARY}">Add staff member</button>
      </header>

      <sc-if value="{{{{adding}}}}" hint-placeholder-val="{{{{true}}}}">
      <section aria-label="Add staff member" style="display: flex; flex-direction: column; gap: 16px; padding: 24px; border-radius: 12px; background: #171b22; border: 1px solid {VIOLET};">
        <h2 style="margin: 0; font-size: 20px; font-weight: 600;">Add a staff member</h2>
        <div role="radiogroup" aria-label="Role" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px;">
          <sc-for list="{{{{roles}}}}" as="r" hint-placeholder-count="3">
            <button type="button" role="radio" aria-checked="{{{{r.on}}}}" onClick="{{{{r.pick}}}}" style="{{{{r.style}}}}">
              <span style="font-size: 16px; font-weight: 600;">{{{{r.name}}}}</span>
              <span style="font-size: 14px; line-height: 20px; color: #9aa4b2;">{{{{r.desc}}}}</span>
            </button>
          </sc-for>
        </div>
        <fieldset style="margin: 0; padding: 16px; border: 1px solid #20262f; border-radius: 12px; display: flex; flex-direction: column; gap: 12px;">
          <legend style="padding: 0 6px; font-size: 16px; font-weight: 600;">Login hours</legend>
          <span style="font-size: 14px; line-height: 20px; {MUTED}">They can only log in during these hours. When the window closes, any open session ends.</span>
          <div role="group" aria-label="Days" style="display: flex; flex-wrap: wrap; gap: 8px;">
            <sc-for list="{{{{days}}}}" as="d" hint-placeholder-count="7">
              <button type="button" aria-pressed="{{{{d.on}}}}" onClick="{{{{d.toggle}}}}" style="{{{{d.style}}}}">{{{{d.label}}}}</button>
            </sc-for>
          </div>
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 15px;">
            <label for="from" style="{MUTED}">From</label><input id="from" type="time" value="09:00" style="{INPUT} {MONO}">
            <label for="to" style="{MUTED}">to</label><input id="to" type="time" value="17:00" style="{INPUT} {MONO}">
            <label for="tz" style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Time zone</label>
            <select id="tz" style="{INPUT}"><option>UTC</option><option>America/Los_Angeles</option><option>America/New_York</option><option>Europe/Berlin</option></select>
          </div>
          <span style="font-size: 13px; {MUTED}">You can change these any time from their row. Your owner account has no time limit.</span>
        </fieldset>
        <sc-if value="{{{{noLink}}}}" hint-placeholder-val="{{{{false}}}}">
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px;">
            <button type="button" onClick="{{{{makeLink}}}}" style="{PRIMARY}">Create invite link</button>
            <span style="font-size: 14px; {MUTED}">They set up their own staff login with a security key or PGP. Staff can't use passwords.</span>
          </div>
        </sc-if>
        <sc-if value="{{{{hasLink}}}}" hint-placeholder-val="{{{{true}}}}">
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <span style="font-size: 14px; {MUTED}">Invite link for a new {{{{roleName}}}}. Send it to them privately. It works once and expires in 24 hours.</span>
            <div style="display: flex; gap: 8px;">
              <input aria-label="Invite link" type="text" readonly value="https://staff.x2f.example/invite/Hq7v2KpX9mTw" style="flex-grow: 1; min-width: 0; {INPUT} {MONO} font-size: 14px;">
              <button type="button" style="{SECONDARY}">Copy link</button>
            </div>
          </div>
        </sc-if>
      </section>
      </sc-if>

      <div style="overflow-x: auto;">
        <table style="width: 100%; min-width: 900px; border-collapse: collapse; font-size: 15px;">
          <thead><tr style="text-align: left; font-size: 13px; {MUTED}">
            <th scope="col" style="padding: 10px 12px; font-weight: 600;">Name</th><th scope="col" style="padding: 10px 12px; font-weight: 600;">Role</th><th scope="col" style="padding: 10px 12px; font-weight: 600;">Status</th><th scope="col" style="padding: 10px 12px; font-weight: 600;">Login hours</th><th scope="col" style="padding: 10px 12px; font-weight: 600;">Joined</th><th scope="col" style="padding: 10px 12px; font-weight: 600;">Last active</th><th scope="col" style="padding: 10px 12px; font-weight: 600; text-align: right;">Cases</th><th scope="col" style="padding: 10px 12px;"><span style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Actions</span></th>
          </tr></thead>
          <tbody>
            <sc-for list="{{{{staff}}}}" as="p" hint-placeholder-count="4">
            <tr style="border-top: 1px solid #20262f;">
              <td style="padding: 14px 12px; font-weight: 600; {MONO}">{{{{p.name}}}}</td>
              <td style="padding: 14px 12px;"><span style="{{{{p.roleStyle}}}}">{{{{p.role}}}}</span></td>
              <td style="padding: 14px 12px;"><span style="{{{{p.statusStyle}}}}">{{{{p.status}}}}</span></td>
              <td style="padding: 14px 12px; font-size: 14px;">{{{{p.hours}}}}</td>
              <td style="padding: 14px 12px; {MUTED}">{{{{p.joined}}}}</td>
              <td style="padding: 14px 12px; {MUTED}">{{{{p.active}}}}</td>
              <td style="padding: 14px 12px; text-align: right; {MONO}">{{{{p.cases}}}}</td>
              <td style="padding: 14px 12px; text-align: right;"><button type="button" onClick="{{{{p.toggle}}}}" style="height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid #6b7584; background: transparent; color: #eef1f5; font-family: inherit; font-size: 14px; cursor: pointer;">{{{{p.action}}}}</button></td>
            </tr>
            </sc-for>
          </tbody>
        </table>
      </div>
      <p style="margin: 0; font-size: 13px; {MUTED}">Names and numbers are examples. Switching someone off takes effect immediately; everything they did stays in the activity log.</p>
    </div>
  </main>''',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { adding: true, role: 'mod', link: false, off: {}, days: { Mon: true, Tue: true, Wed: true, Thu: true, Fri: true } }; }
  renderVals() {
    const VIOLET = '#b69cff';
    const defs = [
      { id: 'senior', name: 'Senior moderator', desc: 'Handles disputes and appeals, co-approves rulings above your size limit, and can freeze or ban accounts.' },
      { id: 'mod', name: 'Moderator', desc: 'Handles disputes and rules alone below your size limit. Larger rulings wait for a senior moderator or you.' },
      { id: 'helper', name: 'Helper', desc: 'Answers questions and support tickets. Cannot see dispute evidence or rule on anything.' }
    ];
    const role = this.state.role;
    const base = 'display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 14px 16px; border-radius: 12px; background: #0e1116; color: #eef1f5; font-family: inherit; text-align: left; cursor: pointer; ';
    const roles = defs.map((d) => ({ ...d, on: role === d.id ? 'true' : 'false',
      style: base + (role === d.id ? 'border: 2px solid #ff7a1a;' : 'border: 2px solid #20262f;'),
      pick: () => this.setState({ role: d.id, link: false }) }));
    const chip = (c) => 'display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 999px; font-size: 13px; font-weight: 600; ' + c;
    const people = [
      { id: 'a', name: 'sarah.v', role: 'Senior moderator', hours: 'Any time', joined: 'Sep 2026', active: '12 min ago', cases: '41' },
      { id: 'b', name: 'dmitri_k', role: 'Moderator', hours: 'Mon–Fri, 09:00–17:00 UTC', joined: 'Oct 2026', active: '2 h ago', cases: '17' },
      { id: 'c', name: 'tobi.w', role: 'Helper', hours: 'Every day, 18:00–23:00 UTC', joined: 'Oct 2026', active: 'Yesterday', cases: '0' },
      { id: 'd', name: 'Invite sent', role: 'Moderator', hours: 'Mon–Fri, 09:00–17:00 UTC', joined: 'Expires in 21 h', active: '', cases: '' }
    ];
    const staff = people.map((p) => {
      const off = !!this.state.off[p.id];
      const pending = p.id === 'd';
      return { ...p,
        roleStyle: chip(p.role === 'Helper' ? 'background: #20262f; color: #eef1f5;' : (p.role === 'Senior moderator' ? 'background: ' + VIOLET + '; color: #170f2b;' : 'border: 1px solid ' + VIOLET + '; color: ' + VIOLET + ';')),
        status: pending ? 'Waiting' : (off ? 'Switched off' : 'Active'),
        statusStyle: 'font-size: 14px; font-weight: 600; color: ' + (pending ? '#f2c14e' : (off ? '#ff6b8a' : '#4cc3d9')) + ';',
        action: pending ? 'Cancel invite' : (off ? 'Switch on' : 'Switch off'),
        toggle: () => this.setState({ off: Object.assign({}, this.state.off, { [p.id]: !off }) }) };
    });
    const dayBase = 'height: 36px; min-width: 52px; padding: 0 10px; border-radius: 999px; font-family: inherit; font-size: 14px; cursor: pointer; ';
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => {
      const on = !!this.state.days[label];
      return { label, on: on ? 'true' : 'false',
        style: dayBase + (on ? 'border: 1px solid #ff7a1a; background: #20262f; color: #eef1f5; font-weight: 600;' : 'border: 1px solid #6b7584; background: transparent; color: #9aa4b2;'),
        toggle: () => this.setState({ days: Object.assign({}, this.state.days, { [label]: !on }) }) };
    });
    return { roles, staff, days, adding: this.state.adding, noLink: !this.state.link, hasLink: this.state.link,
      roleName: defs.find((d) => d.id === role).name.toLowerCase(),
      openAdd: () => this.setState({ adding: true, link: false }), makeLink: () => this.setState({ link: true }) };
  }
}''', 1000)

# 3. Settings
def field(id_, label, value, unit, note):
    return f'''        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label for="{id_}" style="font-size: 15px; font-weight: 600;">{label}</label>
          <span style="display: flex; align-items: center; gap: 10px;"><input id="{id_}" type="text" value="{value}" style="width: 160px; {INPUT} {MONO}"><span style="font-size: 15px; {MUTED}">{unit}</span></span>
          <span style="font-size: 13px; line-height: 18px; {MUTED}">{note}</span>
        </div>'''

files["StaffSettings.dc.html"] = page("Settings", sidebar("Settings") + f'''
  <main style="flex: 1 1 0; min-width: 0; padding: 32px; display: flex; flex-direction: column;">
    <div style="max-width: 760px; width: 100%; display: flex; flex-direction: column; gap: 24px;">
      <section style="display: flex; flex-direction: column; gap: 6px;">
        <h1 style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 32px; line-height: 38px; font-weight: 700;">Settings</h1>
        <p style="margin: 0; font-size: 15px; {MUTED}">Only the owner can change these. Every change is recorded in the activity log.</p>
      </section>
      <section aria-label="Rulings" style="display: flex; flex-direction: column; gap: 20px; padding: 24px; border-radius: 12px; background: #171b22;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 600;">Rulings</h2>
{field("limit", "Large-trade limit", "1,000", "USD equivalent", "A moderator can rule alone on trades below this. At or above it, a senior moderator or you must approve too.")}
{field("reply", "First response deadline", "4", "hours", "How soon a moderator must reply after a dispute opens. Traders see this deadline and their place in the queue.")}
{field("appeal", "Appeal window", "48", "hours", "How long either trader has to appeal a ruling. Appeals go to a senior moderator or you, never the moderator who ruled.")}
      </section>
      <section aria-label="Staff pay" style="display: flex; flex-direction: column; gap: 20px; padding: 24px; border-radius: 12px; background: #171b22;">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 600;">Staff pay</h2>
          <span style="font-size: 14px; line-height: 20px; {MUTED}">Paid monthly in XMR. Amounts to be decided; check with the lawyer before the first payment.</span>
        </div>
{field("pay-senior", "Senior moderator, per case", "[RATE]", "USD in XMR", "Includes co-approving large rulings.")}
{field("pay-mod", "Moderator, per case", "[RATE]", "USD in XMR", "A ruling overturned on appeal earns nothing.")}
{field("pay-helper", "Helper, per month", "[RATE]", "USD in XMR", "Flat rate, since questions don't come in cases.")}
      </section>
      <div><button type="button" style="{PRIMARY}">Save settings</button></div>
    </div>
  </main>''', STATIC, 1240)

# 4. Activity log (search by trade code filters to that trade)
files["StaffLog.dc.html"] = page("Activity log", sidebar("Activity log") + f'''
  <main style="flex: 1 1 0; min-width: 0; padding: 32px; display: flex; flex-direction: column;">
    <div style="max-width: 1000px; width: 100%; display: flex; flex-direction: column; gap: 20px;">
      <section style="display: flex; flex-direction: column; gap: 6px;">
        <h1 style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 32px; line-height: 38px; font-weight: 700;">Activity log</h1>
        <p style="margin: 0; font-size: 15px; line-height: 22px; {MUTED}">Every staff action and every step of every trade. Entries can't be edited or deleted by anyone. Opening a dispute chat or an unblurred proof always appears here.</p>
      </section>
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px;">
        <label for="q" style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Trade code</label>
        <input id="q" type="search" value="{{{{q}}}}" onChange="{{{{onQ}}}}" placeholder="Type or paste a trade code" spellcheck="false" style="width: 340px; {INPUT} {MONO}">
        <label for="active" style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Active disputes</label>
        <select id="active" onChange="{{{{onPick}}}}" style="{INPUT} max-width: 100%;">
          <option value="">Active disputes ({{{{activeCount}}}})</option>
          <sc-for list="{{{{active}}}}" as="a" hint-placeholder-count="2">
            <option value="{{{{a.code}}}}">{{{{a.label}}}}</option>
          </sc-for>
        </select>
        <sc-if value="{{{{filtered}}}}" hint-placeholder-val="{{{{false}}}}">
          <button type="button" onClick="{{{{clear}}}}" style="height: 36px; padding: 0 12px; border: 0; background: transparent; color: #ff7a1a; font-family: inherit; font-size: 14px; cursor: pointer;">Show everything</button>
        </sc-if>
      </div>
      <span style="font-size: 14px; {MUTED}">{{{{summary}}}}</span>
      <div style="overflow-x: auto;">
        <table style="width: 100%; min-width: 860px; border-collapse: collapse; font-size: 15px;">
          <thead><tr style="text-align: left; font-size: 13px; {MUTED}"><th scope="col" style="padding: 10px 12px; font-weight: 600;">When</th><th scope="col" style="padding: 10px 12px; font-weight: 600;">Trade</th><th scope="col" style="padding: 10px 12px; font-weight: 600;">Who</th><th scope="col" style="padding: 10px 12px; font-weight: 600;">What happened</th></tr></thead>
          <tbody>
            <sc-for list="{{{{rows}}}}" as="r" hint-placeholder-count="8">
            <tr style="border-top: 1px solid #20262f;"><td style="padding: 12px; white-space: nowrap; {MUTED}">{{{{r.t}}}}</td><td style="padding: 12px; {MONO} font-size: 14px;">{{{{r.code}}}}</td><td style="padding: 12px; white-space: nowrap;"><span style="font-weight: 600; {MONO}">{{{{r.who}}}}</span> <span style="font-size: 13px; {MUTED}">{{{{r.role}}}}</span></td><td style="padding: 12px;">{{{{r.what}}}}</td></tr>
            </sc-for>
          </tbody>
        </table>
      </div>
      <p style="margin: 0; font-size: 13px; {MUTED}">Every trade gets a random 16-character code in four groups (letters and numbers, no look-alikes such as 0 and O). You can search with or without the dashes. Codes reveal nothing about how many trades X2F handles. Entries are examples.</p>
    </div>
  </main>''',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { q: '' }; }
  renderVals() {
    const A = '3HW8-ZD2N-RT6K-Q9VB', B = 'K7M2-9QXA-4FTR-8WPN', C = 'P9VC-6KE1-YB4M-2HJD';
    const bare = (x) => x.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const all = [
      ['Today 09:50', C, 'system', '', 'Dispute opened by the seller: payment not received; waiting for a moderator'],
      ['Today 09:44', C, 'nightjar', 'Buyer', "Tapped I've paid"],
      ['Today 09:31', A, 'dmitri_k', 'Moderator', 'Proposed a ruling: release 1.80 XMR to the buyer (above the limit, waiting for your approval)'],
      ['Today 09:20', B, 'mira.k', 'Buyer', "Tapped I've paid and uploaded proof"],
      ['Today 09:12', A, 'dmitri_k', 'Moderator', 'Opened the trade chat'],
      ['Today 08:55', A, 'dmitri_k', 'Moderator', 'Requested the unblurred payment proof'],
      ['Today 08:47', B, 'system', '', 'Escrow secured after 10 confirmations'],
      ['Today 08:40', A, 'system', '', 'Dispute opened by the buyer; assigned to dmitri_k'],
      ['Today 08:25', B, 'satoshi_ghost', 'Seller', 'Funded the escrow with 1.25 XMR'],
      ['Yesterday 22:10', '', 'lumen.k', 'Owner', 'Created an invite link for a new moderator (Mon to Fri, 09:00 to 17:00 UTC)'],
      ['Yesterday 19:00', '', 'system', '', "Ended dmitri_k's session at the end of their login hours"],
      ['Yesterday 18:03', '', 'lumen.k', 'Owner', 'Changed the large-trade limit from 500 to 1,000 USD']
    ];
    const q = bare(this.state.q);
    const hits = q ? all.filter((r) => bare(r[1]) === q) : all;
    const rows = hits.map((r) => ({ t: r[0], code: r[1] || '', who: r[2], role: r[3], what: r[4] }));
    const summary = q ? (hits.length ? hits.length + ' entries for trade ' + this.state.q.trim().toUpperCase() + ', newest first.' : 'No entries for ' + this.state.q.trim().toUpperCase() + '. Check the code and try again.') : 'Showing everything, newest first.';
    return { rows, summary, q: this.state.q, filtered: !!q,
      active: [
        { code: A, label: A + ' · Zelle · 1.80 XMR · waiting for your approval' },
        { code: C, label: C + ' · Revolut · 0.40 XMR · waiting for a moderator' }
      ], activeCount: 2,
      onPick: (e) => this.setState({ q: e.target.value }),
      onQ: (e) => this.setState({ q: e.target.value }), clear: () => this.setState({ q: '' }) };
  }
}''', 900)

# 5. Overview: emergency stop, earnings, announcement banner, maintenance mode
def card(title, body):
    return f'''      <section aria-label="{title}" style="display: flex; flex-direction: column; gap: 14px; padding: 24px; border-radius: 12px; background: #171b22;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 600;">{title}</h2>
{body}
      </section>'''

stop = f'''        <sc-if value="{{{{live}}}}" hint-placeholder-val="{{{{true}}}}">
          <p style="margin: 0; display: flex; align-items: center; gap: 8px; font-size: 16px; color: #4cc3d9;">{CHECK}X2F is live. New trades are open.</p>
          <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">If something goes wrong, such as an attack or a serious bug, pause every new trade and offer at once. Trades already in escrow can still be released, refunded or disputed, so nobody's coins get stuck.</p>
          <div><button type="button" onClick="{{{{askStop}}}}" style="height: 48px; padding: 0 20px; border: 1px solid #ff6b8a; border-radius: 12px; background: transparent; color: #ff6b8a; font-family: inherit; font-size: 16px; font-weight: 600; cursor: pointer;">Pause all new trades</button></div>
        </sc-if>
        <sc-if value="{{{{confirming}}}}" hint-placeholder-val="{{{{false}}}}">
          <p style="margin: 0; font-size: 16px; line-height: 24px;">Tap your security key to pause all new trades. Everyone will see a notice until you resume.</p>
          <div style="display: flex; gap: 8px;"><button type="button" onClick="{{{{doStop}}}}" style="height: 48px; padding: 0 20px; border: 0; border-radius: 12px; background: #ff6b8a; color: #1f0a10; font-family: inherit; font-size: 16px; font-weight: 600; cursor: pointer;">Tap key and pause</button><button type="button" onClick="{{{{cancel}}}}" style="{SECONDARY}">Cancel</button></div>
        </sc-if>
        <sc-if value="{{{{paused}}}}" hint-placeholder-val="{{{{false}}}}">
          <p style="margin: 0; padding: 12px 14px; border-radius: 8px; border: 1px solid #ff6b8a; font-size: 16px; line-height: 24px; color: #ff6b8a; font-weight: 600;">New trades are paused since 01:20 UTC. Trades in escrow are carrying on.</p>
          <div><button type="button" onClick="{{{{resume}}}}" style="{PRIMARY}">Tap key and resume trading</button></div>
        </sc-if>'''

earn = f'''        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
          <div style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 14px; {MUTED}">This month</span><span style="{MONO} font-size: 26px; font-weight: 500;">4.82 XMR</span><span style="font-size: 13px; {MUTED}">about $1,590 · 211 trades</span></div>
          <div style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 14px; {MUTED}">Last month</span><span style="{MONO} font-size: 26px; font-weight: 500;">3.07 XMR</span><span style="font-size: 13px; {MUTED}">about $1,013 · 140 trades</span></div>
          <div style="display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 14px; {MUTED}">All time</span><span style="{MONO} font-size: 26px; font-weight: 500;">7.89 XMR</span><span style="font-size: 13px; {MUTED}">about $2,603</span></div>
        </div>
        <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">The 1% fee from each completed trade goes to X2F's fee wallet ending <span style="{MONO} color: #eef1f5;">…9Fq2</span>. This page reads it with a view-only key; the key that can spend from it stays offline, never on the server. Figures are examples.</p>'''

banner = f'''        <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">Show a message at the top of every screen, for every user. Change or remove it whenever you like.</p>
        <label for="msg" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">Message
          <input id="msg" type="text" value="{{{{text}}}}" onChange="{{{{onText}}}}" maxlength="140" style="{INPUT}">
        </label>
        <div role="radiogroup" aria-label="Banner type" style="display: flex; flex-wrap: wrap; gap: 8px;">
          <sc-for list="{{{{kinds}}}}" as="k" hint-placeholder-count="2">
            <button type="button" role="radio" aria-checked="{{{{k.on}}}}" onClick="{{{{k.pick}}}}" style="{{{{k.style}}}}">{{{{k.label}}}}</button>
          </sc-for>
        </div>
        <span style="font-size: 14px; {MUTED}">Preview</span>
        <div aria-label="Banner preview" style="{{{{previewStyle}}}}">{{{{text}}}}</div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;"><button type="button" onClick="{{{{toggleBanner}}}}" style="{PRIMARY}">{{{{bannerCta}}}}</button></div>
        <span style="font-size: 13px; {MUTED}">{{{{bannerState}}}}</span>'''

maint = f'''        <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">For planned upgrades. Users see the message below instead of the app; trades in escrow keep their timers paused until you switch it off.</p>
        <label for="mm" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">Message to users
          <input id="mm" type="text" value="X2F is being upgraded. Back by 03:00 UTC." style="{INPUT}">
        </label>
        <label style="display: flex; align-items: center; gap: 10px; font-size: 15px; cursor: pointer;"><input type="checkbox" style="width: 20px; height: 20px; margin: 0; accent-color: #ff7a1a;">Maintenance mode on</label>'''

files["StaffOverview.dc.html"] = page("Overview", sidebar("Overview") + f'''
  <main style="flex: 1 1 0; min-width: 0; padding: 32px; display: flex; flex-direction: column;">
    <div style="max-width: 1000px; width: 100%; display: flex; flex-direction: column; gap: 20px;">
      <section style="display: flex; flex-direction: column; gap: 6px;">
        <h1 style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 32px; line-height: 38px; font-weight: 700;">Overview</h1>
        <p style="margin: 0; font-size: 15px; {MUTED}">Owner controls. Every change here is recorded in the activity log.</p>
      </section>
{card("Emergency stop", stop)}
{card("Earnings", earn)}
{card("Announcement banner", banner)}
{card("Maintenance mode", maint)}
    </div>
  </main>''',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { stop: 'live', text: 'Zelle payments may take longer this weekend because of a bank holiday.', kind: 'info', shown: false }; }
  renderVals() {
    const st = this.state.stop, kind = this.state.kind;
    const kinds = [{ id: 'info', label: 'Information', color: '#4cc3d9' }, { id: 'warn', label: 'Warning', color: '#f2c14e' }];
    const base = 'height: 40px; padding: 0 14px; border-radius: 999px; font-family: inherit; font-size: 14px; cursor: pointer; ';
    const cur = kinds.find((k) => k.id === kind);
    return {
      live: st === 'live', confirming: st === 'confirm', paused: st === 'paused',
      askStop: () => this.setState({ stop: 'confirm' }), doStop: () => this.setState({ stop: 'paused' }),
      cancel: () => this.setState({ stop: 'live' }), resume: () => this.setState({ stop: 'live' }),
      text: this.state.text, onText: (e) => this.setState({ text: e.target.value }),
      kinds: kinds.map((k) => ({ label: k.label, on: kind === k.id ? 'true' : 'false',
        style: base + (kind === k.id ? 'border: 1px solid #ff7a1a; background: #20262f; color: #eef1f5; font-weight: 600;' : 'border: 1px solid #6b7584; background: transparent; color: #eef1f5;'),
        pick: () => this.setState({ kind: k.id }) })),
      previewStyle: 'padding: 12px 16px; border-radius: 8px; background: #20262f; border-left: 4px solid ' + cur.color + '; color: #eef1f5; font-size: 15px; line-height: 22px;',
      toggleBanner: () => this.setState({ shown: !this.state.shown }),
      bannerCta: this.state.shown ? 'Remove banner' : 'Show to everyone',
      bannerState: this.state.shown ? 'Showing to everyone now.' : 'Not showing.'
    };
  }
}''', 1500)

# 6. Moderator performance, with a per-person chart view
TH = "padding: 10px 12px; font-weight: 600;"
files["StaffPerformance.dc.html"] = page("Performance", sidebar("Performance") + f'''
  <main style="flex: 1 1 0; min-width: 0; padding: 32px; display: flex; flex-direction: column;">
    <div style="max-width: 1000px; width: 100%; display: flex; flex-direction: column; gap: 20px;">
      <section style="display: flex; flex-direction: column; gap: 6px;">
        <h1 style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 32px; line-height: 38px; font-weight: 700;">Moderator performance</h1>
        <p style="margin: 0; font-size: 15px; line-height: 22px; {MUTED}">How quickly and how well each person handles disputes. Use it for coaching, pay and deciding who becomes a senior moderator.</p>
      </section>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        <label for="per" style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Period</label>
        <select id="per" style="{INPUT}"><option>Last 30 days</option><option>Last 90 days</option><option>All time</option></select>
      </div>
      <div style="overflow-x: auto;">
        <table style="width: 100%; min-width: 980px; border-collapse: collapse; font-size: 15px;">
          <thead><tr style="font-size: 13px; {MUTED}">
            <th scope="col" style="{TH} text-align: left;">Name</th><th scope="col" style="{TH} text-align: left;">Role</th><th scope="col" style="{TH} text-align: right;">Cases</th><th scope="col" style="{TH} text-align: right;">Typical first reply</th><th scope="col" style="{TH} text-align: right;">Typical time to ruling</th><th scope="col" style="{TH} text-align: right;">Overturned on appeal</th><th scope="col" style="{TH} text-align: right;">Replied within deadline</th><th scope="col" style="{TH} text-align: right;">Open now</th><th scope="col" style="{TH}"><span style="position: absolute; width: 1px; height: 1px; overflow: hidden;">Chart</span></th>
          </tr></thead>
          <tbody>
            <sc-for list="{{{{people}}}}" as="p" hint-placeholder-count="3">
            <tr style="{{{{p.rowStyle}}}}"><td style="padding: 14px 12px; font-weight: 600; {MONO}">{{{{p.name}}}}</td><td style="padding: 14px 12px; {MUTED}">{{{{p.role}}}}</td><td style="padding: 14px 12px; text-align: right; {MONO}">{{{{p.cases}}}}</td><td style="padding: 14px 12px; text-align: right; {MONO}">{{{{p.first}}}}</td><td style="padding: 14px 12px; text-align: right; {MONO}">{{{{p.ruling}}}}</td><td style="{{{{p.overStyle}}}}">{{{{p.over}}}}</td><td style="padding: 14px 12px; text-align: right; {MONO}">{{{{p.within}}}}</td><td style="padding: 14px 12px; text-align: right; {MONO}">{{{{p.open}}}}</td><td style="padding: 14px 12px; text-align: right;"><button type="button" aria-pressed="{{{{p.on}}}}" onClick="{{{{p.pick}}}}" style="height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid #6b7584; background: transparent; color: #eef1f5; font-family: inherit; font-size: 14px; cursor: pointer; white-space: nowrap;">{{{{p.btn}}}}</button></td></tr>
            </sc-for>
          </tbody>
        </table>
      </div>

      <sc-if value="{{{{hasChart}}}}" hint-placeholder-val="{{{{true}}}}">
      <section aria-label="{{{{who}}}} charts" style="display: flex; flex-direction: column; gap: 16px; padding: 24px; border-radius: 12px; background: #171b22;">
        <div style="display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 600;"><span style="{MONO}">{{{{who}}}}</span>, last 8 weeks</h2>
          <button type="button" onClick="{{{{toggleTable}}}}" style="{SECONDARY}">{{{{tableBtn}}}}</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
          <div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 13px; {MUTED}">Cases</span><span style="{MONO} font-size: 26px;">{{{{totCases}}}}</span></div>
          <div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 13px; {MUTED}">Overturned on appeal</span><span style="{MONO} font-size: 26px;">{{{{totOver}}}}</span></div>
          <div style="display: flex; flex-direction: column; gap: 2px;"><span style="font-size: 13px; {MUTED}">Replied within deadline</span><span style="{MONO} font-size: 26px;">{{{{totWithin}}}}</span></div>
        </div>
        <sc-if value="{{{{showCharts}}}}" hint-placeholder-val="{{{{true}}}}">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 24px;">
          <figure style="margin: 0; display: flex; flex-direction: column; gap: 8px;">
            <figcaption style="font-size: 15px; font-weight: 600;">Cases handled per week</figcaption>
            <svg viewBox="0 0 440 200" role="img" aria-label="{{{{casesAria}}}}" style="width: 100%; height: auto;">
              <sc-for list="{{{{casesGrid}}}}" as="g" hint-placeholder-count="3">
                <line x1="36" x2="432" y1="{{{{g.y}}}}" y2="{{{{g.y}}}}" stroke="#20262f" stroke-width="1"/>
                <text x="28" y="{{{{g.ty}}}}" text-anchor="end" font-size="11" fill="#9aa4b2">{{{{g.label}}}}</text>
              </sc-for>
              <sc-for list="{{{{bars}}}}" as="b" hint-placeholder-count="8">
                <g onMouseEnter="{{{{b.hover}}}}" onMouseLeave="{{{{clearHover}}}}">
                  <rect x="{{{{b.hx}}}}" y="12" width="{{{{b.hw}}}}" height="160" fill="transparent"/>
                  <path d="{{{{b.d}}}}" fill="{{{{b.fill}}}}"/>
                  <text x="{{{{b.cx}}}}" y="190" text-anchor="middle" font-size="11" fill="#9aa4b2">{{{{b.label}}}}</text>
                </g>
              </sc-for>
            </svg>
            <span style="font-size: 14px; min-height: 20px;">{{{{casesRead}}}}</span>
          </figure>
          <figure style="margin: 0; display: flex; flex-direction: column; gap: 8px;">
            <figcaption style="font-size: 15px; font-weight: 600;">Typical first reply per week</figcaption>
            <svg viewBox="0 0 440 200" role="img" aria-label="{{{{replyAria}}}}" style="width: 100%; height: auto;">
              <sc-for list="{{{{replyGrid}}}}" as="g" hint-placeholder-count="3">
                <line x1="36" x2="432" y1="{{{{g.y}}}}" y2="{{{{g.y}}}}" stroke="#20262f" stroke-width="1"/>
                <text x="28" y="{{{{g.ty}}}}" text-anchor="end" font-size="11" fill="#9aa4b2">{{{{g.label}}}}</text>
              </sc-for>
              <line x1="36" x2="432" y1="{{{{deadY}}}}" y2="{{{{deadY}}}}" stroke="#9aa4b2" stroke-width="1.5" stroke-dasharray="6 4"/>
              <text x="430" y="{{{{deadTy}}}}" text-anchor="end" font-size="11" fill="#9aa4b2">4 h deadline</text>
              <polyline points="{{{{linePts}}}}" fill="none" stroke="#9178ee" stroke-width="2" stroke-linejoin="round"/>
              <sc-for list="{{{{dots}}}}" as="d" hint-placeholder-count="8">
                <g onMouseEnter="{{{{d.hover}}}}" onMouseLeave="{{{{clearHover}}}}">
                  <rect x="{{{{d.hx}}}}" y="12" width="{{{{d.hw}}}}" height="160" fill="transparent"/>
                  <circle cx="{{{{d.cx}}}}" cy="{{{{d.cy}}}}" r="{{{{d.r}}}}" fill="#9178ee" stroke="#171b22" stroke-width="2"/>
                  <text x="{{{{d.cx}}}}" y="190" text-anchor="middle" font-size="11" fill="#9aa4b2">{{{{d.label}}}}</text>
                </g>
              </sc-for>
            </svg>
            <span style="font-size: 14px; min-height: 20px;">{{{{replyRead}}}}</span>
          </figure>
        </div>
        </sc-if>
        <sc-if value="{{{{showTable}}}}" hint-placeholder-val="{{{{false}}}}">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead><tr style="font-size: 13px; {MUTED}"><th scope="col" style="{TH} text-align: left;">Week of</th><th scope="col" style="{TH} text-align: right;">Cases</th><th scope="col" style="{TH} text-align: right;">Typical first reply</th></tr></thead>
            <tbody>
              <sc-for list="{{{{weeks}}}}" as="w" hint-placeholder-count="8">
                <tr style="border-top: 1px solid #20262f;"><td style="padding: 8px 12px;">{{{{w.label}}}}</td><td style="padding: 8px 12px; text-align: right; {MONO}">{{{{w.cases}}}}</td><td style="padding: 8px 12px; text-align: right; {MONO}">{{{{w.reply}}}}</td></tr>
              </sc-for>
            </tbody>
          </table>
        </sc-if>
      </section>
      </sc-if>

      <p style="margin: 0; padding: 12px 14px; border-radius: 8px; border: 1px solid #f2c14e; font-size: 14px; line-height: 20px;">dmitri_k had 3 rulings overturned on appeal this month and replied within the 4-hour deadline 82% of the time. Their overturned cases are a good place to start a coaching chat, and they earn no pay under the current rules.</p>
      <p style="margin: 0; font-size: 13px; {MUTED}">Typical means the middle value, so one slow case doesn't skew it. Figures are examples.</p>
    </div>
  </main>''',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { pick: 'dmitri_k', hover: null, table: false }; }
  renderVals() {
    const weeks = ['Aug 24', 'Aug 31', 'Sep 7', 'Sep 14', 'Sep 21', 'Sep 28', 'Oct 5', 'Oct 12'];
    const data = {
      'sarah.v': { role: 'Senior moderator', cases: [4, 5, 6, 5, 4, 6, 5, 6], reply: [42, 35, 40, 30, 45, 38, 36, 33], first: '38 min', ruling: '3 h 10 min', over: 0, within: '96%', open: '1' },
      'dmitri_k': { role: 'Moderator', cases: [1, 2, 2, 3, 2, 3, 2, 2], reply: [95, 130, 150, 90, 160, 140, 100, 120], first: '1 h 52 min', ruling: '6 h 40 min', over: 3, within: '82%', open: '1' },
      'lumen.k': { role: 'Owner', cases: [1, 1, 2, 1, 1, 1, 1, 1], reply: [20, 25, 18, 30, 22, 19, 24, 21], first: '22 min', ruling: '1 h 05 min', over: 0, within: '100%', open: '1' }
    };
    const fmt = (m) => m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min' : m + ' min';
    const pick = this.state.pick;
    const people = Object.keys(data).map((name) => {
      const d = data[name], n = d.cases.reduce((a, b) => a + b, 0), on = pick === name;
      return { name, role: d.role, cases: String(n), first: d.first, ruling: d.ruling, over: d.over + ' of ' + n, within: d.within, open: d.open,
        overStyle: 'padding: 14px 12px; text-align: right; font-family: monospace; ' + (d.over > 0 ? 'color: #f2c14e;' : ''),
        rowStyle: 'border-top: 1px solid #20262f;' + (on ? ' background: #171b22;' : ''),
        on: on ? 'true' : 'false', btn: on ? 'Hide chart' : 'Show chart',
        pick: () => this.setState({ pick: on ? null : name, hover: null }) };
    });
    const out = { people, hasChart: !!pick, clearHover: () => this.setState({ hover: null }) };
    if (!pick) return Object.assign(out, { showCharts: false, showTable: false });
    const d = data[pick];
    const L = 36, R = 432, T = 12, B = 172, slot = (R - L) / 8;
    const yOf = (v, max) => B - (v / max) * (B - T);
    const cMax = Math.max(4, Math.ceil(Math.max(...d.cases) / 2) * 2);
    const rMax = 300;
    const hover = this.state.hover;
    const bars = d.cases.map((v, i) => {
      const w = slot - 14, x = L + i * slot + 7, y = yOf(v, cMax), r = Math.min(4, (B - y) / 2);
      return { label: weeks[i].split(' ')[1], cx: x + w / 2, hx: L + i * slot, hw: slot,
        d: 'M' + x + ',' + B + ' V' + (y + r) + ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y + ' H' + (x + w - r) + ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + ' V' + B + ' Z',
        fill: hover === i ? '#a993f3' : '#9178ee', hover: () => this.setState({ hover: i }) };
    });
    const pts = d.reply.map((v, i) => [L + i * slot + slot / 2, yOf(v, rMax)]);
    const dots = pts.map((p, i) => ({ cx: p[0], cy: p[1], r: hover === i ? 6 : 4, label: weeks[i].split(' ')[1], hx: L + i * slot, hw: slot, hover: () => this.setState({ hover: i }) }));
    const grid = (max, step, f) => { const g = []; for (let v = 0; v <= max; v += step) { const y = yOf(v, max); g.push({ y, ty: y + 4, label: f(v) }); } return g; };
    const n = d.cases.reduce((a, b) => a + b, 0);
    return Object.assign(out, {
      who: pick, showCharts: !this.state.table, showTable: this.state.table,
      tableBtn: this.state.table ? 'Show as charts' : 'Show as table', toggleTable: () => this.setState({ table: !this.state.table }),
      totCases: String(n), totOver: d.over + ' of ' + n, totWithin: d.within,
      bars, casesGrid: grid(cMax, cMax / 2, (v) => String(v)),
      casesAria: pick + ' cases per week for 8 weeks: ' + d.cases.join(', '),
      casesRead: hover === null ? 'Point at a bar to see that week.' : 'Week of ' + weeks[hover] + ': ' + d.cases[hover] + (d.cases[hover] === 1 ? ' case' : ' cases'),
      replyGrid: grid(rMax, 100, (v) => v === 0 ? '0' : (v / 60).toFixed(v % 60 ? 1 : 0) + ' h'),
      deadY: yOf(240, rMax), deadTy: yOf(240, rMax) - 6,
      linePts: pts.map((p) => p[0] + ',' + p[1]).join(' '), dots,
      replyAria: pick + ' typical first reply per week in minutes: ' + d.reply.join(', ') + '. Deadline 240 minutes.',
      replyRead: hover === null ? 'Point at a dot to see that week.' : 'Week of ' + weeks[hover] + ': typical first reply ' + fmt(d.reply[hover]),
      weeks: weeks.map((w, i) => ({ label: w, cases: String(d.cases[i]), reply: fmt(d.reply[i]) }))
    });
  }
}''', 1400)

os.makedirs(OUT, exist_ok=True)
for name, html in files.items():
    open(os.path.join(OUT, name), "w").write(html)
print(json.dumps(list(files)))
