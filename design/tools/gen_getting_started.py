# Generates the Getting started artboards (.dc.html) for the X2F App canvas.
# Shared shell: setup header with a 5-step progress bar, body, footer.
import sys, os, json
OUT = sys.argv[1]

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@600;700&amp;family=Atkinson+Hyperlegible+Next:wght@400;600&amp;family=Atkinson+Hyperlegible+Mono:wght@400;500&amp;display=swap">'
MONO = "font-family: 'Atkinson Hyperlegible Mono', monospace;"
MUTED = "color: #9aa4b2;"
INPUT = "height: 48px; padding: 0 12px; border-radius: 6px; border: 1px solid #6b7584; background: #20262f; color: #eef1f5; font-family: inherit; font-size: 16px;"
PRIMARY = "display: flex; align-items: center; justify-content: center; width: 100%; height: 56px; border: 0; border-radius: 12px; background: #ff7a1a; color: #1a0e05; font-family: inherit; font-size: 18px; font-weight: 600; cursor: pointer; text-decoration: none;"
QUIET = "width: 100%; height: 44px; border: 0; background: transparent; color: #9aa4b2; font-family: inherit; font-size: 15px; cursor: pointer;"
CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="flex-shrink: 0;"><path d="M5 12l4 4 10-10"/></svg>'

