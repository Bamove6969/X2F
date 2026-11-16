# agy: where to work (from claude2, on the OWNER's order, 16 Nov 2026)

These rules win over anything you find on the computer. Read all of it before your next command.

## 1. Never use local files or old folders
- **Do not open, read, search, copy from or run anything in any existing folder on this computer.** That includes
  `~/x2f`, `~/X2F`, `~/x2f-comms`, `/mnt/c/...`, Desktop, Downloads, or any other X2F copy. They are old.
- No `find`, `ls`, `grep` or `cat` outside your own workspace (section 2). If you need a file, it comes from GitHub,
  through your workspace's git.
- The ONLY source of truth is the GitHub repository **`https://github.com/Bamove6969/X2F`** (remote name `origin`).

## 2. Your one workspace
Create it once, in a brand-new empty folder, then never work anywhere else:
```sh
mkdir -p ~/agy-x2f && cd ~/agy-x2f
git clone https://github.com/Bamove6969/X2F.git repo
cd repo
git fetch origin
```
For each job, use its own worktree inside the same workspace (so your 4 sub-agents never share a folder):
```sh
cd ~/agy-x2f/repo
git fetch origin
git worktree add ~/agy-x2f/<job> -b wip/agy-<job> origin/wip/third-demo-r3
cd ~/agy-x2f/<job> && nvm use 24 && npm ci
```
For comms (orders, READY lines), a separate worktree:
```sh
cd ~/agy-x2f/repo
git worktree add ~/agy-x2f/comms --detach origin/comms
# each time you post: cd ~/agy-x2f/comms && git fetch origin comms && git checkout --detach origin/comms
#   append your line; git add to-lead.log; git commit -m "agy: <job> ready"; git push origin HEAD:comms
#   (if rejected: git fetch origin comms && git rebase origin/comms && git push origin HEAD:comms; never force)
```
Before EVERY command that reads or writes code, check you are inside `~/agy-x2f/`: `pwd` must start with it.

## 3. Branches ("sub categories")
| What | Branch | You may |
| --- | --- | --- |
| Base for every new job | `origin/wip/third-demo-r3` (the owner's current demo, head 1fa6bed1 or newer) | branch FROM it, never push to it |
| Your work | `wip/agy-<job>` (one per job, e.g. `wip/agy-a11y`) | create, commit, push (`git push -u origin wip/agy-<job>`) |
| Fixing a review on an existing job | the same `wip/agy-<job>` branch | add commits; never rewrite or force-push |
| Orders and messages | `comms`: read `AGY-ORDERS.md`, `AGY-ORDERS-2.md`, `AGY-ORDERS-3.md`, `to-agy.log`, `review-agy-*.md` | append ONE line to `to-lead.log` per CLAIM / READY / BLOCKED; nothing else |
| Owner's notes and decisions | `comms`: `owner-demo-notes-*.jsonl`, `owner-decisions-2026-11-06.md`, `owner-answers-register.md`, OWNER DECISION lines in `to-lead.log` | read only |
| Everything else: `main`, `wip/lead-*`, `wip/second-*`, `wip/third-*`, `claude/*`, `dependabot/*` | — | read only (you may `git show`/`git diff` them); never push, merge into them or check them out to edit |

To read a comms file without leaving your job: `git -C ~/agy-x2f/repo show origin/comms:<file>`.
Your existing branches (landing, setup-flow, recovery-copy, unsigned-copy, notes-audit, wallet-research) are on GitHub;
to fix one: `git -C ~/agy-x2f/repo fetch origin && git -C ~/agy-x2f/repo worktree add ~/agy-x2f/<job> wip/agy-<job>`
(it tracks `origin/wip/agy-<job>`; `git pull` before editing).

## 4. Allowed `git -C` commands
`git -C ~/agy-x2f/<something> status|log|diff|show|fetch|add|commit|worktree|pull|push origin wip/agy-<job>|push origin HEAD:comms`.
Never: `--force`/`-f`, `reset --hard`, `clean`, `branch -D`, `push` to any branch not named in section 3, or `-C` pointing outside `~/agy-x2f/`.

## 5. Off-limits work (owner-decided; claude2 is building it)
Fonts, font sizes and font weights; orange/primary button text size; the TOTP / login-method rules and the
`/setup/login`, `/setup/authenticator`, `/setup/security-key` screens; demo notes numbering (Job 14);
and everything in AGY-ORDERS.md rule 5 (money, escrow, keys, login security, payouts, disputes, liens, fees).

## 6. Clock
Your commits are stamped about 1 hour in the future. Run `date -u` and compare with real UTC; fix the clock if it is off.
