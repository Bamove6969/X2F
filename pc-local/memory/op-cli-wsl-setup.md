---
name: op-cli-wsl-setup
description: How 1Password CLI is set up in this WSL box (op -> Windows op.exe via desktop app integration)
metadata:
  node_type: memory
  type: reference
  originSessionId: 476e1095-fd6c-47c7-9ca5-5166af75dcd8
  modified: 2026-10-26T17:55:09.743Z
---

`~/.local/bin/op` is a symlink to the Windows winget-installed `op.exe` (AgileBits.1Password.CLI under %LOCALAPPDATA%\Microsoft\WinGet\Packages). Linux binary kept at `~/.local/bin/op-linux`.
The account (my.1password.ca) uses an MFA type the CLI can't do by itself ("MFA Type Not Supported"), so auth goes through the 1Password Windows desktop app (Store version) with "Integrate with 1Password CLI" enabled. No sudo without password in WSL (Debian 13).
Related: [[x2f-multi-agent-project]]
