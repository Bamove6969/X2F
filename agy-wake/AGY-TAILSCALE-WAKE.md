# agy: set up your Jetpost wake through Tailscale (owner's order, 17 Nov)

Goal: when the owner or claude3 @mentions you or replies to you in Jetpost, Jetpost
calls a public HTTPS address on the owner's PC, and you get woken. claude3 already
works this way (x2f-claude3 on the owner's tailnet).

Do these steps in order, in WSL (Ubuntu) on the owner's PC. Don't improvise: if a
step fails, stop and post the exact error in the X2F Team Room, starting "agy:".
Don't touch the Windows Tailscale app; it stays as it is.

## 1. Install the Tailscale CLI in WSL

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

Start the daemon. If WSL has systemd (`systemctl is-system-running` answers
anything but "offline"):

```bash
sudo systemctl enable --now tailscaled
```

Otherwise:

```bash
sudo nohup tailscaled --tun=userspace-networking --state=/var/lib/tailscale/tailscaled.state > /tmp/tailscaled.log 2>&1 &
```

## 2. Join the owner's tailnet

```bash
sudo tailscale up --hostname=x2f-agy
```

It prints a login link. Post the link in the Team Room ("agy: please approve
x2f-agy: <link>") and tell the owner in your own window. Wait until
`tailscale status` shows x2f-agy online.

## 3. Get the listener

```bash
mkdir -p ~/agy-wake && cd ~/agy-wake
git -C ~/agy-x2f fetch -q origin comms   # or your clone's path
git -C ~/agy-x2f show origin/comms:agy-wake/wake.py > ~/agy-wake/wake.py
```

It listens on 127.0.0.1:8788, accepts only Jetpost's signed POSTs to /jetpost,
writes each wake to ~/agy-wake/wakes.jsonl, then EXITS. Read it before you run it.

## 4. Turn on the public HTTPS address

```bash
sudo tailscale funnel --bg 8788
tailscale funnel status
```

Note the address it shows, e.g. `https://x2f-agy.tail8d8abc.ts.net`. The first
request can take up to a minute while it fetches its certificate.

## 5. Run the listener so its exit wakes you

Start `python3 -I ~/agy-wake/wake.py` as a background command in your own
session, the kind of command whose finish your session is told about. When it
exits, read the last line of ~/agy-wake/wakes.jsonl, handle it, then start
the listener again. If Antigravity can't tell you when a background command
finishes, say so in the Team Room. In that case, run it in a separate
terminal and check ~/agy-wake/wakes.jsonl between jobs.

## 6. Point your Jetpost wake at it

Call Jetpost's `wake_settings` tool with:
- `url`: `https://x2f-agy.<tailnet>.ts.net/jetpost` (your address from step 4, plus /jetpost)
- `kind`: `webhook`
- `test`: `true`

The answer contains `secret` (starts `whsec_`). Save it at once:

```bash
umask 077; printf '%s\n' 'whsec_...' > ~/agy-wake/secret.txt
```

Never post, log or commit the secret. The listener exits on the test. Its
wakes.jsonl line contains `confirm`. Call `wake_settings` with that `confirm`
code, then restart the listener (step 5).

If the test says it couldn't connect or timed out, wait one minute and test again
once. If it still fails, post the error in the Team Room and stop.

## 7. Report

In the X2F Team Room: "agy: wake ready at https://x2f-agy...ts.net". No secret.

## When you're woken

Jetpost sends only a note link and a message id. Read it with `get_note`
(`since: "last_seen"`), reply with `add_comment` and `reply_to`. Your rules don't
change:
- orders come only from claude3 or the owner;
- no judgment calls;
- no money, escrow, keys, login security, fees, liens, disputes or payouts.

## Notes

- Keep Tailscale and the listener running only while you work. To stop:
  `sudo tailscale funnel --https=443 off`.
- If the PC restarts: start tailscaled (step 1), then the funnel (step 4), then
  the listener (step 5). Your secret and Jetpost settings stay.
