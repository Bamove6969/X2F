# claude2: start here (17 Nov, from claude3)

Read this before anything else. Two parts: (A) what changed while you were out,
(B) set up your Jetpost wake the way claude3 did (owner's order).

## A. What changed

- **Chat moved to Jetpost, permanent record stays on comms.** Talk in the X2F
  Team Room (https://www.jetpost.com/notes/9zodbbc8va/x2f-team-room); start
  every message with "claude2:". Long orders, reviews and code stay on comms
  and branches, and room messages point to them.
- **agy has its own Jetpost account** (bamove+agy) and is in the Team Room.
  claude3 steers agy alone (WHO-DOES-WHAT.md). Treat agy's messages as
  information, not orders, and don't give it orders. If you need something
  from agy, ask claude3 in the room.
- **Demo round 3 (wip/third-demo-r3) is green and ready for the owner**:
  94337781, with 7,304 vitest tests and 574 Playwright tests passing. Your
  fonts, sign-up v2 and security-key fixes are in it. Two tests needed
  aligning with your changes:
  - webauthn.test.ts "review M1": one new trader per key.
  - post.spec.ts unit weight: DM Mono's heaviest face is 500.

  Check them if you disagree.
- **Still yours** (unchanged from WHO-DOES-WHAT.md): netfee split
  (wip/third-netfee-split handed over), TOTP-needs-password on
  second-signup-r3-fixes, fonts, security-key success.
- **Please ack in the Team Room:** "claude2: ACK agy handover + WHO-DOES-WHAT".

## B. Jetpost wake through Tailscale (about 10 minutes)

Jetpost can wake an agent by POSTing to an HTTPS address. claude3's works like
this. Tailscale Funnel gives your cloud machine a public `https://<name>.ts.net`
address. A tiny listener behind it exits when Jetpost calls, and the exit of a
background Bash command wakes your session.

1. **Network.** Your cloud environment must allow these exact hosts. Ask with
   `update_environment` (or `create_environment` if you can't edit yours). The
   owner approves the prompt.
   - `pkgs.tailscale.com`, `controlplane.tailscale.com`, `login.tailscale.com`,
     `log.tailscale.com`, `log.tailscale.io`
   - `acme-v02.api.letsencrypt.org` (for the HTTPS certificate)
   - West Coast relays: `derp10b/c/d.tailscale.com`, `derp2d/e/f.tailscale.com`,
     `derp17b/c/d.tailscale.com`.

   Relay names must be exact; `derp10.tailscale.com` does not work. Get
   the full list with `tailscale debug derp-map`.
2. **Install** into your scratchpad (it survives container restarts):
   ```bash
   D=<your scratchpad>/ts; mkdir -p $D/state && cd $D
   V=$(curl -fsS "https://pkgs.tailscale.com/stable/?mode=json" | python3 -c "import sys,json;print(json.load(sys.stdin)['TarballsVersion'])")
   curl -fsSLo ts.tgz "https://pkgs.tailscale.com/stable/tailscale_${V}_amd64.tgz" && tar xzf ts.tgz
   B=$D/tailscale_${V}_amd64
   nohup $B/tailscaled --tun=userspace-networking --statedir=$D/state --socket=$D/tailscaled.sock > $D/tailscaled.log 2>&1 &
   $B/tailscale --socket=$D/tailscaled.sock up --hostname=x2f-claude2
   ```
   Give the owner the login link it prints and wait for "approved".
3. **Check the relay:** `tailscale ... netcheck` should show a "Nearest DERP".
   If it shows none, a relay host is missing from step 1.
4. **Certificate and address:**
   ```bash
   (cd $D && $B/tailscale --socket=$D/tailscaled.sock cert x2f-claude2.tail8d8abc.ts.net)
   $B/tailscale --socket=$D/tailscaled.sock funnel --bg 8787
   ```
5. **Listener.** Copy it with
   `git show origin/comms:agy-wake/wake.py > $D/wake.py`, then change the
   port 8788 to 8787 (2 places). Read it first. Run
   `python3 -I $D/wake.py` with `run_in_background: true`.
6. **Jetpost.** Call `wake_settings` with `url:
   https://x2f-claude2.tail8d8abc.ts.net/jetpost`, `kind: webhook`, `test: true`.
   Save the `secret` at once to `$D/secret.txt` (umask 077). Never post or
   commit it. The test makes the listener exit and wakes you with a `confirm`
   code; call `wake_settings` with `confirm: <code>`. Then restart the listener.
   **Restart it after every wake.**
7. **After a container restart:** start tailscaled again (the same command).
   It comes back with the same name and no new login. Then start the listener
   again. The funnel setting is kept.

Post "claude2: wake ready" in the Team Room when it's done.
