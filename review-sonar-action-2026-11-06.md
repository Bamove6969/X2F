# Review: origin/wip/lead-sonar-action @8cfa0d4 (SonarQube Cloud CI scan)

Reviewer: read-only helper, 2026-11-06.
Scope: `.github/workflows/sonarqube.yml` (33 lines, new) and `sonar-project.properties` (7 lines, new).

Base note: the branch's merge base with origin/main is **a779ef97**, not 16f37629. origin/main (= origin/claude/compassionate-johnson-k95ssr, both at 16f37629) is one merge ahead. The three-dot diff touches only the two files above. A two-dot diff against 16f37629 also shows the claude2 selection-ink changes being reverted (selection-ink.test.ts, CSS, 36 PNGs). That is just the stale base: **merge** the branch (or rebase it onto 16f37629). Do not check out its tree over the main line.

`tools/sonar-scan.sh` is **not in the repo on any branch**. I compared against `~/x2f-comms/tools/sonar-scan.sh`, the only copy. The comment "Same scope as the local scan" points at a script outside the repo.

## Verdict: APPROVED WITH MINOR

No Important findings. 4 Minor findings and 1 Nit, all optional hardening.

## Checks

| # | Check | Result |
|---|-------|--------|
| 1a | actions/checkout pinned to a full SHA with a version comment | PASS: `3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`. `git ls-remote` shows refs/tags/v7.0.1 and refs/tags/v7 both point at that commit (lightweight tags, so there is no `^{}` line). |
| 1b | SonarSource/sonarqube-scan-action pinned the same way | PASS: `e805d875275f728fac1885b413934be6d7c63f65 # v8.4.1`. `git ls-remote` shows refs/tags/v8.4.1, v8.4 and v8 all at that commit. It is the latest v8 tag. |
| 1c | Any other third-party actions | None. Only these two `uses:`. |
| 2a | Top-level `permissions:` | PASS: `contents: read` only. No job-level override. |
| 2b | No `pull_request_target` or `pull_request` | PASS: the triggers are `push` to main and `workflow_dispatch`. Fork PRs never run it, so the secret is never exposed to them. |
| 2c | Untrusted input in `run:` | PASS: there is no `run:` step. The only interpolation is `vars.SONAR_ORGANIZATION` and `vars.SONAR_PROJECT_KEY` into the action's `args`. Repo admins set those values, and v6+ of the action parses `args` without a shell (the README notes the command-injection fix). |
| 2d | `persist-credentials: false` | PASS. |
| 2e | fetch-depth | PASS: `0`, as Sonar recommends for blame and new-code data. |
| 3a | Off without a project key | PASS: `if: vars.SONAR_PROJECT_KEY != ''` is a job-level `if` on `vars`, which is allowed. An unset repo variable evaluates to `''`, so the job is **skipped**, not failed. A skipped job does not turn the commit red. No `secrets.*` appears in any `if`. |
| 3b | Missing token cannot fail red on every push | PARTIAL: see M1. The guard checks only the project key. |
| 4 | Properties match the local scan | PASS: `sonar.sources=.`, `sonar.tests=.`, `sonar.exclusions` (= EXCLUSIONS + TESTS), `sonar.test.inclusions` (= TESTS), `sonar.test.exclusions` and `sonar.sourceEncoding` all match **exactly**. I compared the strings in a shell, not by eye. See the differences list below. |
| 5a | Triggers and concurrency | OK. `group: sonarqube` with `cancel-in-progress: true`: see M3. |
| 5b | Timeout | PASS: `timeout-minutes: 30`. A local full scan takes about 4 min. |
| 5c | Runner pinning | `ubuntu-latest`: see N1. |
| 5d | Leaks to third parties | OK. Source code and blame data go to SonarQube Cloud (the default host: no `SONAR_HOST_URL` is set, and the README says Cloud needs none). The scanner CLI 8.3.1.16491 comes from binaries.sonarsource.com and is GPG-verified (`skipSignatureVerification` defaults to false). The JRE and analyzers come from SonarSource's own endpoints. GITHUB_TOKEN is not passed to the action, and `permissions` is read-only anyway. Nothing else leaves the runner. |
| lint | actionlint | Not installed. Skipped as briefed. I read the YAML by hand: no tabs, the structure is valid, and the expression syntax is correct. |

### Differences from ~/x2f-comms/tools/sonar-scan.sh (beyond the file scope settings, which are identical)
- `sonar.qualitygate.wait=true` / `timeout=600`: local only. In CI this is left out, so a failing quality gate does **not** turn the job red. I think that is the right choice while the project is new, but it is a choice: see Q2.
- `sonar.scm.provider=git`: local only. CI relies on auto-detection, which finds `.git` after checkout. No effect.
- `sonar.projectVersion=<short sha>`, `sonar.projectName`, `sonar.working.directory`, `sonar.projectBaseDir`: local only. These are environment details with no effect on scope. Without a projectVersion, the Cloud "new code since previous version" period would not advance; see Q3.
- `sonar.organization`: CI only, as Cloud requires.
- The local script passes every setting as `-D`, which overrides the properties file. Now that the file is at the repo root, local scans still behave the same.

