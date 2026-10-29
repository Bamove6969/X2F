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
    <span style="font-size: 13px; line-height: 18px; {MUTED}">Takes about 2 minutes.</span>
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
    <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">5 to 20 characters: letters, numbers, dots, dashes and underscores. It shows exactly as you type it. Pick something that isn't your real name or used elsewhere.</p>''',
    f'    <a href="SetupLogin.dc.html" style="{PRIMARY}">Continue</a>', STATIC)

# 2. Login method
files["SetupLogin.dc.html"] = shell("How do you want to log in?", 2, "SetupUsername.dc.html", f'''{h1("How do you want to log in?", "Choose one for now. You can add others later in Settings.")}
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
    <a href="#" style="display: inline-flex; align-items: center; height: 44px; font-size: 15px;">New to PGP?</a>''',
    f'    <a href="{{{{next}}}}" style="{PRIMARY}">{{{{cta}}}}</a>',
'''class Component extends DCLogic {
  constructor(props) { super(props); this.state = { pick: 'pgp' }; }
  renderVals() {
    const defs = [
      { id: 'pgp', name: 'PGP key', rec: true, next: 'SetupPgpKey.dc.html', cta: 'Continue with PGP key',
        desc: 'Log in with a PGP key instead of a password. X2F stores only your public key, so there is no password for anyone to steal from us.',
        later: 'Each time you log in, X2F shows a message locked with your public key. Only your private key can unlock it, so you decrypt it in your PGP app and paste in the login code inside. Without your private key, nobody can get that code, and each one works only once.' },
      { id: 'passkey', name: 'Passkey', next: '#', cta: 'Continue with passkey',
        desc: 'Log in with your face, fingerprint or phone PIN. Apple or Google keep it synced across your devices.' },
      { id: 'key', name: 'Security key', next: '#', cta: 'Continue with security key',
        desc: 'Log in by tapping a YubiKey or similar key plugged into your phone or computer.' },
      { id: 'password', name: 'Password', next: 'SetupPassword.dc.html', cta: 'Continue with a password',
        desc: 'Set a password if you would rather. It needs at least 10 characters, with upper and lower case letters, a number and a symbol.' }
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
files["SetupPgpKey.dc.html"] = shell("Paste your public key", 3, "SetupLogin.dc.html", f'''{h1("Add your PGP public key", "Paste the public key from your PGP app. X2F never asks for your private key, so don't paste it here.")}
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
    <p style="margin: 0; font-size: 13px; line-height: 18px; {MUTED}">We accept RSA keys of 4096 bits or more, Ed25519 and Ed448. If a key has expired or been revoked, we'll tell you. This is an example key.</p>''',
    f'    <a href="SetupPgpChallenge.dc.html" style="{PRIMARY}">Continue</a>', STATIC)

# 4. PGP challenge
files["SetupPgpChallenge.dc.html"] = shell("Prove it's your key", 3, "SetupPgpKey.dc.html", f'''{h1("Decrypt your first login code", "You'll do the same thing each time you log in.")}
    <sc-if value="{{{{waiting}}}}" hint-placeholder-val="{{{{true}}}}">
    <ol style="margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 15px; line-height: 22px;">
      <li>Copy the encrypted message below.</li>
      <li>Open your PGP app (Kleopatra, GPG Suite or OpenKeychain) and decrypt it.</li>
      <li>Paste the code from inside the message.</li>
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
      Code from the message
      <input id="phrase" type="text" autocomplete="off" spellcheck="false" placeholder="Paste the code" style="{INPUT} {MONO}">
    </label>
    <p style="margin: 0; padding: 10px 12px; border-radius: 6px; border: 1px solid #f2c14e; font-size: 13px; line-height: 18px;">The decrypted message also names X2F and today's date and time. If it names a different site or an old time, stop and don't paste anything. Someone may be trying to phish you.</p>
    </sc-if>
    <sc-if value="{{{{done}}}}" hint-placeholder-val="{{{{false}}}}">
    <section aria-label="Key verified" style="display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 12px; border: 1px solid #4cc3d9;">
      <span style="display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; color: #4cc3d9;">{CHECK}Key verified</span>
      <p style="margin: 0; font-size: 15px; line-height: 22px;">Every login works this way from now on. X2F shows a message locked to your key, your PGP app unlocks it with your private key, and you paste in the code.</p>
      <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">Each code works once and expires after 5 minutes, so a fake site can't reuse one.</p>
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
files["SetupPassword.dc.html"] = shell("Set a password", 3, "SetupLogin.dc.html", f'''{h1("Choose a password", "At least 10 characters, with upper and lower case letters, a number and a symbol.")}
    <label for="pw" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">
      Password
      <input id="pw" type="password" value="Orbit-lantern-74" autocomplete="new-password" style="{INPUT}">
    </label>
    <label for="pw2" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; {MUTED}">
      Type it again
      <input id="pw2" type="password" value="Orbit-lantern-74" autocomplete="new-password" style="{INPUT}">
    </label>
    <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 14px; color: #4cc3d9;">
      <li style="display: flex; align-items: center; gap: 8px;">{CHECK}10 characters or more</li>
      <li style="display: flex; align-items: center; gap: 8px;">{CHECK}Upper and lower case letters</li>
      <li style="display: flex; align-items: center; gap: 8px;">{CHECK}A number and a symbol</li>
      <li style="display: flex; align-items: center; gap: 8px;">{CHECK}Not on the list of leaked passwords</li>
      <li style="display: flex; align-items: center; gap: 8px;">{CHECK}Both match</li>
    </ul>
    <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">X2F stores a scrambled version that can't be turned back into your password. We have no email address to reset it with, so keep it in a password manager or somewhere else safe.</p>''',
    f'    <a href="SetupBackup.dc.html" style="{PRIMARY}">Set password</a>', STATIC)

