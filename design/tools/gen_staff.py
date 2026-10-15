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
    items = [("Disputes", "#"), ("Staff", "StaffList.dc.html"), ("Training library", "#"), ("Activity log", "StaffLog.dc.html"), ("Settings", "StaffSettings.dc.html")]
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
        <input id="q" type="search" value="{{{{q}}}}" onChange="{{{{onQ}}}}" placeholder="Trade code, e.g. 3HW8-ZD2N-RT6K-Q9VB" spellcheck="false" style="width: 340px; {INPUT} {MONO}">
        <sc-for list="{{{{chips}}}}" as="c" hint-placeholder-count="2">
          <button type="button" onClick="{{{{c.pick}}}}" style="height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid #6b7584; background: transparent; color: #eef1f5; font-family: 'Atkinson Hyperlegible Mono', monospace; font-size: 13px; cursor: pointer;">{{{{c.code}}}}</button>
        </sc-for>
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
    const A = '3HW8-ZD2N-RT6K-Q9VB', B = 'K7M2-9QXA-4FTR-8WPN';
    const bare = (x) => x.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const all = [
      ['Today 09:42', A, 'sarah.v', 'Senior moderator', 'Approved the ruling: release 1.80 XMR to the buyer'],
      ['Today 09:31', A, 'dmitri_k', 'Moderator', 'Proposed a ruling: release to the buyer (above the limit, sent for approval)'],
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
      chips: [A, B].map((code) => ({ code, pick: () => this.setState({ q: code }) })),
      onQ: (e) => this.setState({ q: e.target.value }), clear: () => this.setState({ q: '' }) };
  }
}''', 900)

os.makedirs(OUT, exist_ok=True)
for name, html in files.items():
    open(os.path.join(OUT, name), "w").write(html)
print(json.dumps(list(files)))