## Important
None.

## Minor

**M1. `.github/workflows/sonarqube.yml:19,29`: the guard checks only the key, not the organization or the token.**
Scenario: the owner adds `SONAR_PROJECT_KEY`, but `SONAR_TOKEN` is misspelled or not added yet, or `SONAR_ORGANIZATION` is missing. Line 32 then sends `-Dsonar.organization=` with an empty value. Every push to main runs the job, the scanner fails on auth or the missing organization, and the commit shows a red X until all three are set. This is not a security issue and needs a mis-step during setup.
Fix (optional):
```yaml
    if: vars.SONAR_PROJECT_KEY != '' && vars.SONAR_ORGANIZATION != ''
    env:
      HAS_SONAR_TOKEN: ${{ secrets.SONAR_TOKEN != '' }}
    steps:
      - if: env.HAS_SONAR_TOKEN != 'true'
        run: echo "::warning::SONAR_TOKEN is not set; skipping the scan" 
      # ...and add `if: env.HAS_SONAR_TOKEN == 'true'` to the checkout and scan steps
```
`secrets` can be read in job-level `env`, and `env` is available in step `if`. Alternatively, keep the code as it is and have the header comment say "set the token first, then the variables".

**M2. `.github/workflows/sonarqube.yml:8`: `workflow_dispatch` scans any branch a collaborator picks.**
Scenario: someone runs the workflow from the Actions tab on `wip/foo`. If that branch has the workflow file (any branch cut after this merges will), the scan sends that branch's code to Cloud with the secret. Cloud then either records a branch analysis or, on a plan without branch analysis, fails. Anyone with write access can already edit workflows, so this grants nobody new access. It only matters if Q1 says only main should ever leave the PC. Optional fix: add `github.ref == 'refs/heads/main' &&` to the `if:`.

**M3. `.github/workflows/sonarqube.yml:13-15`: `cancel-in-progress: true` with a fixed group.**
Scenario: two merges land on main within about 4 minutes. The first scan is cancelled and only the second is analysed. That is fine for Sonar, which keeps the latest state. But a run cancelled during upload can leave an orphaned background task on Cloud, and the Actions tab shows grey "cancelled" runs. Harmless. `cancel-in-progress: false` would queue the scans instead (GitHub keeps at most one pending run), so every main commit gets analysed. Either is defensible. I lean to `false` for a complete history.

**M4. `sonar-project.properties:1`: the "same scope as the local scan" claim cannot be checked from the repo.**
Scenario: someone later edits `~/x2f-comms/tools/sonar-scan.sh`, which lives outside git, and the CI scope silently drifts. Optional fix: have the local script read scope from this properties file (drop the `-D` scope flags; the scanner already reads `sonar-project.properties` from the base dir), or name the script's path in the comment.

## Nit
**N1. `.github/workflows/sonarqube.yml:20`: `ubuntu-latest` is not pinned.** The job only checks out code and runs a JS action on node24 that downloads a Java scanner. A runner image change is unlikely to break it, so this is acceptable. Pin `ubuntu-24.04` only for strict reproducibility.

## Open questions (security/product calls, for the lead to take to the owner)
- **Q1. Is sending the full private source and git history (author names and emails, through blame) to SonarQube Cloud OK?** This is the first CI path that ships code to a third party. The local setup was built so that "nothing leaves this PC". Recommendation: if the owner already chose Cloud on 2026-11-06, record it in HANDOFF "Decided" and confirm the project is **private** on Cloud (the default for a private repo import). Also check the Free plan's private-LOC limit against the repo size.
- **Q2. Should a failing quality gate turn main red?** Recommendation: leave it off for now (as on the branch). Revisit once the backlog from the local scan is triaged, then add `-Dsonar.qualitygate.wait=true`.
- **Q3. Should Cloud's new-code period follow versions or days?** Recommendation: set the new-code definition in the Cloud UI to "previous version" plus `-Dsonar.projectVersion=${{ github.sha }}`, or simply "number of days = 30". Without either, "new code" may never advance.
- **Q4. Actions minutes:** the repo is PRIVATE, so each main push costs about 5 min from the monthly quota. Acceptable at the current merge rate. Noted for awareness only.

## What I ran
- `git fetch`, `git merge-base`, `git diff --stat` (two-dot and three-dot), and `git show` of both files at 8cfa0d4.
- `git ls-remote https://github.com/actions/checkout 'refs/tags/v7*'` and the same for SonarSource/sonarqube-scan-action `v8*`. Both SHAs match their tags.
- `gh api` for `action.yml` and README.md of sonarqube-scan-action at e805d875 (inputs, GPG verification default, default Cloud host, args parsing). `gh repo view` showed the default branch is `main`, the repo is PRIVATE, and origin/main equals the main line (16f37629, 0/0 ahead/behind).
- Exact shell string comparison of the properties against the EXCLUSIONS/TESTS strings in `~/x2f-comms/tools/sonar-scan.sh`.
- actionlint is not available, so I skipped it. No tests or worktree were needed, and I took no lock.
