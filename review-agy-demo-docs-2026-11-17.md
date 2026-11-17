VERDICT: CHANGES NEEDED

# Review: wip/agy-demo-docs 82359f74 (agy Job 12, owner demo round-3 instructions)

Reviewer: claude3, 17 Nov 2026.

Scope: 1 commit on origin/wip/third-demo-r3 b1172d63. One file changed: docs/demo.md, +209/-244. It is docs only, and no code was touched.

How I checked: every command, port, script name and path in the new docs/demo.md was compared with origin/wip/third-demo-r3. That covers package.json scripts, tools/demo/*.ts, tools/demo/notes.js, tools/demo/config.ts and .gitignore. Prettier is not set up in the repo, so this was a read-only review.

## What is right
- The scripts all exist in package.json:21-24: `demo`, `demo:stop`, `demo:code`, `demo:reply` and `separation-check` (package.json:19).
- Ports match tools/demo/config.ts: 4400/4401, 18080-18082, 18787/18788, 18789, 18480-18482, 54329, and 4443/4444 for the tailnet.
- These paths exist: `.demo/pids.json`, `.demo/logs/`, `.demo/logins.txt`, `.demo/secrets/`, `.demo/state/rp-origin.json` (gateway.ts:101, config.ts:10), `apps/web/dist-demo/` (.gitignore:17), `~/x2f-comms/.comms-push`, and the codes page `/__demo/codes` (codes-page.ts:2).
- These tools/demo files exist: door.ts, guard.ts, moderator.ts, self-origin.ts and phone.ts.
- Accounts and password match seed.ts:81-107: three personal accounts, five cast accounts, and ana-demo is a vendor.
- Push behaviour matches the code. The status texts "Saved on this computer — not on GitHub yet" and "On GitHub" are at notes.js:187-189. `DEMO_NOTES_PUSH=0` is handled at notes-push.ts:50, and the 30 s wait is at notes-push.ts:60. The "Download my notes" button is at notes.js:177.
- The security-key part matches rp-adopt.ts:1-24: open the page in its own tab, and `DEMO_ADOPT_HOST` pins the host.

## Blocking

B1. The quick start is not the owner's real procedure (docs/demo.md:9-27). The owner runs the demo on his Windows PC, inside WSL, with:
`cd ~/x2f && git fetch && git checkout wip/third-demo-r3 && git pull && npm ci && npm run demo`
He then opens http://localhost:4400 in his Windows browser. The doc says only `git checkout wip/third-demo-r3` and then `npm run demo`, and it never says where to type them. As written:
- with no `cd ~/x2f`, the commands run in whatever folder the terminal opened in;
- with no `git fetch` / `git pull`, he runs yesterday's code;
- with no `npm ci`, new dependencies are missing and the start fails.

Fix: replace steps 1-3 with:
```
1. Open Ubuntu (WSL) from the Windows Start menu.
2. Paste this line and press Enter (it gets the newest demo and starts it; the first start takes a few minutes):
   cd ~/x2f && git fetch && git checkout wip/third-demo-r3 && git pull && npm ci && npm run demo
3. When it prints "X2F demo is running", open http://localhost:4400 in Chrome or Edge on Windows.
4. To stop: in the same Ubuntu window, cd ~/x2f && npm run demo:stop
```
Also add one line before step 2: "If a demo is already running, stop it first (step 4) before you update." That stops `npm ci` from replacing node_modules while the old demo's processes still use them.

B2. The manual push fallback would commit to the demo branch, and its push would fail (docs/demo.md:153-163). These commands run in ~/x2f, which has wip/third-demo-r3 checked out:
```
cp ... owner-demo-notes-<date>.jsonl
git add ...
git commit ...
git push origin comms
```
What happens:
- The note file is committed onto the local wip/third-demo-r3. The next `git pull` then has to merge, and may open an editor or fail.
- `git push origin comms` pushes a local `comms` branch that does not exist ("src refspec comms does not match any").
- It also copies demo-notes.jsonl, which is only the raw comments. It has no numbers, no replies and no resolved threads. The file from the "Download my notes" button has all of them (notes-server.ts:618).

Fix: replace step 2 with a separate folder that never touches ~/x2f's branch. Use the downloaded file, which lands in Windows Downloads, so in WSL it is under /mnt/c/Users/<your Windows name>/Downloads/:
```
cd ~/x2f && git fetch origin comms
git worktree add --detach ~/x2f-comms-manual origin/comms
cp /mnt/c/Users/<your Windows name>/Downloads/owner-demo-notes-<date>.jsonl ~/x2f-comms-manual/
cd ~/x2f-comms-manual && git add owner-demo-notes-<date>.jsonl && git commit -m "owner demo notes <date>" && git push origin HEAD:comms
cd ~/x2f && git worktree remove ~/x2f-comms-manual
```
Then add: "If the push is refused because comms moved, send the downloaded file to the lead instead." The orders' `cp ~/x2f-comms/demo-notes.jsonl ...` line can stay, but only as the fallback for when the download button cannot be used, and it still goes into the separate folder.

B3. "To share the demo securely" (docs/demo.md:227) is wrong and unsafe. A Cloudflare quick tunnel is public. demo.ts prints "anyone with this URL can open it". Anyone who has the link can open the demo and sign up. The old text said this in bold.

Fix: replace the line with: "**A public link, only when you ask for one.** `DEMO_TUNNEL=cloudflared npm run demo` makes a public web address (needs `cloudflared` installed). Anyone who has that address can open the demo and sign up. It is fake money only, and the link ends at `npm run demo:stop`."

## Minor

M1. The codes page does not refresh every 30 s (docs/demo.md:98). The page reloads itself at least every 10 s (meta refresh `min(left, 10)`, codes-page.ts:33) and shows "New codes in N s". Also, `npm run demo` prints only the `Open:` URL and the `Logins:` line, not the codes page (demo.ts:250-259), so docs/demo.md:21-23 claims too much. Fix: "The page shows each account's current code and updates itself every few seconds", and "it prints the address to open (http://localhost:4400)".

M2. The phone part (docs/demo.md:94) does not match the setup. Under WSL, a phone cannot reach http://localhost:4400 on the PC. The phone only works over the tailnet (https on 4443, when Tailscale runs inside the demo's Linux) or with the Android Terminal setup. Fix: "Open it in another browser tab on this PC."

M3. The push timing is wrong (docs/demo.md:147). It says "30 seconds after any new comment, reply, or resolution". A reply made with `npm run demo:reply` does not start a push: reply.ts never calls onChange, and only notes-server.ts:593 and :605 do. Fix: "30 seconds after a new comment, follow-up or Resolve".

M4. `demo:reply` is the lead's tool, not the owner's (docs/demo.md:133-136; reply.ts:2 calls it "The lead's reply"). Fix: start the paragraph with "For the lead:". Then add: "The owner adds to a thread by tapping its pin and typing there."

M5. The "Pre-seeded offers" column says "Active demo offers (USD/CAD)" for every cast account (docs/demo.md:79-83). seed.ts:81-99 gives:
- satoshi: USD sell (Zelle, Cash App)
- mira: CAD sell and buy (Interac)
- nightowl: USD buy (Zelle) and sell (Venmo)
- kettle: USD and CAD sell (Amazon gift cards)
- lowtide: CAD sell (Wise) and USD buy (PayPal)

Fix: list each account's offers like that, so the owner knows where to find a buy offer and a sell offer.

M6. The "Fixed issues" paragraph changed the advice (docs/demo.md:216). The original said: do not reload a trader's page mid-trade, because a reload reopens the regtest escrow wallet, which cannot send in the browser. Keep each trader's page open from take to settled. The new line ties the advice to "co-signing" instead. Fix: "Don't reload a trader's page in the middle of a trade; keep each trader's page open from taking the offer until it says settled."

M7. Funding (docs/demo.md:202) dropped one trigger: "or completes the hold that opens the wallet app". Fix: add it back. The faucet also pays when the seller uses that button.

M8. Security keys (docs/demo.md:183-186) leave out a fact the owner will hit: only the first adopted host is kept, and keys then work under that host only, not on localhost (rp-adopt.ts:15-16). Fix: add "After that, security keys and passkeys work only on that address; restart the demo to go back to localhost."

M9. The rewrite deleted the developer reference that the code points to. tools/demo/*.ts headers say "see docs/demo.md". The deleted parts covered:
- what a comment records and what it never reads;
- the `/__demo/*` limits;
- `DEMO_NOTES_FILE` and `DEMO_NOTES_SEED`;
- `DEMO_PUBLIC_ORIGIN` and `DEMO_PUBLIC_NODE_ORIGIN`;
- the guard details and their test files.

Fix: keep the owner text at the top. Move the removed paragraphs, unchanged from b1172d63:docs/demo.md, into a final section "For developers".

M10. Add one WSL line under Requirements (docs/demo.md:31-37): "On Windows: Docker Desktop with WSL integration turned on for Ubuntu (or Docker installed inside Ubuntu), and run everything in the Ubuntu window, not in PowerShell."