def shell(title, step, back, body, footer, script, props='{"$preview":{"width":390,"height":844}}'):
    segs = "".join(
        f'<span style="flex: 1; height: 4px; border-radius: 999px; background: {"#ff7a1a" if i < step else "#20262f"};"></span>'
        for i in range(5))
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
button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{{outline:2px solid #eef1f5;outline-offset:2px}}
input::placeholder,textarea::placeholder{{color:#9aa4b2}}
</style>
</helmet>
<div style="width: 390px; height: 844px; box-sizing: border-box; background: #0e1116; color: #eef1f5; font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; display: flex; flex-direction: column;">
  <header style="display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 14px; border-bottom: 1px solid #20262f;">
    <div style="display: flex; align-items: center; gap: 8px;">
      <a href="{back}" aria-label="Back" style="display: flex; width: 44px; height: 44px; margin-left: -10px; align-items: center; justify-content: center; color: #eef1f5;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      </a>
      <span style="flex-grow: 1; font-size: 15px; font-weight: 600;">Set up your account</span>
      <span style="font-size: 13px; {MUTED}">Step {step} of 5</span>
    </div>
    <div role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="5" aria-valuenow="{step}" style="display: flex; gap: 4px;">{segs}</div>
    <span style="font-size: 13px; line-height: 18px; {MUTED}">Your trade with satoshi_ghost waits while you finish. About 2 minutes.</span>
  </header>
  <main style="flex-grow: 1; min-height: 0; overflow-y: auto; padding: 20px 16px; display: flex; flex-direction: column; gap: 20px;">
{body}
  </main>
  <footer style="display: flex; flex-direction: column; gap: 4px; padding: 16px; border-top: 1px solid #20262f;">
{footer}
  </footer>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{props}'>
{script}
</script>
</body>
</html>
'''

def h1(t, sub):
    return f'''    <section style="display: flex; flex-direction: column; gap: 6px;">
      <h1 style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 26px; line-height: 32px; font-weight: 600;">{t}</h1>
      <p style="margin: 0; font-size: 16px; line-height: 24px; {MUTED}">{sub}</p>
    </section>'''

STATIC = "class Component extends DCLogic {\n  renderVals() { return {}; }\n}"
files = {}

# 1. Username
files["SetupUsername.dc.html"] = shell("Pick a username", 1, "SellOffers.dc.html", f'''{h1("Pick a username", "This is how traders see you. No email or phone number needed, now or ever.")}
    <label for="uname" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">
      Username
      <input id="uname" type="text" value="lumen.k" autocomplete="off" spellcheck="false" style="{INPUT} {MONO}">
    </label>
    <span style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #4cc3d9;">{CHECK}lumen.k is available</span>
    <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">3 to 20 characters: letters, numbers, dots, dashes and underscores. It shows exactly as you type it. Pick something that isn't your real name or used elsewhere.</p>''',
    f'    <a href="SetupLogin.dc.html" style="{PRIMARY}">Continue</a>', STATIC)

# 2. Login method
files["SetupLogin.dc.html"] = shell("How will you log in?", 2, "SetupUsername.dc.html", f'''{h1("How will you log in?", "Pick one now. You can add more later in Settings.")}
    <div role="radiogroup" aria-label="Login method" style="display: flex; flex-direction: column; gap: 10px;">
      <sc-for list="{{{{methods}}}}" as="m" hint-placeholder-count="4">
        <button type="button" role="radio" aria-checked="{{{{m.on}}}}" onClick="{{{{m.pick}}}}" style="{{{{m.style}}}}">
          <span style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 17px; font-weight: 600;">{{{{m.name}}}}</span>
            <sc-if value="{{{{m.rec}}}}" hint-placeholder-val="{{{{false}}}}"><span style="padding: 2px 10px; border-radius: 999px; background: #20262f; color: #4cc3d9; font-size: 12px; font-weight: 600;">Recommended</span></sc-if>
          </span>
          <span style="font-size: 14px; line-height: 20px; {MUTED}">{{{{m.desc}}}}</span>
          <sc-if value="{{{{m.later}}}}" hint-placeholder-val="{{{{false}}}}"><span style="font-size: 14px; line-height: 20px; color: #eef1f5;">{{{{m.later}}}}</span></sc-if>
        </button>
      </sc-for>
    </div>
    <a href="#" style="display: inline-flex; align-items: center; height: 44px; font-size: 15px;">What's PGP?</a>''',
    f'    <a href="{{{{next}}}}" style="{PRIMARY}">{{{{cta}}}}</a>',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { pick: 'pgp' }; }
  renderVals() {
    const defs = [
      { id: 'pgp', name: 'PGP key', rec: true, next: 'SetupPgpKey.dc.html', cta: 'Continue with PGP key',
        desc: 'No password to remember, and nothing for anyone to steal from X2F: we only ever hold your public key.',
        later: 'Logging in later: copy the message X2F shows, decrypt it in your PGP app, paste the phrase back. A few seconds once you know it.' },
      { id: 'passkey', name: 'Passkey', next: '#', cta: 'Continue with passkey',
        desc: 'Unlock with your face, fingerprint or phone PIN. Apple or Google keep it synced across your devices.' },
      { id: 'key', name: 'Security key', next: '#', cta: 'Continue with security key',
        desc: 'A YubiKey or similar. Tap it to log in. It never leaves your hands.' },
      { id: 'password', name: 'Password', next: 'SetupPassword.dc.html', cta: 'Continue with a password',
        desc: 'Prefer a simple password? That works too. At least 12 characters; four random words make a good one.' }
    ];
    const base = 'display: flex; flex-direction: column; align-items: flex-start; gap: 6px; width: 100%; padding: 14px 16px; border-radius: 12px; background: #171b22; color: #eef1f5; font-family: inherit; text-align: left; cursor: pointer; ';
    const pick = this.state.pick;
    const methods = defs.map((d) => ({
      name: d.name, desc: d.desc, rec: !!d.rec, later: pick === d.id ? (d.later || '') : '',
      on: pick === d.id ? 'true' : 'false',
      style: base + (pick === d.id ? 'border: 2px solid #ff7a1a;' : 'border: 2px solid transparent;'),
      pick: () => this.setState({ pick: d.id })
    }));
    const cur = defs.find((d) => d.id === pick);
    return { methods, cta: cur.cta, next: cur.next };
  }
}''')

# 3. PGP public key
files["SetupPgpKey.dc.html"] = shell("Paste your public key", 3, "SetupLogin.dc.html", f'''{h1("Paste your PGP public key", "Your public key only. Never paste the private one: X2F will never ask for it.")}
    <label for="pub" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">
      Public key
      <textarea id="pub" rows="6" spellcheck="false" style="padding: 10px 12px; border-radius: 6px; border: 1px solid #6b7584; background: #20262f; color: #eef1f5; {MONO} font-size: 13px; line-height: 18px; resize: none;">-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEZx3kQhYJKwYBBAHaRw8BAQdA0r9p
…
-----END PGP PUBLIC KEY BLOCK-----</textarea>
    </label>
    <section aria-label="Key check" style="display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-radius: 12px; border: 1px solid #4cc3d9;">
      <span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: #4cc3d9;">{CHECK}Key accepted</span>
      <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 14px;"><span style="{MUTED}">Type</span><span>Ed25519</span></div>
      <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 14px;"><span style="{MUTED}">Expires</span><span>Never</span></div>
      <div style="display: flex; flex-direction: column; gap: 4px; font-size: 14px;"><span style="{MUTED}">Fingerprint (your account ID)</span><span style="{MONO} font-size: 13px; line-height: 18px;">3F2A 9C41 7B0E D5A2 61C8  0E4B 92D7 1F6A C3B8 0D15</span></div>
    </section>
    <p style="margin: 0; font-size: 13px; line-height: 18px; {MUTED}">Accepted: RSA 4096 or larger, Ed25519, Ed448. Expired or revoked keys are turned away with a note on why. Example key shown.</p>''',
    f'    <a href="SetupPgpChallenge.dc.html" style="{PRIMARY}">Continue</a>', STATIC)

# 4. PGP challenge
files["SetupPgpChallenge.dc.html"] = shell("Prove it's your key", 3, "SetupPgpKey.dc.html", f'''{h1("Prove it's your key", "This is exactly how every login will work.")}
    <sc-if value="{{{{waiting}}}}" hint-placeholder-val="{{{{true}}}}">
    <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 15px; line-height: 22px;">
      <li>Copy the message below.</li>
      <li>Decrypt it in your PGP app (Kleopatra, GPG Suite or OpenKeychain).</li>
      <li>Paste the phrase it reveals.</li>
    </ol>
    <section aria-label="Encrypted message" style="display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: #f2c14e;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Expires in <span style="{MONO}">4:12</span></span>
        <button type="button" style="height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid #6b7584; background: transparent; color: #eef1f5; font-family: inherit; font-size: 14px; cursor: pointer;">Copy message</button>
      </div>
      <pre style="margin: 0; padding: 10px 12px; border-radius: 6px; background: #171b22; {MONO} font-size: 12px; line-height: 17px; {MUTED} white-space: pre-wrap; word-break: break-all;">-----BEGIN PGP MESSAGE-----

hF4DkR7c2x9mPq0SAQdA4vJ8u2Lk0aQz
Wm3n…
-----END PGP MESSAGE-----</pre>
    </section>
    <label for="phrase" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">
      Decrypted phrase
      <input id="phrase" type="text" autocomplete="off" spellcheck="false" placeholder="Paste the phrase here" style="{INPUT} {MONO}">
    </label>
    <p style="margin: 0; padding: 10px 12px; border-radius: 6px; border: 1px solid #f2c14e; font-size: 13px; line-height: 18px;">The decrypted message names X2F and the current time. If it names another site or an old time, stop: someone may be trying to phish you.</p>
    </sc-if>
    <sc-if value="{{{{done}}}}" hint-placeholder-val="{{{{false}}}}">
    <section aria-label="Key verified" style="display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 12px; border: 1px solid #4cc3d9;">
      <span style="display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; color: #4cc3d9;">{CHECK}Key verified</span>
      <p style="margin: 0; font-size: 15px; line-height: 22px;">That's how every login works: copy, decrypt, paste. No password to forget or leak.</p>
      <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">A phishing site can't reuse a phrase: each one works once, expires in 5 minutes and names X2F.</p>
    </section>
    </sc-if>''',
    f'''    <sc-if value="{{{{waiting}}}}" hint-placeholder-val="{{{{true}}}}"><button type="button" onClick="{{{{verify}}}}" style="{PRIMARY}">Verify</button></sc-if>
    <sc-if value="{{{{done}}}}" hint-placeholder-val="{{{{false}}}}"><a href="SetupBackup.dc.html" style="{PRIMARY}">Continue</a></sc-if>''',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { done: false }; }
  renderVals() {
    return { waiting: !this.state.done, done: this.state.done, verify: () => this.setState({ done: true }) };
  }
}''')

# Alt. Password
files["SetupPassword.dc.html"] = shell("Set a password", 3, "SetupLogin.dc.html", f'''{h1("Set a password", "Keep it simple if you like. Long beats complicated.")}
    <label for="pw" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">
      Password
      <input id="pw" type="password" value="orbit lantern maple river" autocomplete="new-password" style="{INPUT}">
    </label>
    <label for="pw2" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">
      Type it again
      <input id="pw2" type="password" value="orbit lantern maple river" autocomplete="new-password" style="{INPUT}">
    </label>
    <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 14px; color: #4cc3d9;">
      <li style="display: flex; align-items: center; gap: 8px;">{CHECK}12 characters or more</li>
      <li style="display: flex; align-items: center; gap: 8px;">{CHECK}Not on the list of leaked passwords</li>
      <li style="display: flex; align-items: center; gap: 8px;">{CHECK}Both match</li>
    </ul>
    <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">We store only a one-way scramble of it, so even X2F can't read it. There's no email to reset it with, so keep it somewhere safe, like a password manager.</p>''',
    f'    <a href="SetupBackup.dc.html" style="{PRIMARY}">Set password</a>', STATIC)

# 4. Backup (optional)
files["SetupBackup.dc.html"] = shell("Add a backup login?", 4, "SetupPgpChallenge.dc.html", f'''{h1("Add a backup login?", "Recommended. X2F has no email or phone number for you, so if you lose your key or forget your password, nobody can get you back in.")}
    <p style="margin: 0; padding: 12px 14px; border-radius: 12px; background: #171b22; font-size: 14px; line-height: 20px;">Your coins are always safe in your own wallet. What you'd lose is this account and its reputation.</p>
    <div role="radiogroup" aria-label="Backup method" style="display: flex; flex-direction: column;">
      <sc-for list="{{{{opts}}}}" as="o" hint-placeholder-count="4">
        <button type="button" role="radio" aria-checked="{{{{o.on}}}}" onClick="{{{{o.pick}}}}" style="{{{{o.style}}}}">
          <span style="display: flex; flex-direction: column; gap: 2px; text-align: left;">
            <span style="font-size: 16px; font-weight: 600;">{{{{o.name}}}}</span>
            <span style="font-size: 13px; line-height: 18px; color: #9aa4b2;">{{{{o.desc}}}}</span>
          </span>
          <span aria-hidden="true" style="{{{{o.dot}}}}"></span>
        </button>
      </sc-for>
    </div>''',
    f'''    <a href="SetupWallet.dc.html" style="{PRIMARY}">Add {{{{choice}}}}</a>
    <a href="SetupWallet.dc.html" style="display: flex; align-items: center; justify-content: center; height: 44px; color: #9aa4b2; font-size: 15px; text-decoration: none;">Skip for now</a>''',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { pick: 'totp' }; }
  renderVals() {
    const defs = [
      { id: 'totp', name: 'Authenticator app', short: 'authenticator app', desc: '6-digit codes from any authenticator app.' },
      { id: 'key', name: 'Security key', short: 'security key', desc: 'A YubiKey or similar, kept somewhere safe.' },
      { id: 'pgp2', name: 'Second PGP key', short: 'second PGP key', desc: 'A spare key stored apart from your main one.' },
      { id: 'codes', name: 'Printed recovery codes', short: 'recovery codes', desc: 'Ten one-time codes to print or write down.' }
    ];
    const pick = this.state.pick;
    const opts = defs.map((d) => ({
      name: d.name, desc: d.desc, on: pick === d.id ? 'true' : 'false',
      style: 'display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 64px; padding: 10px 0; border: 0; border-bottom: 1px solid #20262f; background: transparent; color: #eef1f5; font-family: inherit; cursor: pointer;',
      dot: 'width: 20px; height: 20px; flex-shrink: 0; box-sizing: border-box; border-radius: 999px; ' + (pick === d.id ? 'border: 6px solid #ff7a1a;' : 'border: 2px solid #6b7584;'),
      pick: () => this.setState({ pick: d.id })
    }));
    return { opts, choice: defs.find((d) => d.id === pick).short };
  }
}''')

# 5. Link a wallet
files["SetupWallet.dc.html"] = shell("Where should your XMR go?", 5, "SetupBackup.dc.html", f'''{h1("Where should your XMR go?", "Pick the wallet you want paid to. X2F never holds your coins.")}
    <div role="radiogroup" aria-label="Wallet app" style="display: flex; flex-wrap: wrap; gap: 8px;">
      <sc-for list="{{{{apps}}}}" as="a" hint-placeholder-count="8">
        <button type="button" role="radio" aria-checked="{{{{a.on}}}}" onClick="{{{{a.pick}}}}" style="{{{{a.style}}}}">{{{{a.label}}}}</button>
      </sc-for>
    </div>
    <sc-if value="{{{{edgeTip}}}}" hint-placeholder-val="{{{{false}}}}">
      <p style="margin: 0; padding: 10px 12px; border-radius: 6px; border: 1px solid #f2c14e; font-size: 13px; line-height: 18px;">For best privacy, turn on Full Sync in Edge's Monero settings. Otherwise Edge's servers can see payments coming in.</p>
    </sc-if>
    <label for="addr" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">
      Receive address from {{{{appName}}}}
      <span style="display: flex; gap: 8px;">
        <input id="addr" type="text" placeholder="4… or 8…" autocomplete="off" spellcheck="false" style="flex-grow: 1; min-width: 0; {INPUT} {MONO} font-size: 15px;">
        <button type="button" aria-label="Scan address QR code" style="display: flex; width: 48px; height: 48px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 6px; border: 1px solid #6b7584; background: transparent; color: #eef1f5; cursor: pointer;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M8 12h8"/></svg>
        </button>
      </span>
    </label>
    <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">Your first wallet works right away. Wallets you add later wait 24 hours before they can receive payouts, so someone who gets into your account can't redirect your coins.</p>''',
    f'    <a href="BuyerPay.dc.html" style="{PRIMARY}">Finish and go to the trade</a>',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { app: 'Cake Wallet' }; }
  renderVals() {
    const names = ['Cake Wallet', 'Edge', 'Feather', 'Monerujo', 'Stack', 'Monero GUI', 'Ledger or Trezor', 'Other'];
    const app = this.state.app;
    const base = 'height: 40px; padding: 0 14px; border-radius: 999px; font-family: inherit; font-size: 14px; cursor: pointer; ';
    const apps = names.map((label) => ({
      label, on: app === label ? 'true' : 'false',
      style: app === label ? base + 'border: 1px solid #ff7a1a; background: #20262f; color: #eef1f5; font-weight: 600;'
                           : base + 'border: 1px solid #6b7584; background: transparent; color: #eef1f5;',
      pick: () => this.setState({ app: label })
    }));
    return { apps, appName: app === 'Other' ? 'your wallet' : app, edgeTip: app === 'Edge' };
  }
}''')

os.makedirs(OUT, exist_ok=True)
for name, html in files.items():
    open(os.path.join(OUT, name), "w").write(html)
print(json.dumps(list(files)))
