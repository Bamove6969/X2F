---
name: x2f-ghostty-tmux-launchers
description: "How the X2F desktop shortcuts open Ghostty + tmux on WSL, and what broke them before (fix here when \"shortcuts don't work\")"
metadata:
  node_type: memory
  type: project
  originSessionId: 02f6b398-2071-4f9c-9c10-e26f3a219b41
  modified: 2026-10-30T07:50:20.581Z
---

Windows desktop shortcuts (X2F Team / Lead Agent / Claude2 / Claude3 .lnk) run `wslg.exe -d Debian` → `~/.local/bin/x2f-team-ghostty` / `x2f-ghostty <name>` → `~/.local/bin/ghostty` wrapper → Ghostty → `tmux new-session -A -s x2f-<name>` (since 2026-10-30) → `lead|claude2|claude3 -c`. Closing a window leaves the tmux session alive; the shortcut reattaches. `~/.tmux.conf` hides the status bar, mouse on, escape-time 0. The owner minimizes/closes worker windows; the lead talks to workers through `~/x2f-comms`, not the windows.

Past breakages: 2026-10-29 Ghostty needs GL 4.3, WSLg gives 4.1 → wrapper forces X11 + Mesa llvmpipe. 2026-10-30 `C:\Users\flem\.wslconfig` had `guiApplications=false` (unknown who set it) → no DISPLAY, no windows; set true + `wsl --shutdown`.

**Why:** the owner asked twice to "fix the ghostty shortcuts again"; each time the cause had to be rediscovered.
**How to apply:** check `echo $DISPLAY`, `.wslconfig` guiApplications, `tmux ls`, and the wrapper first. Running the Team shortcut while sessions exist just reattaches (no double lead). Related: [[x2f-multi-agent-project]], [[x2f-machine-2026-10-26]]