# 4. Backup (optional)
files["SetupBackup.dc.html"] = shell("Add a backup login?", 4, "SetupPgpChallenge.dc.html", f'''{h1("Add a backup way to log in", "We recommend it. X2F has no email address or phone number for you, so if you lose your key or forget your password, we have no way to let you back in.")}
    <p style="margin: 0; padding: 12px 14px; border-radius: 12px; background: #171b22; font-size: 14px; line-height: 20px;">Your coins stay in your own wallet either way. Without a backup, you could lose this account and the reputation you've built on it.</p>
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
      { id: 'totp', name: 'Authenticator app', short: 'authenticator app', desc: 'Six-digit codes from any authenticator app.' },
      { id: 'key', name: 'Security key', short: 'security key', desc: 'A YubiKey or similar that you keep somewhere safe.' },
      { id: 'pgp2', name: 'Second PGP key', short: 'second PGP key', desc: 'A spare PGP key stored separately from your main one.' },
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
files["SetupWallet.dc.html"] = shell("Where should your XMR go?", 5, "SetupBackup.dc.html", f'''{h1("Where should we send your XMR?", "Choose the wallet you want to be paid to. X2F never holds your coins.")}
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
    <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">Whenever you add a payout wallet, we'll ask you to confirm it's you, and we'll show an alert. Want extra protection? In Security settings, you can make new wallets wait 24 hours before they can be paid.</p>
    <p style="margin: 0; font-size: 13px; line-height: 18px; {MUTED}">Monero addresses never expire, so reusing one will never make you miss a payout. For extra privacy, you can paste a fresh address from your wallet for each trade.</p>''',
    f'    <a href="SetupWelcome.dc.html" style="{PRIMARY}">Finish setup</a>',
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

# Welcome (end of setup)
files["SetupWelcome.dc.html"] = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Welcome to X2F</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{FONTS}
<style>
body{{margin:0}}
a:focus-visible{{outline:2px solid #eef1f5;outline-offset:2px}}
</style>
</helmet>
<div style="width: 390px; height: 844px; box-sizing: border-box; background: #0e1116; color: #eef1f5; font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; display: flex; flex-direction: column;">
  <main style="flex-grow: 1; padding: 72px 24px 24px; display: flex; flex-direction: column; gap: 28px;">
    <span aria-hidden="true" style="display: flex; width: 64px; height: 64px; align-items: center; justify-content: center; border-radius: 999px; border: 2px solid #4cc3d9; color: #4cc3d9;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4 10-10"/></svg>
    </span>
    <section style="display: flex; flex-direction: column; gap: 10px;">
      <h1 style="margin: 0; font-family: 'Familjen Grotesk', sans-serif; font-size: 34px; line-height: 38px; font-weight: 700; letter-spacing: -0.02em;">Welcome to X2F, lumen.k</h1>
      <p style="margin: 0; font-size: 17px; line-height: 26px; {MUTED}">Your account is ready. Trade Monero for cash, bank transfers and payment apps, with every trade protected by escrow.</p>
    </section>
    <ul aria-label="Your setup" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column;">
      <li style="display: flex; justify-content: space-between; gap: 12px; padding: 14px 0; border-bottom: 1px solid #20262f; font-size: 15px;"><span style="{MUTED}">You log in with</span><span>PGP key</span></li>
      <li style="display: flex; justify-content: space-between; gap: 12px; padding: 14px 0; border-bottom: 1px solid #20262f; font-size: 15px;"><span style="{MUTED}">Backup login</span><span>Authenticator app</span></li>
      <li style="display: flex; justify-content: space-between; gap: 12px; padding: 14px 0; border-bottom: 1px solid #20262f; font-size: 15px;"><span style="{MUTED}">You get paid to</span><span>Cake Wallet <span style="{MONO} {MUTED}">…k3Fz</span></span></li>
    </ul>
    <p style="margin: 0; font-size: 14px; line-height: 20px; {MUTED}">You can change any of these later in Settings.</p>
  </main>
  <footer style="padding: 16px;">
    <a href="Main.dc.html" style="{PRIMARY}">Start trading</a>
  </footer>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":390,"height":844}}}}'>
{STATIC}
</script>
</body>
</html>
'''

os.makedirs(OUT, exist_ok=True)
for name, html in files.items():
    open(os.path.join(OUT, name), "w").write(html)
print(json.dumps(list(files)))
